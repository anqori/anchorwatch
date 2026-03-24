#include "aw_simulation.h"

#include <math.h>

#include "aw_constants.h"

namespace aw {

namespace {

float knotsToMps(float knots) {
  return knots / SIM_KNOTS_PER_MPS;
}

float metersPerDegLon(float lat) {
  return SIM_METERS_PER_DEG_LAT * cosf(lat * static_cast<float>(M_PI) / 180.0f);
}

}  // namespace

float SimulationEngine::randomUnit() {
  return static_cast<float>(esp_random()) / 4294967295.0f;
}

float SimulationEngine::randomRange(float min_value, float max_value) {
  return min_value + (max_value - min_value) * randomUnit();
}

float SimulationEngine::normalizeDeg(float value) {
  while (value < 0.0f) {
    value += 360.0f;
  }
  while (value >= 360.0f) {
    value -= 360.0f;
  }
  return value;
}

void SimulationEngine::begin(unsigned long now_ms) {
  last_mono_ms_ = now_ms;
  current_ts_ms_ = SIM_START_TS_MS;
  offset_east_m_ = 0.0f;
  offset_north_m_ = 0.0f;
  cog_deg_ = randomRange(0.0f, 360.0f);
  sog_kn_ = randomRange(0.4f, 0.9f);
  wind_kn_ = 12.0f;
  wind_dir_deg_ = 220.0f;
  active_ = true;
}

void SimulationEngine::stop() {
  active_ = false;
  last_mono_ms_ = 0;
  current_ts_ms_ = 0;
}

bool SimulationEngine::active() const {
  return active_;
}

uint64_t SimulationEngine::currentTsMs() const {
  return current_ts_ms_;
}

void SimulationEngine::step(unsigned long now_ms, PositionState& position, DepthState& depth, WindState& wind) {
  if (!active_) {
    return;
  }

  if (last_mono_ms_ == 0) {
    last_mono_ms_ = now_ms;
  }

  const unsigned long elapsed_ms = now_ms - last_mono_ms_;
  const unsigned long step_ms = elapsed_ms > 0 ? TELEMETRY_TICK_MS : 0UL;
  const float dt = step_ms > 0 ? static_cast<float>(step_ms) / 1000.0f : 0.0f;
  last_mono_ms_ = now_ms;
  current_ts_ms_ += step_ms;

  if (step_ms == 0) {
    return;
  }

  cog_deg_ = normalizeDeg(cog_deg_ + randomRange(-18.0f, 18.0f) * dt);
  sog_kn_ += randomRange(-0.12f, 0.12f) * dt;
  if (sog_kn_ < SIM_MIN_SOG_KN) {
    sog_kn_ = SIM_MIN_SOG_KN;
  } else if (sog_kn_ > SIM_MAX_SOG_KN) {
    sog_kn_ = SIM_MAX_SOG_KN;
  }

  const float speed_mps = knotsToMps(sog_kn_);
  const float heading_rad = cog_deg_ * static_cast<float>(M_PI) / 180.0f;
  offset_east_m_ += cosf(heading_rad) * speed_mps * dt;
  offset_north_m_ += sinf(heading_rad) * speed_mps * dt;

  const float radius = sqrtf(offset_east_m_ * offset_east_m_ + offset_north_m_ * offset_north_m_);
  if (radius > SIM_RADIUS_M) {
    const float scale = SIM_RADIUS_M / radius;
    offset_east_m_ *= scale;
    offset_north_m_ *= scale;
    cog_deg_ = normalizeDeg(cog_deg_ + 180.0f + randomRange(-35.0f, 35.0f));
  }

  const float meters_per_deg_lon = metersPerDegLon(SIM_CENTER_LAT_DEG);
  position.valid = true;
  position.lat = SIM_CENTER_LAT_DEG + (offset_north_m_ / SIM_METERS_PER_DEG_LAT);
  position.lon = SIM_CENTER_LON_DEG + (offset_east_m_ / meters_per_deg_lon);
  position.gps_age_ms = 0;
  position.sog_kn = sog_kn_;
  position.cog_deg = cog_deg_;
  position.heading_deg = cog_deg_;
  position.last_update_ts = current_ts_ms_;

  const float current_radius = sqrtf(offset_east_m_ * offset_east_m_ + offset_north_m_ * offset_north_m_);
  const float radius_ratio = current_radius / SIM_RADIUS_M;
  depth.available = true;
  depth.depth_m = 5.0f - (3.5f * radius_ratio);
  if (depth.depth_m < 1.5f) {
    depth.depth_m = 1.5f;
  }
  depth.ts = current_ts_ms_;

  const float max_delta_kn = SIM_MAX_WIND_DELTA_KN_PER_MIN * dt / 60.0f;
  const float max_delta_deg = SIM_MAX_WIND_DELTA_DEG_PER_MIN * dt / 60.0f;
  wind_kn_ += randomRange(-max_delta_kn, max_delta_kn);
  if (wind_kn_ < 3.0f) {
    wind_kn_ = 3.0f;
  } else if (wind_kn_ > 35.0f) {
    wind_kn_ = 35.0f;
  }
  wind_dir_deg_ = normalizeDeg(wind_dir_deg_ + randomRange(-max_delta_deg, max_delta_deg));

  wind.available = true;
  wind.wind_kn = wind_kn_;
  wind.wind_dir_deg = wind_dir_deg_;
  wind.ts = current_ts_ms_;
}

}  // namespace aw
