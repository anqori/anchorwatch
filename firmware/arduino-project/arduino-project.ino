#include <Arduino.h>
#include <Preferences.h>
#include <WiFi.h>

#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>

#include <ctype.h>

#ifndef LED_BUILTIN
#define LED_BUILTIN 2
#endif

// Hardware pin baseline for bring-up.
static const int SIREN_PIN = 4;
static const int STATUS_LED_PIN = LED_BUILTIN;

// Identity defaults.
#ifndef ANQORI_BUILD_VERSION
#define ANQORI_BUILD_VERSION "run-unknown"
#endif
static const char *FW_VERSION = ANQORI_BUILD_VERSION;
static const char *BLE_DEVICE_NAME_PREFIX = "Anqori-AnchorWatch-";
static const char *DEFAULT_BOAT_ID_PREFIX = "boat_";
static const char *DEFAULT_DEVICE_ID_PREFIX = "dev_";
static const char *BOAT_SECRET_PREFIX = "am_bs_";

// Shared BLE GATT UUIDs.
static const char *BLE_SERVICE_UUID = "9f2d0000-87aa-4f4a-a0ea-4d5d4f415354";
static const char *BLE_CONTROL_TX_UUID = "9f2d0001-87aa-4f4a-a0ea-4d5d4f415354";
static const char *BLE_EVENT_RX_UUID = "9f2d0002-87aa-4f4a-a0ea-4d5d4f415354";
static const char *BLE_SNAPSHOT_UUID = "9f2d0003-87aa-4f4a-a0ea-4d5d4f415354";
static const char *BLE_AUTH_UUID = "9f2d0004-87aa-4f4a-a0ea-4d5d4f415354";

// Timing constants.
static const unsigned long MAIN_TICK_MS = 1000UL;
static const unsigned long BLE_CHUNK_TIMEOUT_MS = 2000UL;
static const unsigned long PAIR_MODE_TTL_MS = 10UL * 60UL * 1000UL;
static const unsigned long PRIV_SESSION_TTL_MS = 10UL * 60UL * 1000UL;
static const unsigned long WIFI_RETRY_MAX_MS = 30UL * 1000UL;
static const unsigned long WIFI_CONNECT_TIMEOUT_MS = 20UL * 1000UL;
static const size_t BLE_CHUNK_MAX_PAYLOAD = 120U;
static const unsigned long BLE_NOTIFY_INTER_CHUNK_DELAY_MS = 40UL;
static const unsigned long BLE_NOTIFY_RETRY_DELAY_MS = 150UL;
static const uint8_t BLE_NOTIFY_MAX_RETRIES = 1;
static const unsigned long BLE_NOTIFY_ENOMEM_BACKOFF_MS = 5000UL;
static const int BLE_NOTIFY_NIMBLE_ENOMEM = 6;

// Fake telemetry route area: 200m radius around Plueschowhafen, Kiel.
static const float SIM_CENTER_LAT_DEG = 54.38329f;
static const float SIM_CENTER_LON_DEG = 10.16349f;
static const float SIM_RADIUS_M = 200.0f;
static const float SIM_METERS_PER_DEG_LAT = 111320.0f;
static const float SIM_KNOTS_PER_MPS = 1.94384f;
static const float SIM_MIN_SOG_KN = 0.4f;
static const float SIM_MAX_SOG_KN = 2.4f;
static const float SIM_HEADING_JITTER_DEG = 32.0f;
static const float SIM_MIN_DT_SEC = 0.2f;
static const float SIM_MAX_DT_SEC = 2.5f;
static const int SIM_WIFI_SCAN_MAX_RESULTS = 32;

enum AlarmLevel {
  ALARM_NONE = 0,
  ALARM_WARNING,
  ALARM_FULL
};

enum InboundSource {
  INBOUND_BLE = 0,
  INBOUND_WLAN = 1
};

struct TelemetrySample {
  bool gpsValid;
  float latDeg;
  float lonDeg;
  float cogDeg;
  float sogKnots;
  float depthM;
  float windKnots;
  float windDirDeg;
  uint32_t gpsAgeMs;
  uint32_t dataAgeMs;
};

struct WiFiConfig {
  String ssid;
  String passphrase;
  String security;
  bool hidden;
  String country;
  int version;
};

struct ParsedEnvelope {
  String reqId;
  String command;
};

struct TrackPointSample {
  unsigned long tsMs;
  float latDeg;
  float lonDeg;
  float cogDeg;
  float headingDeg;
  float sogKnots;
};

struct BleChunkAssembler {
  static const uint8_t MAX_PARTS = 24;
  bool active;
  uint32_t msgId32;
  uint8_t partCount;
  unsigned long startedMs;
  String parts[MAX_PARTS];
  bool received[MAX_PARTS];
};

TelemetrySample sample = {};
AlarmLevel alarmLevel = ALARM_NONE;
unsigned long bootMs = 0;
unsigned long lastTickMs = 0;
unsigned long lastBleStatusAtMs = 0;
unsigned long pairModeUntilMs = 0;
unsigned long privSessionUntilMs = 0;
unsigned long wifiNextAttemptMs = 0;
unsigned long wifiRetryDelayMs = 1000UL;

bool debugProtocol = true;
bool bleConnected = false;
bool wifiConnectPending = false;
bool pairModeWasActive = false;
bool anchorPositionValid = false;
bool activeConnectWifiInFlight = false;

uint32_t txMsgCounter = 1;

String boatId;
String deviceId;
String boatSecret;
String wifiLastError = "";
String anchorState = "up";
WiFiConfig wifiConfig = {};
BleChunkAssembler bleAssembler = {};
float anchorLat = 0.0f;
float anchorLon = 0.0f;
bool simMotionInitialized = false;
unsigned long simLastUpdateMs = 0;
float simOffsetEastM = 0.0f;
float simOffsetNorthM = 0.0f;
float simCogDeg = 0.0f;
float simSogKnots = 0.0f;
unsigned long lastAnchorDownAtMs = 0;
unsigned long activeConnectWifiStartedAtMs = 0;
unsigned long lastStreamedSampleAtMs = 0;
uint32_t versionPosition = 1;
uint32_t versionNavData = 1;
uint32_t versionAlarmState = 1;
uint32_t versionAnchorPosition = 1;
uint32_t versionAlarmConfig = 1;
uint32_t versionAnchorSettings = 1;
uint32_t versionProfiles = 1;
uint32_t versionWlanConfig = 1;
String activeGetDataReqId = "";
String activeConnectWifiReqId = "";
String storedAlarmConfigJson = "{}";
String storedAnchorSettingsJson = "{}";
String storedProfilesJson = "{}";
static const size_t TRACK_HISTORY_CAPACITY = 2048U;
TrackPointSample trackHistory[TRACK_HISTORY_CAPACITY];
size_t trackHistoryCount = 0;
size_t trackHistoryNextIndex = 0;

BLEServer *bleServer = nullptr;
BLEService *bleService = nullptr;
BLECharacteristic *controlTxCharacteristic = nullptr;
BLECharacteristic *eventRxCharacteristic = nullptr;
BLECharacteristic *snapshotCharacteristic = nullptr;
BLECharacteristic *authCharacteristic = nullptr;
BLECharacteristicCallbacks::Status bleLastEventNotifyStatus = BLECharacteristicCallbacks::Status::SUCCESS_NOTIFY;
uint32_t bleLastEventNotifyCode = 0;
bool bleLastEventNotifyValid = false;
bool bleEventSubscriberActive = false;
unsigned long bleNotifyBackoffUntilMs = 0;

void resetBleAssembler() {
  bleAssembler.active = false;
  bleAssembler.msgId32 = 0;
  bleAssembler.partCount = 0;
  bleAssembler.startedMs = 0;
  for (uint8_t i = 0; i < BleChunkAssembler::MAX_PARTS; i++) {
    bleAssembler.parts[i] = "";
    bleAssembler.received[i] = false;
  }
}

bool isPairModeActive(unsigned long nowMs) {
  return nowMs < pairModeUntilMs;
}

bool isPrivilegedSessionActive(unsigned long nowMs) {
  return isPairModeActive(nowMs) && nowMs < privSessionUntilMs;
}

void setSiren(bool enabled) {
  digitalWrite(SIREN_PIN, enabled ? HIGH : LOW);
}

String sourceName(InboundSource source) {
  if (source == INBOUND_WLAN) {
    return "wlan";
  }
  return "ble";
}

String toHex(uint64_t value, uint8_t width) {
  String out = "";
  for (int8_t nibble = (int8_t)(width - 1); nibble >= 0; nibble--) {
    const uint8_t shift = (uint8_t)nibble * 4;
    const uint8_t digit = (value >> shift) & 0x0F;
    out += "0123456789abcdef"[digit];
  }
  return out;
}

String randomToken(size_t len) {
  static const char chars[] =
    "ABCDEFGHJKLMNPQRSTUVWXYZ"
    "abcdefghijkmnopqrstuvwxyz"
    "23456789";
  const size_t charCount = sizeof(chars) - 1;
  String out = "";
  out.reserve(len);
  for (size_t i = 0; i < len; i++) {
    out += chars[esp_random() % charCount];
  }
  return out;
}

float randomUnitF() {
  return (float)esp_random() / 4294967295.0f;
}

float randomRangeF(float minValue, float maxValue) {
  return minValue + (maxValue - minValue) * randomUnitF();
}

float normalizeHeadingDeg(float deg) {
  while (deg < 0.0f) {
    deg += 360.0f;
  }
  while (deg >= 360.0f) {
    deg -= 360.0f;
  }
  return deg;
}

