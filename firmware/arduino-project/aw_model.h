#pragma once

#include <Arduino.h>
#include <stdint.h>
#include <vector>

namespace aw {

enum class RuntimeMode {
  LIVE,
  SIMULATION,
};

enum class WlanConnectionState {
  DISCONNECTED,
  CONNECTING,
  AUTHENTICATING,
  OBTAINING_IP,
  CONNECTED,
  FAILED,
};

enum class AlertType {
  ANCHOR_DISTANCE,
  OBSTACLE_CLOSE,
  WIND_ABOVE,
  DEPTH_BELOW,
  DATA_OUTDATED,
};

enum class AlertSeverity {
  WARNING,
  ALARM,
};

enum class AlertState {
  DISABLED_STATE,
  WATCHING,
  ALERT,
};

enum class ObstacleType {
  PERMANENT,
  TEMPORARY,
};

struct GeoPoint {
  float lat = 0.0f;
  float lon = 0.0f;
};

struct PositionState {
  bool valid = false;
  float lat = 0.0f;
  float lon = 0.0f;
  uint32_t gps_age_ms = 0;
  float sog_kn = 0.0f;
  float cog_deg = 0.0f;
  float heading_deg = 0.0f;
  uint64_t last_update_ts = 0;
};

struct DepthState {
  bool available = false;
  float depth_m = 0.0f;
  uint64_t ts = 0;
};

struct WindState {
  bool available = false;
  float wind_kn = 0.0f;
  float wind_dir_deg = 0.0f;
  uint64_t ts = 0;
};

struct AnchorPositionState {
  String state = "up";
  bool has_position = false;
  float lat = 0.0f;
  float lon = 0.0f;
};

struct WlanStatusState {
  WlanConnectionState wifi_state = WlanConnectionState::DISCONNECTED;
  bool wifi_connected = false;
  String wifi_ssid;
  int32_t wifi_rssi = 0;
  String wifi_error;
};

struct SystemStatusState {
  bool cloud_reachable = false;
  String server_version;
};

struct AlertConfigEntry {
  AlertType type = AlertType::ANCHOR_DISTANCE;
  bool enabled = true;
  uint32_t min_time_ms = 0;
  AlertSeverity severity = AlertSeverity::ALARM;
  uint32_t default_silence_ms = 0;
  float max_distance_m = 0.0f;
  float min_distance_m = 0.0f;
  float max_wind_kn = 0.0f;
  float min_depth_m = 0.0f;
  uint32_t max_age_ms = 0;
};

struct AlarmConfigValue {
  uint32_t version = 1;
  std::vector<AlertConfigEntry> alerts;
};

struct ObstaclePolygon {
  String obstacle_id;
  ObstacleType type = ObstacleType::PERMANENT;
  std::vector<GeoPoint> polygon;
};

struct ObstaclesConfigValue {
  uint32_t version = 1;
  std::vector<ObstaclePolygon> obstacles;
};

struct RawConfigValue {
  uint32_t version = 1;
  String raw_json;
};

struct SystemConfigValue {
  uint32_t version = 1;
  RuntimeMode runtime_mode = RuntimeMode::LIVE;
};

struct WlanConfigValue {
  uint32_t version = 1;
  String ssid;
  String passphrase;
  String security = "wpa2";
  String country = "DE";
  bool hidden = false;
};

struct CloudConfigValue {
  uint32_t version = 1;
  String boat_id;
  String boat_secret;
  bool secret_configured = false;
};

struct AlertRuntime {
  AlertType alert_type = AlertType::ANCHOR_DISTANCE;
  AlertState state = AlertState::WATCHING;
  AlertSeverity severity = AlertSeverity::ALARM;
  bool has_above_threshold_since = false;
  uint64_t above_threshold_since_ts = 0;
  bool has_alert_since = false;
  uint64_t alert_since_ts = 0;
  bool has_alert_silenced_until = false;
  uint64_t alert_silenced_until_ts = 0;
};

struct AlarmStateValue {
  std::vector<AlertRuntime> alerts;
};

struct TrackPoint {
  uint32_t ts_sec = 0;
  float lat = 0.0f;
  float lon = 0.0f;
  float cog_deg = 0.0f;
  float heading_deg = 0.0f;
  float sog_kn = 0.0f;
  bool has_depth = false;
  float depth_m = 0.0f;
  bool has_wind = false;
  float wind_kn = 0.0f;
  float wind_dir_deg = 0.0f;
};

struct RequestEnvelope {
  String req_id;
  String type;
  String data_raw;
};

struct ErrorValue {
  String code;
  String message;
};

struct WlanNetworkValue {
  String ssid;
  String security;
  int32_t rssi = 0;
  int32_t channel = 0;
  bool hidden = false;
  bool has_rssi = false;
  bool has_channel = false;
};

struct SetAnchorRequest {
  bool has_coordinates = false;
  float lat = 0.0f;
  float lon = 0.0f;
};

struct MoveAnchorRequest {
  float lat = 0.0f;
  float lon = 0.0f;
};

struct SilenceAlarmRequest {
  AlertType alert_type = AlertType::ANCHOR_DISTANCE;
};

struct ScanWlanRequest {
  int max_results = 32;
  bool include_hidden = false;
};

}  // namespace aw
