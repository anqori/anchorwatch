#pragma once

#include "aw_alarm.h"
#include "aw_ble.h"
#include "aw_cloud.h"
#include "aw_constants.h"
#include "aw_model.h"
#include "aw_simulation.h"
#include "aw_storage.h"

namespace aw {

class AnchorWatchRuntime : public BleTransportListener, public CloudTransportListener {
 public:
  void setup();
  void loop();

  void onBleJsonMessage(const String& json) override;
  void onBleAuthAction(const String& action) override;
  void onBleConnectionChanged(bool connected) override;
  void onCloudSessionOpened(const String& cloud_conn_id) override;
  void onCloudSessionPayload(const String& cloud_conn_id, const String& payload_json) override;
  void onCloudSessionClosed(const String& cloud_conn_id, const String& reason) override;

 private:
  enum class SessionTransport {
    BLE,
    CLOUD,
  };

  struct SessionRef {
    SessionTransport transport = SessionTransport::BLE;
    String session_id;
  };

  struct ActiveRequestRef {
    SessionRef session;
    String req_id;
  };

  Storage storage_;
  BleTransport ble_;
  CloudTransport cloud_;
  SimulationEngine simulation_;
  AlarmEngine alarm_engine_;

  String device_id_;
  CloudConfigValue cloud_config_;
  AlarmConfigValue alarm_config_;
  ObstaclesConfigValue obstacles_;
  RawConfigValue anchor_settings_;
  RawConfigValue profiles_;
  SystemConfigValue system_config_;
  WlanConfigValue wlan_config_;

  PositionState position_;
  DepthState depth_;
  WindState wind_;
  AnchorPositionState anchor_position_;
  WlanStatusState wlan_status_;
  SystemStatusState system_status_;
  AlarmStateValue alarm_state_;

  TrackPoint track_history_[TRACK_HISTORY_CAPACITY];
  size_t track_history_count_ = 0;
  size_t track_history_next_ = 0;

  std::vector<ActiveRequestRef> get_data_requests_;
  bool scan_active_ = false;
  ActiveRequestRef active_scan_request_;
  std::vector<WlanNetworkValue> scan_results_;
  size_t scan_emit_index_ = 0;
  bool scan_needs_ack_ = false;

  unsigned long last_telemetry_tick_ms_ = 0;
  unsigned long last_history_sample_ms_ = 0;
  unsigned long pair_mode_until_ms_ = 0;
  unsigned long privileged_until_ms_ = 0;
  unsigned long wifi_connect_started_ms_ = 0;
  unsigned long wifi_next_retry_ms_ = 0;
  unsigned long wifi_retry_delay_ms_ = WIFI_RETRY_MIN_MS;
  bool debug_enabled_ = false;
  bool last_pair_mode_active_ = false;

  uint64_t last_anchor_down_ts_ = 0;
  bool has_real_time_ = false;

  void setupPins();
  void setupWifi();
  void loadState();
  void refreshAuthValue();
  void refreshSnapshotValue();
  void processSerial();
  void handleSerialCommand(const String& line);
  void handleRequest(SessionTransport transport, const String& session_id, const String& json);
  void updateLoopState(unsigned long now_ms);
  void updateTelemetry(unsigned long now_ms);
  void clearTelemetryForLiveMode();
  void recordTrackPoint(uint64_t now_ts);
  void updateWlan(unsigned long now_ms);
  void startWifiConnect(unsigned long now_ms);
  void updateAlarmAndOutputs(uint64_t now_ts);
  void applyOutputs(uint64_t now_ts);
  void updateCloud(unsigned long now_ms);
  void publishBootstrap(const ActiveRequestRef& request);
  void publishRuntimeStateToStreams();
  void publishConfigToStreams(const char* config_type);
  void publishPositionToStreams();
  void publishDepthToStreams();
  void publishWindToStreams();
  void publishWlanStatusToStreams();
  void publishSystemStatusToStreams();
  void publishAlarmStateToStreams();
  void publishAnchorPositionToStreams();
  void publishTrackBackfill(const ActiveRequestRef& request);
  void appendTrackPoint(const TrackPoint& point);
  bool telemetryReady() const;
  uint64_t currentEpochMs() const;
  uint64_t pairModeUntilTs() const;
  uint64_t privilegedUntilTs() const;
  bool isPairModeActive(unsigned long now_ms) const;
  bool isPrivileged(unsigned long now_ms) const;
  void setPairMode(unsigned long now_ms, unsigned long ttl_ms);
  void clearPairMode();
  void confirmPrivileged(unsigned long now_ms);
  bool requiresPrivilege(SessionTransport transport, const String& type) const;
  bool handleCancel(const ActiveRequestRef& request, const RequestEnvelope& envelope);
  bool removeGetDataRequest(const ActiveRequestRef& request);
  void closeOriginalRequestAsCanceled(const ActiveRequestRef& request);
  void closeSession(SessionTransport transport, const String& session_id, const String& reason);
  bool sessionMatches(const SessionRef& session, SessionTransport transport, const String& session_id) const;
  void sendToSession(SessionTransport transport, const String& session_id, const String& json);
  void send(const ActiveRequestRef& request, const String& json);
  void sendError(const ActiveRequestRef& request, const String& code, const String& message);
  void sendAck(const ActiveRequestRef& request);
};

}  // namespace aw
