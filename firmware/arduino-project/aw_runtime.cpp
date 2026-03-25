#include "aw_runtime.h"

#include <WiFi.h>
#include <Preferences.h>
#include <esp_heap_caps.h>

#include "aw_constants.h"
#include "aw_json.h"
#include "aw_protocol.h"

namespace aw {

namespace {

static const char* BLE_SESSION_ID = "ble";

void clearEspWifiNvs() {
  Preferences wifi_prefs;
  if (!wifi_prefs.begin("wifi", false)) {
    Serial.println("[wifi] failed to open wifi nvs namespace");
    return;
  }
  wifi_prefs.clear();
  wifi_prefs.end();
  Serial.println("[wifi] cleared esp wifi nvs namespace");
}

void logBootstrapSend(const char* type) {
  Serial.print("[bootstrap] ");
  Serial.println(type);
}

bool equalPositionState(const PositionState& a, const PositionState& b) {
  return a.valid == b.valid
    && a.lat == b.lat
    && a.lon == b.lon
    && a.gps_age_ms == b.gps_age_ms
    && a.sog_kn == b.sog_kn
    && a.cog_deg == b.cog_deg
    && a.heading_deg == b.heading_deg
    && a.last_update_ts == b.last_update_ts;
}

bool equalDepthState(const DepthState& a, const DepthState& b) {
  return a.available == b.available
    && a.depth_m == b.depth_m
    && a.ts == b.ts;
}

bool equalWindState(const WindState& a, const WindState& b) {
  return a.available == b.available
    && a.wind_kn == b.wind_kn
    && a.wind_dir_deg == b.wind_dir_deg
    && a.ts == b.ts;
}

bool equalAnchorPositionState(const AnchorPositionState& a, const AnchorPositionState& b) {
  return a.state == b.state
    && a.has_position == b.has_position
    && a.lat == b.lat
    && a.lon == b.lon;
}

bool equalWlanStatusState(const WlanStatusState& a, const WlanStatusState& b) {
  return a.wifi_state == b.wifi_state
    && a.wifi_connected == b.wifi_connected
    && a.wifi_ssid == b.wifi_ssid
    && a.wifi_rssi == b.wifi_rssi
    && a.wifi_error == b.wifi_error;
}

bool equalSystemStatusState(const SystemStatusState& a, const SystemStatusState& b) {
  return a.cloud_reachable == b.cloud_reachable
    && a.server_version == b.server_version;
}

bool equalAlertRuntime(const AlertRuntime& a, const AlertRuntime& b) {
  return a.alert_type == b.alert_type
    && a.state == b.state
    && a.severity == b.severity
    && a.has_above_threshold_since == b.has_above_threshold_since
    && a.above_threshold_since_ts == b.above_threshold_since_ts
    && a.has_alert_since == b.has_alert_since
    && a.alert_since_ts == b.alert_since_ts
    && a.has_alert_silenced_until == b.has_alert_silenced_until
    && a.alert_silenced_until_ts == b.alert_silenced_until_ts;
}

bool equalAlarmState(const AlarmStateValue& a, const AlarmStateValue& b) {
  if (a.alerts.size() != b.alerts.size()) {
    return false;
  }
  for (size_t index = 0; index < a.alerts.size(); index++) {
    if (!equalAlertRuntime(a.alerts[index], b.alerts[index])) {
      return false;
    }
  }
  return true;
}

}  // namespace

void AnchorWatchRuntime::recordHeapCheckpoint(const char* label, bool store_for_boot_report) {
  HeapCheckpoint checkpoint;
  checkpoint.label = label;
  checkpoint.free_heap = ESP.getFreeHeap();
  checkpoint.min_free_heap = ESP.getMinFreeHeap();
  checkpoint.free_8bit = heap_caps_get_free_size(MALLOC_CAP_8BIT);
  checkpoint.largest_8bit = heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
  checkpoint.free_internal = heap_caps_get_free_size(MALLOC_CAP_INTERNAL);
  checkpoint.largest_internal = heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL);

  Serial.printf(
    "[mem] %s free_heap=%u min_free_heap=%u free_8bit=%u largest_8bit=%u free_internal=%u largest_internal=%u\n",
    checkpoint.label.c_str(),
    checkpoint.free_heap,
    checkpoint.min_free_heap,
    checkpoint.free_8bit,
    checkpoint.largest_8bit,
    checkpoint.free_internal,
    checkpoint.largest_internal
  );
  log_e(
    "[mem] %s free_heap=%u min_free_heap=%u free_8bit=%u largest_8bit=%u free_internal=%u largest_internal=%u",
    checkpoint.label.c_str(),
    checkpoint.free_heap,
    checkpoint.min_free_heap,
    checkpoint.free_8bit,
    checkpoint.largest_8bit,
    checkpoint.free_internal,
    checkpoint.largest_internal
  );

  if (store_for_boot_report) {
    boot_heap_checkpoints_.push_back(checkpoint);
  }
}

void AnchorWatchRuntime::printBootHeapCheckpoints() {
  if (boot_heap_checkpoints_.empty()) {
    Serial.println("[mem] no deferred boot checkpoints recorded");
    return;
  }
  Serial.println("[mem] deferred boot checkpoint replay start");
  log_e("[mem] deferred boot checkpoint replay start");
  for (const HeapCheckpoint& checkpoint : boot_heap_checkpoints_) {
    Serial.printf(
      "[mem][replay] %s free_heap=%u min_free_heap=%u free_8bit=%u largest_8bit=%u free_internal=%u largest_internal=%u\n",
      checkpoint.label.c_str(),
      checkpoint.free_heap,
      checkpoint.min_free_heap,
      checkpoint.free_8bit,
      checkpoint.largest_8bit,
      checkpoint.free_internal,
      checkpoint.largest_internal
    );
    log_e(
      "[mem][replay] %s free_heap=%u min_free_heap=%u free_8bit=%u largest_8bit=%u free_internal=%u largest_internal=%u",
      checkpoint.label.c_str(),
      checkpoint.free_heap,
      checkpoint.min_free_heap,
      checkpoint.free_8bit,
      checkpoint.largest_8bit,
      checkpoint.free_internal,
      checkpoint.largest_internal
    );
  }
  Serial.println("[mem] deferred boot checkpoint replay end");
  log_e("[mem] deferred boot checkpoint replay end");
}

void AnchorWatchRuntime::setup() {
  Serial.begin(115200);
  boot_heap_checkpoints_.clear();
  recordHeapCheckpoint("boot", true);
  setupPins();
  recordHeapCheckpoint("after setupPins", true);
  storage_.begin();
  recordHeapCheckpoint("after storage.begin", true);
  track_log_.begin();
  recordHeapCheckpoint("after track_log.begin", true);
  loadState();
  recordHeapCheckpoint("after loadState", true);
  system_status_.server_version = FW_VERSION;
  system_status_.cloud_reachable = false;
  pair_mode_until_ms_ = millis() + PAIR_MODE_TTL_MS;
  last_pair_mode_active_ = isPairModeActive(millis());
  setupWifi();
  const String device_name = String(BLE_DEVICE_NAME_PREFIX) + device_id_.substring(max(0, static_cast<int>(device_id_.length()) - 6));
  const bool ble_ready = ble_.begin(device_name, this);
  recordHeapCheckpoint("after ble.begin", true);
  if (ble_ready) {
    Serial.print("[ble] advertising as ");
    Serial.println(device_name);
  } else {
    Serial.println("[ble] init failed; BLE transport unavailable");
  }
  recordHeapCheckpoint("before cloud.begin", true);
  cloud_.begin(this);
  recordHeapCheckpoint("after cloud.begin", true);
  if (system_config_.runtime_mode == RuntimeMode::SIMULATION) {
    simulation_.begin(millis());
    has_real_time_ = true;
  }
  deferred_boot_heap_report_due_ms_ = millis() + 2000UL;
  deferred_boot_heap_report_pending_ = true;
  refreshAuthValue();
  refreshSnapshotValue();
  Serial.println("AnchorWatch firmware v2 runtime started");
  Serial.println("Commands: help, mem status, pair on, pair off, pair status, wifi status, wifi scan, track status, track clear, debug on, debug off");
}