void initSimMotion(unsigned long nowMs) {
  const float radius = SIM_RADIUS_M * sqrtf(randomUnitF());
  const float angle = randomRangeF(0.0f, TWO_PI);
  simOffsetEastM = radius * cosf(angle);
  simOffsetNorthM = radius * sinf(angle);
  simCogDeg = randomRangeF(0.0f, 360.0f);
  simSogKnots = randomRangeF(SIM_MIN_SOG_KN, SIM_MAX_SOG_KN);
  simLastUpdateMs = nowMs;
  simMotionInitialized = true;
}

void updateSimMotion(unsigned long nowMs) {
  if (!simMotionInitialized) {
    initSimMotion(nowMs);
    return;
  }

  float dtSec = (float)(nowMs - simLastUpdateMs) / 1000.0f;
  simLastUpdateMs = nowMs;
  if (dtSec < SIM_MIN_DT_SEC) {
    dtSec = SIM_MIN_DT_SEC;
  } else if (dtSec > SIM_MAX_DT_SEC) {
    dtSec = SIM_MAX_DT_SEC;
  }

  simCogDeg = normalizeHeadingDeg(simCogDeg + randomRangeF(-SIM_HEADING_JITTER_DEG, SIM_HEADING_JITTER_DEG));
  const float targetSogKnots = randomRangeF(SIM_MIN_SOG_KN, SIM_MAX_SOG_KN);
  simSogKnots += (targetSogKnots - simSogKnots) * 0.35f;
  if (simSogKnots < SIM_MIN_SOG_KN) {
    simSogKnots = SIM_MIN_SOG_KN;
  } else if (simSogKnots > SIM_MAX_SOG_KN) {
    simSogKnots = SIM_MAX_SOG_KN;
  }

  const float speedMps = simSogKnots / SIM_KNOTS_PER_MPS;
  const float headingRad = simCogDeg * DEG_TO_RAD;
  const float eastVelMps = sinf(headingRad) * speedMps;
  const float northVelMps = cosf(headingRad) * speedMps;

  float nextEastM = simOffsetEastM + eastVelMps * dtSec;
  float nextNorthM = simOffsetNorthM + northVelMps * dtSec;
  const float distanceM = sqrtf((nextEastM * nextEastM) + (nextNorthM * nextNorthM));
  if (distanceM > SIM_RADIUS_M) {
    const float scale = SIM_RADIUS_M / distanceM;
    nextEastM *= scale;
    nextNorthM *= scale;
    const float inwardCogDeg = atan2f(-nextEastM, -nextNorthM) * 180.0f / PI;
    simCogDeg = normalizeHeadingDeg(inwardCogDeg + randomRangeF(-25.0f, 25.0f));
  }

  simOffsetEastM = nextEastM;
  simOffsetNorthM = nextNorthM;
}

void persistIdentity() {
  Preferences prefs;
  prefs.begin("am_cfg", false);
  prefs.putString("boat_id", boatId);
  prefs.putString("boat_sec", boatSecret);
  prefs.end();
}

void persistWiFiConfig() {
  Preferences prefs;
  prefs.begin("am_cfg", false);
  prefs.putString("w_ssid", wifiConfig.ssid);
  prefs.putString("w_pass", wifiConfig.passphrase);
  prefs.putString("w_sec", wifiConfig.security);
  prefs.putBool("w_hid", wifiConfig.hidden);
  prefs.putString("w_ctr", wifiConfig.country);
  prefs.putInt("cfg_ver", wifiConfig.version);
  prefs.end();
}

void loadPersistentState() {
  const uint64_t chip = ESP.getEfuseMac();
  deviceId = String(DEFAULT_DEVICE_ID_PREFIX) + toHex(chip & 0xFFFFFFFFULL, 8);

  Preferences prefs;
  prefs.begin("am_cfg", true);
  boatId = prefs.getString("boat_id", "");
  boatSecret = prefs.getString("boat_sec", "");
  wifiConfig.ssid = prefs.getString("w_ssid", "");
  wifiConfig.passphrase = prefs.getString("w_pass", "");
  wifiConfig.security = prefs.getString("w_sec", "wpa2");
  wifiConfig.hidden = prefs.getBool("w_hid", false);
  wifiConfig.country = prefs.getString("w_ctr", "");
  wifiConfig.version = prefs.getInt("cfg_ver", 0);
  prefs.end();

  if (boatId.length() == 0) {
    boatId = String(DEFAULT_BOAT_ID_PREFIX) + toHex(chip & 0xFFFFFFFFULL, 8);
  }
  if (boatSecret.length() == 0) {
    boatSecret = String(BOAT_SECRET_PREFIX) + randomToken(32);
  }
  persistIdentity();
}

String jsonEscape(const String &in) {
  String out = "";
  out.reserve(in.length() + 8);
  for (size_t i = 0; i < in.length(); i++) {
    const char c = in[i];
    if (c == '\\' || c == '"') {
      out += '\\';
      out += c;
      continue;
    }
    if (c == '\n') {
      out += "\\n";
      continue;
    }
    if (c == '\r') {
      out += "\\r";
      continue;
    }
    if (c == '\t') {
      out += "\\t";
      continue;
    }
    out += c;
  }
  return out;
}

String jsonString(const String &in) {
  return String("\"") + jsonEscape(in) + "\"";
}

String jsonBool(bool value) {
  return value ? "true" : "false";
}

void appendJsonField(String &json, bool &first, const String &key, const String &rawValue) {
  if (!first) {
    json += ",";
  }
  first = false;
  json += jsonString(key);
  json += ":";
  json += rawValue;
}

int skipWs(const String &json, int index) {
  while (index < (int)json.length() && isspace((unsigned char)json[index])) {
    index++;
  }
  return index;
}

int findKeyColon(const String &json, const String &key, int fromIndex = 0) {
  const String needle = String("\"") + key + "\"";
  int keyIndex = json.indexOf(needle, fromIndex);
  while (keyIndex >= 0) {
    const int colon = json.indexOf(':', keyIndex + needle.length());
    if (colon >= 0) {
      return colon;
    }
    keyIndex = json.indexOf(needle, keyIndex + needle.length());
  }
  return -1;
}

bool extractJsonStringValue(const String &json, const String &key, String &out) {
  const int colon = findKeyColon(json, key);
  if (colon < 0) {
    return false;
  }
  int index = skipWs(json, colon + 1);
  if (index >= (int)json.length() || json[index] != '"') {
    return false;
  }
  index++;
  bool escaped = false;
  String value = "";
  for (; index < (int)json.length(); index++) {
    const char c = json[index];
    if (escaped) {
      value += c;
      escaped = false;
      continue;
    }
    if (c == '\\') {
      escaped = true;
      continue;
    }
    if (c == '"') {
      out = value;
      return true;
    }
    value += c;
  }
  return false;
}

bool extractJsonBoolValue(const String &json, const String &key, bool &out) {
  const int colon = findKeyColon(json, key);
  if (colon < 0) {
    return false;
  }
  const int index = skipWs(json, colon + 1);
  if (json.startsWith("true", index)) {
    out = true;
    return true;
  }
  if (json.startsWith("false", index)) {
    out = false;
    return true;
  }
  return false;
}

bool extractJsonIntValue(const String &json, const String &key, int &out) {
  const int colon = findKeyColon(json, key);
  if (colon < 0) {
    return false;
  }
  int index = skipWs(json, colon + 1);
  const int start = index;
  if (index < (int)json.length() && json[index] == '-') {
    index++;
  }
  while (index < (int)json.length() && isdigit((unsigned char)json[index])) {
    index++;
  }
  if (index == start || (index == start + 1 && json[start] == '-')) {
    return false;
  }
  out = json.substring(start, index).toInt();
  return true;
}

bool extractJsonFloatValue(const String &json, const String &key, float &out) {
  const int colon = findKeyColon(json, key);
  if (colon < 0) {
    return false;
  }
  int index = skipWs(json, colon + 1);
  const int start = index;
  if (index < (int)json.length() && (json[index] == '-' || json[index] == '+')) {
    index++;
  }
  bool seenDigit = false;
  while (index < (int)json.length()) {
    const char c = json[index];
    if (isdigit((unsigned char)c)) {
      seenDigit = true;
      index++;
      continue;
    }
    if (c == '.' || c == 'e' || c == 'E' || c == '-' || c == '+') {
      index++;
      continue;
    }
    break;
  }
  if (!seenDigit) {
    return false;
  }
  out = json.substring(start, index).toFloat();
  return true;
}

bool extractJsonRawValue(const String &json, const String &key, String &out) {
  const int colon = findKeyColon(json, key);
  if (colon < 0) {
    return false;
  }
  int index = skipWs(json, colon + 1);
  if (index >= (int)json.length()) {
    return false;
  }

  const char first = json[index];
  if (first == '{' || first == '[') {
    const char openChar = first;
    const char closeChar = first == '{' ? '}' : ']';
    int depth = 0;
    bool inString = false;
    bool escaped = false;
    for (int cursor = index; cursor < (int)json.length(); cursor++) {
      const char c = json[cursor];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (c == '\\') {
          escaped = true;
        } else if (c == '"') {
          inString = false;
        }
        continue;
      }
      if (c == '"') {
        inString = true;
        continue;
      }
      if (c == openChar) {
        depth++;
      } else if (c == closeChar) {
        depth--;
        if (depth == 0) {
          out = json.substring(index, cursor + 1);
          return true;
        }
      }
    }
    return false;
  }

  if (first == '"') {
    bool escaped = false;
    for (int cursor = index + 1; cursor < (int)json.length(); cursor++) {
      const char c = json[cursor];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c == '\\') {
        escaped = true;
        continue;
      }
      if (c == '"') {
        out = json.substring(index, cursor + 1);
        return true;
      }
    }
    return false;
  }

  int cursor = index;
  while (cursor < (int)json.length()) {
    const char c = json[cursor];
    if (c == ',' || c == '}' || c == ']') {
      break;
    }
    cursor++;
  }
  out = json.substring(index, cursor);
  out.trim();
  return out.length() > 0;
}

