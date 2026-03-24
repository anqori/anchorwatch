#pragma once

#include "aw_model.h"

namespace aw {

bool parseRequestEnvelope(const String& raw, RequestEnvelope& envelope, ErrorValue& error);
bool parseCancelRequest(const String& raw, String& original_req_id, ErrorValue& error);
bool parseSetAnchorRequest(const String& raw, SetAnchorRequest& request, ErrorValue& error);
bool parseMoveAnchorRequest(const String& raw, MoveAnchorRequest& request, ErrorValue& error);
bool parseSilenceAlarmRequest(const String& raw, SilenceAlarmRequest& request, ErrorValue& error);
bool parseScanWlanRequest(const String& raw, ScanWlanRequest& request, ErrorValue& error);
bool parseAlarmConfigValue(const String& raw, AlarmConfigValue& value, ErrorValue& error);
bool parseObstaclesConfigValue(const String& raw, ObstaclesConfigValue& value, ErrorValue& error);
bool parseRawConfigValue(const String& raw, RawConfigValue& value, ErrorValue& error);
bool parseSystemConfigValue(const String& raw, SystemConfigValue& value, ErrorValue& error);
bool parseWlanConfigValue(const String& raw, WlanConfigValue& value, ErrorValue& error);
bool parseCloudCredentialUpdate(const String& raw, uint32_t& version, String& boat_id, String& boat_secret, ErrorValue& error);

const char* toProtocolString(RuntimeMode value);
const char* toProtocolString(WlanConnectionState value);
const char* toProtocolString(AlertType value);
const char* toProtocolString(AlertSeverity value);
const char* toProtocolString(AlertState value);
const char* toProtocolString(ObstacleType value);

bool parseRuntimeMode(const String& raw, RuntimeMode& value);
bool parseAlertType(const String& raw, AlertType& value);
bool parseAlertSeverity(const String& raw, AlertSeverity& value);
bool parseObstacleType(const String& raw, ObstacleType& value);

AlarmConfigValue makeDefaultAlarmConfig();
ObstaclesConfigValue makeDefaultObstaclesConfig();
RawConfigValue makeDefaultAnchorSettingsConfig();
RawConfigValue makeDefaultProfilesConfig();
SystemConfigValue makeDefaultSystemConfig();
WlanConfigValue makeDefaultWlanConfig();

String buildAckReply(const String& req_id);
String buildErrorReply(const String& req_id, const String& code, const String& message);
String buildPositionReply(const String& req_id, const char* state, const PositionState& value);
String buildDepthReply(const String& req_id, const char* state, const DepthState& value);
String buildWindReply(const String& req_id, const char* state, const WindState& value);
String buildWlanStatusReply(const String& req_id, const char* state, const WlanStatusState& value);
String buildSystemStatusReply(const String& req_id, const char* state, const SystemStatusState& value);
String buildAlarmStateReply(const String& req_id, const char* state, const AlarmStateValue& value);
String buildAnchorPositionReply(const String& req_id, const char* state, const AnchorPositionState& value);
String buildAlarmConfigReply(const String& req_id, const char* state, const AlarmConfigValue& value);
String buildObstaclesConfigReply(const String& req_id, const char* state, const ObstaclesConfigValue& value);
String buildRawConfigReply(const String& req_id, const char* state, const char* type, const RawConfigValue& value);
String buildSystemConfigReply(const String& req_id, const char* state, const SystemConfigValue& value);
String buildWlanConfigReply(const String& req_id, const char* state, const WlanConfigValue& value);
String buildCloudConfigReply(const String& req_id, const char* state, const CloudConfigValue& value);
String buildTrackBackfillReply(const String& req_id, const char* state, const std::vector<TrackPoint>& points);
String buildWlanNetworkReply(const String& req_id, const char* state, const WlanNetworkValue& value);
String buildAuthStatusJson(bool pair_mode_active, uint64_t pair_mode_until_ts, bool privileged_active, uint64_t privileged_until_ts, const String& boat_id);
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
);

String serializeAlarmConfigData(const AlarmConfigValue& value);
String serializeObstaclesConfigData(const ObstaclesConfigValue& value);
String serializeRawConfigData(const RawConfigValue& value);
String serializeSystemConfigData(const SystemConfigValue& value);
String serializeWlanConfigData(const WlanConfigValue& value);

}  // namespace aw