void AnchorWatchRuntime::loop() {
  const unsigned long now_ms = millis();
  if (deferred_boot_heap_report_pending_ && now_ms >= deferred_boot_heap_report_due_ms_) {
    printBootHeapCheckpoints();
    deferred_boot_heap_report_pending_ = false;
  }
  ble_.loop(now_ms);
  processSerial();
  updateLoopState(now_ms);
  delay(LOOP_IDLE_DELAY_MS);
}

void AnchorWatchRuntime::setupPins() {
  pinMode(SIREN_PIN, OUTPUT);
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(SIREN_PIN, LOW);
  digitalWrite(STATUS_LED_PIN, LOW);
}

void AnchorWatchRuntime::setupWifi() {
  recordHeapCheckpoint("setupWifi start", true);
  clearEspWifiNvs();
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(false, false);
  WiFi.setSleep(false);
  WiFi.setHostname("anchorwatch");
  wlan_status_.wifi_state = WlanConnectionState::DISCONNECTED;
  wlan_status_.wifi_connected = false;
  recordHeapCheckpoint("setupWifi done", true);
}

void AnchorWatchRuntime::loadState() {
  storage_.loadIdentity(device_id_, ble_connection_pin_, cloud_config_);
  storage_.loadAlarmConfig(alarm_config_);
  storage_.loadObstaclesConfig(obstacles_);
  storage_.loadAnchorSettings(anchor_settings_);
  storage_.loadProfiles(profiles_);
  storage_.loadSystemConfig(system_config_);
  storage_.loadWlanConfig(wlan_config_);
  storage_.loadAnchorState(anchor_position_, last_anchor_down_ts_);
  updateAlarmAndOutputs(currentEpochMs());
}

void AnchorWatchRuntime::refreshAuthValue() {
  if (!ble_.isReady()) {
    return;
  }
  const unsigned long now_ms = millis();
  const SessionAuthRef* ble_auth = findSessionAuth(SessionTransport::BLE, BLE_SESSION_ID);
  const char* session_state = "UNAUTHORIZED";
  if (ble_auth != nullptr && ble_auth->setup_authorized) {
    session_state = "SETUP_AUTHORIZED";
  } else if (ble_auth != nullptr && ble_auth->session_authorized) {
    session_state = "AUTHORIZED";
  }
  ble_.setAuthValue(buildAuthStatusJson(
    isPairModeActive(now_ms),
    pairModeUntilTs(),
    cloud_config_.boat_id,
    cloud_config_.secret_configured,
    cloud_config_.version,
    boatAccessStateString(),
    session_state
  ));
}

void AnchorWatchRuntime::refreshSnapshotValue() {
  if (!ble_.isReady()) {
    return;
  }
  String snapshot = "{";
  snapshot += "\"boat_access_state\":\"";
  snapshot += boatAccessStateString();
  snapshot += "\",\"boat_id\":";
  snapshot += jsonQuote(cloud_config_.boat_id);
  snapshot += ",\"secret_configured\":";
  snapshot += jsonBool(cloud_config_.secret_configured);
  snapshot += ",\"cloud_config_version\":";
  snapshot += String(cloud_config_.version);
  snapshot += ",\"server_version\":";
  snapshot += jsonQuote(system_status_.server_version);
  snapshot += "}";
  ble_.setSnapshotValue(snapshot);
}

void AnchorWatchRuntime::processSerial() {
  static String line;
  while (Serial.available() > 0) {
    const char c = static_cast<char>(Serial.read());
    if (c == '\r') {
      continue;
    }
    if (c == '\n') {
      line.trim();
      if (!line.isEmpty()) {
        handleSerialCommand(line);
      }
      line = "";
      continue;
    }
    line += c;
  }
}

void AnchorWatchRuntime::handleSerialCommand(const String& line) {
  const unsigned long now_ms = millis();
  if (line == "help") {
    Serial.println("Commands: help, mem status, pair on, pair off, pair status, wifi status, wifi scan, track status, track clear, debug on, debug off");
    return;
  }
  if (line == "mem status") {
    recordHeapCheckpoint("serial mem status");
    printBootHeapCheckpoints();
    return;
  }
  if (line == "pair on") {
    setPairMode(now_ms, PAIR_MODE_TTL_MS);
    Serial.println("[pair] enabled for 120s");
    return;
  }
  if (line == "pair off") {
    clearPairMode();
    Serial.println("[pair] disabled");
    return;
  }
  if (line == "pair status") {
    Serial.print("[pair] active=");
    Serial.print(isPairModeActive(now_ms) ? "true" : "false");
    Serial.print(" until_ts=");
    Serial.println(static_cast<unsigned long long>(pairModeUntilTs()));
    return;
  }
  if (line == "wifi status") {
    Serial.print("[wifi] state=");
    Serial.print(toProtocolString(wlan_status_.wifi_state));
    Serial.print(" connected=");
    Serial.print(wlan_status_.wifi_connected ? "true" : "false");
    Serial.print(" ssid=");
    Serial.print(wlan_status_.wifi_ssid);
    Serial.print(" rssi=");
    Serial.print(wlan_status_.wifi_rssi);
    Serial.print(" error=");
    Serial.println(wlan_status_.wifi_error);
    return;
  }
  if (line == "wifi scan") {
    if (scan_active_) {
      Serial.println("[wifi] scan already active via protocol");
      return;
    }
    std::vector<WlanNetworkValue> results;
    String error_message;
    if (!performWifiScan(false, 20, results, error_message)) {
      Serial.print("[wifi] serial scan failed: ");
      Serial.println(error_message);
      return;
    }
    Serial.print("[wifi] serial scan found ");
    Serial.println(static_cast<unsigned>(results.size()));
    for (size_t index = 0; index < results.size(); index++) {
      const WlanNetworkValue& network = results[index];
      Serial.print("[wifi] ");
      Serial.print(index);
      Serial.print(": ssid=");
      Serial.print(network.ssid);
      Serial.print(" security=");
      Serial.print(network.security);
      Serial.print(" rssi=");
      Serial.print(network.has_rssi ? String(network.rssi) : String("null"));
      Serial.print(" channel=");
      Serial.print(network.has_channel ? String(network.channel) : String("null"));
      Serial.print(" hidden=");
      Serial.println(network.hidden ? "true" : "false");
    }
    return;
  }
  if (line == "track status") {
    const TrackLog::Stats stats = track_log_.stats();
    Serial.print("[track] available=");
    Serial.print(stats.available ? "true" : "false");
    Serial.print(" count=");
    Serial.print(stats.count);
    Serial.print(" capacity=");
    Serial.print(stats.capacity);
    Serial.print(" next_index=");
    Serial.print(stats.next_index);
    Serial.print(" file_bytes=");
    Serial.print(stats.file_bytes);
    Serial.print(" fs_used=");
    Serial.print(stats.fs_used_bytes);
    Serial.print(" fs_total=");
    Serial.print(stats.fs_total_bytes);
    Serial.print(" reserved=");
    Serial.println(stats.reserved_bytes);
    return;
  }
  if (line == "track clear") {
    track_log_.clear();
    Serial.println("[track] cleared");
    return;
  }
  if (line == "debug on") {
    debug_enabled_ = true;
    Serial.println("[debug] enabled");
    return;
  }
  if (line == "debug off") {
    debug_enabled_ = false;
    Serial.println("[debug] disabled");
    return;
  }
  Serial.println("[serial] unknown command");
}