bool extractJsonIntFromObjectKey(const String &json, const String &objectKey, const String &itemKey, int &out) {
  String objectRaw = "";
  if (!extractJsonRawValue(json, objectKey, objectRaw)) {
    return false;
  }
  return extractJsonIntValue(objectRaw, itemKey, out);
}

bool extractJsonStringByAnyKey(const String &json, const String &primary, const String &fallback, String &out) {
  if (extractJsonStringValue(json, primary, out)) {
    return true;
  }
  if (fallback.length() > 0 && extractJsonStringValue(json, fallback, out)) {
    return true;
  }
  return false;
}

bool extractJsonBoolByAnyKey(const String &json, const String &primary, const String &fallback, bool &out) {
  if (extractJsonBoolValue(json, primary, out)) {
    return true;
  }
  if (fallback.length() > 0 && extractJsonBoolValue(json, fallback, out)) {
    return true;
  }
  return false;
}

String buildBleTransferId() {
  const unsigned long now = millis();
  String out = "";
  out.reserve(24);
  out += toHex((uint64_t)now, 8);
  out += toHex((uint64_t)txMsgCounter++, 8);
  return out;
}

uint32_t fnv1a32(const String &input) {
  uint32_t hash = 2166136261UL;
  for (size_t i = 0; i < input.length(); i++) {
    hash ^= (uint8_t)input[i];
    hash *= 16777619UL;
  }
  return hash;
}

String bytesToString(const uint8_t *data, size_t len) {
  String out = "";
  out.reserve(len);
  for (size_t i = 0; i < len; i++) {
    out += (char)data[i];
  }
  return out;
}

void appendTrackHistoryPoint(const TelemetrySample &in, unsigned long nowMs) {
  if (!in.gpsValid) {
    return;
  }
  TrackPointSample point = {};
  point.tsMs = nowMs;
  point.latDeg = in.latDeg;
  point.lonDeg = in.lonDeg;
  point.cogDeg = in.cogDeg;
  point.headingDeg = in.cogDeg;
  point.sogKnots = in.sogKnots;
  trackHistory[trackHistoryNextIndex] = point;
  trackHistoryNextIndex = (trackHistoryNextIndex + 1U) % TRACK_HISTORY_CAPACITY;
  if (trackHistoryCount < TRACK_HISTORY_CAPACITY) {
    trackHistoryCount++;
  }
}

size_t trackHistoryIndexFromOldest(size_t offset) {
  if (trackHistoryCount == 0) {
    return 0;
  }
  const size_t oldestIndex = trackHistoryCount == TRACK_HISTORY_CAPACITY ? trackHistoryNextIndex : 0U;
  return (oldestIndex + offset) % TRACK_HISTORY_CAPACITY;
}

String buildTrackPointsJson(unsigned long sinceMs) {
  String json = "[";
  bool first = true;
  for (size_t i = 0; i < trackHistoryCount; i++) {
    const TrackPointSample &point = trackHistory[trackHistoryIndexFromOldest(i)];
    if (point.tsMs < sinceMs) {
      continue;
    }
    if (!first) {
      json += ",";
    }
    first = false;
    json += "{";
    bool firstField = true;
    appendJsonField(json, firstField, "ts", String(point.tsMs));
    appendJsonField(json, firstField, "lat", String(point.latDeg, 6));
    appendJsonField(json, firstField, "lon", String(point.lonDeg, 6));
    appendJsonField(json, firstField, "cogDeg", String(point.cogDeg, 1));
    appendJsonField(json, firstField, "headingDeg", String(point.headingDeg, 1));
    appendJsonField(json, firstField, "sogKn", String(point.sogKnots, 2));
    json += "}";
  }
  json += "]";
  return json;
}

bool notifyBleChunked(const String &msgId, const String &json, bool retryOnEnomem);
size_t resolveBleChunkPayloadLimit();
void sendBleJsonMessage(const String &label, const String &json, bool retryOnEnomem = true);

void sendBleJsonMessage(const String &label, const String &json, bool retryOnEnomem) {
  const String transferId = buildBleTransferId();
  const bool sent = notifyBleChunked(transferId, json, retryOnEnomem);
  if (debugProtocol) {
    Serial.print("[proto] tx ");
    Serial.print(label);
    Serial.print(" bytes=");
    Serial.print(json.length());
    Serial.print(" chunkMax=");
    Serial.print(resolveBleChunkPayloadLimit());
    Serial.print(" retryOnEnomem=");
    Serial.print(retryOnEnomem ? "true" : "false");
    Serial.print(" sent=");
    Serial.println(sent ? "true" : "false");
  }
}

void sendProtocolReplyOverBle(const String &reqId, const String &command, const String &state, const String &dataJson) {
  String json = "{";
  bool first = true;
  appendJsonField(json, first, "req_id", jsonString(reqId));
  appendJsonField(json, first, "state", jsonString(state));
  appendJsonField(json, first, "command", jsonString(command));
  appendJsonField(json, first, "data", dataJson);
  json += "}";
  sendBleJsonMessage(command + ":" + state, json, command != "get-data");
}

bool tryAssembleBleMessage(const uint8_t *data, size_t len, String &completedJson) {
  if (len == 0) {
    return false;
  }

  if (data[0] == '{') {
    completedJson = bytesToString(data, len);
    return true;
  }

  if (len < 6) {
    return false;
  }

  const uint32_t msgId32 =
    (uint32_t)data[0] |
    ((uint32_t)data[1] << 8) |
    ((uint32_t)data[2] << 16) |
    ((uint32_t)data[3] << 24);
  const uint8_t partIndex = data[4];
  const uint8_t partCount = data[5];

  if (partCount == 0 || partCount > BleChunkAssembler::MAX_PARTS || partIndex >= partCount) {
    resetBleAssembler();
    return false;
  }

  const unsigned long now = millis();
  const bool expired = bleAssembler.active && (now - bleAssembler.startedMs > BLE_CHUNK_TIMEOUT_MS);
  const bool shapeMismatch = bleAssembler.active &&
    (bleAssembler.msgId32 != msgId32 || bleAssembler.partCount != partCount);
  if (!bleAssembler.active || expired || shapeMismatch) {
    resetBleAssembler();
    bleAssembler.active = true;
    bleAssembler.msgId32 = msgId32;
    bleAssembler.partCount = partCount;
    bleAssembler.startedMs = now;
  }

  bleAssembler.parts[partIndex] = bytesToString(data + 6, len - 6);
  bleAssembler.received[partIndex] = true;

  for (uint8_t i = 0; i < bleAssembler.partCount; i++) {
    if (!bleAssembler.received[i]) {
      return false;
    }
  }

  String merged = "";
  for (uint8_t i = 0; i < bleAssembler.partCount; i++) {
    merged += bleAssembler.parts[i];
  }
  resetBleAssembler();
  completedJson = merged;
  return true;
}

size_t resolveBleChunkPayloadLimit() {
  size_t limit = BLE_CHUNK_MAX_PAYLOAD;
  if (!bleConnected || bleServer == nullptr) {
    return limit;
  }
  const uint16_t connId = bleServer->getConnId();
  if (connId == BLE_HS_CONN_HANDLE_NONE) {
    return limit;
  }
  const uint16_t peerMtu = bleServer->getPeerMTU(connId);
  if (peerMtu <= 9) {
    return 1;
  }
  const size_t mtuLimited = (size_t)peerMtu - 9U;  // ATT value limit (mtu-3) minus chunk header (6).
  if (mtuLimited < 1) {
    return 1;
  }
  return min(limit, mtuLimited);
}

