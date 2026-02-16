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

// Protocol and identity defaults.
static const char *PROTOCOL_VERSION = "am.v1";
#ifndef ANQORI_BUILD_VERSION
#define ANQORI_BUILD_VERSION "run-unknown"
#endif
static const char *FW_VERSION = ANQORI_BUILD_VERSION;
static const char *BLE_DEVICE_NAME_PREFIX = "Anqori-AnchorWatch-";
static const char *DEFAULT_BOAT_ID_PREFIX = "boat_";
static const char *DEFAULT_DEVICE_ID_PREFIX = "dev_";
static const char *BOAT_SECRET_PREFIX = "am_bs_";

// BLE GATT UUIDs from protocol-v1.
static const char *BLE_SERVICE_UUID = "9f2d0000-87aa-4f4a-a0ea-4d5d4f415354";
static const char *BLE_CONTROL_TX_UUID = "9f2d0001-87aa-4f4a-a0ea-4d5d4f415354";
static const char *BLE_EVENT_RX_UUID = "9f2d0002-87aa-4f4a-a0ea-4d5d4f415354";
static const char *BLE_SNAPSHOT_UUID = "9f2d0003-87aa-4f4a-a0ea-4d5d4f415354";
static const char *BLE_AUTH_UUID = "9f2d0004-87aa-4f4a-a0ea-4d5d4f415354";

// Timing constants.
static const unsigned long MAIN_TICK_MS = 1000UL;
static const unsigned long BLE_STATUS_CADENCE_MS = 3000UL;
static const unsigned long BLE_CHUNK_TIMEOUT_MS = 2000UL;
static const unsigned long PAIR_MODE_TTL_MS = 10UL * 60UL * 1000UL;
static const unsigned long PRIV_SESSION_TTL_MS = 10UL * 60UL * 1000UL;
static const unsigned long WIFI_RETRY_MAX_MS = 30UL * 1000UL;
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
  String msgType;
  String msgId;
  bool requiresAck;
};

