#pragma once

#include "aw_alarm.h"
#include "aw_ble.h"
#include "aw_cloud.h"
#include "aw_constants.h"
#include "aw_model.h"
#include "aw_simulation.h"
#include "aw_storage.h"
#include "aw_track_log.h"

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

  struct SessionAuthRef {
    SessionRef session;
    bool setup_authorized = false;
    bool session_authorized = false;
  };

  struct HeapCheckpoint {
    String label;
    uint32_t free_heap = 0;
    uint32_t min_free_heap = 0;
    uint32_t free_8bit = 0;
    uint32_t largest_8bit = 0;
    uint32_t free_internal = 0;
    uint32_t largest_internal = 0;
  };

  Storage storage_;
  TrackLog track_log_;
  BleTransport ble_;
  CloudTransport cloud_;
  SimulationEngine simulation_;
  AlarmEngine alarm_engine_;

  String device_id_;
  String ble_connection_pin_;
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

  std::vector<ActiveRequestRef> get_data_requests_;
  std::vector<SessionAuthRef> session_auth_;
  std::vector<HeapCheckpoint> boot_heap_checkpoints_;
  std::vector<String> ble_outbox_;
  bool scan_active_ = false;
  ActiveRequestRef active_scan_request_;
  std::vector<WlanNetworkValue> scan_results_;
  size_t scan_emit_index_ = 0;
  bool scan_needs_ack_ = false;

  unsigned long last_telemetry_tick_ms_ = 0;
  unsigned long last_history_sample_ms_ = 0;
  unsigned long last_ble_send_ms_ = 0;
  unsigned long pair_mode_until_ms_ = 0;
  unsigned long wifi_connect_started_ms_ = 0;
  unsigned long wifi_next_retry_ms_ = 0;
  unsigned long wifi_retry_delay_ms_ = WIFI_RETRY_MIN_MS;
  unsigned long deferred_boot_heap_report_due_ms_ = 0;
  bool debug_enabled_ = false;
  bool deferred_boot_heap_report_pending_ = false;
  bool last_pair_mode_active_ = false;

  uint64_t last_anchor_down_ts_ = 0;
  bool has_real_time_ = false;

  void setupPins();
  void setupWifi();
  void loadState();
  void recordHeapCheckpoint(const char* label, bool store_for_boot_report = false);
  void printBootHeapCheckpoints();
  void refreshAuthValue();
  void refreshSnapshotValue();
  void processSerial();
  void handleSerialCommand(const String& line);
  void handleRequest(SessionTransport transport, const String& session_id, const String& json);
  void updateLoopState(unsigned long now_ms);
  void flushBleOutbox(unsigned long now_ms);
  void updateTelemetry(unsigned long now_ms);
  void clearTelemetryForLiveMode();
  void recordTrackPoint(uint64_t now_ts);
  void updateWlan(unsigned long now_ms);
  void startWifiConnect(unsigned long now_ms);
  bool performWifiScan(bool include_hidden, int max_results, std::vector<WlanNetworkValue>& results, String& error_message);
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
  bool isPairModeActive(unsigned long now_ms) const;
  void setPairMode(unsigned long now_ms, unsigned long ttl_ms);
  void clearPairMode();
  bool isSetupRequired() const;
  bool isLocalReady() const;
  bool isCloudReady() const;
  const char* boatAccessStateString() const;
  SessionAuthRef* findSessionAuth(SessionTransport transport, const String& session_id);
  const SessionAuthRef* findSessionAuth(SessionTransport transport, const String& session_id) const;
  SessionAuthRef& ensureSessionAuth(SessionTransport transport, const String& session_id);
  bool isSetupAuthorized(SessionTransport transport, const String& session_id) const;
  bool isSessionAuthorized(SessionTransport transport, const String& session_id) const;
  void clearAllSessionAuthorization();
  void clearBleSessionAuthorization();
  void invalidateAuthorizedStreams(const String& code, const String& message);
  bool handleCancel(const ActiveRequestRef& request, const RequestEnvelope& envelope);
  bool removeGetDataRequest(const ActiveRequestRef& request);
  void closeOriginalRequest(const ActiveRequestRef& request, const String& code, const String& message);
  void closeSession(SessionTransport transport, const String& session_id, const String& reason);
  bool sessionMatches(const SessionRef& session, SessionTransport transport, const String& session_id) const;
  void sendToSession(SessionTransport transport, const String& session_id, const String& json);
  void send(const ActiveRequestRef& request, const String& json);
  void sendError(const ActiveRequestRef& request, const String& code, const String& message);
  void sendAck(const ActiveRequestRef& request);
};

}  // namespace aw
