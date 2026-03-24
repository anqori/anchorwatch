#include "aw_runtime.h"

#include <WiFi.h>

#include "aw_constants.h"
#include "aw_json.h"
#include "aw_protocol.h"

namespace aw {

namespace {

static const char* BLE_SESSION_ID = "ble";

}  // namespace

void AnchorWatchRuntime::setup() {
  Serial.begin(115200);
  setupPins();
  setupWifi();
  storage_.begin();
  loadState();
  system_status_.server_version = FW_VERSION;
  system_status_.cloud_reachable = false;
  pair_mode_until_ms_ = millis() + PAIR_MODE_TTL_MS;
  privileged_until_ms_ = 0;
  last_pair_mode_active_ = isPairModeActive(millis());
  const String device_name = String(BLE_DEVICE_NAME_PREFIX) + device_id_.substring(max(0, static_cast<int>(device_id_.length()) - 6));
  ble_.begin(device_name, this);
  cloud_.begin(this);
  if (system_config_.runtime_mode == RuntimeMode::SIMULATION) {
    simulation_.begin(millis());
    has_real_time_ = true;
  }
  refreshAuthValue();
  refreshSnapshotValue();
  Serial.println("AnchorWatch firmware v2 runtime started");
  Serial.println("Commands: help, pair on, pair off, pair status, pair confirm, wifi status, debug on, debug off");
}

void AnchorWatchRuntime::loop() {
  const unsigned long now_ms = millis();
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
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true, true);
  WiFi.setSleep(false);
  WiFi.setHostname("anchorwatch");
  wlan_status_.wifi_state = WlanConnectionState::DISCONNECTED;
  wlan_status_.wifi_connected = false;
}

void AnchorWatchRuntime::loadState() {
  storage_.loadIdentity(device_id_, cloud_config_);
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
  const unsigned long now_ms = millis();
  ble_.setAuthValue(buildAuthStatusJson(
    isPairModeActive(now_ms),
    pairModeUntilTs(),
    isPrivileged(now_ms),
    privilegedUntilTs(),
    cloud_config_.boat_id
  ));
}