bool AnchorWatchRuntime::performWifiScan(
  bool include_hidden,
  int max_results,
  std::vector<WlanNetworkValue>& results,
  String& error_message
) {
  recordHeapCheckpoint("scan start");
  WiFi.mode(WIFI_STA);
  WiFi.enableSTA(true);
  wifi_connect_started_ms_ = 0;
  WiFi.disconnect(false, false);
  delay(50);
  recordHeapCheckpoint("scan after wifi reset");
  results.clear();
  const int found = WiFi.scanNetworks(false, include_hidden);
  recordHeapCheckpoint("scan after scanNetworks");
  Serial.printf("[wifi] scan result found=%d status=%d\n", found, static_cast<int>(WiFi.status()));
  if (found == WIFI_SCAN_RUNNING) {
    error_message = "wifi scan already running";
    return false;
  }
  if (found < 0) {
    error_message = "wifi scan failed rc=" + String(found) + " status=" + String(static_cast<int>(WiFi.status()));
    Serial.print("[wifi] ");
    Serial.println(error_message);
    WiFi.scanDelete();
    return false;
  }
  const int limited_results = min(found, max_results);
  for (int index = 0; index < limited_results; index++) {
    WlanNetworkValue network;
    network.ssid = WiFi.SSID(index);
    network.security = "wpa2";
    network.has_rssi = true;
    network.rssi = WiFi.RSSI(index);
    network.has_channel = true;
    network.channel = WiFi.channel(index);
    network.hidden = network.ssid.isEmpty();
    if (!include_hidden && network.hidden) {
      continue;
    }
    results.push_back(network);
  }
  WiFi.scanDelete();
  recordHeapCheckpoint("scan after scanDelete");
  error_message = "";
  return true;
}

void AnchorWatchRuntime::onBleJsonMessage(const String& json) {
  handleRequest(SessionTransport::BLE, BLE_SESSION_ID, json);
}

void AnchorWatchRuntime::onBleAuthAction(const String& action) {
  if (action == "pair.confirm" || action == "PAIR_CONFIRM") {
    refreshAuthValue();
    Serial.println("[ble-auth] pair confirm ignored; pair mode alone grants BLE writes");
    return;
  }
  if (action == "pair.clear" || action == "PAIR_CLEAR") {
    refreshAuthValue();
  }
}

void AnchorWatchRuntime::onBleConnectionChanged(bool connected) {
  if (!connected) {
    ble_outbox_.clear();
    closeSession(SessionTransport::BLE, BLE_SESSION_ID, "ble_disconnected");
  }
}

void AnchorWatchRuntime::onCloudSessionOpened(const String& cloud_conn_id) {
  if (debug_enabled_) {
    Serial.print("[cloud] session open ");
    Serial.println(cloud_conn_id);
  }
}

void AnchorWatchRuntime::onCloudSessionPayload(const String& cloud_conn_id, const String& payload_json) {
  handleRequest(SessionTransport::CLOUD, cloud_conn_id, payload_json);
}

void AnchorWatchRuntime::onCloudSessionClosed(const String& cloud_conn_id, const String& reason) {
  if (debug_enabled_) {
    Serial.print("[cloud] session closed ");
    Serial.print(cloud_conn_id);
    Serial.print(" reason=");
    Serial.println(reason);
  }
  closeSession(SessionTransport::CLOUD, cloud_conn_id, reason);
}

void AnchorWatchRuntime::updateLoopState(unsigned long now_ms) {
  last_pair_mode_active_ = isPairModeActive(now_ms);
  updateWlan(now_ms);
  updateCloud(now_ms);
  updateTelemetry(now_ms);
  if (scan_active_) {
    if (scan_emit_index_ < scan_results_.size()) {
      send(active_scan_request_, buildWlanNetworkReply(active_scan_request_.req_id, "ONGOING", scan_results_[scan_emit_index_]));
      scan_emit_index_++;
    } else if (scan_needs_ack_) {
      sendAck(active_scan_request_);
      scan_active_ = false;
      active_scan_request_ = {};
      scan_results_.clear();
      scan_emit_index_ = 0;
      scan_needs_ack_ = false;
    }
  }
  refreshAuthValue();
  refreshSnapshotValue();
  flushBleOutbox(now_ms);
}

void AnchorWatchRuntime::flushBleOutbox(unsigned long now_ms) {
  if (ble_outbox_.empty() || !ble_.isReady() || !ble_.isConnected()) {
    return;
  }
  if (last_ble_send_ms_ != 0 && now_ms - last_ble_send_ms_ < BLE_NOTIFY_INTER_MESSAGE_DELAY_MS) {
    return;
  }
  const String json = ble_outbox_.front();
  ble_outbox_.erase(ble_outbox_.begin());
  if (debug_enabled_) {
    Serial.print("[ble-outbox] sending ");
    Serial.println(json);
  }
  if (ble_.sendJson(json)) {
    last_ble_send_ms_ = now_ms;
    return;
  }
  ble_outbox_.insert(ble_outbox_.begin(), json);
}

void AnchorWatchRuntime::updateTelemetry(unsigned long now_ms) {
  if (now_ms - last_telemetry_tick_ms_ < TELEMETRY_TICK_MS) {
    return;
  }
  last_telemetry_tick_ms_ += TELEMETRY_TICK_MS;
  if (last_telemetry_tick_ms_ == 0 || last_telemetry_tick_ms_ > now_ms) {
    last_telemetry_tick_ms_ = now_ms;
  }

  const PositionState previous_position = position_;
  const DepthState previous_depth = depth_;
  const WindState previous_wind = wind_;
  const AnchorPositionState previous_anchor_position = anchor_position_;
  const AlarmStateValue previous_alarm_state = alarm_state_;
  const WlanStatusState previous_wlan_status = wlan_status_;
  const SystemStatusState previous_system_status = system_status_;

  if (system_config_.runtime_mode == RuntimeMode::SIMULATION) {
    if (!simulation_.active()) {
      simulation_.begin(now_ms);
      has_real_time_ = true;
    }
    simulation_.step(now_ms, position_, depth_, wind_);
    if (now_ms - last_history_sample_ms_ >= HISTORY_SAMPLE_INTERVAL_MS) {
      last_history_sample_ms_ = now_ms;
      recordTrackPoint(simulation_.currentTsMs());
    }
    updateAlarmAndOutputs(simulation_.currentTsMs());
    if (!equalPositionState(previous_position, position_)) {
      publishPositionToStreams();
    }
    if (!equalDepthState(previous_depth, depth_)) {
      publishDepthToStreams();
    }
    if (!equalWindState(previous_wind, wind_)) {
      publishWindToStreams();
    }
    if (!equalWlanStatusState(previous_wlan_status, wlan_status_)) {
      publishWlanStatusToStreams();
    }
    if (!equalSystemStatusState(previous_system_status, system_status_)) {
      publishSystemStatusToStreams();
    }
    if (!equalAlarmState(previous_alarm_state, alarm_state_)) {
      publishAlarmStateToStreams();
    }
    if (!equalAnchorPositionState(previous_anchor_position, anchor_position_)) {
      publishAnchorPositionToStreams();
    }
    return;
  }

  if (!has_real_time_) {
    clearTelemetryForLiveMode();
    updateAlarmAndOutputs(0);
    if (!equalPositionState(previous_position, position_)) {
      publishPositionToStreams();
    }
    if (!equalDepthState(previous_depth, depth_)) {
      publishDepthToStreams();
    }
    if (!equalWindState(previous_wind, wind_)) {
      publishWindToStreams();
    }
    if (!equalWlanStatusState(previous_wlan_status, wlan_status_)) {
      publishWlanStatusToStreams();
    }
    if (!equalSystemStatusState(previous_system_status, system_status_)) {
      publishSystemStatusToStreams();
    }
    if (!equalAlarmState(previous_alarm_state, alarm_state_)) {
      publishAlarmStateToStreams();
    }
    if (!equalAnchorPositionState(previous_anchor_position, anchor_position_)) {
      publishAnchorPositionToStreams();
    }
    return;
  }
}