bool notifyBleChunked(const String &msgId, const String &json, bool retryOnEnomem) {
  if (!bleConnected || eventRxCharacteristic == nullptr) {
    if (debugProtocol) {
      Serial.print("[proto] tx drop msgId=");
      Serial.print(msgId);
      Serial.println(" reason=ble-not-connected");
    }
    return false;
  }

  const uint32_t msgId32 = fnv1a32(msgId);
  const size_t total = json.length();
  const size_t chunkPayloadLimit = resolveBleChunkPayloadLimit();
  if (chunkPayloadLimit == 0) {
    return false;
  }

  size_t partCount = total / chunkPayloadLimit;
  if ((total % chunkPayloadLimit) != 0 || partCount == 0) {
    partCount++;
  }
  if (partCount > 255) {
    if (debugProtocol) {
      Serial.print("[proto] tx drop msgId=");
      Serial.print(msgId);
      Serial.println(" reason=too-many-chunks");
    }
    return false;
  }

  uint8_t frame[BLE_CHUNK_MAX_PAYLOAD + 6];
  for (size_t part = 0; part < partCount; part++) {
    const size_t offset = part * chunkPayloadLimit;
    const size_t chunkLen = min(chunkPayloadLimit, total - offset);
    const uint8_t maxAttempts = retryOnEnomem ? BLE_NOTIFY_MAX_RETRIES : 0;

    frame[0] = msgId32 & 0xFF;
    frame[1] = (msgId32 >> 8) & 0xFF;
    frame[2] = (msgId32 >> 16) & 0xFF;
    frame[3] = (msgId32 >> 24) & 0xFF;
    frame[4] = (uint8_t)part;
    frame[5] = (uint8_t)partCount;
    for (size_t i = 0; i < chunkLen; i++) {
      frame[6 + i] = (uint8_t)json[offset + i];
    }

    bool partSent = false;
    for (uint8_t attempt = 0; attempt <= maxAttempts; attempt++) {
      bleLastEventNotifyValid = false;
      bleLastEventNotifyCode = 0;
      eventRxCharacteristic->setValue(frame, chunkLen + 6);
      eventRxCharacteristic->notify();

      const bool notifySuccess =
        bleLastEventNotifyValid &&
        (bleLastEventNotifyStatus == BLECharacteristicCallbacks::Status::SUCCESS_NOTIFY ||
         bleLastEventNotifyStatus == BLECharacteristicCallbacks::Status::SUCCESS_INDICATE);
      if (notifySuccess) {
        partSent = true;
        break;
      }

      const bool notifyOutOfMemory =
        bleLastEventNotifyValid &&
        bleLastEventNotifyStatus == BLECharacteristicCallbacks::Status::ERROR_GATT &&
        (int)bleLastEventNotifyCode == BLE_NOTIFY_NIMBLE_ENOMEM;
      if (!notifyOutOfMemory || attempt >= maxAttempts) {
        if (notifyOutOfMemory) {
          bleNotifyBackoffUntilMs = millis() + BLE_NOTIFY_ENOMEM_BACKOFF_MS;
        }
        if (debugProtocol) {
          Serial.print("[proto] tx drop msgId=");
          Serial.print(msgId);
          Serial.print(" reason=notify-failed part=");
          Serial.print((int)part);
          Serial.print(" partCount=");
          Serial.print((int)partCount);
          Serial.print(" status=");
          Serial.print((int)bleLastEventNotifyStatus);
          Serial.print(" code=");
          Serial.println((int)bleLastEventNotifyCode);
        }
        return false;
      }

      delay(BLE_NOTIFY_RETRY_DELAY_MS);
    }

    if (!partSent) {
      return false;
    }
    delay(BLE_NOTIFY_INTER_CHUNK_DELAY_MS);
  }
  return true;
}

String buildResultDataJson(const String &status, const String &errorCode = "", const String &errorMessage = "", const String &extraFields = "") {
  String json = "{";
  bool first = true;
  appendJsonField(json, first, "status", jsonString(status));
  if (errorCode.length() > 0 || errorMessage.length() > 0) {
    String error = "{";
    bool firstError = true;
    appendJsonField(error, firstError, "code", jsonString(errorCode.length() > 0 ? errorCode : "COMMAND_FAILED"));
    appendJsonField(error, firstError, "message", jsonString(errorMessage.length() > 0 ? errorMessage : "command failed"));
    error += "}";
    appendJsonField(json, first, "error", error);
    appendJsonField(json, first, "errorCode", jsonString(errorCode.length() > 0 ? errorCode : "COMMAND_FAILED"));
    appendJsonField(json, first, "errorDetail", jsonString(errorMessage.length() > 0 ? errorMessage : "command failed"));
  }
  if (extraFields.length() > 0) {
    json += ",";
    json += extraFields;
  }
  json += "}";
  return json;
}

void sendClosedOk(const String &reqId, const String &command, const String &extraFields = "") {
  sendProtocolReplyOverBle(reqId, command, "CLOSED_OK", buildResultDataJson("ok", "", "", extraFields));
}

void sendClosedFailed(const String &reqId, const String &command, const String &errorCode, const String &errorMessage, const String &status = "failed") {
  sendProtocolReplyOverBle(reqId, command, "CLOSED_FAILED", buildResultDataJson(status, errorCode, errorMessage));
}

String buildPositionPartValue() {
  String value = "{";
  bool first = true;
  appendJsonField(value, first, "lat", String(sample.latDeg, 6));
  appendJsonField(value, first, "lon", String(sample.lonDeg, 6));
  appendJsonField(value, first, "gps_age_ms", String(sample.gpsAgeMs));
  appendJsonField(value, first, "valid", jsonBool(sample.gpsValid));
  appendJsonField(value, first, "sog_kn", String(sample.sogKnots, 2));
  appendJsonField(value, first, "cog_deg", String(sample.cogDeg, 1));
  appendJsonField(value, first, "heading_deg", String(sample.cogDeg, 1));
  value += "}";
  return value;
}

String buildNavDataPartValue() {
  const bool wifiConnected = WiFi.status() == WL_CONNECTED;
  String value = "{";
  bool first = true;
  appendJsonField(value, first, "depth_m", String(sample.depthM, 2));
  appendJsonField(value, first, "wind_kn", String(sample.windKnots, 1));
  appendJsonField(value, first, "wind_dir_deg", String(sample.windDirDeg, 1));
  appendJsonField(value, first, "data_age_ms", String(sample.dataAgeMs));
  appendJsonField(value, first, "wifi_connected", jsonBool(wifiConnected));
  appendJsonField(value, first, "wifi_ssid", jsonString(wifiConnected ? WiFi.SSID() : wifiConfig.ssid));
  appendJsonField(value, first, "wifi_rssi", String(wifiConnected ? WiFi.RSSI() : 0));
  appendJsonField(value, first, "wifi_error", jsonString(wifiLastError));
  appendJsonField(value, first, "cloud_reachable", jsonBool(wifiConnected));
  appendJsonField(value, first, "firmware_version", jsonString(FW_VERSION));
  appendJsonField(value, first, "pair_mode_active", jsonBool(isPairModeActive(millis())));
  appendJsonField(value, first, "pair_mode_remaining_ms", String(isPairModeActive(millis()) ? (pairModeUntilMs - millis()) : 0));
  appendJsonField(value, first, "session_paired", jsonBool(isPrivilegedSessionActive(millis())));
  value += "}";
  return value;
}

String buildAlarmStatePartValue() {
  String alerts = "{";
  bool firstAlerts = true;
  String wind = "{";
  bool firstWind = true;
  const String windState = triggerWindAbove(sample) ? "ALERT" : "WATCHING";
  appendJsonField(wind, firstWind, "state", jsonString(windState));
  appendJsonField(wind, firstWind, "severity", jsonString("WARNING"));
  appendJsonField(wind, firstWind, "above_threshold_since_ts", triggerWindAbove(sample) ? String((unsigned long)millis()) : "null");
  appendJsonField(wind, firstWind, "alert_since_ts", triggerWindAbove(sample) ? String((unsigned long)millis()) : "null");
  appendJsonField(wind, firstWind, "alert_silenced_until_ts", "null");
  wind += "}";
  appendJsonField(alerts, firstAlerts, "wind_strength", wind);

  String depth = "{";
  bool firstDepth = true;
  const String depthState = triggerDepthLow(sample) ? "ALERT" : "WATCHING";
  appendJsonField(depth, firstDepth, "state", jsonString(depthState));
  appendJsonField(depth, firstDepth, "severity", jsonString("ALARM"));
  appendJsonField(depth, firstDepth, "above_threshold_since_ts", triggerDepthLow(sample) ? String((unsigned long)millis()) : "null");
  appendJsonField(depth, firstDepth, "alert_since_ts", triggerDepthLow(sample) ? String((unsigned long)millis()) : "null");
  appendJsonField(depth, firstDepth, "alert_silenced_until_ts", "null");
  depth += "}";
  appendJsonField(alerts, firstAlerts, "depth", depth);
  alerts += "}";

  String value = "{";
  bool first = true;
  const String level =
    alarmLevel == ALARM_FULL ? "alarm"
    : alarmLevel == ALARM_WARNING ? "warning"
    : "none";
  appendJsonField(value, first, "level", jsonString(level));
  appendJsonField(value, first, "alerts", alerts);
  value += "}";
  return value;
}

String buildAnchorPositionConfigValue() {
  String value = "{";
  bool first = true;
  appendJsonField(value, first, "state", jsonString(anchorState));
  if (anchorPositionValid) {
    String position = "{";
    bool firstPosition = true;
    appendJsonField(position, firstPosition, "lat", String(anchorLat, 6));
    appendJsonField(position, firstPosition, "lon", String(anchorLon, 6));
    position += "}";
    appendJsonField(value, first, "position", position);
  } else {
    appendJsonField(value, first, "position", "null");
  }
  value += "}";
  return value;
}

String buildWlanConfigValue() {
  String value = "{";
  bool first = true;
  appendJsonField(value, first, "ssid", jsonString(wifiConfig.ssid));
  appendJsonField(value, first, "passphrase", jsonString(wifiConfig.passphrase));
  appendJsonField(value, first, "security", jsonString(wifiConfig.security));
  appendJsonField(value, first, "country", jsonString(wifiConfig.country.length() > 0 ? wifiConfig.country : "DE"));
  appendJsonField(value, first, "hidden", jsonBool(wifiConfig.hidden));
  value += "}";
  return value;
}

String wrapVersionedPart(uint32_t version, const String &valueJson) {
  String json = "{";
  bool first = true;
  appendJsonField(json, first, "version", String(version));
  appendJsonField(json, first, "value", valueJson);
  json += "}";
  return json;
}

