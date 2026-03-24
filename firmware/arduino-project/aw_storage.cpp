#include "aw_storage.h"

#include <Preferences.h>

#include "aw_constants.h"
#include "aw_protocol.h"

namespace aw {

namespace {

Preferences prefs;

String suffixFromEfuse() {
  const uint64_t mac = ESP.getEfuseMac();
  char buffer[17];
  snprintf(buffer, sizeof(buffer), "%08llx", static_cast<unsigned long long>(mac & 0xffffffffULL));
  return String(buffer);
}

}  // namespace

String makeDefaultDeviceId() {
  return String(DEFAULT_DEVICE_ID_PREFIX) + suffixFromEfuse();
}

String makeDefaultBoatId() {
  return String(DEFAULT_BOAT_ID_PREFIX) + suffixFromEfuse();
}

bool Storage::begin() {
  if (started_) {
    return true;
  }
  started_ = prefs.begin(PREFS_NAMESPACE, false);
  return started_;
}

void Storage::end() {
  if (started_) {
    prefs.end();
    started_ = false;
  }
}

void Storage::loadIdentity(String& device_id, String& ble_connection_pin, CloudConfigValue& cloud_config) {
  device_id = prefs.getString(PREF_KEY_DEVICE_ID, makeDefaultDeviceId());
  cloud_config.boat_id = prefs.getString(PREF_KEY_BOAT_ID, makeDefaultBoatId());
  ble_connection_pin = prefs.getString(PREF_KEY_BLE_CONNECTION_PIN, "");
  cloud_config.cloud_secret = prefs.getString(PREF_KEY_CLOUD_SECRET, "");
  cloud_config.secret_configured = !cloud_config.cloud_secret.isEmpty();
  cloud_config.version = prefs.getUInt(PREF_KEY_CLOUD_VERSION, 1U);
  prefs.putString(PREF_KEY_DEVICE_ID, device_id);
  prefs.putString(PREF_KEY_BOAT_ID, cloud_config.boat_id);
}

void Storage::saveIdentity(const String& ble_connection_pin, const CloudConfigValue& cloud_config) {
  prefs.putString(PREF_KEY_BLE_CONNECTION_PIN, ble_connection_pin);
  prefs.putString(PREF_KEY_BOAT_ID, cloud_config.boat_id);
  prefs.putString(PREF_KEY_CLOUD_SECRET, cloud_config.cloud_secret);
  prefs.putUInt(PREF_KEY_CLOUD_VERSION, cloud_config.version);
}

void Storage::loadAlarmConfig(AlarmConfigValue& value) {
  const String raw = prefs.getString(PREF_KEY_ALARM_CONFIG, "");
  ErrorValue error;
  if (!raw.isEmpty() && parseAlarmConfigValue(raw, value, error)) {
    return;
  }
  value = makeDefaultAlarmConfig();
}

void Storage::saveAlarmConfig(const AlarmConfigValue& value) {
  prefs.putString(PREF_KEY_ALARM_CONFIG, serializeAlarmConfigData(value));
}

void Storage::loadObstaclesConfig(ObstaclesConfigValue& value) {
  const String raw = prefs.getString(PREF_KEY_OBSTACLES, "");
  ErrorValue error;
  if (!raw.isEmpty() && parseObstaclesConfigValue(raw, value, error)) {
    return;
  }
  value = makeDefaultObstaclesConfig();
}

void Storage::saveObstaclesConfig(const ObstaclesConfigValue& value) {
  prefs.putString(PREF_KEY_OBSTACLES, serializeObstaclesConfigData(value));
}

void Storage::loadAnchorSettings(RawConfigValue& value) {
  const String raw = prefs.getString(PREF_KEY_ANCHOR_SETTINGS, "");
  ErrorValue error;
  if (!raw.isEmpty() && parseRawConfigValue(raw, value, error)) {
    return;
  }
  value = makeDefaultAnchorSettingsConfig();
}

void Storage::saveAnchorSettings(const RawConfigValue& value) {
  prefs.putString(PREF_KEY_ANCHOR_SETTINGS, value.raw_json);
}

void Storage::loadProfiles(RawConfigValue& value) {
  const String raw = prefs.getString(PREF_KEY_PROFILES, "");
  ErrorValue error;
  if (!raw.isEmpty() && parseRawConfigValue(raw, value, error)) {
    return;
  }
  value = makeDefaultProfilesConfig();
}

void Storage::saveProfiles(const RawConfigValue& value) {
  prefs.putString(PREF_KEY_PROFILES, value.raw_json);
}

void Storage::loadSystemConfig(SystemConfigValue& value) {
  const String raw = prefs.getString(PREF_KEY_SYSTEM_CONFIG, "");
  ErrorValue error;
  if (!raw.isEmpty() && parseSystemConfigValue(raw, value, error)) {
    return;
  }
  value = makeDefaultSystemConfig();
}

void Storage::saveSystemConfig(const SystemConfigValue& value) {
  prefs.putString(PREF_KEY_SYSTEM_CONFIG, serializeSystemConfigData(value));
}

void Storage::loadWlanConfig(WlanConfigValue& value) {
  const String raw = prefs.getString(PREF_KEY_WLAN_CONFIG, "");
  ErrorValue error;
  if (!raw.isEmpty() && parseWlanConfigValue(raw, value, error)) {
    return;
  }
  value = makeDefaultWlanConfig();
}

void Storage::saveWlanConfig(const WlanConfigValue& value) {
  prefs.putString(PREF_KEY_WLAN_CONFIG, serializeWlanConfigData(value));
}

void Storage::loadAnchorState(AnchorPositionState& anchor_position, uint64_t& last_anchor_down_ts) {
  anchor_position.state = prefs.getString(PREF_KEY_ANCHOR_STATE, "up");
  anchor_position.has_position = prefs.getBool(PREF_KEY_ANCHOR_HAS, false);
  anchor_position.lat = prefs.getFloat(PREF_KEY_ANCHOR_LAT, 0.0f);
  anchor_position.lon = prefs.getFloat(PREF_KEY_ANCHOR_LON, 0.0f);
  last_anchor_down_ts = prefs.getULong64(PREF_KEY_LAST_ANCHOR_TS, 0ULL);
}

void Storage::saveAnchorState(const AnchorPositionState& anchor_position, uint64_t last_anchor_down_ts) {
  prefs.putString(PREF_KEY_ANCHOR_STATE, anchor_position.state);
  prefs.putBool(PREF_KEY_ANCHOR_HAS, anchor_position.has_position);
  prefs.putFloat(PREF_KEY_ANCHOR_LAT, anchor_position.lat);
  prefs.putFloat(PREF_KEY_ANCHOR_LON, anchor_position.lon);
  prefs.putULong64(PREF_KEY_LAST_ANCHOR_TS, last_anchor_down_ts);
}

}  // namespace aw