void AnchorWatchRuntime::clearTelemetryForLiveMode() {
  position_.valid = false;
  position_.lat = 0.0f;
  position_.lon = 0.0f;
  position_.gps_age_ms = 0;
  position_.sog_kn = 0.0f;
  position_.cog_deg = 0.0f;
  position_.heading_deg = 0.0f;
  position_.last_update_ts = 0;
  depth_.available = false;
  depth_.depth_m = 0.0f;
  depth_.ts = 0;
  wind_.available = false;
  wind_.wind_kn = 0.0f;
  wind_.wind_dir_deg = 0.0f;
  wind_.ts = 0;
}

void AnchorWatchRuntime::recordTrackPoint(uint64_t now_ts) {
  if (!position_.valid || now_ts == 0) {
    return;
  }
  TrackPoint point;
  point.ts_sec = static_cast<uint32_t>(now_ts / 1000ULL);
  point.lat = position_.lat;
  point.lon = position_.lon;
  point.cog_deg = position_.cog_deg;
  point.heading_deg = position_.heading_deg;
  point.sog_kn = position_.sog_kn;
  point.has_depth = depth_.available;
  point.depth_m = depth_.depth_m;
  point.has_wind = wind_.available;
  point.wind_kn = wind_.wind_kn;
  point.wind_dir_deg = wind_.wind_dir_deg;
  appendTrackPoint(point);
}

void AnchorWatchRuntime::appendTrackPoint(const TrackPoint& point) {
  if (!track_log_.append(point)) {
    Serial.println("[track] append failed");
  }
}

bool AnchorWatchRuntime::telemetryReady() const {
  return system_config_.runtime_mode == RuntimeMode::SIMULATION || has_real_time_;
}

uint64_t AnchorWatchRuntime::currentEpochMs() const {
  if (system_config_.runtime_mode == RuntimeMode::SIMULATION) {
    return simulation_.currentTsMs();
  }
  return has_real_time_ ? position_.last_update_ts : 0;
}

uint64_t AnchorWatchRuntime::pairModeUntilTs() const {
  return static_cast<uint64_t>(pair_mode_until_ms_);
}

bool AnchorWatchRuntime::isPairModeActive(unsigned long now_ms) const {
  return now_ms < pair_mode_until_ms_;
}

void AnchorWatchRuntime::setPairMode(unsigned long now_ms, unsigned long ttl_ms) {
  pair_mode_until_ms_ = now_ms + ttl_ms;
}

void AnchorWatchRuntime::clearPairMode() {
  pair_mode_until_ms_ = 0;
}

bool AnchorWatchRuntime::isSetupRequired() const {
  return ble_connection_pin_.isEmpty();
}

bool AnchorWatchRuntime::isLocalReady() const {
  return !ble_connection_pin_.isEmpty();
}

bool AnchorWatchRuntime::isCloudReady() const {
  return !ble_connection_pin_.isEmpty() && cloud_config_.secret_configured && !cloud_config_.cloud_secret.isEmpty();
}

const char* AnchorWatchRuntime::boatAccessStateString() const {
  if (isSetupRequired()) {
    return "SETUP_REQUIRED";
  }
  if (isCloudReady()) {
    return "CLOUD_READY";
  }
  return "LOCAL_READY";
}

AnchorWatchRuntime::SessionAuthRef* AnchorWatchRuntime::findSessionAuth(SessionTransport transport, const String& session_id) {
  for (SessionAuthRef& entry : session_auth_) {
    if (sessionMatches(entry.session, transport, session_id)) {
      return &entry;
    }
  }
  return nullptr;
}

const AnchorWatchRuntime::SessionAuthRef* AnchorWatchRuntime::findSessionAuth(SessionTransport transport, const String& session_id) const {
  for (const SessionAuthRef& entry : session_auth_) {
    if (sessionMatches(entry.session, transport, session_id)) {
      return &entry;
    }
  }
  return nullptr;
}

AnchorWatchRuntime::SessionAuthRef& AnchorWatchRuntime::ensureSessionAuth(SessionTransport transport, const String& session_id) {
  SessionAuthRef* existing = findSessionAuth(transport, session_id);
  if (existing != nullptr) {
    return *existing;
  }
  session_auth_.push_back({});
  SessionAuthRef& created = session_auth_.back();
  created.session.transport = transport;
  created.session.session_id = session_id;
  return created;
}

bool AnchorWatchRuntime::isSetupAuthorized(SessionTransport transport, const String& session_id) const {
  const SessionAuthRef* entry = findSessionAuth(transport, session_id);
  return entry != nullptr && entry->setup_authorized;
}

bool AnchorWatchRuntime::isSessionAuthorized(SessionTransport transport, const String& session_id) const {
  const SessionAuthRef* entry = findSessionAuth(transport, session_id);
  return entry != nullptr && entry->session_authorized;
}

void AnchorWatchRuntime::clearAllSessionAuthorization() {
  for (SessionAuthRef& entry : session_auth_) {
    entry.setup_authorized = false;
    entry.session_authorized = false;
  }
}

void AnchorWatchRuntime::clearBleSessionAuthorization() {
  for (SessionAuthRef& entry : session_auth_) {
    if (entry.session.transport != SessionTransport::BLE) {
      continue;
    }
    entry.setup_authorized = false;
    entry.session_authorized = false;
  }
}

void AnchorWatchRuntime::invalidateAuthorizedStreams(const String& code, const String& message) {
  for (size_t index = 0; index < get_data_requests_.size();) {
    if (get_data_requests_[index].session.transport != SessionTransport::BLE) {
      index++;
      continue;
    }
    sendError(get_data_requests_[index], code, message);
    get_data_requests_.erase(get_data_requests_.begin() + index);
  }

  if (scan_active_ && active_scan_request_.session.transport == SessionTransport::BLE) {
    sendError(active_scan_request_, code, message);
    scan_active_ = false;
    active_scan_request_ = {};
    scan_results_.clear();
    scan_emit_index_ = 0;
    scan_needs_ack_ = false;
  }
}

bool AnchorWatchRuntime::sessionMatches(const SessionRef& session, SessionTransport transport, const String& session_id) const {
  return session.transport == transport && session.session_id == session_id;
}

void AnchorWatchRuntime::sendToSession(SessionTransport transport, const String& session_id, const String& json) {
  if (transport == SessionTransport::BLE) {
    (void)session_id;
    ble_outbox_.push_back(json);
    return;
  }
  cloud_.sendPayload(session_id, json);
}