String buildGetDataSnapshotDataJson() {
  const unsigned long nowMs = millis();
  const unsigned long backfillWindowStartMs = nowMs > (30UL * 60UL * 1000UL) ? nowMs - (30UL * 60UL * 1000UL) : 0UL;
  const unsigned long sinceMs = lastAnchorDownAtMs > 0 ? min(lastAnchorDownAtMs, backfillWindowStartMs) : backfillWindowStartMs;

  String data = "{";
  bool first = true;

  String stateParts = "{";
  bool firstState = true;
  appendJsonField(stateParts, firstState, "position", wrapVersionedPart(versionPosition, buildPositionPartValue()));
  appendJsonField(stateParts, firstState, "nav_data", wrapVersionedPart(versionNavData, buildNavDataPartValue()));
  appendJsonField(stateParts, firstState, "alarm_state", wrapVersionedPart(versionAlarmState, buildAlarmStatePartValue()));
  stateParts += "}";
  appendJsonField(data, first, "state_parts", stateParts);

  String configParts = "{";
  bool firstConfig = true;
  appendJsonField(configParts, firstConfig, "anchor_position", wrapVersionedPart(versionAnchorPosition, buildAnchorPositionConfigValue()));
  appendJsonField(configParts, firstConfig, "alarm_config", wrapVersionedPart(versionAlarmConfig, storedAlarmConfigJson));
  appendJsonField(configParts, firstConfig, "anchor_settings", wrapVersionedPart(versionAnchorSettings, storedAnchorSettingsJson));
  appendJsonField(configParts, firstConfig, "profiles", wrapVersionedPart(versionProfiles, storedProfilesJson));
  appendJsonField(configParts, firstConfig, "wlan_config", wrapVersionedPart(versionWlanConfig, buildWlanConfigValue()));
  configParts += "}";
  appendJsonField(data, first, "config_parts", configParts);
  appendJsonField(data, first, "track_points", buildTrackPointsJson(sinceMs));
  data += "}";
  return data;
}

void sendGetDataSnapshotReply(const String &reqId) {
  sendProtocolReplyOverBle(reqId, "get-data", "ONGOING", buildGetDataSnapshotDataJson());
}

void sendGetDataPartReply(const String &group, const String &name, uint32_t version, const String &valueJson) {
  if (activeGetDataReqId.length() == 0) {
    return;
  }
  String data = "{";
  bool first = true;
  String part = "{";
  bool firstPart = true;
  appendJsonField(part, firstPart, "group", jsonString(group));
  appendJsonField(part, firstPart, "name", jsonString(name));
  appendJsonField(part, firstPart, "version", String(version));
  appendJsonField(part, firstPart, "value", valueJson);
  part += "}";
  appendJsonField(data, first, "part", part);
  data += "}";
  sendProtocolReplyOverBle(activeGetDataReqId, "get-data", "ONGOING", data);
}

void sendGetDataTrackAppendReply(const TrackPointSample &point) {
  if (activeGetDataReqId.length() == 0) {
    return;
  }
  String trackPoints = "[{";
  bool firstPoint = true;
  appendJsonField(trackPoints, firstPoint, "ts", String(point.tsMs));
  appendJsonField(trackPoints, firstPoint, "lat", String(point.latDeg, 6));
  appendJsonField(trackPoints, firstPoint, "lon", String(point.lonDeg, 6));
  appendJsonField(trackPoints, firstPoint, "cogDeg", String(point.cogDeg, 1));
  appendJsonField(trackPoints, firstPoint, "headingDeg", String(point.headingDeg, 1));
  appendJsonField(trackPoints, firstPoint, "sogKn", String(point.sogKnots, 2));
  trackPoints += "}]";

  String data = "{";
  bool first = true;
  appendJsonField(data, first, "track_append", trackPoints);
  data += "}";
  sendProtocolReplyOverBle(activeGetDataReqId, "get-data", "ONGOING", data);
}

void applyAlarmLevel(AlarmLevel next) {
  alarmLevel = next;
  switch (alarmLevel) {
    case ALARM_NONE:
      setSiren(false);
      digitalWrite(STATUS_LED_PIN, LOW);
      break;
    case ALARM_WARNING:
      setSiren(false);
      digitalWrite(STATUS_LED_PIN, HIGH);
      break;
    case ALARM_FULL:
      setSiren(true);
      digitalWrite(STATUS_LED_PIN, HIGH);
      break;
  }
}

bool triggerDepthLow(const TelemetrySample &in) {
  return in.depthM < 1.8f;
}

bool triggerWindAbove(const TelemetrySample &in) {
  return in.windKnots > 30.0f;
}

bool triggerGpsStale(const TelemetrySample &in) {
  return in.gpsAgeMs > 5000;
}

AlarmLevel evaluateAlarm(const TelemetrySample &in) {
  if (triggerGpsStale(in)) {
    return ALARM_FULL;
  }
  if (triggerDepthLow(in) || triggerWindAbove(in)) {
    return ALARM_WARNING;
  }
  return ALARM_NONE;
}

// Placeholder NMEA2000 reader.
void readTelemetry(TelemetrySample &out, unsigned long nowMs) {
  updateSimMotion(nowMs);

  // x = east/west, y = north/south in local meters.
  const float eastOffsetM = simOffsetEastM;
  const float northOffsetM = simOffsetNorthM;
  const float cosLat = cosf(SIM_CENTER_LAT_DEG * DEG_TO_RAD);
  const float metersPerDegLon = SIM_METERS_PER_DEG_LAT * (cosLat > 0.01f ? cosLat : 0.01f);

  out.gpsValid = true;
  out.latDeg = SIM_CENTER_LAT_DEG + (northOffsetM / SIM_METERS_PER_DEG_LAT);
  out.lonDeg = SIM_CENTER_LON_DEG + (eastOffsetM / metersPerDegLon);
  out.cogDeg = simCogDeg;
  out.sogKnots = simSogKnots;
  out.depthM = 3.1f;
  out.windKnots = 12.5f;
  out.windDirDeg = 205.0f;
  out.gpsAgeMs = nowMs - bootMs;
  out.dataAgeMs = nowMs - bootMs;
}

void printSample(const TelemetrySample &in, AlarmLevel level) {
  Serial.print("GPS=");
  Serial.print(in.gpsValid ? "ok" : "invalid");
  Serial.print(" COG=");
  Serial.print(in.cogDeg, 1);
  Serial.print(" SOGkn=");
  Serial.print(in.sogKnots, 2);
  Serial.print(" Depth=");
  Serial.print(in.depthM, 2);
  Serial.print(" Wind=");
  Serial.print(in.windKnots, 1);
  Serial.print(" GPSAgeMs=");
  Serial.print(in.gpsAgeMs);
  Serial.print(" Alarm=");
  Serial.print((int)level);
  Serial.print(" WiFi=");
  Serial.print(WiFi.status() == WL_CONNECTED ? "up" : "down");
  Serial.print(" Pair=");
  Serial.println(isPairModeActive(millis()) ? "on" : "off");
}

void scheduleWifiConnectNow() {
  wifiConnectPending = true;
  wifiRetryDelayMs = 1000UL;
  wifiNextAttemptMs = 0;
}

void updateWifiManager(unsigned long nowMs) {
  if (wifiConfig.ssid.length() == 0) {
    return;
  }

  if (WiFi.status() == WL_CONNECTED) {
    wifiConnectPending = false;
    wifiRetryDelayMs = 1000UL;
    wifiLastError = "";
    return;
  }

  if (!wifiConnectPending && nowMs < wifiNextAttemptMs) {
    return;
  }
  if (nowMs < wifiNextAttemptMs) {
    return;
  }

  wifiConnectPending = false;
  wifiNextAttemptMs = nowMs + wifiRetryDelayMs;
  wifiRetryDelayMs = min(wifiRetryDelayMs * 2UL, WIFI_RETRY_MAX_MS);
  wifiLastError = "connecting";

  if (debugProtocol) {
    Serial.print("[wifi] connect attempt ssid=");
    Serial.println(wifiConfig.ssid);
  }

  WiFi.disconnect();
  WiFi.begin(wifiConfig.ssid.c_str(), wifiConfig.passphrase.c_str());
}

void finalizeActiveWifiConnect(unsigned long nowMs) {
  if (!activeConnectWifiInFlight || activeConnectWifiReqId.length() == 0) {
    return;
  }

  if (WiFi.status() == WL_CONNECTED) {
    activeConnectWifiInFlight = false;
    sendProtocolReplyOverBle(activeConnectWifiReqId, "connect-wlan", "CLOSED_OK", buildResultDataJson("ok", "", "", "\"attempt\":{\"phase\":\"connected\",\"ssid\":" + jsonString(wifiConfig.ssid) + "}"));
    activeConnectWifiReqId = "";
    sendGetDataPartReply("state", "nav_data", ++versionNavData, buildNavDataPartValue());
    return;
  }

  if (nowMs - activeConnectWifiStartedAtMs >= WIFI_CONNECT_TIMEOUT_MS) {
    activeConnectWifiInFlight = false;
    wifiLastError = "timeout";
    sendClosedFailed(activeConnectWifiReqId, "connect-wlan", "WIFI_CONNECT_FAILED", "connection timed out");
    activeConnectWifiReqId = "";
    sendGetDataPartReply("state", "nav_data", ++versionNavData, buildNavDataPartValue());
  }
}

void maybeEmitActiveDataStream(unsigned long nowMs) {
  if (!bleConnected || activeGetDataReqId.length() == 0) {
    return;
  }
  if (lastStreamedSampleAtMs == nowMs) {
    return;
  }
  lastStreamedSampleAtMs = nowMs;

  versionPosition++;
  versionNavData++;
  versionAlarmState++;
  sendGetDataPartReply("state", "position", versionPosition, buildPositionPartValue());
  sendGetDataPartReply("state", "nav_data", versionNavData, buildNavDataPartValue());
  sendGetDataPartReply("state", "alarm_state", versionAlarmState, buildAlarmStatePartValue());

  if (trackHistoryCount > 0) {
    const TrackPointSample &lastPoint = trackHistory[trackHistoryIndexFromOldest(trackHistoryCount - 1)];
    sendGetDataTrackAppendReply(lastPoint);
  }
}

