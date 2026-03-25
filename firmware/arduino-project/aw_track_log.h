#pragma once

#include <Arduino.h>

#include <functional>

#include "aw_model.h"

namespace aw {

class TrackLog {
 public:
  struct Stats {
    bool mounted = false;
    bool available = false;
    uint32_t capacity = 0;
    uint32_t count = 0;
    uint32_t next_index = 0;
    size_t reserved_bytes = 0;
    size_t file_bytes = 0;
    size_t fs_total_bytes = 0;
    size_t fs_used_bytes = 0;
  };

  bool begin();
  void end();

  bool append(const TrackPoint& point);
  void clear();
  bool forEachSince(uint64_t since_ts_ms, const std::function<bool(const TrackPoint&)>& visitor);
  Stats stats() const;

 private:
  bool ensureLogFile();
  bool resetLogFile();
  bool rewriteHeader();

  bool mounted_ = false;
  uint32_t capacity_ = 0;
  uint32_t count_ = 0;
  uint32_t next_index_ = 0;
  size_t reserved_bytes_ = 0;
  size_t file_bytes_ = 0;
  size_t fs_total_bytes_ = 0;
};

}  // namespace aw