void AnchorWatchRuntime::send(const ActiveRequestRef& request, const String& json) {
  sendToSession(request.session.transport, request.session.session_id, json);
}

void AnchorWatchRuntime::sendError(const ActiveRequestRef& request, const String& code, const String& message) {
  send(request, buildErrorReply(request.req_id, code, message));
}

void AnchorWatchRuntime::sendAck(const ActiveRequestRef& request) {
  send(request, buildAckReply(request.req_id));
}

void AnchorWatchRuntime::publishBootstrap(const ActiveRequestRef& request) {
  Serial.print("[bootstrap] start req_id=");
  Serial.println(request.req_id);
  logBootstrapSend("STATE_POSITION");
  send(request, buildPositionReply(request.req_id, "ONGOING", position_));
  logBootstrapSend("STATE_DEPTH");
  send(request, buildDepthReply(request.req_id, "ONGOING", depth_));
  logBootstrapSend("STATE_WIND");
  send(request, buildWindReply(request.req_id, "ONGOING", wind_));
  logBootstrapSend("STATE_WLAN_STATUS");
  send(request, buildWlanStatusReply(request.req_id, "ONGOING", wlan_status_));
  logBootstrapSend("STATE_SYSTEM_STATUS");
  send(request, buildSystemStatusReply(request.req_id, "ONGOING", system_status_));
  logBootstrapSend("STATE_ANCHOR_POSITION");
  send(request, buildAnchorPositionReply(request.req_id, "ONGOING", anchor_position_));
  logBootstrapSend("STATE_ALARM_STATE");
  send(request, buildAlarmStateReply(request.req_id, "ONGOING", alarm_state_));
  logBootstrapSend("CONFIG_ALARM");
  send(request, buildAlarmConfigReply(request.req_id, "ONGOING", alarm_config_));
  logBootstrapSend("CONFIG_OBSTACLES");
  send(request, buildObstaclesConfigReply(request.req_id, "ONGOING", obstacles_));
  logBootstrapSend("CONFIG_ANCHOR_SETTINGS");
  send(request, buildRawConfigReply(request.req_id, "ONGOING", "CONFIG_ANCHOR_SETTINGS", anchor_settings_));
  logBootstrapSend("CONFIG_PROFILES");
  send(request, buildRawConfigReply(request.req_id, "ONGOING", "CONFIG_PROFILES", profiles_));
  logBootstrapSend("CONFIG_SYSTEM");
  send(request, buildSystemConfigReply(request.req_id, "ONGOING", system_config_));
  logBootstrapSend("CONFIG_WLAN");
  send(request, buildWlanConfigReply(request.req_id, "ONGOING", wlan_config_));
  if (request.session.transport == SessionTransport::BLE &&
      isSessionAuthorized(request.session.transport, request.session.session_id)) {
    logBootstrapSend("CONFIG_CLOUD");
    send(request, buildCloudConfigReply(request.req_id, "ONGOING", cloud_config_));
  }
  logBootstrapSend("TRACK_BACKFILL");
  publishTrackBackfill(request);
  Serial.println("[bootstrap] end");
}

void AnchorWatchRuntime::publishPositionToStreams() {
  for (const ActiveRequestRef& request : get_data_requests_) {
    send(request, buildPositionReply(request.req_id, "ONGOING", position_));
  }
}

void AnchorWatchRuntime::publishDepthToStreams() {
  for (const ActiveRequestRef& request : get_data_requests_) {
    send(request, buildDepthReply(request.req_id, "ONGOING", depth_));
  }
}

void AnchorWatchRuntime::publishWindToStreams() {
  for (const ActiveRequestRef& request : get_data_requests_) {
    send(request, buildWindReply(request.req_id, "ONGOING", wind_));
  }
}

void AnchorWatchRuntime::publishWlanStatusToStreams() {
  for (const ActiveRequestRef& request : get_data_requests_) {
    send(request, buildWlanStatusReply(request.req_id, "ONGOING", wlan_status_));
  }
}

void AnchorWatchRuntime::publishSystemStatusToStreams() {
  for (const ActiveRequestRef& request : get_data_requests_) {
    send(request, buildSystemStatusReply(request.req_id, "ONGOING", system_status_));
  }
}

void AnchorWatchRuntime::publishAlarmStateToStreams() {
  for (const ActiveRequestRef& request : get_data_requests_) {
    send(request, buildAlarmStateReply(request.req_id, "ONGOING", alarm_state_));
  }
}

void AnchorWatchRuntime::publishAnchorPositionToStreams() {
  for (const ActiveRequestRef& request : get_data_requests_) {
    send(request, buildAnchorPositionReply(request.req_id, "ONGOING", anchor_position_));
  }
}

void AnchorWatchRuntime::publishRuntimeStateToStreams() {
  publishPositionToStreams();
  publishDepthToStreams();
  publishWindToStreams();
  publishWlanStatusToStreams();
  publishSystemStatusToStreams();
  publishAlarmStateToStreams();
  publishAnchorPositionToStreams();
}

void AnchorWatchRuntime::publishConfigToStreams(const char* config_type) {
  for (const ActiveRequestRef& request : get_data_requests_) {
    if (String(config_type) == "CONFIG_ALARM") {
      send(request, buildAlarmConfigReply(request.req_id, "ONGOING", alarm_config_));
    } else if (String(config_type) == "CONFIG_OBSTACLES") {
      send(request, buildObstaclesConfigReply(request.req_id, "ONGOING", obstacles_));
    } else if (String(config_type) == "CONFIG_ANCHOR_SETTINGS") {
      send(request, buildRawConfigReply(request.req_id, "ONGOING", "CONFIG_ANCHOR_SETTINGS", anchor_settings_));
    } else if (String(config_type) == "CONFIG_PROFILES") {
      send(request, buildRawConfigReply(request.req_id, "ONGOING", "CONFIG_PROFILES", profiles_));
    } else if (String(config_type) == "CONFIG_SYSTEM") {
      send(request, buildSystemConfigReply(request.req_id, "ONGOING", system_config_));
    } else if (String(config_type) == "CONFIG_WLAN") {
      send(request, buildWlanConfigReply(request.req_id, "ONGOING", wlan_config_));
    } else if (String(config_type) == "CONFIG_CLOUD") {
      if (request.session.transport == SessionTransport::BLE &&
          isSessionAuthorized(request.session.transport, request.session.session_id)) {
        send(request, buildCloudConfigReply(request.req_id, "ONGOING", cloud_config_));
      }
    }
  }
}

void AnchorWatchRuntime::publishTrackBackfill(const ActiveRequestRef& request) {
  const uint64_t now_ts = currentEpochMs();
  const TrackLog::Stats stats = track_log_.stats();
  if (stats.count == 0 || now_ts == 0) {
    return;
  }
  const uint64_t since_ts = last_anchor_down_ts_ > 0 && last_anchor_down_ts_ < now_ts - 1800000ULL
    ? last_anchor_down_ts_
    : (now_ts > 1800000ULL ? now_ts - 1800000ULL : 0ULL);
  std::vector<TrackPoint> batch;
  batch.reserve(TRACK_BACKFILL_REPLY_POINTS);
  const bool ok = track_log_.forEachSince(since_ts, [&](const TrackPoint& point) {
    batch.push_back(point);
    if (batch.size() >= TRACK_BACKFILL_REPLY_POINTS) {
      send(request, buildTrackBackfillReply(request.req_id, "ONGOING", batch));
      batch.clear();
    }
    return true;
  });
  if (!ok) {
    Serial.println("[track] backfill read failed");
    return;
  }
  if (!batch.empty()) {
    send(request, buildTrackBackfillReply(request.req_id, "ONGOING", batch));
  }
}