void enterPairMode(unsigned long nowMs, unsigned long ttlMs = PAIR_MODE_TTL_MS) {
  pairModeUntilMs = nowMs + ttlMs;
  privSessionUntilMs = 0;
  Serial.println("[pair] pair mode enabled");
}

void exitPairMode() {
  pairModeUntilMs = 0;
  privSessionUntilMs = 0;
  Serial.println("[pair] pair mode disabled");
}

void refreshAuthCharacteristic() {
  if (authCharacteristic == nullptr) {
    return;
  }
  const unsigned long nowMs = millis();
  String json = "{";
  bool first = true;
  appendJsonField(json, first, "pairModeActive", jsonBool(isPairModeActive(nowMs)));
  appendJsonField(json, first, "pairModeRemainingMs", String(isPairModeActive(nowMs) ? (pairModeUntilMs - nowMs) : 0));
  appendJsonField(json, first, "sessionPaired", jsonBool(isPrivilegedSessionActive(nowMs)));
  appendJsonField(json, first, "sessionRemainingMs", String(isPrivilegedSessionActive(nowMs) ? (privSessionUntilMs - nowMs) : 0));
  appendJsonField(json, first, "boatId", jsonString(boatId));
  json += "}";
  authCharacteristic->setValue(json.c_str());
}

bool parseEnvelope(const String &raw, ParsedEnvelope &parsed, String &errorDetail) {
  if (!extractJsonStringValue(raw, "req_id", parsed.reqId)) {
    errorDetail = "missing req_id";
    return false;
  }
  if (!extractJsonStringValue(raw, "command", parsed.command)) {
    errorDetail = "missing command";
    return false;
  }
  parsed.reqId.trim();
  parsed.command.trim();
  if (parsed.reqId.length() == 0 || parsed.command.length() == 0) {
    errorDetail = "empty req_id or command";
    return false;
  }
  return true;
}

String wifiSecurityLabel(wifi_auth_mode_t auth) {
  switch (auth) {
    case WIFI_AUTH_OPEN:
      return "open";
#if defined(WIFI_AUTH_WPA3_PSK)
    case WIFI_AUTH_WPA3_PSK:
      return "wpa3";
#endif
#if defined(WIFI_AUTH_WPA2_WPA3_PSK)
    case WIFI_AUTH_WPA2_WPA3_PSK:
      return "wpa3";
#endif
    case WIFI_AUTH_WPA2_PSK:
      return "wpa2";
#if defined(WIFI_AUTH_WPA_PSK)
    case WIFI_AUTH_WPA_PSK:
      return "wpa2";
#endif
#if defined(WIFI_AUTH_WPA_WPA2_PSK)
    case WIFI_AUTH_WPA_WPA2_PSK:
      return "wpa2";
#endif
    default:
      return "unknown";
  }
}

bool buildWifiScanNetworksJson(int maxResults, bool includeHidden, String &networksJson, String &scanError) {
  const int limitedMax = max(1, min(maxResults, SIM_WIFI_SCAN_MAX_RESULTS));
  const int found = WiFi.scanNetworks(false, includeHidden);
  if (found < 0) {
    scanError = "wifi scan failed";
    if (debugProtocol) {
      Serial.print("[scan] wifi.scanNetworks failed code=");
      Serial.println(found);
    }
    WiFi.scanDelete();
    return false;
  }
  if (debugProtocol) {
    Serial.print("[scan] wifi.scanNetworks found=");
    Serial.print(found);
    Serial.print(" limitedMax=");
    Serial.print(limitedMax);
    Serial.print(" includeHidden=");
    Serial.println(includeHidden ? "true" : "false");
  }

  networksJson = "[";
  bool firstNetwork = true;
  int emitted = 0;
  for (int i = 0; i < found && emitted < limitedMax; i++) {
    const String ssid = WiFi.SSID(i);
    const bool hidden = ssid.length() == 0;
    if (hidden && !includeHidden) {
      continue;
    }

    if (!firstNetwork) {
      networksJson += ",";
    }
    networksJson += "{";
    bool firstField = true;
    appendJsonField(networksJson, firstField, "ssid", jsonString(ssid));
    appendJsonField(networksJson, firstField, "security", jsonString(wifiSecurityLabel((wifi_auth_mode_t)WiFi.encryptionType(i))));
    appendJsonField(networksJson, firstField, "rssi", String(WiFi.RSSI(i)));
    appendJsonField(networksJson, firstField, "channel", String(WiFi.channel(i)));
    appendJsonField(networksJson, firstField, "hidden", jsonBool(hidden));
    networksJson += "}";
    firstNetwork = false;
    emitted++;
  }
  networksJson += "]";
  if (debugProtocol) {
    Serial.print("[scan] wifi.scanNetworks emitted=");
    Serial.print(emitted);
    Serial.print(" networksJsonBytes=");
    Serial.println(networksJson.length());
  }
  WiFi.scanDelete();
  return true;
}

bool checkIfVersion(const String &raw, const String &partName, uint32_t currentVersion, String &errorCode, String &errorDetail) {
  int requestedVersion = 0;
  if (!extractJsonIntFromObjectKey(raw, "if_versions", partName, requestedVersion)) {
    return true;
  }
  if ((uint32_t)requestedVersion != currentVersion) {
    errorCode = "VERSION_CONFLICT";
    errorDetail = String(partName) + " version mismatch";
    return false;
  }
  return true;
}

bool requirePrivilegedSessionOrReply(const ParsedEnvelope &envelope) {
  if (isPrivilegedSessionActive(millis())) {
    return true;
  }
  sendClosedFailed(envelope.reqId, envelope.command, "AUTH_FAILED", "pair mode and paired session required", "rejected");
  return false;
}

bool applyWlanConfigFromRaw(const String &raw, String &errorCode, String &errorDetail) {
  String ssid = "";
  String passphrase = "";
  String security = wifiConfig.security.length() ? wifiConfig.security : "wpa2";
  String country = wifiConfig.country.length() ? wifiConfig.country : "DE";
  bool hidden = wifiConfig.hidden;

  const bool hasSsid = extractJsonStringByAnyKey(raw, "ssid", "network.wifi.ssid", ssid);
  extractJsonStringByAnyKey(raw, "passphrase", "network.wifi.passphrase", passphrase);
  extractJsonStringByAnyKey(raw, "security", "network.wifi.security", security);
  extractJsonStringByAnyKey(raw, "country", "network.wifi.country", country);
  extractJsonBoolByAnyKey(raw, "hidden", "network.wifi.hidden", hidden);

  if (!hasSsid || ssid.length() == 0) {
    errorCode = "INVALID_PAYLOAD";
    errorDetail = "ssid is required";
    return false;
  }

  if (security.length() == 0) {
    security = "wpa2";
  }
  if (country.length() == 0) {
    country = "DE";
  }

  wifiConfig.ssid = ssid;
  wifiConfig.passphrase = passphrase;
  wifiConfig.security = security;
  wifiConfig.country = country;
  wifiConfig.hidden = hidden;
  wifiConfig.version = max(wifiConfig.version + 1, 1);
  persistWiFiConfig();
  scheduleWifiConnectNow();
  versionWlanConfig++;
  return true;
}

void sendWifiConnectProgress(const String &reqId, const String &phase, const String &detail = "") {
  String data = "{";
  bool first = true;
  String attempt = "{";
  bool firstAttempt = true;
  appendJsonField(attempt, firstAttempt, "phase", jsonString(phase));
  appendJsonField(attempt, firstAttempt, "ssid", jsonString(wifiConfig.ssid));
  if (detail.length() > 0) {
    appendJsonField(attempt, firstAttempt, "detail", jsonString(detail));
  }
  attempt += "}";
  appendJsonField(data, first, "attempt", attempt);
  data += "}";
  sendProtocolReplyOverBle(reqId, "connect-wlan", "ONGOING", data);
}

void handleScanWlan(const ParsedEnvelope &envelope, const String &raw) {
  if (!requirePrivilegedSessionOrReply(envelope)) {
    return;
  }
  int maxResults = 20;
  extractJsonIntValue(raw, "max_results", maxResults);
  bool includeHidden = false;
  extractJsonBoolValue(raw, "include_hidden", includeHidden);

  String networksJson = "[]";
  String scanError = "";
  if (!buildWifiScanNetworksJson(maxResults, includeHidden, networksJson, scanError)) {
    sendClosedFailed(envelope.reqId, envelope.command, "DEVICE_FAILED", scanError);
    return;
  }
  sendProtocolReplyOverBle(envelope.reqId, envelope.command, "CLOSED_OK", buildResultDataJson("ok", "", "", "\"networks\":" + networksJson));
}

void handleConnectWlan(const ParsedEnvelope &envelope, const String &raw) {
  if (!requirePrivilegedSessionOrReply(envelope)) {
    return;
  }
  String errorCode = "";
  String errorDetail = "";
  if (!checkIfVersion(raw, "wlan_config", versionWlanConfig, errorCode, errorDetail)) {
    sendClosedFailed(envelope.reqId, envelope.command, errorCode, errorDetail, "rejected");
    return;
  }
  if (!applyWlanConfigFromRaw(raw, errorCode, errorDetail)) {
    sendClosedFailed(envelope.reqId, envelope.command, errorCode, errorDetail, "rejected");
    return;
  }

  activeConnectWifiReqId = envelope.reqId;
  activeConnectWifiInFlight = true;
  activeConnectWifiStartedAtMs = millis();
  sendWifiConnectProgress(envelope.reqId, "connecting");
  sendGetDataPartReply("config", "wlan_config", versionWlanConfig, buildWlanConfigValue());
  sendGetDataPartReply("state", "nav_data", ++versionNavData, buildNavDataPartValue());
}