struct CommandResult {
  String status;
  String errorCode;
  String errorDetail;
  String ackExtraFields;
  bool skipAutoAck;
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
bool secretSentInCurrentPairWindow = false;
bool anchorPositionValid = false;

uint32_t txSeq = 1;
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

String buildMsgId() {
  const unsigned long now = millis();
  String out = "";
  out.reserve(24);
  out += toHex((uint64_t)now, 8);
  out += toHex((uint64_t)txMsgCounter++, 8);
  return out;
}

struct OutboundEnvelope {
  String msgId;
  String json;
};

OutboundEnvelope makeEnvelope(const String &msgType, const String &payloadJson, bool requiresAck = false) {
  OutboundEnvelope out;
  out.msgId = buildMsgId();

  String json = "{";
  bool first = true;
  appendJsonField(json, first, "ver", jsonString(PROTOCOL_VERSION));
  appendJsonField(json, first, "msgType", jsonString(msgType));
  appendJsonField(json, first, "msgId", jsonString(out.msgId));
  appendJsonField(json, first, "boatId", jsonString(boatId));
  appendJsonField(json, first, "deviceId", jsonString(deviceId));
  appendJsonField(json, first, "seq", String(txSeq++));
  appendJsonField(json, first, "ts", String((unsigned long)millis()));
  appendJsonField(json, first, "requiresAck", jsonBool(requiresAck));
  appendJsonField(json, first, "payload", payloadJson);
  json += "}";

  out.json = json;
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

bool notifyBleChunked(const String &msgId, const String &json, bool retryOnEnomem = true) {
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

void sendEnvelopeOverBle(const String &msgType, const String &payloadJson, bool requiresAck = false) {
  OutboundEnvelope envelope = makeEnvelope(msgType, payloadJson, requiresAck);
  const bool retryOnEnomem = msgType != "status.patch";
  const bool sent = notifyBleChunked(envelope.msgId, envelope.json, retryOnEnomem);
  if (debugProtocol) {
    Serial.print("[proto] tx ");
    Serial.print(msgType);
    Serial.print(" bytes=");
    Serial.print(envelope.json.length());
    Serial.print(" chunkMax=");
    Serial.print(resolveBleChunkPayloadLimit());
    Serial.print(" retryOnEnomem=");
    Serial.print(retryOnEnomem ? "true" : "false");
    Serial.print(" sent=");
    Serial.println(sent ? "true" : "false");
  }
}

void sendCommandAck(const String &ackForMsgId, const String &status, const String &errorCode, const String &errorDetail, const String &extraFields = "") {
  String payload = "{";
  bool first = true;
  appendJsonField(payload, first, "ackForMsgId", jsonString(ackForMsgId));
  appendJsonField(payload, first, "status", jsonString(status));
  appendJsonField(payload, first, "errorCode", errorCode.length() ? jsonString(errorCode) : "null");
  appendJsonField(payload, first, "errorDetail", errorDetail.length() ? jsonString(errorDetail) : "null");
  if (extraFields.length() > 0) {
    payload += ",";
    payload += extraFields;
  }
  payload += "}";
  sendEnvelopeOverBle("command.ack", payload, false);
}

void sendOnboardingBoatSecret() {
  String payload = "{";
  bool first = true;
  appendJsonField(payload, first, "boatId", jsonString(boatId));
  appendJsonField(payload, first, "boatSecret", jsonString(boatSecret));
  appendJsonField(payload, first, "issuedAt", String((unsigned long)millis()));
  payload += "}";
  sendEnvelopeOverBle("onboarding.boat_secret", payload, false);
}

String buildStatusSnapshotPayload() {
  const bool wifiConnected = WiFi.status() == WL_CONNECTED;
  String payload = "{";
  bool firstPayload = true;

  String snapshot = "{";
  bool firstSnapshot = true;

  String telemetry = "{";
  bool firstTelemetry = true;
  String gps = "{";
  bool firstGps = true;
  appendJsonField(gps, firstGps, "lat", String(sample.latDeg, 6));
  appendJsonField(gps, firstGps, "lon", String(sample.lonDeg, 6));
  appendJsonField(gps, firstGps, "ageMs", String(sample.gpsAgeMs));
  appendJsonField(gps, firstGps, "valid", jsonBool(sample.gpsValid));
  gps += "}";
  appendJsonField(telemetry, firstTelemetry, "gps", gps);

  String depth = "{";
  bool firstDepth = true;
  appendJsonField(depth, firstDepth, "meters", String(sample.depthM, 2));
  appendJsonField(depth, firstDepth, "ageMs", String(sample.dataAgeMs));
  depth += "}";
  appendJsonField(telemetry, firstTelemetry, "depth", depth);

  String wind = "{";
  bool firstWind = true;
  appendJsonField(wind, firstWind, "knots", String(sample.windKnots, 1));
  appendJsonField(wind, firstWind, "dirDeg", String(sample.windDirDeg, 1));
  appendJsonField(wind, firstWind, "ageMs", String(sample.dataAgeMs));
  wind += "}";
  appendJsonField(telemetry, firstTelemetry, "wind", wind);
  telemetry += "}";
  appendJsonField(snapshot, firstSnapshot, "telemetry", telemetry);

  String system = "{";
  bool firstSystem = true;
  String wifi = "{";
  bool firstWifi = true;
  appendJsonField(wifi, firstWifi, "connected", jsonBool(wifiConnected));
  appendJsonField(wifi, firstWifi, "ssid", jsonString(wifiConnected ? WiFi.SSID() : wifiConfig.ssid));
  appendJsonField(wifi, firstWifi, "rssi", String(wifiConnected ? WiFi.RSSI() : 0));
  appendJsonField(wifi, firstWifi, "lastError", jsonString(wifiLastError));
  wifi += "}";
  appendJsonField(system, firstSystem, "wifi", wifi);

  String cloud = "{";
  bool firstCloud = true;
  appendJsonField(cloud, firstCloud, "reachable", jsonBool(wifiConnected));
  cloud += "}";
  appendJsonField(system, firstSystem, "cloud", cloud);

  String firmware = "{";
  bool firstFirmware = true;
  appendJsonField(firmware, firstFirmware, "version", jsonString(FW_VERSION));
  firmware += "}";
  appendJsonField(system, firstSystem, "firmware", firmware);

  String pairMode = "{";
  bool firstPair = true;
  appendJsonField(pairMode, firstPair, "active", jsonBool(isPairModeActive(millis())));
  appendJsonField(pairMode, firstPair, "remainingMs", String(isPairModeActive(millis()) ? (pairModeUntilMs - millis()) : 0));
  appendJsonField(pairMode, firstPair, "sessionPaired", jsonBool(isPrivilegedSessionActive(millis())));
  pairMode += "}";
  appendJsonField(system, firstSystem, "pairMode", pairMode);

  system += "}";
  appendJsonField(snapshot, firstSnapshot, "system", system);

  String anchor = "{";
  bool firstAnchor = true;
  appendJsonField(anchor, firstAnchor, "state", jsonString(anchorState));
  if (anchorPositionValid) {
    String position = "{";
    bool firstPosition = true;
    appendJsonField(position, firstPosition, "lat", String(anchorLat, 6));
    appendJsonField(position, firstPosition, "lon", String(anchorLon, 6));
    position += "}";
    appendJsonField(anchor, firstAnchor, "position", position);
  } else {
    appendJsonField(anchor, firstAnchor, "position", "null");
  }
  anchor += "}";
  appendJsonField(snapshot, firstSnapshot, "anchor", anchor);
  snapshot += "}";

  appendJsonField(payload, firstPayload, "snapshot", snapshot);
  appendJsonField(payload, firstPayload, "updatedAt", String((unsigned long)millis()));
  payload += "}";
  return payload;
}

void sendStatusSnapshot() {
  sendEnvelopeOverBle("status.snapshot", buildStatusSnapshotPayload(), false);
}

void sendTrackSnapshot() {
  String payload = "{";
  bool firstPayload = true;

  String points = "[";
  points += "{";
  bool firstPoint = true;
  appendJsonField(points, firstPoint, "ts", String((unsigned long)millis()));
  appendJsonField(points, firstPoint, "lat", String(sample.latDeg, 6));
  appendJsonField(points, firstPoint, "lon", String(sample.lonDeg, 6));
  appendJsonField(points, firstPoint, "cogDeg", String(sample.cogDeg, 1));
  appendJsonField(points, firstPoint, "headingDeg", String(sample.cogDeg, 1));
  appendJsonField(points, firstPoint, "sogKn", String(sample.sogKnots, 2));
  points += "}";
  points += "]";

  appendJsonField(payload, firstPayload, "points", points);
  appendJsonField(payload, firstPayload, "totalPoints", "1");
  appendJsonField(payload, firstPayload, "returnedPoints", "1");
  payload += "}";

  sendEnvelopeOverBle("track.snapshot", payload, false);
}

void sendStatusPatch() {
  const bool wifiConnected = WiFi.status() == WL_CONNECTED;
  String payload = "{";
  bool firstPayload = true;
  String statePatch = "{";
  bool firstPatch = true;

  appendJsonField(statePatch, firstPatch, "telemetry.gps.lat", String(sample.latDeg, 6));
  appendJsonField(statePatch, firstPatch, "telemetry.gps.lon", String(sample.lonDeg, 6));
  appendJsonField(statePatch, firstPatch, "telemetry.gps.ageMs", String(sample.gpsAgeMs));
  appendJsonField(statePatch, firstPatch, "telemetry.gps.valid", jsonBool(sample.gpsValid));
  appendJsonField(statePatch, firstPatch, "telemetry.motion.sogKn", String(sample.sogKnots, 2));
  appendJsonField(statePatch, firstPatch, "telemetry.motion.cogDeg", String(sample.cogDeg, 1));
  appendJsonField(statePatch, firstPatch, "telemetry.depth.meters", String(sample.depthM, 2));
  appendJsonField(statePatch, firstPatch, "telemetry.wind.knots", String(sample.windKnots, 1));
  appendJsonField(statePatch, firstPatch, "telemetry.wind.dirDeg", String(sample.windDirDeg, 1));
  appendJsonField(statePatch, firstPatch, "system.wifi.connected", jsonBool(wifiConnected));
  appendJsonField(statePatch, firstPatch, "system.wifi.ssid", jsonString(wifiConnected ? WiFi.SSID() : wifiConfig.ssid));
  appendJsonField(statePatch, firstPatch, "system.wifi.rssi", String(wifiConnected ? WiFi.RSSI() : 0));
  appendJsonField(statePatch, firstPatch, "system.wifi.lastError", jsonString(wifiLastError));
  appendJsonField(statePatch, firstPatch, "system.cloud.reachable", jsonBool(wifiConnected));
  appendJsonField(statePatch, firstPatch, "system.firmware.version", jsonString(FW_VERSION));
  appendJsonField(statePatch, firstPatch, "system.pairMode.active", jsonBool(isPairModeActive(millis())));
  appendJsonField(statePatch, firstPatch, "system.pairMode.remainingMs", String(isPairModeActive(millis()) ? (pairModeUntilMs - millis()) : 0));
  appendJsonField(statePatch, firstPatch, "system.pairMode.sessionPaired", jsonBool(isPrivilegedSessionActive(millis())));
  appendJsonField(statePatch, firstPatch, "anchor.state", jsonString(anchorState));
  if (anchorPositionValid) {
    appendJsonField(statePatch, firstPatch, "anchor.position.lat", String(anchorLat, 6));
    appendJsonField(statePatch, firstPatch, "anchor.position.lon", String(anchorLon, 6));
  } else {
    appendJsonField(statePatch, firstPatch, "anchor.position", "null");
  }
  statePatch += "}";

  appendJsonField(payload, firstPayload, "statePatch", statePatch);
  payload += "}";
  sendEnvelopeOverBle("status.patch", payload, false);
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

void enterPairMode(unsigned long nowMs, unsigned long ttlMs = PAIR_MODE_TTL_MS) {
  pairModeUntilMs = nowMs + ttlMs;
  privSessionUntilMs = 0;
  secretSentInCurrentPairWindow = false;
  Serial.println("[pair] pair mode enabled");
}

void exitPairMode() {
  pairModeUntilMs = 0;
  privSessionUntilMs = 0;
  secretSentInCurrentPairWindow = false;
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
  String ver = "";
  if (!extractJsonStringValue(raw, "ver", ver)) {
    errorDetail = "missing ver";
    return false;
  }
  if (ver != PROTOCOL_VERSION) {
    errorDetail = "unsupported ver";
    return false;
  }
  if (!extractJsonStringValue(raw, "msgType", parsed.msgType)) {
    errorDetail = "missing msgType";
    return false;
  }
  if (!extractJsonStringValue(raw, "msgId", parsed.msgId)) {
    parsed.msgId = buildMsgId();
  }
  parsed.requiresAck = false;
  extractJsonBoolValue(raw, "requiresAck", parsed.requiresAck);
  return true;
}

CommandResult makeResult(const String &status, const String &errorCode = "", const String &errorDetail = "") {
  CommandResult result;
  result.status = status;
  result.errorCode = errorCode;
  result.errorDetail = errorDetail;
  result.ackExtraFields = "";
  result.skipAutoAck = false;
  return result;
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

void sendOnboardingWifiScanResult(const String &requestId, const String &networksJson, const String &errorCode = "", const String &errorDetail = "") {
  String payload = "{";
  bool first = true;
  appendJsonField(payload, first, "requestId", jsonString(requestId));
  appendJsonField(payload, first, "completedAt", String((unsigned long)millis()));
  appendJsonField(payload, first, "networks", networksJson);
  if (errorCode.length() > 0) {
    appendJsonField(payload, first, "errorCode", jsonString(errorCode));
  }
  if (errorDetail.length() > 0) {
    appendJsonField(payload, first, "errorDetail", jsonString(errorDetail));
  }
  payload += "}";
  sendEnvelopeOverBle("onboarding.wifi.scan_result", payload, false);
}

bool applyWiFiConfigPatch(const String &raw, String &errorCode, String &errorDetail) {
  int version = 0;
  if (!extractJsonIntValue(raw, "version", version) || version < 0) {
    errorCode = "INVALID_PAYLOAD";
    errorDetail = "config.patch requires integer version>=0";
    return false;
  }
  if (version <= wifiConfig.version) {
    errorCode = "VERSION_CONFLICT";
    errorDetail = "version must increase";
    return false;
  }

  String ssid = "";
  String passphrase = "";
  String security = "";
  String country = "";
  bool hidden = wifiConfig.hidden;
  bool hasSsid = extractJsonStringByAnyKey(raw, "network.wifi.ssid", "ssid", ssid);
  bool hasPass = extractJsonStringByAnyKey(raw, "network.wifi.passphrase", "passphrase", passphrase);
  bool hasSecurity = extractJsonStringByAnyKey(raw, "network.wifi.security", "security", security);
  bool hasCountry = extractJsonStringByAnyKey(raw, "network.wifi.country", "country", country);
  bool hasHidden = extractJsonBoolByAnyKey(raw, "network.wifi.hidden", "hidden", hidden);

  if (!hasSsid && !hasPass && !hasSecurity && !hasCountry && !hasHidden) {
    errorCode = "INVALID_PAYLOAD";
    errorDetail = "no supported network.wifi.* fields in patch";
    return false;
  }

  if (hasSsid) {
    wifiConfig.ssid = ssid;
  }
  if (hasPass) {
    wifiConfig.passphrase = passphrase;
  }
  if (hasSecurity) {
    wifiConfig.security = security;
  }
  if (hasCountry) {
    wifiConfig.country = country;
  }
  if (hasHidden) {
    wifiConfig.hidden = hidden;
  }
  wifiConfig.version = version;
  persistWiFiConfig();
  scheduleWifiConnectNow();
  return true;
}

CommandResult handleConfigPatch(const ParsedEnvelope &envelope, const String &raw) {
  const unsigned long nowMs = millis();
  if (!isPrivilegedSessionActive(nowMs)) {
    return makeResult("rejected", "AUTH_FAILED", "pair mode and paired session required");
  }

  String errorCode = "";
  String errorDetail = "";
  if (!applyWiFiConfigPatch(raw, errorCode, errorDetail)) {
    return makeResult("rejected", errorCode, errorDetail);
  }

  if (debugProtocol) {
    Serial.println("[proto] applied config.patch network.wifi.*");
  }
  sendStatusPatch();
  return makeResult("ok");
}

CommandResult handleOnboardingRequestSecret() {
  const unsigned long nowMs = millis();
  if (!isPrivilegedSessionActive(nowMs)) {
    return makeResult("rejected", "AUTH_FAILED", "pair mode and paired session required");
  }
  sendOnboardingBoatSecret();
  secretSentInCurrentPairWindow = true;
  return makeResult("ok");
}

CommandResult handleOnboardingWifiScan(const ParsedEnvelope &envelope, const String &raw) {
  const unsigned long scanStartedAtMs = millis();
  String requestId = envelope.msgId;
  extractJsonStringValue(raw, "requestId", requestId);
  requestId.trim();
  if (requestId.length() == 0) {
    requestId = envelope.msgId;
  }

  int maxResults = 20;
  extractJsonIntValue(raw, "maxResults", maxResults);
  bool includeHidden = false;
  extractJsonBoolValue(raw, "includeHidden", includeHidden);

  if (debugProtocol) {
    Serial.print("[scan] requestId=");
    Serial.print(requestId);
    Serial.print(" msgId=");
    Serial.print(envelope.msgId);
    Serial.print(" maxResults=");
    Serial.print(maxResults);
    Serial.print(" includeHidden=");
    Serial.print(includeHidden ? "true" : "false");
    Serial.print(" bleConnected=");
    Serial.println(bleConnected ? "true" : "false");
  }

  sendCommandAck(envelope.msgId, "ok", "", "", "\"requestId\":" + jsonString(requestId));

  String networksJson = "[]";
  String scanError = "";
  if (!buildWifiScanNetworksJson(maxResults, includeHidden, networksJson, scanError)) {
    if (debugProtocol) {
      Serial.print("[scan] failed requestId=");
      Serial.print(requestId);
      Serial.print(" elapsedMs=");
      Serial.print(millis() - scanStartedAtMs);
      Serial.print(" error=");
      Serial.println(scanError);
    }
    sendOnboardingWifiScanResult(requestId, "[]", "DEVICE_FAILED", scanError);
    CommandResult result = makeResult("ok");
    result.skipAutoAck = true;
    return result;
  }

  if (debugProtocol) {
    Serial.print("[scan] success requestId=");
    Serial.print(requestId);
    Serial.print(" elapsedMs=");
    Serial.print(millis() - scanStartedAtMs);
    Serial.print(" networksBytes=");
    Serial.print(networksJson.length());
    Serial.print(" bleConnected=");
    Serial.println(bleConnected ? "true" : "false");
  }
  sendOnboardingWifiScanResult(requestId, networksJson);
  CommandResult result = makeResult("ok");
  result.skipAutoAck = true;
  return result;
}

CommandResult handleOnboardingWifiConnect(const String &raw) {
  const unsigned long nowMs = millis();
  if (!isPrivilegedSessionActive(nowMs)) {
    return makeResult("rejected", "AUTH_FAILED", "pair mode and paired session required");
  }

  String ssid = "";
  String passphrase = "";
  String security = wifiConfig.security.length() ? wifiConfig.security : "wpa2";
  String country = wifiConfig.country.length() ? wifiConfig.country : "DE";
  bool hidden = wifiConfig.hidden;

  const bool hasSsid = extractJsonStringByAnyKey(raw, "network.wifi.ssid", "ssid", ssid);
  extractJsonStringByAnyKey(raw, "network.wifi.passphrase", "passphrase", passphrase);
  extractJsonStringByAnyKey(raw, "network.wifi.security", "security", security);
  extractJsonStringByAnyKey(raw, "network.wifi.country", "country", country);
  extractJsonBoolByAnyKey(raw, "network.wifi.hidden", "hidden", hidden);

  if (!hasSsid || ssid.length() == 0) {
    return makeResult("rejected", "INVALID_PAYLOAD", "ssid is required");
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
  sendStatusPatch();
  return makeResult("ok");
}

CommandResult handleAnchorRise() {
  anchorState = "up";
  anchorPositionValid = false;
  sendStatusPatch();
  return makeResult("ok");
}

CommandResult handleAnchorDown(const String &raw) {
  float requestedLat = 0.0f;
  float requestedLon = 0.0f;
  const bool hasLat = extractJsonFloatValue(raw, "lat", requestedLat);
  const bool hasLon = extractJsonFloatValue(raw, "lon", requestedLon);

  if (hasLat && hasLon) {
    anchorLat = requestedLat;
    anchorLon = requestedLon;
  } else if (sample.gpsValid) {
    anchorLat = sample.latDeg;
    anchorLon = sample.lonDeg;
  } else {
    return makeResult("rejected", "INVALID_PAYLOAD", "anchor.down requires lat/lon or valid GPS");
  }

  anchorPositionValid = true;
  anchorState = "down";
  sendStatusPatch();
  return makeResult("ok");
}

CommandResult dispatchMessage(const ParsedEnvelope &envelope, const String &raw, InboundSource source) {
  (void)source;
  if (envelope.msgType == "config.patch") {
    return handleConfigPatch(envelope, raw);
  }
  if (envelope.msgType == "onboarding.request_secret") {
    return handleOnboardingRequestSecret();
  }
  if (envelope.msgType == "onboarding.wifi.scan") {
    return handleOnboardingWifiScan(envelope, raw);
  }
  if (envelope.msgType == "onboarding.wifi.connect") {
    return handleOnboardingWifiConnect(raw);
  }
  if (envelope.msgType == "status.snapshot.request") {
    sendStatusSnapshot();
    return makeResult("ok");
  }
  if (envelope.msgType == "track.snapshot.request") {
    sendTrackSnapshot();
    return makeResult("ok");
  }
  if (envelope.msgType == "anchor.rise") {
    return handleAnchorRise();
  }
  if (envelope.msgType == "anchor.down") {
    return handleAnchorDown(raw);
  }
  return makeResult("rejected", "UNSUPPORTED_MSG_TYPE", "unsupported msgType");
}

void processInboundMessage(const String &raw, InboundSource source) {
  ParsedEnvelope envelope = {};
  String parseError = "";
  String fallbackMsgId = "";
  extractJsonStringValue(raw, "msgId", fallbackMsgId);

  if (!parseEnvelope(raw, envelope, parseError)) {
    if (debugProtocol) {
      Serial.print("[proto] parse error from ");
      Serial.print(sourceName(source));
      Serial.print(": ");
      Serial.println(parseError);
    }
    if (fallbackMsgId.length() > 0) {
      sendCommandAck(fallbackMsgId, "rejected", "INVALID_PAYLOAD", parseError);
    }
    return;
  }

  if (debugProtocol) {
    Serial.print("[proto] rx ");
    Serial.print(envelope.msgType);
    Serial.print(" via ");
    Serial.println(sourceName(source));
  }

  const CommandResult result = dispatchMessage(envelope, raw, source);
  const bool shouldAck =
    envelope.requiresAck ||
    envelope.msgType.endsWith(".request") ||
    envelope.msgType == "config.patch" ||
    envelope.msgType.startsWith("onboarding.");
  if (shouldAck && !result.skipAutoAck) {
    sendCommandAck(envelope.msgId, result.status, result.errorCode, result.errorDetail, result.ackExtraFields);
  }
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
  } else if (action == "request_secret") {
    if (isPrivilegedSessionActive(nowMs)) {
      sendOnboardingBoatSecret();
      secretSentInCurrentPairWindow = true;
    }
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
    OutboundEnvelope envelope = makeEnvelope("status.snapshot", buildStatusSnapshotPayload(), false);
    characteristic->setValue(envelope.json.c_str());
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

void emitBlePeriodicMessages(unsigned long nowMs) {
  (void)nowMs;
  // Disabled: periodic status.patch pushes have caused repeated NimBLE ENOMEM on some clients.
  // State still updates via command responses, snapshots, and explicit status.patch emits on config/anchor changes.
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
    processAuthWrite("request_secret");
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
    secretSentInCurrentPairWindow = false;
    Serial.println("[pair] pair mode expired");
  }
  pairModeWasActive = active;
}

void maybeEmitOnboardingSecret() {
  const unsigned long nowMs = millis();
  if (!bleConnected || !isPrivilegedSessionActive(nowMs) || secretSentInCurrentPairWindow) {
    return;
  }
  sendOnboardingBoatSecret();
  secretSentInCurrentPairWindow = true;
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
  maybeEmitOnboardingSecret();
  emitBlePeriodicMessages(nowMs);

  if (nowMs - lastTickMs < MAIN_TICK_MS) {
    return;
  }
  lastTickMs = nowMs;

  readTelemetry(sample, nowMs);
  applyAlarmLevel(evaluateAlarm(sample));
  printSample(sample, alarmLevel);
}