void AnchorWatchRuntime::updateWlan(unsigned long now_ms) {
  wl_status_t status = WiFi.status();
  const WlanStatusState previous_status = wlan_status_;

  if (status == WL_CONNECTED) {
    wlan_status_.wifi_state = WlanConnectionState::CONNECTED;
    wlan_status_.wifi_connected = true;
    wlan_status_.wifi_ssid = WiFi.SSID();
    wlan_status_.wifi_rssi = WiFi.RSSI();
    wlan_status_.wifi_error = "";
    wifi_connect_started_ms_ = 0;
    wifi_retry_delay_ms_ = WIFI_RETRY_MIN_MS;
  } else {
    wlan_status_.wifi_connected = false;
    wlan_status_.wifi_ssid = wlan_config_.ssid;
    wlan_status_.wifi_rssi = 0;
    if (!wlan_config_.ssid.isEmpty()) {
      if (wifi_connect_started_ms_ == 0 && now_ms >= wifi_next_retry_ms_) {
        startWifiConnect(now_ms);
      } else if (wifi_connect_started_ms_ != 0 && now_ms - wifi_connect_started_ms_ > WIFI_CONNECT_TIMEOUT_MS) {
        wlan_status_.wifi_state = WlanConnectionState::FAILED;
        wlan_status_.wifi_error = "connect timeout";
        wifi_connect_started_ms_ = 0;
        wifi_next_retry_ms_ = now_ms + wifi_retry_delay_ms_;
        wifi_retry_delay_ms_ = min<unsigned long>(wifi_retry_delay_ms_ * 2UL, WIFI_RETRY_MAX_MS);
      }
    } else {
      wlan_status_.wifi_state = WlanConnectionState::DISCONNECTED;
      wlan_status_.wifi_error = "";
      wifi_connect_started_ms_ = 0;
    }
  }

  if (!equalWlanStatusState(previous_status, wlan_status_)) {
    publishWlanStatusToStreams();
  }
}

void AnchorWatchRuntime::updateCloud(unsigned long now_ms) {
  const SystemStatusState previous_status = system_status_;
  cloud_.loop(now_ms, wlan_status_.wifi_connected, cloud_config_);
  system_status_.cloud_reachable = cloud_.isConnected();
  if (!equalSystemStatusState(previous_status, system_status_)) {
    if (debug_enabled_) {
      Serial.print("[cloud] reachable=");
      Serial.print(system_status_.cloud_reachable ? "true" : "false");
      if (!system_status_.cloud_reachable) {
        Serial.print(" error=");
        Serial.print(cloud_.lastError());
      }
      Serial.println();
    }
    publishSystemStatusToStreams();
  }
}

void AnchorWatchRuntime::startWifiConnect(unsigned long now_ms) {
  if (wlan_config_.ssid.isEmpty()) {
    return;
  }
  wifi_connect_started_ms_ = now_ms;
  wlan_status_.wifi_state = WlanConnectionState::CONNECTING;
  wlan_status_.wifi_error = "";
  WiFi.disconnect();
  WiFi.begin(wlan_config_.ssid.c_str(), wlan_config_.passphrase.c_str());
}

void AnchorWatchRuntime::updateAlarmAndOutputs(uint64_t now_ts) {
  alarm_engine_.evaluate(
    now_ts,
    telemetryReady(),
    position_,
    anchor_position_,
    depth_,
    wind_,
    alarm_config_,
    obstacles_,
    alarm_state_
  );
  applyOutputs(now_ts);
}

void AnchorWatchRuntime::applyOutputs(uint64_t now_ts) {
  const uint8_t level = AlarmEngine::highestOutputLevel(alarm_state_, now_ts);
  digitalWrite(STATUS_LED_PIN, level >= 1 ? HIGH : LOW);
  digitalWrite(SIREN_PIN, level >= 2 ? HIGH : LOW);
}

bool AnchorWatchRuntime::removeGetDataRequest(const ActiveRequestRef& request) {
  for (size_t index = 0; index < get_data_requests_.size(); index++) {
    const ActiveRequestRef& active = get_data_requests_[index];
    if (active.req_id == request.req_id && sessionMatches(active.session, request.session.transport, request.session.session_id)) {
      get_data_requests_.erase(get_data_requests_.begin() + index);
      return true;
    }
  }
  return false;
}

void AnchorWatchRuntime::closeOriginalRequest(const ActiveRequestRef& request, const String& code, const String& message) {
  sendError(request, code, message);
}

void AnchorWatchRuntime::closeSession(SessionTransport transport, const String& session_id, const String& reason) {
  (void)reason;
  for (size_t index = 0; index < get_data_requests_.size();) {
    if (sessionMatches(get_data_requests_[index].session, transport, session_id)) {
      get_data_requests_.erase(get_data_requests_.begin() + index);
      continue;
    }
    index++;
  }
  if (scan_active_ && sessionMatches(active_scan_request_.session, transport, session_id)) {
    scan_active_ = false;
    active_scan_request_ = {};
    scan_results_.clear();
    scan_emit_index_ = 0;
    scan_needs_ack_ = false;
  }
  for (size_t index = 0; index < session_auth_.size();) {
    if (sessionMatches(session_auth_[index].session, transport, session_id)) {
      session_auth_.erase(session_auth_.begin() + index);
      continue;
    }
    index++;
  }
  refreshAuthValue();
}

bool AnchorWatchRuntime::handleCancel(const ActiveRequestRef& request, const RequestEnvelope& envelope) {
  ErrorValue error;
  String original_req_id;
  if (!parseCancelRequest(envelope.data_raw, original_req_id, error)) {
    sendError(request, error.code, error.message);
    return true;
  }
  for (size_t index = 0; index < get_data_requests_.size(); index++) {
    const ActiveRequestRef original = get_data_requests_[index];
    if (original.req_id == original_req_id &&
        sessionMatches(original.session, request.session.transport, request.session.session_id)) {
      get_data_requests_.erase(get_data_requests_.begin() + index);
      closeOriginalRequest(original, "CANCELED", "request canceled");
      sendAck(request);
      return true;
    }
  }
  if (scan_active_ &&
      active_scan_request_.req_id == original_req_id &&
      sessionMatches(active_scan_request_.session, request.session.transport, request.session.session_id)) {
    const ActiveRequestRef original = active_scan_request_;
    scan_active_ = false;
    active_scan_request_ = {};
    scan_results_.clear();
    scan_emit_index_ = 0;
    scan_needs_ack_ = false;
    closeOriginalRequest(original, "CANCELED", "request canceled");
    sendAck(request);
    return true;
  }
  sendError(request, "NOT_FOUND", "request not active");
  return true;
}

