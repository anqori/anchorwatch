#include "aw_track_log.h"

#include <LittleFS.h>

#include <algorithm>

#include "aw_constants.h"

namespace aw {

namespace {

static const char* TRACK_LOG_PATH = "/track_log.bin";
static const uint32_t TRACK_LOG_MAGIC = 0x4b525457UL;  // WTRK
static const uint16_t TRACK_LOG_VERSION = 1U;

struct __attribute__((packed)) TrackLogHeader {
  uint32_t magic = TRACK_LOG_MAGIC;
  uint16_t version = TRACK_LOG_VERSION;
  uint16_t header_size = sizeof(TrackLogHeader);
  uint32_t record_size = 0;
  uint32_t capacity = 0;
  uint32_t count = 0;
  uint32_t next_index = 0;
  uint32_t reserved_bytes = 0;
};

struct __attribute__((packed)) StoredTrackPoint {
  uint32_t ts_sec = 0;
  float lat = 0.0f;
  float lon = 0.0f;
  float cog_deg = 0.0f;
  float heading_deg = 0.0f;
  float sog_kn = 0.0f;
  float depth_m = 0.0f;
  float wind_kn = 0.0f;
  float wind_dir_deg = 0.0f;
  uint8_t flags = 0;
};

static const uint8_t TRACK_POINT_FLAG_DEPTH = 0x01U;
static const uint8_t TRACK_POINT_FLAG_WIND = 0x02U;

size_t computeReservedBytes(size_t total_bytes) {
  size_t reserved = std::min(total_bytes / 4U, TRACK_LOG_MAX_RESERVED_FS_BYTES);
  if (total_bytes > TRACK_LOG_MIN_RESERVED_FS_BYTES && reserved < TRACK_LOG_MIN_RESERVED_FS_BYTES) {
    reserved = TRACK_LOG_MIN_RESERVED_FS_BYTES;
  }
  return reserved;
}

uint32_t computeCapacity(size_t total_bytes, size_t reserved_bytes) {
  const size_t header_bytes = sizeof(TrackLogHeader);
  if (total_bytes <= reserved_bytes + header_bytes) {
    return 0;
  }
  size_t usable_bytes = total_bytes - reserved_bytes - header_bytes;
  size_t capacity = usable_bytes / sizeof(StoredTrackPoint);
  if (capacity < TRACK_LOG_MIN_RECORD_CAPACITY && total_bytes > header_bytes) {
    const size_t fallback_reserved = std::min(total_bytes / 8U, TRACK_LOG_MIN_RESERVED_FS_BYTES);
    if (total_bytes > fallback_reserved + header_bytes) {
      usable_bytes = total_bytes - fallback_reserved - header_bytes;
      capacity = usable_bytes / sizeof(StoredTrackPoint);
    }
  }
  return static_cast<uint32_t>(capacity);
}

size_t recordOffset(uint32_t index) {
  return sizeof(TrackLogHeader) + static_cast<size_t>(index) * sizeof(StoredTrackPoint);
}

StoredTrackPoint toStoredTrackPoint(const TrackPoint& point) {
  StoredTrackPoint stored;
  stored.ts_sec = point.ts_sec;
  stored.lat = point.lat;
  stored.lon = point.lon;
  stored.cog_deg = point.cog_deg;
  stored.heading_deg = point.heading_deg;
  stored.sog_kn = point.sog_kn;
  stored.depth_m = point.depth_m;
  stored.wind_kn = point.wind_kn;
  stored.wind_dir_deg = point.wind_dir_deg;
  if (point.has_depth) {
    stored.flags |= TRACK_POINT_FLAG_DEPTH;
  }
  if (point.has_wind) {
    stored.flags |= TRACK_POINT_FLAG_WIND;
  }
  return stored;
}

TrackPoint fromStoredTrackPoint(const StoredTrackPoint& stored) {
  TrackPoint point;
  point.ts_sec = stored.ts_sec;
  point.lat = stored.lat;
  point.lon = stored.lon;
  point.cog_deg = stored.cog_deg;
  point.heading_deg = stored.heading_deg;
  point.sog_kn = stored.sog_kn;
  point.has_depth = (stored.flags & TRACK_POINT_FLAG_DEPTH) != 0;
  point.depth_m = stored.depth_m;
  point.has_wind = (stored.flags & TRACK_POINT_FLAG_WIND) != 0;
  point.wind_kn = stored.wind_kn;
  point.wind_dir_deg = stored.wind_dir_deg;
  return point;
}

bool readHeader(File& file, TrackLogHeader& header) {
  if (!file.seek(0) || file.read(reinterpret_cast<uint8_t*>(&header), sizeof(header)) != sizeof(header)) {
    return false;
  }
  return true;
}

bool headerIsValid(const TrackLogHeader& header, uint32_t capacity) {
  return header.magic == TRACK_LOG_MAGIC &&
    header.version == TRACK_LOG_VERSION &&
    header.header_size == sizeof(TrackLogHeader) &&
    header.record_size == sizeof(StoredTrackPoint) &&
    header.capacity == capacity &&
    header.count <= header.capacity &&
    header.next_index < header.capacity;
}

}  // namespace

bool TrackLog::begin() {
  if (mounted_) {
    return true;
  }
  mounted_ = LittleFS.begin(true);
  if (!mounted_) {
    log_e("[track] failed to mount LittleFS");
    return false;
  }
  fs_total_bytes_ = LittleFS.totalBytes();
  reserved_bytes_ = computeReservedBytes(fs_total_bytes_);
  capacity_ = computeCapacity(fs_total_bytes_, reserved_bytes_);
  file_bytes_ = sizeof(TrackLogHeader) + static_cast<size_t>(capacity_) * sizeof(StoredTrackPoint);
  if (capacity_ == 0) {
    log_e("[track] no usable flash capacity total=%u reserved=%u", static_cast<unsigned>(fs_total_bytes_),
          static_cast<unsigned>(reserved_bytes_));
    return false;
  }
  if (!ensureLogFile()) {
    mounted_ = false;
    LittleFS.end();
    return false;
  }
  log_i("[track] mounted total=%u reserved=%u file=%u capacity=%u count=%u",
        static_cast<unsigned>(fs_total_bytes_),
        static_cast<unsigned>(reserved_bytes_),
        static_cast<unsigned>(file_bytes_),
        static_cast<unsigned>(capacity_),
        static_cast<unsigned>(count_));
  return true;
}

void TrackLog::end() {
  if (!mounted_) {
    return;
  }
  LittleFS.end();
  mounted_ = false;
  capacity_ = 0;
  count_ = 0;
  next_index_ = 0;
  reserved_bytes_ = 0;
  file_bytes_ = 0;
  fs_total_bytes_ = 0;
}

bool TrackLog::ensureLogFile() {
  if (!mounted_) {
    return false;
  }
  File file = LittleFS.open(TRACK_LOG_PATH, FILE_READ);
  if (!file) {
    return resetLogFile();
  }
  TrackLogHeader header;
  const bool valid = readHeader(file, header) && headerIsValid(header, capacity_);
  file.close();
  if (!valid) {
    log_w("[track] resetting invalid track log");
    return resetLogFile();
  }
  count_ = header.count;
  next_index_ = header.next_index;
  return true;
}

bool TrackLog::resetLogFile() {
  if (!mounted_) {
    return false;
  }
  LittleFS.remove(TRACK_LOG_PATH);
  File file = LittleFS.open(TRACK_LOG_PATH, FILE_WRITE, true);
  if (!file) {
    log_e("[track] failed to create %s", TRACK_LOG_PATH);
    return false;
  }
  TrackLogHeader header;
  header.record_size = sizeof(StoredTrackPoint);
  header.capacity = capacity_;
  header.count = 0;
  header.next_index = 0;
  header.reserved_bytes = static_cast<uint32_t>(reserved_bytes_);
  const bool ok = file.write(reinterpret_cast<const uint8_t*>(&header), sizeof(header)) == sizeof(header);
  file.flush();
  file.close();
  if (!ok) {
    log_e("[track] failed to write initial header");
    return false;
  }
  count_ = 0;
  next_index_ = 0;
  return true;
}

bool TrackLog::rewriteHeader() {
  if (!mounted_) {
    return false;
  }
  File file = LittleFS.open(TRACK_LOG_PATH, "r+");
  if (!file) {
    return false;
  }
  TrackLogHeader header;
  header.record_size = sizeof(StoredTrackPoint);
  header.capacity = capacity_;
  header.count = count_;
  header.next_index = next_index_;
  header.reserved_bytes = static_cast<uint32_t>(reserved_bytes_);
  const bool ok = file.seek(0) &&
    file.write(reinterpret_cast<const uint8_t*>(&header), sizeof(header)) == sizeof(header);
  file.flush();
  file.close();
  return ok;
}

bool TrackLog::append(const TrackPoint& point) {
  if (!mounted_ || capacity_ == 0) {
    return false;
  }
  File file = LittleFS.open(TRACK_LOG_PATH, "r+");
  if (!file && !resetLogFile()) {
    return false;
  }
  if (!file) {
    file = LittleFS.open(TRACK_LOG_PATH, "r+");
  }
  if (!file) {
    log_e("[track] failed to open track log for append");
    return false;
  }
  const StoredTrackPoint stored = toStoredTrackPoint(point);
  const size_t offset = recordOffset(next_index_);
  const bool write_ok = file.seek(static_cast<uint32_t>(offset)) &&
    file.write(reinterpret_cast<const uint8_t*>(&stored), sizeof(stored)) == sizeof(stored);
  file.flush();
  file.close();
  if (!write_ok) {
    log_e("[track] failed to append point at index=%u", static_cast<unsigned>(next_index_));
    return false;
  }
  next_index_ = (next_index_ + 1U) % capacity_;
  if (count_ < capacity_) {
    count_++;
  }
  if (!rewriteHeader()) {
    log_e("[track] failed to rewrite header after append");
    return false;
  }
  return true;
}

void TrackLog::clear() {
  if (!mounted_) {
    return;
  }
  if (!resetLogFile()) {
    log_e("[track] failed to clear track log");
  }
}

bool TrackLog::forEachSince(uint64_t since_ts_ms, const std::function<bool(const TrackPoint&)>& visitor) {
  if (!mounted_ || count_ == 0) {
    return true;
  }
  File file = LittleFS.open(TRACK_LOG_PATH, FILE_READ);
  if (!file) {
    log_e("[track] failed to open track log for read");
    return false;
  }
  const uint32_t oldest_index = count_ == capacity_ ? next_index_ : 0U;
  for (uint32_t offset = 0; offset < count_; offset++) {
    const uint32_t index = (oldest_index + offset) % capacity_;
    StoredTrackPoint stored;
    if (!file.seek(static_cast<uint32_t>(recordOffset(index))) ||
        file.read(reinterpret_cast<uint8_t*>(&stored), sizeof(stored)) != sizeof(stored)) {
      file.close();
      log_e("[track] failed to read point index=%u", static_cast<unsigned>(index));
      return false;
    }
    if (static_cast<uint64_t>(stored.ts_sec) * 1000ULL < since_ts_ms) {
      continue;
    }
    if (!visitor(fromStoredTrackPoint(stored))) {
      break;
    }
  }
  file.close();
  return true;
}

TrackLog::Stats TrackLog::stats() const {
  Stats result;
  result.mounted = mounted_;
  result.available = mounted_ && capacity_ > 0;
  result.capacity = capacity_;
  result.count = count_;
  result.next_index = next_index_;
  result.reserved_bytes = reserved_bytes_;
  result.file_bytes = file_bytes_;
  result.fs_total_bytes = fs_total_bytes_;
  result.fs_used_bytes = mounted_ ? LittleFS.usedBytes() : 0U;
  return result;
}

}  // namespace aw