void handleGetData(const ParsedEnvelope &envelope) {
  activeGetDataReqId = envelope.reqId;
  sendGetDataSnapshotReply(envelope.reqId);
}

void handleRaiseAnchor(const ParsedEnvelope &envelope, const String &raw) {
  String errorCode = "";
  String errorDetail = "";
  if (!checkIfVersion(raw, "anchor_position", versionAnchorPosition, errorCode, errorDetail)) {
    sendClosedFailed(envelope.reqId, envelope.command, errorCode, errorDetail, "rejected");
    return;
  }

  anchorState = "up";
  anchorPositionValid = false;
  versionAnchorPosition++;
  sendClosedOk(envelope.reqId, envelope.command);
  sendGetDataPartReply("config", "anchor_position", versionAnchorPosition, buildAnchorPositionConfigValue());
}

void handleMoveAnchor(const ParsedEnvelope &envelope, const String &raw, bool allowCurrentGps) {
  String errorCode = "";
  String errorDetail = "";
  if (!checkIfVersion(raw, "anchor_position", versionAnchorPosition, errorCode, errorDetail)) {
    sendClosedFailed(envelope.reqId, envelope.command, errorCode, errorDetail, "rejected");
    return;
  }

  float requestedLat = 0.0f;
  float requestedLon = 0.0f;
  const bool hasLat = extractJsonFloatValue(raw, "lat", requestedLat);
  const bool hasLon = extractJsonFloatValue(raw, "lon", requestedLon);

  if (hasLat && hasLon) {
    anchorLat = requestedLat;
    anchorLon = requestedLon;
  } else if (allowCurrentGps && sample.gpsValid) {
    anchorLat = sample.latDeg;
    anchorLon = sample.lonDeg;
  } else {
    sendClosedFailed(envelope.reqId, envelope.command, "INVALID_PAYLOAD", "lat/lon required");
    return;
  }

  anchorPositionValid = true;
  anchorState = "down";
  lastAnchorDownAtMs = millis();
  versionAnchorPosition++;
  sendClosedOk(envelope.reqId, envelope.command);
  sendGetDataPartReply("config", "anchor_position", versionAnchorPosition, buildAnchorPositionConfigValue());
}

void handleSilenceAlarm(const ParsedEnvelope &envelope, const String &raw) {
  String errorCode = "";
  String errorDetail = "";
  if (!checkIfVersion(raw, "alarm_state", versionAlarmState, errorCode, errorDetail)) {
    sendClosedFailed(envelope.reqId, envelope.command, errorCode, errorDetail, "rejected");
    return;
  }
  versionAlarmState++;
  sendClosedOk(envelope.reqId, envelope.command);
  sendGetDataPartReply("state", "alarm_state", versionAlarmState, buildAlarmStatePartValue());
}

void handleUpdateConfig(const ParsedEnvelope &envelope, const String &raw) {
  if (!requirePrivilegedSessionOrReply(envelope)) {
    return;
  }

  String partsRaw = "";
  if (!extractJsonRawValue(raw, "parts", partsRaw)) {
    sendClosedFailed(envelope.reqId, envelope.command, "INVALID_PAYLOAD", "parts object required", "rejected");
    return;
  }

  bool changed = false;
  String partRaw = "";
  String errorCode = "";
  String errorDetail = "";

  if (extractJsonRawValue(partsRaw, "alarm_config", partRaw)) {
    if (!checkIfVersion(raw, "alarm_config", versionAlarmConfig, errorCode, errorDetail)) {
      sendClosedFailed(envelope.reqId, envelope.command, errorCode, errorDetail, "rejected");
      return;
    }
    storedAlarmConfigJson = partRaw;
    versionAlarmConfig++;
    changed = true;
  }

  if (extractJsonRawValue(partsRaw, "anchor_settings", partRaw)) {
    if (!checkIfVersion(raw, "anchor_settings", versionAnchorSettings, errorCode, errorDetail)) {
      sendClosedFailed(envelope.reqId, envelope.command, errorCode, errorDetail, "rejected");
      return;
    }
    storedAnchorSettingsJson = partRaw;
    versionAnchorSettings++;
    changed = true;
  }

  if (extractJsonRawValue(partsRaw, "profiles", partRaw)) {
    if (!checkIfVersion(raw, "profiles", versionProfiles, errorCode, errorDetail)) {
      sendClosedFailed(envelope.reqId, envelope.command, errorCode, errorDetail, "rejected");
      return;
    }
    storedProfilesJson = partRaw;
    versionProfiles++;
    changed = true;
  }

  if (extractJsonRawValue(partsRaw, "wlan_config", partRaw)) {
    if (!checkIfVersion(raw, "wlan_config", versionWlanConfig, errorCode, errorDetail)) {
      sendClosedFailed(envelope.reqId, envelope.command, errorCode, errorDetail, "rejected");
      return;
    }
    if (!applyWlanConfigFromRaw(partRaw, errorCode, errorDetail)) {
      sendClosedFailed(envelope.reqId, envelope.command, errorCode, errorDetail, "rejected");
      return;
    }
    changed = true;
  }

  if (!changed) {
    sendClosedFailed(envelope.reqId, envelope.command, "INVALID_PAYLOAD", "no supported config parts", "rejected");
    return;
  }

  sendClosedOk(envelope.reqId, envelope.command);
  sendGetDataPartReply("config", "alarm_config", versionAlarmConfig, storedAlarmConfigJson);
  sendGetDataPartReply("config", "anchor_settings", versionAnchorSettings, storedAnchorSettingsJson);
  sendGetDataPartReply("config", "profiles", versionProfiles, storedProfilesJson);
  sendGetDataPartReply("config", "wlan_config", versionWlanConfig, buildWlanConfigValue());
}

void handleCancel(const ParsedEnvelope &envelope, const String &raw) {
  String originalReqId = "";
  extractJsonStringValue(raw, "original_req_id", originalReqId);
  if (originalReqId.length() == 0) {
    sendClosedFailed(envelope.reqId, envelope.command, "INVALID_PAYLOAD", "original_req_id required", "rejected");
    return;
  }

  if (activeGetDataReqId == originalReqId) {
    sendClosedFailed(activeGetDataReqId, "get-data", "CANCELED", "request canceled");
    activeGetDataReqId = "";
    sendClosedOk(envelope.reqId, envelope.command);
    return;
  }

  if (activeConnectWifiReqId == originalReqId) {
    sendClosedFailed(activeConnectWifiReqId, "connect-wlan", "CANCELED", "request canceled");
    activeConnectWifiReqId = "";
    activeConnectWifiInFlight = false;
    sendClosedOk(envelope.reqId, envelope.command);
    return;
  }

  sendClosedFailed(envelope.reqId, envelope.command, "NOT_FOUND", "original request not active", "rejected");
}

void processInboundMessage(const String &raw, InboundSource source) {
  ParsedEnvelope envelope = {};
  String parseError = "";

  if (!parseEnvelope(raw, envelope, parseError)) {
    if (debugProtocol) {
      Serial.print("[proto] parse error from ");
      Serial.print(sourceName(source));
      Serial.print(": ");
      Serial.println(parseError);
    }
    return;
  }

  if (debugProtocol) {
    Serial.print("[proto] rx ");
    Serial.print(envelope.command);
    Serial.print(" via ");
    Serial.println(sourceName(source));
  }

  if (envelope.command == "scan-wlan") {
    handleScanWlan(envelope, raw);
    return;
  }
  if (envelope.command == "connect-wlan") {
    handleConnectWlan(envelope, raw);
    return;
  }
  if (envelope.command == "get-data") {
    handleGetData(envelope);
    return;
  }
  if (envelope.command == "update-config") {
    handleUpdateConfig(envelope, raw);
    return;
  }
  if (envelope.command == "move-anchor") {
    handleMoveAnchor(envelope, raw, false);
    return;
  }
  if (envelope.command == "set-anchor") {
    handleMoveAnchor(envelope, raw, true);
    return;
  }
  if (envelope.command == "raise-anchor") {
    handleRaiseAnchor(envelope, raw);
    return;
  }
  if (envelope.command == "silence-alarm") {
    handleSilenceAlarm(envelope, raw);
    return;
  }
  if (envelope.command == "cancel") {
    handleCancel(envelope, raw);
    return;
  }

  sendClosedFailed(envelope.reqId, envelope.command, "UNSUPPORTED_COMMAND", "unsupported command", "rejected");
}

void processControlTxWrite(const uint8_t *data, size_t len) {
  String complete = "";
  if (!tryAssembleBleMessage(data, len, complete)) {
    return;
  }
  processInboundMessage(complete, INBOUND_BLE);
}

void processAuthWrite(const String &raw) {
  const unsigned long nowMs = millis();
  String action = "";
  extractJsonStringValue(raw, "action", action);
  if (action.length() == 0) {
    action = raw;
  }
  action.trim();

  if (action == "pair.confirm" || action == "pair_confirm") {
    if (isPairModeActive(nowMs)) {
      privSessionUntilMs = nowMs + PRIV_SESSION_TTL_MS;
      Serial.println("[pair] privileged session activated");
    } else {
      Serial.println("[pair] pair.confirm ignored (pair mode not active)");
    }
  } else if (action == "pair.clear") {
    privSessionUntilMs = 0;
    Serial.println("[pair] privileged session cleared");
  }
  refreshAuthCharacteristic();
}

