#pragma once

#include "aw_model.h"

namespace aw {

class Storage {
 public:
  bool begin();
  void end();

  void loadIdentity(String& device_id, String& ble_connection_pin, CloudConfigValue& cloud_config);
  void saveIdentity(const String& ble_connection_pin, const CloudConfigValue& cloud_config);

  void loadAlarmConfig(AlarmConfigValue& value);
  void saveAlarmConfig(const AlarmConfigValue& value);

  void loadObstaclesConfig(ObstaclesConfigValue& value);
  void saveObstaclesConfig(const ObstaclesConfigValue& value);

  void loadAnchorSettings(RawConfigValue& value);
  void saveAnchorSettings(const RawConfigValue& value);

  void loadProfiles(RawConfigValue& value);
  void saveProfiles(const RawConfigValue& value);

  void loadSystemConfig(SystemConfigValue& value);
  void saveSystemConfig(const SystemConfigValue& value);

  void loadWlanConfig(WlanConfigValue& value);
  void saveWlanConfig(const WlanConfigValue& value);

  void loadAnchorState(AnchorPositionState& anchor_position, uint64_t& last_anchor_down_ts);
  void saveAnchorState(const AnchorPositionState& anchor_position, uint64_t last_anchor_down_ts);

 private:
  bool started_ = false;
};

String makeDefaultDeviceId();
String makeDefaultBoatId();

}  // namespace aw