void AnchorWatchRuntime::refreshSnapshotValue() {
  ble_.setSnapshotValue(buildSnapshotJson(
    position_,
    depth_,
    wind_,
    anchor_position_,
    wlan_status_,
    system_status_,
    alarm_state_,
    system_config_,
    cloud_config_
  ));
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
    Serial.println("Commands: help, pair on, pair off, pair status, pair confirm, wifi status, debug on, debug off");
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
    Serial.print(static_cast<unsigned long long>(pairModeUntilTs()));
    Serial.print(" privileged=");
    Serial.print(isPrivileged(now_ms) ? "true" : "false");
    Serial.print(" privileged_until_ts=");
    Serial.println(static_cast<unsigned long long>(privilegedUntilTs()));
    return;
  }
  if (line == "pair confirm") {
    confirmPrivileged(now_ms);
    Serial.println(isPrivileged(now_ms) ? "[pair] privileged session active" : "[pair] pair mode inactive");
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

void AnchorWatchRuntime::onBleJsonMessage(const String& json) {
  handleRequest(SessionTransport::BLE, BLE_SESSION_ID, json);
}

void AnchorWatchRuntime::onBleAuthAction(const String& action) {
  if (action == "pair.confirm" || action == "PAIR_CONFIRM") {
    confirmPrivileged(millis());
    refreshAuthValue();
    return;
  }
  if (action == "pair.clear" || action == "PAIR_CLEAR") {
    privileged_until_ms_ = 0;
    refreshAuthValue();
  }
}

void AnchorWatchRuntime::onBleConnectionChanged(bool connected) {
  if (!connected) {
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
  if (last_pair_mode_active_ && !isPairModeActive(now_ms)) {
    privileged_until_ms_ = 0;
  }
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
}

void AnchorWatchRuntime::updateTelemetry(unsigned long now_ms) {
  if (now_ms - last_telemetry_tick_ms_ < TELEMETRY_TICK_MS) {
    return;
  }
  last_telemetry_tick_ms_ = now_ms;

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
    publishRuntimeStateToStreams();
    return;
  }

  if (!has_real_time_) {
    clearTelemetryForLiveMode();
    updateAlarmAndOutputs(0);
    publishRuntimeStateToStreams();
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
  track_history_[track_history_next_] = point;
  track_history_next_ = (track_history_next_ + 1U) % TRACK_HISTORY_CAPACITY;
  if (track_history_count_ < TRACK_HISTORY_CAPACITY) {
    track_history_count_++;
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

uint64_t AnchorWatchRuntime::privilegedUntilTs() const {
  return static_cast<uint64_t>(privileged_until_ms_);
}

bool AnchorWatchRuntime::isPairModeActive(unsigned long now_ms) const {
  return now_ms < pair_mode_until_ms_;
}

bool AnchorWatchRuntime::isPrivileged(unsigned long now_ms) const {
  return isPairModeActive(now_ms) && now_ms < privileged_until_ms_;
}

void AnchorWatchRuntime::setPairMode(unsigned long now_ms, unsigned long ttl_ms) {
  pair_mode_until_ms_ = now_ms + ttl_ms;
}

void AnchorWatchRuntime::clearPairMode() {
  pair_mode_until_ms_ = 0;
  privileged_until_ms_ = 0;
}

void AnchorWatchRuntime::confirmPrivileged(unsigned long now_ms) {
  if (!isPairModeActive(now_ms)) {
    privileged_until_ms_ = 0;
    return;
  }
  privileged_until_ms_ = now_ms + PRIV_SESSION_TTL_MS;
}

bool AnchorWatchRuntime::requiresPrivilege(SessionTransport transport, const String& type) const {
  if (transport != SessionTransport::BLE) {
    return false;
  }
  return type != "GET_DATA" && type != "CANCEL";
}

bool AnchorWatchRuntime::sessionMatches(const SessionRef& session, SessionTransport transport, const String& session_id) const {
  return session.transport == transport && session.session_id == session_id;
}

void AnchorWatchRuntime::sendToSession(SessionTransport transport, const String& session_id, const String& json) {
  if (transport == SessionTransport::BLE) {
    ble_.sendJson(json);
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
  send(request, buildPositionReply(request.req_id, "ONGOING", position_));
  send(request, buildDepthReply(request.req_id, "ONGOING", depth_));
  send(request, buildWindReply(request.req_id, "ONGOING", wind_));
  send(request, buildWlanStatusReply(request.req_id, "ONGOING", wlan_status_));
  send(request, buildSystemStatusReply(request.req_id, "ONGOING", system_status_));
  send(request, buildAnchorPositionReply(request.req_id, "ONGOING", anchor_position_));
  send(request, buildAlarmStateReply(request.req_id, "ONGOING", alarm_state_));
  send(request, buildAlarmConfigReply(request.req_id, "ONGOING", alarm_config_));
  send(request, buildObstaclesConfigReply(request.req_id, "ONGOING", obstacles_));
  send(request, buildRawConfigReply(request.req_id, "ONGOING", "CONFIG_ANCHOR_SETTINGS", anchor_settings_));
  send(request, buildRawConfigReply(request.req_id, "ONGOING", "CONFIG_PROFILES", profiles_));
  send(request, buildSystemConfigReply(request.req_id, "ONGOING", system_config_));
  send(request, buildWlanConfigReply(request.req_id, "ONGOING", wlan_config_));
  send(request, buildCloudConfigReply(request.req_id, "ONGOING", cloud_config_));
  publishTrackBackfill(request);
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
      send(request, buildCloudConfigReply(request.req_id, "ONGOING", cloud_config_));
    }
  }
}

void AnchorWatchRuntime::publishTrackBackfill(const ActiveRequestRef& request) {
  const uint64_t now_ts = currentEpochMs();
  if (track_history_count_ == 0 || now_ts == 0) {
    return;
  }
  const uint64_t since_ts = last_anchor_down_ts_ > 0 && last_anchor_down_ts_ < now_ts - 1800000ULL
    ? last_anchor_down_ts_
    : (now_ts > 1800000ULL ? now_ts - 1800000ULL : 0ULL);
  std::vector<TrackPoint> batch;
  batch.reserve(TRACK_BACKFILL_REPLY_POINTS);
  const size_t oldest_index = track_history_count_ == TRACK_HISTORY_CAPACITY ? track_history_next_ : 0U;
  for (size_t offset = 0; offset < track_history_count_; offset++) {
    const size_t index = (oldest_index + offset) % TRACK_HISTORY_CAPACITY;
    const TrackPoint& point = track_history_[index];
    if (static_cast<uint64_t>(point.ts_sec) * 1000ULL < since_ts) {
      continue;
    }
    batch.push_back(point);
    if (batch.size() >= TRACK_BACKFILL_REPLY_POINTS) {
      send(request, buildTrackBackfillReply(request.req_id, "ONGOING", batch));
      batch.clear();
    }
  }
  if (!batch.empty()) {
    send(request, buildTrackBackfillReply(request.req_id, "ONGOING", batch));
  }
}

void AnchorWatchRuntime::updateWlan(unsigned long now_ms) {
  wl_status_t status = WiFi.status();
  WlanConnectionState previous_state = wlan_status_.wifi_state;
  String previous_error = wlan_status_.wifi_error;

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

  if (previous_state != wlan_status_.wifi_state || previous_error != wlan_status_.wifi_error) {
    publishWlanStatusToStreams();
  }
}

void AnchorWatchRuntime::updateCloud(unsigned long now_ms) {
  const bool previous_reachable = system_status_.cloud_reachable;
  cloud_.loop(now_ms, wlan_status_.wifi_connected, cloud_config_);
  system_status_.cloud_reachable = cloud_.isConnected();
  if (previous_reachable != system_status_.cloud_reachable) {
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

void AnchorWatchRuntime::closeOriginalRequestAsCanceled(const ActiveRequestRef& request) {
  sendError(request, "CANCELED", "request canceled");
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
      closeOriginalRequestAsCanceled(original);
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
    closeOriginalRequestAsCanceled(original);
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

  if (requiresPrivilege(transport, envelope.type) && !isPrivileged(millis())) {
    sendError(request, "AUTH_FAILED", "pair mode and privileged session required");
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
        track_history_count_ = 0;
        track_history_next_ = 0;
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
    String boat_secret;
    if (!parseCloudCredentialUpdate(envelope.data_raw, version, boat_id, boat_secret, error)) {
      sendError(request, error.code, error.message);
      return;
    }
    if (version != cloud_config_.version) {
      sendError(request, "VERSION_CONFLICT", "cloud_config version mismatch");
      return;
    }
    cloud_config_.version++;
    cloud_config_.boat_id = boat_id;
    cloud_config_.boat_secret = boat_secret;
    cloud_config_.secret_configured = true;
    storage_.saveCloudConfig(cloud_config_);
    sendAck(request);
    publishConfigToStreams("CONFIG_CLOUD");
    refreshAuthValue();
    return;
  }

  if (envelope.type == "SCAN_WLAN") {
    if (scan_active_) {
      sendError(request, "BUSY", "scan already active");
      return;
    }
    ScanWlanRequest parsed;
    if (!parseScanWlanRequest(envelope.data_raw, parsed, error)) {
      sendError(request, error.code, error.message);
      return;
    }
    scan_results_.clear();
    const int found = WiFi.scanNetworks(false, parsed.include_hidden);
    if (found < 0) {
      sendError(request, "DEVICE_FAILED", "wifi scan failed");
      WiFi.scanDelete();
      return;
    }
    const int max_results = min(found, parsed.max_results);
    for (int index = 0; index < max_results; index++) {
      WlanNetworkValue network;
      network.ssid = WiFi.SSID(index);
      network.security = "wpa2";
      network.has_rssi = true;
      network.rssi = WiFi.RSSI(index);
      network.has_channel = true;
      network.channel = WiFi.channel(index);
      network.hidden = network.ssid.isEmpty();
      if (!parsed.include_hidden && network.hidden) {
        continue;
      }
      scan_results_.push_back(network);
    }
    WiFi.scanDelete();
    scan_active_ = true;
    active_scan_request_ = request;
    scan_emit_index_ = 0;
    scan_needs_ack_ = true;
    return;
  }

  sendError(request, "UNKNOWN_TYPE", "unsupported request type");
}

}  // namespace aw
