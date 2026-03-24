#pragma once

#include "aw_model.h"

namespace aw {

class SimulationEngine {
 public:
  void begin(unsigned long now_ms);
  void stop();
  bool active() const;
  uint64_t currentTsMs() const;
  void step(unsigned long now_ms, PositionState& position, DepthState& depth, WindState& wind);

 private:
  unsigned long last_mono_ms_ = 0;
  uint64_t current_ts_ms_ = 0;
  float offset_east_m_ = 0.0f;
  float offset_north_m_ = 0.0f;
  float cog_deg_ = 0.0f;
  float sog_kn_ = 0.0f;
  float wind_kn_ = 12.0f;
  float wind_dir_deg_ = 220.0f;
  bool active_ = false;

  static float randomUnit();
  static float randomRange(float min_value, float max_value);
  static float normalizeDeg(float value);
};

}  // namespace aw