void AnchorWatchRuntime::handleRequest(SessionTransport transport, const String& session_id, const String& json) {
  RequestEnvelope envelope;
  ErrorValue error;
  if (!parseRequestEnvelope(json, envelope, error)) {
    sendToSession(transport, session_id, buildErrorReply(envelope.req_id, error.code, error.message));
    return;
  }

  ActiveRequestRef request;
  request.session.transport = transport;
  request.session.session_id = session_id;
  request.req_id = envelope.req_id;

  if (envelope.type == "CANCEL") {
    handleCancel(request, envelope);
    return;
  }

  if (envelope.type == "AUTHORIZE_SETUP") {
    String factory_setup_pin;
    if (!parseAuthorizeSetupRequest(envelope.data_raw, factory_setup_pin, error)) {
      sendError(request, error.code, error.message);
      return;
    }
    if (transport != SessionTransport::BLE) {
      sendError(request, "AUTH_FAILED", "setup authorization is BLE-only");
      return;
    }
    if (!isSetupRequired()) {
      sendError(request, "INVALID_STATE", "boat setup already completed");
      return;
    }
    if (!isPairModeActive(millis())) {
      sendError(request, "AUTH_FAILED", "pair mode required");
      return;
    }
    if (factory_setup_pin != FACTORY_SETUP_PIN) {
      sendError(request, "AUTH_FAILED", "invalid factory_setup_pin");
      return;
    }
    SessionAuthRef& auth = ensureSessionAuth(transport, session_id);
    auth.setup_authorized = true;
    auth.session_authorized = false;
    sendAck(request);
    refreshAuthValue();
    return;
  }

  if (envelope.type == "AUTHORIZE_BLE_SESSION") {
    String ble_connection_pin;
    if (!parseAuthorizeBleSessionRequest(envelope.data_raw, ble_connection_pin, error)) {
      sendError(request, error.code, error.message);
      return;
    }
    if (transport != SessionTransport::BLE) {
      sendError(request, "AUTH_FAILED", "BLE session authorization is BLE-only");
      return;
    }
    if (isSetupRequired()) {
      sendError(request, "INVALID_STATE", "boat setup required");
      return;
    }
    if (ble_connection_pin != ble_connection_pin_) {
      sendError(request, "AUTH_FAILED", "invalid ble_connection_pin");
      return;
    }
    SessionAuthRef& auth = ensureSessionAuth(transport, session_id);
    auth.setup_authorized = false;
    auth.session_authorized = true;
    sendAck(request);
    refreshAuthValue();
    return;
  }

  if (isSetupRequired()) {
    if (envelope.type != "SET_INITIAL_BLE_PIN") {
      sendError(request, "SETUP_REQUIRED", "boat setup required");
      return;
    }
  } else {
    if (transport == SessionTransport::BLE &&
        envelope.type != "AUTHORIZE_BLE_SESSION" &&
        !isSessionAuthorized(transport, session_id)) {
      sendError(request, "AUTH_FAILED", "BLE session authorization required");
      return;
    }
  }

  if (envelope.type == "SET_INITIAL_BLE_PIN") {
    String ble_connection_pin;
    if (!parseSetInitialBlePinRequest(envelope.data_raw, ble_connection_pin, error)) {
      sendError(request, error.code, error.message);
      return;
    }
    if (transport != SessionTransport::BLE) {
      sendError(request, "AUTH_FAILED", "initial BLE pin setup is BLE-only");
      return;
    }
    if (!isSetupRequired()) {
      sendError(request, "INVALID_STATE", "boat setup already completed");
      return;
    }
    if (!isSetupAuthorized(transport, session_id)) {
      sendError(request, "AUTH_FAILED", "setup authorization required");
      return;
    }
    ble_connection_pin_ = ble_connection_pin;
    storage_.saveIdentity(ble_connection_pin_, cloud_config_);
    SessionAuthRef& auth = ensureSessionAuth(transport, session_id);
    auth.setup_authorized = false;
    auth.session_authorized = true;
    sendAck(request);
    refreshAuthValue();
    refreshSnapshotValue();
    return;
  }

  if (envelope.type == "GET_DATA") {
    removeGetDataRequest(request);
    get_data_requests_.push_back(request);
    publishBootstrap(request);
    return;
  }

  if (envelope.type == "SET_ANCHOR") {
    SetAnchorRequest parsed;
    if (!parseSetAnchorRequest(envelope.data_raw, parsed, error)) {
      sendError(request, error.code, error.message);
      return;
    }
    if (parsed.has_coordinates) {
      anchor_position_.has_position = true;
      anchor_position_.lat = parsed.lat;
      anchor_position_.lon = parsed.lon;
    } else if (position_.valid) {
      anchor_position_.has_position = true;
      anchor_position_.lat = position_.lat;
      anchor_position_.lon = position_.lon;
    } else {
      sendError(request, "INVALID_STATE", "no current position available");
      return;
    }
    anchor_position_.state = "down";
    last_anchor_down_ts_ = currentEpochMs();
    storage_.saveAnchorState(anchor_position_, last_anchor_down_ts_);
    updateAlarmAndOutputs(currentEpochMs());
    sendAck(request);
    publishAnchorPositionToStreams();
    publishAlarmStateToStreams();
    return;
  }

  if (envelope.type == "MOVE_ANCHOR") {
    MoveAnchorRequest parsed;
    if (!parseMoveAnchorRequest(envelope.data_raw, parsed, error)) {
      sendError(request, error.code, error.message);
      return;
    }
    anchor_position_.state = "down";
    anchor_position_.has_position = true;
    anchor_position_.lat = parsed.lat;
    anchor_position_.lon = parsed.lon;
    storage_.saveAnchorState(anchor_position_, last_anchor_down_ts_);
    updateAlarmAndOutputs(currentEpochMs());
    sendAck(request);
    publishAnchorPositionToStreams();
    publishAlarmStateToStreams();
    return;
  }

  if (envelope.type == "RAISE_ANCHOR") {
    anchor_position_.state = "up";
    anchor_position_.has_position = false;
    storage_.saveAnchorState(anchor_position_, last_anchor_down_ts_);
    updateAlarmAndOutputs(currentEpochMs());
    sendAck(request);
    publishAnchorPositionToStreams();
    publishAlarmStateToStreams();
    return;
  }

  if (envelope.type == "SILENCE_ALARM" || envelope.type == "UNSILENCE_ALARM") {
    SilenceAlarmRequest parsed;
    if (!parseSilenceAlarmRequest(envelope.data_raw, parsed, error)) {
      sendError(request, error.code, error.message);
      return;
    }
    const uint64_t now_ts = currentEpochMs();
    for (AlertRuntime& runtime : alarm_state_.alerts) {
      if (runtime.alert_type != parsed.alert_type) {
        continue;
      }
      if (envelope.type == "SILENCE_ALARM") {
        runtime.has_alert_silenced_until = true;
        for (const AlertConfigEntry& config : alarm_config_.alerts) {
          if (config.type == parsed.alert_type) {
            runtime.alert_silenced_until_ts = now_ts + config.default_silence_ms;
            break;
          }
        }
      } else {
        runtime.has_alert_silenced_until = false;
        runtime.alert_silenced_until_ts = 0;
      }
      break;
    }
    applyOutputs(now_ts);
    sendAck(request);
    publishAlarmStateToStreams();
    return;
  }

  if (envelope.type == "UPDATE_CONFIG_ALARM") {
    AlarmConfigValue next;
    if (!parseAlarmConfigValue(envelope.data_raw, next, error)) {
      sendError(request, error.code, error.message);
      return;
    }
    if (next.version != alarm_config_.version) {
      sendError(request, "VERSION_CONFLICT", "alarm_config version mismatch");
      return;
    }
    next.version++;
    alarm_config_ = next;
    storage_.saveAlarmConfig(alarm_config_);
    updateAlarmAndOutputs(currentEpochMs());
    sendAck(request);
    publishConfigToStreams("CONFIG_ALARM");
    publishAlarmStateToStreams();
    return;
  }

  if (envelope.type == "UPDATE_CONFIG_OBSTACLES") {
    ObstaclesConfigValue next;
    if (!parseObstaclesConfigValue(envelope.data_raw, next, error)) {
      sendError(request, error.code, error.message);
      return;
    }
    if (next.version != obstacles_.version) {
      sendError(request, "VERSION_CONFLICT", "obstacles version mismatch");
      return;
    }
    next.version++;
    obstacles_ = next;
    storage_.saveObstaclesConfig(obstacles_);
    updateAlarmAndOutputs(currentEpochMs());
    sendAck(request);
    publishConfigToStreams("CONFIG_OBSTACLES");
    publishAlarmStateToStreams();
    return;
  }

  if (envelope.type == "UPDATE_CONFIG_ANCHOR_SETTINGS") {
    RawConfigValue next;
    if (!parseRawConfigValue(envelope.data_raw, next, error)) {
      sendError(request, error.code, error.message);
      return;
    }
    if (next.version != anchor_settings_.version) {
      sendError(request, "VERSION_CONFLICT", "anchor_settings version mismatch");
      return;
    }
    next.version++;
    String updated_json;
    if (!jsonReplaceObjectFieldRaw(next.raw_json, "version", String(next.version), updated_json)) {
      sendError(request, "INVALID_REQUEST", "anchor_settings must include top-level version");
      return;
    }
    next.raw_json = jsonTrim(updated_json);
    anchor_settings_ = next;
    storage_.saveAnchorSettings(anchor_settings_);
    sendAck(request);
    publishConfigToStreams("CONFIG_ANCHOR_SETTINGS");
    return;
  }

  if (envelope.type == "UPDATE_CONFIG_PROFILES") {
    RawConfigValue next;
    if (!parseRawConfigValue(envelope.data_raw, next, error)) {
      sendError(request, error.code, error.message);
      return;
    }
    if (next.version != profiles_.version) {
      sendError(request, "VERSION_CONFLICT", "profiles version mismatch");
      return;
    }
    next.version++;
    String updated_json;
    if (!jsonReplaceObjectFieldRaw(next.raw_json, "version", String(next.version), updated_json)) {
      sendError(request, "INVALID_REQUEST", "profiles must include top-level version");
      return;
    }
    next.raw_json = jsonTrim(updated_json);
    profiles_ = next;
    storage_.saveProfiles(profiles_);
    sendAck(request);
    publishConfigToStreams("CONFIG_PROFILES");
    return;
  }

  if (envelope.type == "UPDATE_CONFIG_SYSTEM") {
    SystemConfigValue next;
    if (!parseSystemConfigValue(envelope.data_raw, next, error)) {
      sendError(request, error.code, error.message);
      return;
    }
    if (next.version != system_config_.version) {
      sendError(request, "VERSION_CONFLICT", "system_config version mismatch");
      return;
    }
    const RuntimeMode previous_mode = system_config_.runtime_mode;
    next.version++;
    system_config_ = next;
    storage_.saveSystemConfig(system_config_);
    if (previous_mode != system_config_.runtime_mode) {
      if (system_config_.runtime_mode == RuntimeMode::SIMULATION) {
        simulation_.begin(millis());
        has_real_time_ = true;
      } else {
        simulation_.stop();
        has_real_time_ = false;
        clearTelemetryForLiveMode();
        track_log_.clear();
      }
    }
    updateAlarmAndOutputs(currentEpochMs());
    sendAck(request);
    publishConfigToStreams("CONFIG_SYSTEM");
    publishRuntimeStateToStreams();
    return;
  }

  if (envelope.type == "UPDATE_CONFIG_WLAN") {
    WlanConfigValue next;
    if (!parseWlanConfigValue(envelope.data_raw, next, error)) {
      sendError(request, error.code, error.message);
      return;
    }
    if (next.version != wlan_config_.version) {
      sendError(request, "VERSION_CONFLICT", "wlan_config version mismatch");
      return;
    }
    next.version++;
    wlan_config_ = next;
    storage_.saveWlanConfig(wlan_config_);
    wifi_connect_started_ms_ = 0;
    wifi_next_retry_ms_ = millis();
    sendAck(request);
    publishConfigToStreams("CONFIG_WLAN");
    publishWlanStatusToStreams();
    return;
  }

  if (envelope.type == "UPDATE_CLOUD_CREDENTIALS") {
    uint32_t version = 0;
    String boat_id;
    String cloud_secret;
    if (!parseCloudCredentialUpdate(envelope.data_raw, version, boat_id, cloud_secret, error)) {
      sendError(request, error.code, error.message);
      return;
    }
    if (transport != SessionTransport::BLE) {
      sendError(request, "AUTH_FAILED", "cloud credential update is BLE-only");
      return;
    }
    if (isSetupRequired()) {
      sendError(request, "INVALID_STATE", "boat setup required");
      return;
    }
    if (!isSessionAuthorized(transport, session_id)) {
      sendError(request, "AUTH_FAILED", "BLE session authorization required");
      return;
    }
    if (version != cloud_config_.version) {
      sendError(request, "VERSION_CONFLICT", "cloud_config version mismatch");
      return;
    }
    cloud_config_.version++;
    cloud_config_.boat_id = boat_id;
    cloud_config_.cloud_secret = cloud_secret;
    cloud_config_.secret_configured = true;
    storage_.saveIdentity(ble_connection_pin_, cloud_config_);
    sendAck(request);
    publishConfigToStreams("CONFIG_CLOUD");
    refreshAuthValue();
    refreshSnapshotValue();
    return;
  }

  if (envelope.type == "UPDATE_BLE_PIN") {
    String old_ble_connection_pin;
    String new_ble_connection_pin;
    if (!parseUpdateBlePinRequest(envelope.data_raw, old_ble_connection_pin, new_ble_connection_pin, error)) {
      sendError(request, error.code, error.message);
      return;
    }
    if (transport != SessionTransport::BLE) {
      sendError(request, "AUTH_FAILED", "BLE pin update is BLE-only");
      return;
    }
    if (isSetupRequired()) {
      sendError(request, "INVALID_STATE", "boat setup required");
      return;
    }
    if (!isSessionAuthorized(transport, session_id)) {
      sendError(request, "AUTH_FAILED", "BLE session authorization required");
      return;
    }
    if (old_ble_connection_pin != ble_connection_pin_) {
      sendError(request, "AUTH_FAILED", "invalid old_ble_connection_pin");
      return;
    }
    ble_connection_pin_ = new_ble_connection_pin;
    storage_.saveIdentity(ble_connection_pin_, cloud_config_);
    clearBleSessionAuthorization();
    invalidateAuthorizedStreams("AUTH_REVOKED", "BLE authorization revoked");
    sendAck(request);
    refreshAuthValue();
    refreshSnapshotValue();
    return;
  }

  if (envelope.type == "SCAN_WLAN") {
    if (transport != SessionTransport::BLE) {
      sendError(request, "AUTH_FAILED", "wlan scan is BLE-only");
      return;
    }
    if (scan_active_) {
      sendError(request, "BUSY", "scan already active");
      return;
    }
    ScanWlanRequest parsed;
    if (!parseScanWlanRequest(envelope.data_raw, parsed, error)) {
      sendError(request, error.code, error.message);
      return;
    }
    String error_message;
    if (!performWifiScan(parsed.include_hidden, parsed.max_results, scan_results_, error_message)) {
      const char* code = error_message == "wifi scan already running" ? "BUSY" : "DEVICE_FAILED";
      sendError(request, code, error_message);
      return;
    }
    scan_active_ = true;
    active_scan_request_ = request;
    scan_emit_index_ = 0;
    scan_needs_ack_ = true;
    return;
  }

  sendError(request, "UNKNOWN_TYPE", "unsupported request type");
}

}  // namespace aw
