#pragma once

#include "aw_model.h"

namespace aw {

class AlarmEngine {
 public:
  void evaluate(
    uint64_t now_ts,
    bool telemetry_ready,
    const PositionState& position,
    const AnchorPositionState& anchor_position,
    const DepthState& depth,
    const WindState& wind,
    const AlarmConfigValue& alarm_config,
    const ObstaclesConfigValue& obstacles,
    AlarmStateValue& alarm_state
  ) const;

  static bool isSilenced(const AlertRuntime& runtime, uint64_t now_ts);
  static uint8_t highestOutputLevel(const AlarmStateValue& alarm_state, uint64_t now_ts);

 private:
  static float distanceMeters(float lat_a, float lon_a, float lat_b, float lon_b);
  static float distanceToObstacleMeters(const GeoPoint& position, const ObstaclePolygon& obstacle);
  static float distancePointToSegmentMeters(const GeoPoint& point, const GeoPoint& a, const GeoPoint& b);
  static bool pointInPolygon(const GeoPoint& point, const ObstaclePolygon& polygon);
  static AlertRuntime* findRuntime(AlarmStateValue& alarm_state, AlertType type);
};

}  // namespace aw
