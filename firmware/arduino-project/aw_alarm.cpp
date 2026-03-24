#include "aw_alarm.h"

#include <math.h>

#include "aw_constants.h"
#include "aw_protocol.h"

namespace aw {

namespace {

float degToRad(float deg) {
  return deg * static_cast<float>(M_PI) / 180.0f;
}

float metersPerDegLon(float lat) {
  return SIM_METERS_PER_DEG_LAT * cosf(degToRad(lat));
}

const AlertConfigEntry* findConfig(const AlarmConfigValue& alarm_config, AlertType type) {
  for (const AlertConfigEntry& entry : alarm_config.alerts) {
    if (entry.type == type) {
      return &entry;
    }
  }
  return nullptr;
}

bool hasFreshTelemetry(uint64_t now_ts, uint64_t sample_ts, uint32_t max_age_ms) {
  return sample_ts > 0 && now_ts >= sample_ts && now_ts - sample_ts <= max_age_ms;
}

}  // namespace

AlertRuntime* AlarmEngine::findRuntime(AlarmStateValue& alarm_state, AlertType type) {
  for (AlertRuntime& runtime : alarm_state.alerts) {
    if (runtime.alert_type == type) {
      return &runtime;
    }
  }
  return nullptr;
}

bool AlarmEngine::isSilenced(const AlertRuntime& runtime, uint64_t now_ts) {
  return runtime.has_alert_silenced_until && now_ts < runtime.alert_silenced_until_ts;
}

uint8_t AlarmEngine::highestOutputLevel(const AlarmStateValue& alarm_state, uint64_t now_ts) {
  uint8_t level = 0;
  for (const AlertRuntime& runtime : alarm_state.alerts) {
    if (runtime.state != AlertState::ALERT || isSilenced(runtime, now_ts)) {
      continue;
    }
    if (runtime.severity == AlertSeverity::ALARM) {
      return 2;
    }
    level = 1;
  }
  return level;
}

float AlarmEngine::distanceMeters(float lat_a, float lon_a, float lat_b, float lon_b) {
  const float mean_lat = (lat_a + lat_b) * 0.5f;
  const float dx = (lon_b - lon_a) * metersPerDegLon(mean_lat);
  const float dy = (lat_b - lat_a) * SIM_METERS_PER_DEG_LAT;
  return sqrtf(dx * dx + dy * dy);
}

float AlarmEngine::distancePointToSegmentMeters(const GeoPoint& point, const GeoPoint& a, const GeoPoint& b) {
  const float mean_lat = point.lat;
  const float ax = a.lon * metersPerDegLon(mean_lat);
  const float ay = a.lat * SIM_METERS_PER_DEG_LAT;
  const float bx = b.lon * metersPerDegLon(mean_lat);
  const float by = b.lat * SIM_METERS_PER_DEG_LAT;
  const float px = point.lon * metersPerDegLon(mean_lat);
  const float py = point.lat * SIM_METERS_PER_DEG_LAT;
  const float vx = bx - ax;
  const float vy = by - ay;
  const float wx = px - ax;
  const float wy = py - ay;
  const float len_sq = vx * vx + vy * vy;
  float t = 0.0f;
  if (len_sq > 0.0f) {
    t = (wx * vx + wy * vy) / len_sq;
  }
  if (t < 0.0f) {
    t = 0.0f;
  } else if (t > 1.0f) {
    t = 1.0f;
  }
  const float dx = ax + t * vx - px;
  const float dy = ay + t * vy - py;
  return sqrtf(dx * dx + dy * dy);
}

bool AlarmEngine::pointInPolygon(const GeoPoint& point, const ObstaclePolygon& polygon) {
  bool inside = false;
  const size_t count = polygon.polygon.size();
  if (count < 3) {
    return false;
  }
  for (size_t i = 0, j = count - 1; i < count; j = i++) {
    const GeoPoint& pi = polygon.polygon[i];
    const GeoPoint& pj = polygon.polygon[j];
    const bool intersects =
      ((pi.lon > point.lon) != (pj.lon > point.lon)) &&
      (point.lat < (pj.lat - pi.lat) * (point.lon - pi.lon) / ((pj.lon - pi.lon) + 1e-6f) + pi.lat);
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

float AlarmEngine::distanceToObstacleMeters(const GeoPoint& position, const ObstaclePolygon& obstacle) {
  if (obstacle.polygon.size() < 3) {
    return 1.0e9f;
  }
  if (pointInPolygon(position, obstacle)) {
    return 0.0f;
  }
  float min_distance = 1.0e9f;
  for (size_t index = 0; index < obstacle.polygon.size(); index++) {
    const GeoPoint& a = obstacle.polygon[index];
    const GeoPoint& b = obstacle.polygon[(index + 1U) % obstacle.polygon.size()];
    const float distance = distancePointToSegmentMeters(position, a, b);
    if (distance < min_distance) {
      min_distance = distance;
    }
  }
  return min_distance;
}

void AlarmEngine::evaluate(
  uint64_t now_ts,
  bool telemetry_ready,
  const PositionState& position,
  const AnchorPositionState& anchor_position,
  const DepthState& depth,
  const WindState& wind,
  const AlarmConfigValue& alarm_config,
  const ObstaclesConfigValue& obstacles,
  AlarmStateValue& alarm_state
) const {
  std::vector<AlertRuntime> next_runtimes;
  next_runtimes.reserve(alarm_config.alerts.size());

  for (const AlertConfigEntry& config : alarm_config.alerts) {
    AlertRuntime* previous = findRuntime(alarm_state, config.type);
    AlertRuntime runtime;
    runtime.alert_type = config.type;
    runtime.severity = config.severity;
    if (previous != nullptr) {
      runtime = *previous;
      runtime.severity = config.severity;
    }

    if (!config.enabled) {
      runtime.state = AlertState::DISABLED_STATE;
      runtime.has_above_threshold_since = false;
      runtime.has_alert_since = false;
      next_runtimes.push_back(runtime);
      continue;
    }

    if (!telemetry_ready) {
      runtime.state = AlertState::WATCHING;
      runtime.has_above_threshold_since = false;
      runtime.has_alert_since = false;
      next_runtimes.push_back(runtime);
      continue;
    }

    bool triggered = false;
    switch (config.type) {
      case AlertType::ANCHOR_DISTANCE:
        if (position.valid && anchor_position.has_position && anchor_position.state == "down") {
          triggered = distanceMeters(position.lat, position.lon, anchor_position.lat, anchor_position.lon) > config.max_distance_m;
        }
        break;
      case AlertType::OBSTACLE_CLOSE:
        if (position.valid) {
          GeoPoint point{position.lat, position.lon};
          for (const ObstaclePolygon& obstacle : obstacles.obstacles) {
            if (distanceToObstacleMeters(point, obstacle) <= config.min_distance_m) {
              triggered = true;
              break;
            }
          }
        }
        break;
      case AlertType::WIND_ABOVE:
        triggered = wind.available && wind.wind_kn > config.max_wind_kn;
        break;
      case AlertType::DEPTH_BELOW:
        triggered = depth.available && depth.depth_m < config.min_depth_m;
        break;
      case AlertType::DATA_OUTDATED:
        triggered =
          !position.valid ||
          !hasFreshTelemetry(now_ts, position.last_update_ts, config.max_age_ms) ||
          !hasFreshTelemetry(now_ts, depth.ts, config.max_age_ms) ||
          !hasFreshTelemetry(now_ts, wind.ts, config.max_age_ms);
        break;
    }

    if (!triggered) {
      runtime.state = AlertState::WATCHING;
      runtime.has_above_threshold_since = false;
      runtime.has_alert_since = false;
      next_runtimes.push_back(runtime);
      continue;
    }

    if (!runtime.has_above_threshold_since) {
      runtime.has_above_threshold_since = true;
      runtime.above_threshold_since_ts = now_ts;
    }

    if (now_ts >= runtime.above_threshold_since_ts && now_ts - runtime.above_threshold_since_ts >= config.min_time_ms) {
      runtime.state = AlertState::ALERT;
      if (!runtime.has_alert_since) {
        runtime.has_alert_since = true;
        runtime.alert_since_ts = now_ts;
      }
    } else {
      runtime.state = AlertState::WATCHING;
      runtime.has_alert_since = false;
    }

    next_runtimes.push_back(runtime);
  }

  alarm_state.alerts = next_runtimes;
}

}  // namespace aw