class AnchorServerCallbacks : public BLEServerCallbacks {
 public:
  void onConnect(BLEServer *server) override {
    (void)server;
    bleConnected = true;
    bleEventSubscriberActive = false;
    bleNotifyBackoffUntilMs = 0;
    bleLastEventNotifyValid = false;
    bleLastEventNotifyCode = 0;
    lastBleStatusAtMs = 0;
    activeGetDataReqId = "";
    resetBleAssembler();
    refreshAuthCharacteristic();
    Serial.println("[ble] client connected");
  }

  void onDisconnect(BLEServer *server) override {
    (void)server;
    bleConnected = false;
    bleEventSubscriberActive = false;
    bleNotifyBackoffUntilMs = 0;
    bleLastEventNotifyValid = false;
    bleLastEventNotifyCode = 0;
    privSessionUntilMs = 0;
    activeGetDataReqId = "";
    activeConnectWifiReqId = "";
    activeConnectWifiInFlight = false;
    resetBleAssembler();
    BLEDevice::startAdvertising();
    Serial.println("[ble] client disconnected");
  }
};

class ControlTxCallbacks : public BLECharacteristicCallbacks {
 public:
  void onWrite(BLECharacteristic *characteristic) override {
    const size_t len = characteristic->getLength();
    uint8_t *data = characteristic->getData();
    if (len == 0 || data == nullptr) {
      return;
    }
    processControlTxWrite(data, len);
  }
};

class EventRxCallbacks : public BLECharacteristicCallbacks {
 public:
  void onStatus(BLECharacteristic *characteristic, Status status, uint32_t code) override {
    (void)characteristic;
    const unsigned long nowMs = millis();
    bleLastEventNotifyStatus = status;
    bleLastEventNotifyCode = code;
    bleLastEventNotifyValid = true;
    if (status == BLECharacteristicCallbacks::Status::SUCCESS_NOTIFY ||
        status == BLECharacteristicCallbacks::Status::SUCCESS_INDICATE) {
      bleEventSubscriberActive = true;
    }
    if (status == BLECharacteristicCallbacks::Status::ERROR_NO_SUBSCRIBER ||
        status == BLECharacteristicCallbacks::Status::ERROR_NO_CLIENT) {
      bleEventSubscriberActive = false;
    }
    if (status == BLECharacteristicCallbacks::Status::ERROR_GATT && (int)code == BLE_NOTIFY_NIMBLE_ENOMEM) {
      bleNotifyBackoffUntilMs = nowMs + BLE_NOTIFY_ENOMEM_BACKOFF_MS;
    }
  }

#if defined(CONFIG_NIMBLE_ENABLED)
  void onSubscribe(BLECharacteristic *characteristic, ble_gap_conn_desc *desc, uint16_t subValue) override {
    (void)characteristic;
    bleEventSubscriberActive = (subValue != 0);
    if (debugProtocol) {
      uint16_t peerMtu = 0;
      if (bleServer != nullptr && desc != nullptr) {
        peerMtu = bleServer->getPeerMTU(desc->conn_handle);
      }
      Serial.print("[ble] event_rx subscribe=");
      Serial.print(bleEventSubscriberActive ? "true" : "false");
      Serial.print(" value=");
      Serial.print(subValue);
      Serial.print(" mtu=");
      Serial.println(peerMtu);
    }
  }
#endif
};

class SnapshotCallbacks : public BLECharacteristicCallbacks {
 public:
  void onRead(BLECharacteristic *characteristic) override {
    characteristic->setValue(buildGetDataSnapshotDataJson().c_str());
  }
};

class AuthCallbacks : public BLECharacteristicCallbacks {
 public:
  void onRead(BLECharacteristic *characteristic) override {
    (void)characteristic;
    refreshAuthCharacteristic();
  }

  void onWrite(BLECharacteristic *characteristic) override {
    const size_t len = characteristic->getLength();
    uint8_t *data = characteristic->getData();
    if (len == 0 || data == nullptr) {
      return;
    }
    processAuthWrite(bytesToString(data, len));
  }
};

void initConnectivity() {
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true, true);
  WiFi.setSleep(false);
  WiFi.setHostname("anchorwatch");
}

void initOutputs() {
  pinMode(SIREN_PIN, OUTPUT);
  digitalWrite(SIREN_PIN, LOW);
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);
}

void initBle() {
  const String deviceName = String(BLE_DEVICE_NAME_PREFIX) + deviceId.substring(max(0, (int)deviceId.length() - 6));
  BLEDevice::init(deviceName.c_str());
  BLEDevice::setMTU(185);

  bleServer = BLEDevice::createServer();
  bleServer->setCallbacks(new AnchorServerCallbacks());

  bleService = bleServer->createService(BLE_SERVICE_UUID);

  controlTxCharacteristic = bleService->createCharacteristic(
    BLE_CONTROL_TX_UUID,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
  );
  controlTxCharacteristic->setCallbacks(new ControlTxCallbacks());

  eventRxCharacteristic = bleService->createCharacteristic(
    BLE_EVENT_RX_UUID,
    BLECharacteristic::PROPERTY_NOTIFY
  );
  eventRxCharacteristic->addDescriptor(new BLE2902());
  eventRxCharacteristic->setCallbacks(new EventRxCallbacks());

  snapshotCharacteristic = bleService->createCharacteristic(
    BLE_SNAPSHOT_UUID,
    BLECharacteristic::PROPERTY_READ
  );
  snapshotCharacteristic->setCallbacks(new SnapshotCallbacks());

  authCharacteristic = bleService->createCharacteristic(
    BLE_AUTH_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE
  );
  authCharacteristic->setCallbacks(new AuthCallbacks());
  refreshAuthCharacteristic();

  bleService->start();
  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(BLE_SERVICE_UUID);
  adv->setScanResponse(false);
  BLEDevice::startAdvertising();

  Serial.print("[ble] advertising as ");
  Serial.println(deviceName);
}

void runSerialCommand(const String &lineRaw) {
  String line = lineRaw;
  line.trim();
  if (line.length() == 0) {
    return;
  }

  if (line == "help") {
    Serial.println("Commands: help, pair on, pair off, pair status, pair confirm, request secret, debug on, debug off, wifi status");
    return;
  }

  if (line == "pair on") {
    enterPairMode(millis());
    refreshAuthCharacteristic();
    return;
  }
  if (line == "pair off") {
    exitPairMode();
    refreshAuthCharacteristic();
    return;
  }
  if (line == "pair status") {
    const unsigned long now = millis();
    Serial.print("[pair] active=");
    Serial.print(isPairModeActive(now) ? "true" : "false");
    Serial.print(" remainingMs=");
    Serial.print(isPairModeActive(now) ? (pairModeUntilMs - now) : 0);
    Serial.print(" sessionPaired=");
    Serial.println(isPrivilegedSessionActive(now) ? "true" : "false");
    return;
  }
  if (line == "pair confirm") {
    processAuthWrite("pair.confirm");
    return;
  }
  if (line == "request secret") {
    if (!isPrivilegedSessionActive(millis())) {
      Serial.println("[pair] request secret denied (pair mode and paired session required)");
      return;
    }
    Serial.print("[pair] boatId=");
    Serial.print(boatId);
    Serial.print(" boatSecret=");
    Serial.println(boatSecret);
    return;
  }
  if (line == "debug on") {
    debugProtocol = true;
    Serial.println("[debug] protocol logging enabled");
    return;
  }
  if (line == "debug off") {
    debugProtocol = false;
    Serial.println("[debug] protocol logging disabled");
    return;
  }
  if (line == "wifi status") {
    Serial.print("[wifi] status=");
    Serial.print((int)WiFi.status());
    Serial.print(" ssid=");
    Serial.print(WiFi.SSID());
    Serial.print(" ip=");
    Serial.print(WiFi.localIP());
    Serial.print(" rssi=");
    Serial.println(WiFi.RSSI());
    return;
  }

  Serial.print("[serial] unknown command: ");
  Serial.println(line);
}

void processSerialConsole() {
  static String line = "";
  while (Serial.available()) {
    const char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      runSerialCommand(line);
      line = "";
      continue;
    }
    if (line.length() < 200) {
      line += c;
    }
  }
}

void updatePairModeState(unsigned long nowMs) {
  const bool active = isPairModeActive(nowMs);
  if (pairModeWasActive && !active) {
    privSessionUntilMs = 0;
    Serial.println("[pair] pair mode expired");
  }
  pairModeWasActive = active;
}

void setup() {
  Serial.begin(115200);
  delay(200);
  bootMs = millis();

  resetBleAssembler();
  loadPersistentState();
  initConnectivity();
  initOutputs();
  initBle();

  if (wifiConfig.ssid.length() > 0) {
    scheduleWifiConnectNow();
  }

  Serial.println("Anqori AnchorWatch phase-2 scaffold booted");
  Serial.print("Firmware build version: ");
  Serial.println(FW_VERSION);
  Serial.println("Run `help` in serial monitor for pair/debug commands");
}

void loop() {
  const unsigned long nowMs = millis();

  processSerialConsole();
  updatePairModeState(nowMs);
  updateWifiManager(nowMs);
  refreshAuthCharacteristic();

  if (nowMs - lastTickMs < MAIN_TICK_MS) {
    return;
  }
  lastTickMs = nowMs;

  readTelemetry(sample, nowMs);
  applyAlarmLevel(evaluateAlarm(sample));
  appendTrackHistoryPoint(sample, nowMs);
  finalizeActiveWifiConnect(nowMs);
  maybeEmitActiveDataStream(nowMs);
  printSample(sample, alarmLevel);
}
