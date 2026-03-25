#pragma once

#include <Arduino.h>

#ifndef LED_BUILTIN
#define LED_BUILTIN 2
#endif

namespace aw {

static const int SIREN_PIN = 4;
static const int STATUS_LED_PIN = LED_BUILTIN;

#ifndef ANQORI_BUILD_VERSION
#define ANQORI_BUILD_VERSION "run-unknown"
#endif

static const char* FW_VERSION = ANQORI_BUILD_VERSION;
static const char* BLE_DEVICE_NAME_PREFIX = "Anqori-AnchorWatch-";
static const char* DEFAULT_BOAT_ID_PREFIX = "boat_";
static const char* DEFAULT_DEVICE_ID_PREFIX = "dev_";

#ifndef ANQORI_FACTORY_SETUP_PIN
#define ANQORI_FACTORY_SETUP_PIN "123456"
#endif

static const char* FACTORY_SETUP_PIN = ANQORI_FACTORY_SETUP_PIN;

static const char* BLE_SERVICE_UUID = "9f2d0000-87aa-4f4a-a0ea-4d5d4f415354";
static const char* BLE_CONTROL_TX_UUID = "9f2d0001-87aa-4f4a-a0ea-4d5d4f415354";
static const char* BLE_EVENT_RX_UUID = "9f2d0002-87aa-4f4a-a0ea-4d5d4f415354";
static const char* BLE_SNAPSHOT_UUID = "9f2d0003-87aa-4f4a-a0ea-4d5d4f415354";
static const char* BLE_AUTH_UUID = "9f2d0004-87aa-4f4a-a0ea-4d5d4f415354";

#ifndef ANQORI_CLOUD_RELAY_HOST
#define ANQORI_CLOUD_RELAY_HOST "aw-cloud.anqori.com"
#endif

#ifndef ANQORI_CLOUD_RELAY_PORT
#define ANQORI_CLOUD_RELAY_PORT 443
#endif

static const char* CLOUD_RELAY_HOST = ANQORI_CLOUD_RELAY_HOST;
static const uint16_t CLOUD_RELAY_PORT = ANQORI_CLOUD_RELAY_PORT;
static const char* CLOUD_RELAY_TICKET_PATH = "/v1/ws-ticket";
static const char* CLOUD_RELAY_PIPE_PATH = "/v1/pipe";

static const unsigned long LOOP_IDLE_DELAY_MS = 10UL;
static const unsigned long TELEMETRY_TICK_MS = 1000UL;
static const unsigned long HISTORY_SAMPLE_INTERVAL_MS = 5000UL;
static const unsigned long BLE_CHUNK_TIMEOUT_MS = 2000UL;
static const size_t BLE_CHUNK_MAX_PAYLOAD = 80U;
static const unsigned long BLE_NOTIFY_INTER_CHUNK_DELAY_MS = 35UL;
static const unsigned long BLE_NOTIFY_INTER_MESSAGE_DELAY_MS = 60UL;
static const unsigned long PAIR_MODE_TTL_MS = 120UL * 1000UL;
static const unsigned long WIFI_CONNECT_TIMEOUT_MS = 20UL * 1000UL;
static const unsigned long WIFI_RETRY_MIN_MS = 1000UL;
static const unsigned long WIFI_RETRY_MAX_MS = 30UL * 1000UL;
static const unsigned long CLOUD_CONNECT_TIMEOUT_MS = 10000UL;
static const unsigned long CLOUD_HTTP_TIMEOUT_MS = 10000UL;
static const unsigned long CLOUD_RETRY_MIN_MS = 2000UL;
static const unsigned long CLOUD_RETRY_MAX_MS = 60000UL;
static const unsigned long CLOUD_PING_INTERVAL_MS = 25000UL;
static const size_t TRACK_BACKFILL_REPLY_POINTS = 50U;
static const size_t TRACK_LOG_MAX_RESERVED_FS_BYTES = 256U * 1024U;
static const size_t TRACK_LOG_MIN_RESERVED_FS_BYTES = 64U * 1024U;
static const size_t TRACK_LOG_MIN_RECORD_CAPACITY = 512U;

static const float SIM_CENTER_LAT_DEG = 54.38329f;
static const float SIM_CENTER_LON_DEG = 10.16349f;
static const float SIM_RADIUS_M = 200.0f;
static const float SIM_METERS_PER_DEG_LAT = 111320.0f;
static const float SIM_KNOTS_PER_MPS = 1.94384f;
static const uint64_t SIM_START_TS_MS = 1754060400000ULL;  // 2025-08-01T15:00:00Z
static const float SIM_MIN_SOG_KN = 0.2f;
static const float SIM_MAX_SOG_KN = 1.6f;
static const float SIM_MAX_WIND_DELTA_KN_PER_MIN = 5.0f;
static const float SIM_MAX_WIND_DELTA_DEG_PER_MIN = 20.0f;

static const char* PREFS_NAMESPACE = "anchorwatch";
static const char* PREF_KEY_DEVICE_ID = "device_id";
static const char* PREF_KEY_BOAT_ID = "boat_id";
static const char* PREF_KEY_BLE_CONNECTION_PIN = "ble_pin";
static const char* PREF_KEY_CLOUD_SECRET = "cloud_secret";
static const char* PREF_KEY_CLOUD_VERSION = "cloud_ver";
static const char* PREF_KEY_ALARM_CONFIG = "cfg_alarm";
static const char* PREF_KEY_OBSTACLES = "cfg_obst";
static const char* PREF_KEY_ANCHOR_SETTINGS = "cfg_anchor";
static const char* PREF_KEY_PROFILES = "cfg_profiles";
static const char* PREF_KEY_SYSTEM_CONFIG = "cfg_system";
static const char* PREF_KEY_WLAN_CONFIG = "cfg_wlan";
static const char* PREF_KEY_ANCHOR_STATE = "anchor_state";
static const char* PREF_KEY_ANCHOR_LAT = "anchor_lat";
static const char* PREF_KEY_ANCHOR_LON = "anchor_lon";
static const char* PREF_KEY_ANCHOR_HAS = "anchor_has";
static const char* PREF_KEY_LAST_ANCHOR_TS = "last_anchor";

}  // namespace aw
