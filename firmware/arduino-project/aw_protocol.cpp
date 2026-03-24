#include "aw_protocol.h"

#include "aw_json.h"

namespace aw {

namespace {

void appendFieldRaw(String& out, bool& first, const char* key, const String& raw_value) {
  if (!first) {
    out += ",";
  }
  out += jsonQuote(key);
  out += ":";
  out += raw_value;
  first = false;
}

String wrapReply(const String& req_id, const char* state, const char* type, const String& data_raw) {
  String out = "{";
  bool first = true;
  appendFieldRaw(out, first, "req_id", jsonQuote(req_id));
  appendFieldRaw(out, first, "state", jsonQuote(state));
  appendFieldRaw(out, first, "type", jsonQuote(type));
  appendFieldRaw(out, first, "data", data_raw);
  out += "}";
  return out;
}

String wrapStateReply(const String& req_id, const char* state, const char* type, const String& data_raw) {
  return wrapReply(req_id, state, type, data_raw);
}

bool parseQuotedEnum(const String& raw, String& out) {
  return jsonDecodeStringLiteral(jsonTrim(raw), out);
}

bool parseRequiredString(const String& object, const char* key, String& out, ErrorValue& error) {
  if (jsonGetString(object, key, out)) {
    return true;
  }
  error.code = "INVALID_REQUEST";
  error.message = String("missing or invalid ") + key;
  return false;
}

bool parseRequiredUint32(const String& object, const char* key, uint32_t& out, ErrorValue& error) {
  if (jsonGetUint32(object, key, out)) {
    return true;
  }
  error.code = "INVALID_REQUEST";
  error.message = String("missing or invalid ") + key;
  return false;
}

bool parseRequiredFloat(const String& object, const char* key, float& out, ErrorValue& error) {
  if (jsonGetFloat(object, key, out)) {
    return true;
  }
  error.code = "INVALID_REQUEST";
  error.message = String("missing or invalid ") + key;
  return false;
}

String serializeAlertConfigEntry(const AlertConfigEntry& entry) {
  String data = "{";
  bool first_data = true;
  switch (entry.type) {
    case AlertType::ANCHOR_DISTANCE:
      appendFieldRaw(data, first_data, "max_distance_m", jsonFloat(entry.max_distance_m, 2));
      break;
    case AlertType::OBSTACLE_CLOSE:
      appendFieldRaw(data, first_data, "min_distance_m", jsonFloat(entry.min_distance_m, 2));
      break;
    case AlertType::WIND_ABOVE:
      appendFieldRaw(data, first_data, "max_wind_kn", jsonFloat(entry.max_wind_kn, 2));
      break;
    case AlertType::DEPTH_BELOW:
      appendFieldRaw(data, first_data, "min_depth_m", jsonFloat(entry.min_depth_m, 2));
      break;
    case AlertType::DATA_OUTDATED:
      appendFieldRaw(data, first_data, "max_age_ms", String(entry.max_age_ms));
      break;
  }
  data += "}";

  String out = "{";
  bool first = true;
  appendFieldRaw(out, first, "type", jsonQuote(toProtocolString(entry.type)));
  appendFieldRaw(out, first, "enabled", jsonBool(entry.enabled));
  appendFieldRaw(out, first, "min_time_ms", String(entry.min_time_ms));
  appendFieldRaw(out, first, "severity", jsonQuote(toProtocolString(entry.severity)));
  appendFieldRaw(out, first, "default_silence_ms", String(entry.default_silence_ms));
  appendFieldRaw(out, first, "data", data);
  out += "}";
  return out;
}

String serializeAlertRuntime(const AlertRuntime& entry) {
  String out = "{";
  bool first = true;
  appendFieldRaw(out, first, "alert_type", jsonQuote(toProtocolString(entry.alert_type)));
  appendFieldRaw(out, first, "state", jsonQuote(toProtocolString(entry.state)));
  appendFieldRaw(out, first, "severity", jsonQuote(toProtocolString(entry.severity)));
  appendFieldRaw(out, first, "above_threshold_since_ts", entry.has_above_threshold_since ? jsonU64(entry.above_threshold_since_ts) : jsonNull());
  appendFieldRaw(out, first, "alert_since_ts", entry.has_alert_since ? jsonU64(entry.alert_since_ts) : jsonNull());
  appendFieldRaw(out, first, "alert_silenced_until_ts", entry.has_alert_silenced_until ? jsonU64(entry.alert_silenced_until_ts) : jsonNull());
  out += "}";
  return out;
}

String serializeGeoPoint(const GeoPoint& point) {
  return String("{\"lat\":") + jsonFloat(point.lat, 6) + ",\"lon\":" + jsonFloat(point.lon, 6) + "}";
}

}  // namespace

const char* toProtocolString(RuntimeMode value) {
  switch (value) {
    case RuntimeMode::LIVE: return "LIVE";
    case RuntimeMode::SIMULATION: return "SIMULATION";
  }
  return "LIVE";
}

const char* toProtocolString(WlanConnectionState value) {
  switch (value) {
    case WlanConnectionState::DISCONNECTED: return "DISCONNECTED";
    case WlanConnectionState::CONNECTING: return "CONNECTING";
    case WlanConnectionState::AUTHENTICATING: return "AUTHENTICATING";
    case WlanConnectionState::OBTAINING_IP: return "OBTAINING_IP";
    case WlanConnectionState::CONNECTED: return "CONNECTED";
    case WlanConnectionState::FAILED: return "FAILED";
  }
  return "DISCONNECTED";
}

const char* toProtocolString(AlertType value) {
  switch (value) {
    case AlertType::ANCHOR_DISTANCE: return "ANCHOR_DISTANCE";
    case AlertType::OBSTACLE_CLOSE: return "OBSTACLE_CLOSE";
    case AlertType::WIND_ABOVE: return "WIND_ABOVE";
    case AlertType::DEPTH_BELOW: return "DEPTH_BELOW";
    case AlertType::DATA_OUTDATED: return "DATA_OUTDATED";
  }
  return "ANCHOR_DISTANCE";
}

const char* toProtocolString(AlertSeverity value) {
  switch (value) {
    case AlertSeverity::WARNING: return "WARNING";
    case AlertSeverity::ALARM: return "ALARM";
  }
  return "WARNING";
}

const char* toProtocolString(AlertState value) {
  switch (value) {
    case AlertState::DISABLED_STATE: return "DISABLED";
    case AlertState::WATCHING: return "WATCHING";
    case AlertState::ALERT: return "ALERT";
  }
  return "WATCHING";
}

const char* toProtocolString(ObstacleType value) {
  switch (value) {
    case ObstacleType::PERMANENT: return "PERMANENT";
    case ObstacleType::TEMPORARY: return "TEMPORARY";
  }
  return "PERMANENT";
}

bool parseRuntimeMode(const String& raw, RuntimeMode& value) {
  if (raw == "LIVE") {
    value = RuntimeMode::LIVE;
    return true;
  }
  if (raw == "SIMULATION") {
    value = RuntimeMode::SIMULATION;
    return true;
  }
  return false;
}

bool parseAlertType(const String& raw, AlertType& value) {
  if (raw == "ANCHOR_DISTANCE") {
    value = AlertType::ANCHOR_DISTANCE;
    return true;
  }
  if (raw == "OBSTACLE_CLOSE") {
    value = AlertType::OBSTACLE_CLOSE;
    return true;
  }
  if (raw == "WIND_ABOVE") {
    value = AlertType::WIND_ABOVE;
    return true;
  }
  if (raw == "DEPTH_BELOW") {
    value = AlertType::DEPTH_BELOW;
    return true;
  }
  if (raw == "DATA_OUTDATED") {
    value = AlertType::DATA_OUTDATED;
    return true;
  }
  return false;
}

bool parseAlertSeverity(const String& raw, AlertSeverity& value) {
  if (raw == "WARNING") {
    value = AlertSeverity::WARNING;
    return true;
  }
  if (raw == "ALARM") {
    value = AlertSeverity::ALARM;
    return true;
  }
  return false;
}

bool parseObstacleType(const String& raw, ObstacleType& value) {
  if (raw == "PERMANENT") {
    value = ObstacleType::PERMANENT;
    return true;
  }
  if (raw == "TEMPORARY") {
    value = ObstacleType::TEMPORARY;
    return true;
  }
  return false;
}

AlarmConfigValue makeDefaultAlarmConfig() {
  AlarmConfigValue value;
  value.version = 1;

  AlertConfigEntry anchor;
  anchor.type = AlertType::ANCHOR_DISTANCE;
  anchor.enabled = true;
  anchor.min_time_ms = 20000;
  anchor.severity = AlertSeverity::ALARM;
  anchor.default_silence_ms = 900000;
  anchor.max_distance_m = 35.0f;

  AlertConfigEntry obstacle;
  obstacle.type = AlertType::OBSTACLE_CLOSE;
  obstacle.enabled = true;
  obstacle.min_time_ms = 10000;
  obstacle.severity = AlertSeverity::ALARM;
  obstacle.default_silence_ms = 900000;
  obstacle.min_distance_m = 10.0f;

  AlertConfigEntry wind;
  wind.type = AlertType::WIND_ABOVE;
  wind.enabled = true;
  wind.min_time_ms = 15000;
  wind.severity = AlertSeverity::WARNING;
  wind.default_silence_ms = 900000;
  wind.max_wind_kn = 25.0f;

  AlertConfigEntry depth;
  depth.type = AlertType::DEPTH_BELOW;
  depth.enabled = true;
  depth.min_time_ms = 10000;
  depth.severity = AlertSeverity::ALARM;
  depth.default_silence_ms = 900000;
  depth.min_depth_m = 2.0f;

  AlertConfigEntry outdated;
  outdated.type = AlertType::DATA_OUTDATED;
  outdated.enabled = true;
  outdated.min_time_ms = 5000;
  outdated.severity = AlertSeverity::WARNING;
  outdated.default_silence_ms = 300000;
  outdated.max_age_ms = 10000;

  value.alerts.push_back(anchor);
  value.alerts.push_back(obstacle);
  value.alerts.push_back(wind);
  value.alerts.push_back(depth);
  value.alerts.push_back(outdated);
  return value;
}

ObstaclesConfigValue makeDefaultObstaclesConfig() {
  ObstaclesConfigValue value;
  value.version = 1;
  return value;
}

RawConfigValue makeDefaultAnchorSettingsConfig() {
  RawConfigValue value;
  value.version = 1;
  value.raw_json = "{\"version\":1,\"allowed_range_m\":35,\"allowed_region\":null}";
  return value;
}

RawConfigValue makeDefaultProfilesConfig() {
  RawConfigValue value;
  value.version = 1;
  value.raw_json = "{\"version\":1,\"profiles\":[]}";
  return value;
}

SystemConfigValue makeDefaultSystemConfig() {
  SystemConfigValue value;
  value.version = 1;
  value.runtime_mode = RuntimeMode::LIVE;
  return value;
}

WlanConfigValue makeDefaultWlanConfig() {
  WlanConfigValue value;
  value.version = 1;
  value.ssid = "";
  value.passphrase = "";
  value.security = "wpa2";
  value.country = "DE";
  value.hidden = false;
  return value;
}

bool parseRequestEnvelope(const String& raw, RequestEnvelope& envelope, ErrorValue& error) {
  if (!parseRequiredString(raw, "req_id", envelope.req_id, error)) {
    return false;
  }
  if (!parseRequiredString(raw, "type", envelope.type, error)) {
    return false;
  }
  if (!jsonFindObjectFieldRaw(raw, "data", envelope.data_raw)) {
    error.code = "INVALID_REQUEST";
    error.message = "missing or invalid data";
    return false;
  }
  return true;
}

bool parseCancelRequest(const String& raw, String& original_req_id, ErrorValue& error) {
  return parseRequiredString(raw, "original_req_id", original_req_id, error);
}

bool parseSetAnchorRequest(const String& raw, SetAnchorRequest& request, ErrorValue& error) {
  String lat_raw;
  String lon_raw;
  const bool has_lat = jsonFindObjectFieldRaw(raw, "lat", lat_raw);
  const bool has_lon = jsonFindObjectFieldRaw(raw, "lon", lon_raw);
  if (has_lat != has_lon) {
    error.code = "INVALID_REQUEST";
    error.message = "lat and lon must both be present or omitted";
    return false;
  }
  if (!has_lat) {
    request.has_coordinates = false;
    return true;
  }
  request.has_coordinates = true;
  if (!parseRequiredFloat(raw, "lat", request.lat, error) || !parseRequiredFloat(raw, "lon", request.lon, error)) {
    return false;
  }
  return true;
}

bool parseMoveAnchorRequest(const String& raw, MoveAnchorRequest& request, ErrorValue& error) {
  return parseRequiredFloat(raw, "lat", request.lat, error) && parseRequiredFloat(raw, "lon", request.lon, error);
}

bool parseSilenceAlarmRequest(const String& raw, SilenceAlarmRequest& request, ErrorValue& error) {
  String type_raw;
  if (!parseRequiredString(raw, "alert_type", type_raw, error)) {
    return false;
  }
  if (!parseAlertType(type_raw, request.alert_type)) {
    error.code = "INVALID_REQUEST";
    error.message = "invalid alert_type";
    return false;
  }
  return true;
}

bool parseScanWlanRequest(const String& raw, ScanWlanRequest& request, ErrorValue& error) {
  uint32_t max_results = 32;
  bool include_hidden = false;
  String ignored_raw;
  if (jsonFindObjectFieldRaw(raw, "max_results", ignored_raw)) {
    if (!jsonGetUint32(raw, "max_results", max_results)) {
      error.code = "INVALID_REQUEST";
      error.message = "invalid max_results";
      return false;
    }
  }
  if (jsonFindObjectFieldRaw(raw, "include_hidden", ignored_raw)) {
    if (!jsonGetBool(raw, "include_hidden", include_hidden)) {
      error.code = "INVALID_REQUEST";
      error.message = "invalid include_hidden";
      return false;
    }
  }
  request.max_results = static_cast<int>(max_results);
  request.include_hidden = include_hidden;
  return true;
}

bool parseAlarmConfigValue(const String& raw, AlarmConfigValue& value, ErrorValue& error) {
  AlarmConfigValue parsed;
  if (!parseRequiredUint32(raw, "version", parsed.version, error)) {
    return false;
  }
  String alerts_raw;
  if (!jsonFindObjectFieldRaw(raw, "alerts", alerts_raw)) {
    error.code = "INVALID_REQUEST";
    error.message = "missing alerts";
    return false;
  }
  std::vector<String> alert_items;
  if (!jsonSplitArrayItems(alerts_raw, alert_items)) {
    error.code = "INVALID_REQUEST";
    error.message = "invalid alerts";
    return false;
  }
  for (const String& item : alert_items) {
    AlertConfigEntry entry;
    String type_raw;
    String severity_raw;
    if (!parseRequiredString(item, "type", type_raw, error) ||
        !parseRequiredString(item, "severity", severity_raw, error) ||
        !parseRequiredUint32(item, "min_time_ms", entry.min_time_ms, error) ||
        !parseRequiredUint32(item, "default_silence_ms", entry.default_silence_ms, error) ||
        !jsonGetBool(item, "enabled", entry.enabled)) {
      if (error.code.isEmpty()) {
        error.code = "INVALID_REQUEST";
        error.message = "invalid alert config entry";
      }
      return false;
    }
    if (!parseAlertType(type_raw, entry.type) || !parseAlertSeverity(severity_raw, entry.severity)) {
      error.code = "INVALID_REQUEST";
      error.message = "invalid alert type or severity";
      return false;
    }
    String data_raw;
    if (!jsonFindObjectFieldRaw(item, "data", data_raw)) {
      error.code = "INVALID_REQUEST";
      error.message = "missing alert data";
      return false;
    }
    switch (entry.type) {
      case AlertType::ANCHOR_DISTANCE:
        if (!parseRequiredFloat(data_raw, "max_distance_m", entry.max_distance_m, error)) {
          return false;
        }
        break;
      case AlertType::OBSTACLE_CLOSE:
        if (!parseRequiredFloat(data_raw, "min_distance_m", entry.min_distance_m, error)) {
          return false;
        }
        break;
      case AlertType::WIND_ABOVE:
        if (!parseRequiredFloat(data_raw, "max_wind_kn", entry.max_wind_kn, error)) {
          return false;
        }
        break;
      case AlertType::DEPTH_BELOW:
        if (!parseRequiredFloat(data_raw, "min_depth_m", entry.min_depth_m, error)) {
          return false;
        }
        break;
      case AlertType::DATA_OUTDATED:
        if (!parseRequiredUint32(data_raw, "max_age_ms", entry.max_age_ms, error)) {
          return false;
        }
        break;
    }
    parsed.alerts.push_back(entry);
  }
  value = parsed;
  return true;
}

bool parseObstaclesConfigValue(const String& raw, ObstaclesConfigValue& value, ErrorValue& error) {
  ObstaclesConfigValue parsed;
  if (!parseRequiredUint32(raw, "version", parsed.version, error)) {
    return false;
  }
  String obstacles_raw;
  if (!jsonFindObjectFieldRaw(raw, "obstacles", obstacles_raw)) {
    error.code = "INVALID_REQUEST";
    error.message = "missing obstacles";
    return false;
  }
  std::vector<String> obstacle_items;
  if (!jsonSplitArrayItems(obstacles_raw, obstacle_items)) {
    error.code = "INVALID_REQUEST";
    error.message = "invalid obstacles";
    return false;
  }
  for (const String& item : obstacle_items) {
    ObstaclePolygon obstacle;
    String type_raw;
    if (!parseRequiredString(item, "obstacle_id", obstacle.obstacle_id, error) ||
        !parseRequiredString(item, "type", type_raw, error)) {
      return false;
    }
    if (!parseObstacleType(type_raw, obstacle.type)) {
      error.code = "INVALID_REQUEST";
      error.message = "invalid obstacle type";
      return false;
    }
    String polygon_raw;
    if (!jsonFindObjectFieldRaw(item, "polygon", polygon_raw)) {
      error.code = "INVALID_REQUEST";
      error.message = "missing obstacle polygon";
      return false;
    }
    std::vector<String> point_items;
    if (!jsonSplitArrayItems(polygon_raw, point_items) || point_items.size() < 3) {
      error.code = "INVALID_REQUEST";
      error.message = "invalid obstacle polygon";
      return false;
    }
    for (const String& point_item : point_items) {
      GeoPoint point;
      if (!parseRequiredFloat(point_item, "lat", point.lat, error) ||
          !parseRequiredFloat(point_item, "lon", point.lon, error)) {
        return false;
      }
      obstacle.polygon.push_back(point);
    }
    parsed.obstacles.push_back(obstacle);
  }
  value = parsed;
  return true;
}

bool parseRawConfigValue(const String& raw, RawConfigValue& value, ErrorValue& error) {
  RawConfigValue parsed;
  if (!parseRequiredUint32(raw, "version", parsed.version, error)) {
    return false;
  }
  parsed.raw_json = jsonTrim(raw);
  value = parsed;
  return true;
}

bool parseSystemConfigValue(const String& raw, SystemConfigValue& value, ErrorValue& error) {
  SystemConfigValue parsed;
  if (!parseRequiredUint32(raw, "version", parsed.version, error)) {
    return false;
  }
  String mode_raw;
  if (!parseRequiredString(raw, "runtime_mode", mode_raw, error)) {
    return false;
  }
  if (!parseRuntimeMode(mode_raw, parsed.runtime_mode)) {
    error.code = "INVALID_REQUEST";
    error.message = "invalid runtime_mode";
    return false;
  }
  value = parsed;
  return true;
}

bool parseWlanConfigValue(const String& raw, WlanConfigValue& value, ErrorValue& error) {
  WlanConfigValue parsed;
  if (!parseRequiredUint32(raw, "version", parsed.version, error) ||
      !parseRequiredString(raw, "ssid", parsed.ssid, error) ||
      !parseRequiredString(raw, "passphrase", parsed.passphrase, error) ||
      !parseRequiredString(raw, "security", parsed.security, error) ||
      !parseRequiredString(raw, "country", parsed.country, error)) {
    return false;
  }
  if (!jsonGetBool(raw, "hidden", parsed.hidden)) {
    error.code = "INVALID_REQUEST";
    error.message = "missing or invalid hidden";
    return false;
  }
  value = parsed;
  return true;
}

bool parseAuthorizeSetupRequest(const String& raw, String& factory_setup_pin, ErrorValue& error) {
  if (!parseRequiredString(raw, "factory_setup_pin", factory_setup_pin, error)) {
    return false;
  }
  if (factory_setup_pin.isEmpty()) {
    error.code = "INVALID_REQUEST";
    error.message = "factory_setup_pin must be non-empty";
    return false;
  }
  return true;
}

bool parseAuthorizeBleSessionRequest(const String& raw, String& ble_connection_pin, ErrorValue& error) {
  if (!parseRequiredString(raw, "ble_connection_pin", ble_connection_pin, error)) {
    return false;
  }
  if (ble_connection_pin.isEmpty()) {
    error.code = "INVALID_REQUEST";
    error.message = "ble_connection_pin must be non-empty";
    return false;
  }
  return true;
}

bool parseSetInitialBlePinRequest(const String& raw, String& ble_connection_pin, ErrorValue& error) {
  if (!parseRequiredString(raw, "ble_connection_pin", ble_connection_pin, error)) {
    return false;
  }
  if (ble_connection_pin.isEmpty()) {
    error.code = "INVALID_REQUEST";
    error.message = "ble_connection_pin must be non-empty";
    return false;
  }
  return true;
}

bool parseCloudCredentialUpdate(const String& raw, uint32_t& version, String& boat_id, String& cloud_secret, ErrorValue& error) {
  if (!parseRequiredUint32(raw, "version", version, error) ||
      !parseRequiredString(raw, "boat_id", boat_id, error) ||
      !parseRequiredString(raw, "cloud_secret", cloud_secret, error)) {
    return false;
  }
  if (boat_id.isEmpty() || cloud_secret.isEmpty()) {
    error.code = "INVALID_REQUEST";
    error.message = "boat_id and cloud_secret must be non-empty";
    return false;
  }
  return true;
}

bool parseUpdateBlePinRequest(
  const String& raw,
  String& old_ble_connection_pin,
  String& new_ble_connection_pin,
  ErrorValue& error
) {
  if (!parseRequiredString(raw, "old_ble_connection_pin", old_ble_connection_pin, error) ||
      !parseRequiredString(raw, "new_ble_connection_pin", new_ble_connection_pin, error)) {
    return false;
  }
  if (old_ble_connection_pin.isEmpty() || new_ble_connection_pin.isEmpty()) {
    error.code = "INVALID_REQUEST";
    error.message = "old_ble_connection_pin and new_ble_connection_pin must be non-empty";
    return false;
  }
  return true;
}

String buildAckReply(const String& req_id) {
  return wrapReply(req_id, "CLOSED_OK", "ACK", "{}");
}

String buildErrorReply(const String& req_id, const String& code, const String& message) {
  String data = "{";
  bool first = true;
  appendFieldRaw(data, first, "code", jsonQuote(code));
  appendFieldRaw(data, first, "message", jsonQuote(message));
  data += "}";
  return wrapReply(req_id, "CLOSED_FAILED", "ERROR", data);
}

String buildPositionReply(const String& req_id, const char* state, const PositionState& value) {
  String data = "{";
  bool first = true;
  appendFieldRaw(data, first, "lat", jsonFloat(value.lat, 6));
  appendFieldRaw(data, first, "lon", jsonFloat(value.lon, 6));
  appendFieldRaw(data, first, "gps_age_ms", String(value.gps_age_ms));
  appendFieldRaw(data, first, "valid", jsonBool(value.valid));
  appendFieldRaw(data, first, "sog_kn", jsonFloat(value.sog_kn, 2));
  appendFieldRaw(data, first, "cog_deg", jsonFloat(value.cog_deg, 1));
  appendFieldRaw(data, first, "heading_deg", jsonFloat(value.heading_deg, 1));
  data += "}";
  return wrapStateReply(req_id, state, "STATE_POSITION", data);
}

String buildDepthReply(const String& req_id, const char* state, const DepthState& value) {
  String data = "{";
  bool first = true;
  appendFieldRaw(data, first, "depth_m", jsonFloat(value.depth_m, 2));
  appendFieldRaw(data, first, "ts", jsonU64(value.ts));
  data += "}";
  return wrapStateReply(req_id, state, "STATE_DEPTH", data);
}

String buildWindReply(const String& req_id, const char* state, const WindState& value) {
  String data = "{";
  bool first = true;
  appendFieldRaw(data, first, "wind_kn", jsonFloat(value.wind_kn, 2));
  appendFieldRaw(data, first, "wind_dir_deg", jsonFloat(value.wind_dir_deg, 1));
  appendFieldRaw(data, first, "ts", jsonU64(value.ts));
  data += "}";
  return wrapStateReply(req_id, state, "STATE_WIND", data);
}

String buildWlanStatusReply(const String& req_id, const char* state, const WlanStatusState& value) {
  String data = "{";
  bool first = true;
  appendFieldRaw(data, first, "wifi_state", jsonQuote(toProtocolString(value.wifi_state)));
  appendFieldRaw(data, first, "wifi_connected", jsonBool(value.wifi_connected));
  appendFieldRaw(data, first, "wifi_ssid", jsonQuote(value.wifi_ssid));
  appendFieldRaw(data, first, "wifi_rssi", String(value.wifi_rssi));
  appendFieldRaw(data, first, "wifi_error", jsonQuote(value.wifi_error));
  data += "}";
  return wrapStateReply(req_id, state, "STATE_WLAN_STATUS", data);
}

String buildSystemStatusReply(const String& req_id, const char* state, const SystemStatusState& value) {
  String data = "{";
  bool first = true;
  appendFieldRaw(data, first, "cloud_reachable", jsonBool(value.cloud_reachable));
  appendFieldRaw(data, first, "server_version", jsonQuote(value.server_version));
  data += "}";
  return wrapStateReply(req_id, state, "STATE_SYSTEM_STATUS", data);
}

String buildAlarmStateReply(const String& req_id, const char* state, const AlarmStateValue& value) {
  String alerts = "[";
  for (size_t index = 0; index < value.alerts.size(); index++) {
    if (index > 0) {
      alerts += ",";
    }
    alerts += serializeAlertRuntime(value.alerts[index]);
  }
  alerts += "]";

  String data = "{";
  bool first = true;
  appendFieldRaw(data, first, "alerts", alerts);
  data += "}";
  return wrapStateReply(req_id, state, "STATE_ALARM_STATE", data);
}

String buildAnchorPositionReply(const String& req_id, const char* state, const AnchorPositionState& value) {
  String data = "{";
  bool first = true;
  appendFieldRaw(data, first, "state", jsonQuote(value.state));
  appendFieldRaw(data, first, "lat", value.has_position ? jsonFloat(value.lat, 6) : jsonNull());
  appendFieldRaw(data, first, "lon", value.has_position ? jsonFloat(value.lon, 6) : jsonNull());
  data += "}";
  return wrapStateReply(req_id, state, "STATE_ANCHOR_POSITION", data);
}

String serializeAlarmConfigData(const AlarmConfigValue& value) {
  String alerts = "[";
  for (size_t index = 0; index < value.alerts.size(); index++) {
    if (index > 0) {
      alerts += ",";
    }
    alerts += serializeAlertConfigEntry(value.alerts[index]);
  }
  alerts += "]";

  String data = "{";
  bool first = true;
  appendFieldRaw(data, first, "version", String(value.version));
  appendFieldRaw(data, first, "alerts", alerts);
  data += "}";
  return data;
}

String buildAlarmConfigReply(const String& req_id, const char* state, const AlarmConfigValue& value) {
  return wrapStateReply(req_id, state, "CONFIG_ALARM", serializeAlarmConfigData(value));
}

String serializeObstaclesConfigData(const ObstaclesConfigValue& value) {
  String obstacles = "[";
  for (size_t index = 0; index < value.obstacles.size(); index++) {
    if (index > 0) {
      obstacles += ",";
    }
    const ObstaclePolygon& obstacle = value.obstacles[index];
    String polygon = "[";
    for (size_t point_index = 0; point_index < obstacle.polygon.size(); point_index++) {
      if (point_index > 0) {
        polygon += ",";
      }
      polygon += serializeGeoPoint(obstacle.polygon[point_index]);
    }
    polygon += "]";

    String item = "{";
    bool first = true;
    appendFieldRaw(item, first, "obstacle_id", jsonQuote(obstacle.obstacle_id));
    appendFieldRaw(item, first, "type", jsonQuote(toProtocolString(obstacle.type)));
    appendFieldRaw(item, first, "polygon", polygon);
    item += "}";
    obstacles += item;
  }
  obstacles += "]";

  String data = "{";
  bool first = true;
  appendFieldRaw(data, first, "version", String(value.version));
  appendFieldRaw(data, first, "obstacles", obstacles);
  data += "}";
  return data;
}

String buildObstaclesConfigReply(const String& req_id, const char* state, const ObstaclesConfigValue& value) {
  return wrapStateReply(req_id, state, "CONFIG_OBSTACLES", serializeObstaclesConfigData(value));
}

String serializeRawConfigData(const RawConfigValue& value) {
  return value.raw_json;
}

String buildRawConfigReply(const String& req_id, const char* state, const char* type, const RawConfigValue& value) {
  return wrapStateReply(req_id, state, type, serializeRawConfigData(value));
}

String serializeSystemConfigData(const SystemConfigValue& value) {
  String data = "{";
  bool first = true;
  appendFieldRaw(data, first, "version", String(value.version));
  appendFieldRaw(data, first, "runtime_mode", jsonQuote(toProtocolString(value.runtime_mode)));
  data += "}";
  return data;
}

String buildSystemConfigReply(const String& req_id, const char* state, const SystemConfigValue& value) {
  return wrapStateReply(req_id, state, "CONFIG_SYSTEM", serializeSystemConfigData(value));
}

String serializeWlanConfigData(const WlanConfigValue& value) {
  String data = "{";
  bool first = true;
  appendFieldRaw(data, first, "version", String(value.version));
  appendFieldRaw(data, first, "ssid", jsonQuote(value.ssid));
  appendFieldRaw(data, first, "passphrase", jsonQuote(value.passphrase));
  appendFieldRaw(data, first, "security", jsonQuote(value.security));
  appendFieldRaw(data, first, "country", jsonQuote(value.country));
  appendFieldRaw(data, first, "hidden", jsonBool(value.hidden));
  data += "}";
  return data;
}

String buildWlanConfigReply(const String& req_id, const char* state, const WlanConfigValue& value) {
  return wrapStateReply(req_id, state, "CONFIG_WLAN", serializeWlanConfigData(value));
}

String buildCloudConfigReply(const String& req_id, const char* state, const CloudConfigValue& value) {
  String data = "{";
  bool first = true;
  appendFieldRaw(data, first, "version", String(value.version));
  appendFieldRaw(data, first, "boat_id", jsonQuote(value.boat_id));
  appendFieldRaw(data, first, "cloud_secret", jsonQuote(value.cloud_secret));
  appendFieldRaw(data, first, "secret_configured", jsonBool(value.secret_configured));
  data += "}";
  return wrapStateReply(req_id, state, "CONFIG_CLOUD", data);
}

String buildTrackBackfillReply(const String& req_id, const char* state, const std::vector<TrackPoint>& points) {
  String data = "[";
  for (size_t index = 0; index < points.size(); index++) {
    if (index > 0) {
      data += ",";
    }
    const TrackPoint& point = points[index];
    String item = "{";
    bool first = true;
    appendFieldRaw(item, first, "ts", jsonU64(static_cast<uint64_t>(point.ts_sec) * 1000ULL));
    appendFieldRaw(item, first, "lat", jsonFloat(point.lat, 6));
    appendFieldRaw(item, first, "lon", jsonFloat(point.lon, 6));
    appendFieldRaw(item, first, "cog_deg", jsonFloat(point.cog_deg, 1));
    appendFieldRaw(item, first, "heading_deg", jsonFloat(point.heading_deg, 1));
    appendFieldRaw(item, first, "sog_kn", jsonFloat(point.sog_kn, 2));
    appendFieldRaw(item, first, "depth_m", point.has_depth ? jsonFloat(point.depth_m, 2) : jsonNull());
    appendFieldRaw(item, first, "wind_kn", point.has_wind ? jsonFloat(point.wind_kn, 2) : jsonNull());
    appendFieldRaw(item, first, "wind_dir_deg", point.has_wind ? jsonFloat(point.wind_dir_deg, 1) : jsonNull());
    item += "}";
    data += item;
  }
  data += "]";
  return wrapStateReply(req_id, state, "TRACK_BACKFILL", data);
}

String buildWlanNetworkReply(const String& req_id, const char* state, const WlanNetworkValue& value) {
  String data = "{";
  bool first = true;
  appendFieldRaw(data, first, "ssid", jsonQuote(value.ssid));
  appendFieldRaw(data, first, "security", jsonQuote(value.security));
  appendFieldRaw(data, first, "rssi", value.has_rssi ? String(value.rssi) : jsonNull());
  appendFieldRaw(data, first, "channel", value.has_channel ? String(value.channel) : jsonNull());
  appendFieldRaw(data, first, "hidden", jsonBool(value.hidden));
  data += "}";
  return wrapStateReply(req_id, state, "WLAN_NETWORK", data);
}

String buildAuthStatusJson(
  bool pair_mode_active,
  uint64_t pair_mode_until_ts,
  const String& boat_id,
  bool secret_configured,
  uint32_t cloud_config_version,
  const char* boat_access_state,
  const char* session_state
) {
  String data = "{";
  bool first = true;
  appendFieldRaw(data, first, "pair_mode_active", jsonBool(pair_mode_active));
  appendFieldRaw(data, first, "pair_mode_until_ts", pair_mode_active ? jsonU64(pair_mode_until_ts) : jsonNull());
  appendFieldRaw(data, first, "boat_id", jsonQuote(boat_id));
  appendFieldRaw(data, first, "secret_configured", jsonBool(secret_configured));
  appendFieldRaw(data, first, "cloud_config_version", String(cloud_config_version));
  appendFieldRaw(data, first, "boat_access_state", jsonQuote(boat_access_state));
  appendFieldRaw(data, first, "session_state", jsonQuote(session_state));
  data += "}";
  return data;
}

String buildSnapshotJson(
  const PositionState& position,
  const DepthState& depth,
  const WindState& wind,
  const AnchorPositionState& anchor_position,
  const WlanStatusState& wlan_status,
  const SystemStatusState& system_status,
  const AlarmStateValue& alarm_state,
  const SystemConfigValue& system_config,
  const CloudConfigValue& cloud_config
) {
  String data = "{";
  bool first = true;
  appendFieldRaw(data, first, "position_valid", jsonBool(position.valid));
  appendFieldRaw(data, first, "position_lat", jsonFloat(position.lat, 6));
  appendFieldRaw(data, first, "position_lon", jsonFloat(position.lon, 6));
  appendFieldRaw(data, first, "depth_m", depth.available ? jsonFloat(depth.depth_m, 2) : jsonNull());
  appendFieldRaw(data, first, "wind_kn", wind.available ? jsonFloat(wind.wind_kn, 2) : jsonNull());
  appendFieldRaw(data, first, "anchor_state", jsonQuote(anchor_position.state));
  appendFieldRaw(data, first, "wifi_state", jsonQuote(toProtocolString(wlan_status.wifi_state)));
  appendFieldRaw(data, first, "cloud_reachable", jsonBool(system_status.cloud_reachable));
  appendFieldRaw(data, first, "server_version", jsonQuote(system_status.server_version));
  appendFieldRaw(data, first, "runtime_mode", jsonQuote(toProtocolString(system_config.runtime_mode)));
  appendFieldRaw(data, first, "boat_id", jsonQuote(cloud_config.boat_id));
  appendFieldRaw(data, first, "secret_configured", jsonBool(cloud_config.secret_configured));
  appendFieldRaw(data, first, "active_alerts", String(alarm_state.alerts.size()));
  appendFieldRaw(data, first, "config_system", serializeSystemConfigData(system_config));
  appendFieldRaw(data, first, "config_cloud", String("{\"version\":") + cloud_config.version + ",\"boat_id\":" + jsonQuote(cloud_config.boat_id) + ",\"secret_configured\":" + jsonBool(cloud_config.secret_configured) + "}");
  data += "}";
  return data;
}

}  // namespace aw
