# Anqori AnchorWatch Protocol v2

Status: active  
Date: 2026-03-25

Related access lifecycle: [`docs/access-and-provisioning.md`](/home/pm/dev/anchormaster/docs/access-and-provisioning.md)

## Purpose

Define one simple protocol for all runtime transport paths:

- BLE local control
- WLAN/cloud relay control
- future Android helper device emulator

The relay is transport-only. It forwards opaque messages and does not merge state, store config, or answer protocol-local control messages.

## Envelope

Client to server:

```json
{
  "req_id": "01HZXJ0Q8J72E9K4N5P6R7S8T9",
  "type": "GET_DATA",
  "data": {}
}
```

Server to client:

```json
{
  "req_id": "01HZXJ0Q8J72E9K4N5P6R7S8T9",
  "state": "ONGOING",
  "type": "STATE_POSITION",
  "data": {}
}
```

Reply states:

- `ONGOING`: more replies may follow for this request
- `CLOSED_OK`: terminal success
- `CLOSED_FAILED`: terminal failure

Failures use the same envelope with:

```json
{
  "req_id": "01HZXJ0Q8J72E9K4N5P6R7S8T9",
  "state": "CLOSED_FAILED",
  "type": "ERROR",
  "data": {
    "code": "VERSION_CONFLICT",
    "message": "alarm_config version mismatch"
  }
}
```

Meaning of `type`:

- in requests, `type` identifies the requested operation such as `GET_DATA` or `UPDATE_CONFIG_ANCHOR_SETTINGS`
- in replies, `type` identifies the payload shape carried in `data`
- reply `type` may differ from the request `type`
- for a streamed request such as `GET_DATA`, reply `type` may change across messages on the same `req_id`
- terminal failure replies always use `type: "ERROR"`

Meaning of `version`:

- runtime state replies do not use a top-level `version`
- config DTOs carry their own `version` field inside `data`
- the app sends that same config DTO version back when using the matching `UPDATE_CONFIG_*` request
- the server accepts an `UPDATE_CONFIG_*` change only if the supplied config DTO version matches the current authoritative version
- after a successful config write, the server increments the affected config DTO version before publishing it again

## General Request/Reply Rules

The protocol is always request-response.

Rules:

1. Clients initiate work by sending requests.
2. Every request must receive at least one reply unless the transport disconnects first.
3. Servers answer only as replies to an existing request.
4. Streaming is still request-response: the client opens a request such as `GET_DATA` or `SCAN_WLAN`, and the server sends one or more replies on that same `req_id`.
5. There are no unsolicited business messages outside an open request lifecycle.
6. Multiple in-flight requests must be supported on the same connection.
7. Replies for different requests may be interleaved on the wire.
8. The app must correlate replies by `req_id`, not by arrival order.
9. The proxy must forward messages unchanged and must not assume one-at-a-time request handling.
10. The app must interpret reply payloads by reply `type`, not by the original request `type`.
11. Failure payloads are always carried as `type: "ERROR"` with the error object directly in `data`.
12. `CANCEL` is a normal request in this model and must also receive its own reply.

## Request Type Catalog

Runtime/config types:

- `GET_DATA`
- `AUTHORIZE_BLE_SESSION`
- `SET_INITIAL_BLE_PIN`
- `SET_ANCHOR`
- `MOVE_ANCHOR`
- `RAISE_ANCHOR`
- `SILENCE_ALARM`
- `UNSILENCE_ALARM`
- `UPDATE_CONFIG_ALARM`
- `UPDATE_CONFIG_OBSTACLES`
- `UPDATE_CONFIG_ANCHOR_SETTINGS`
- `UPDATE_CONFIG_PROFILES`
- `UPDATE_CONFIG_SYSTEM`
- `UPDATE_CONFIG_WLAN`
- `UPDATE_CLOUD_CREDENTIALS`
- `UPDATE_BLE_PIN`
- `SCAN_WLAN`
- `CANCEL`

Onboarding types:

- `AUTHORIZE_SETUP`

## Reply Type Catalog

Runtime/config reply types:

- `STATE_POSITION`
- `STATE_ANCHOR_POSITION`
- `STATE_DEPTH`
- `STATE_WIND`
- `STATE_WLAN_STATUS`
- `STATE_SYSTEM_STATUS`
- `STATE_ALARM_STATE`
- `CONFIG_ALARM`
- `CONFIG_OBSTACLES`
- `CONFIG_ANCHOR_SETTINGS`
- `CONFIG_PROFILES`
- `CONFIG_SYSTEM`
- `CONFIG_WLAN`
- `CONFIG_CLOUD`

Other reply types:

- `TRACK_BACKFILL`
- `WLAN_NETWORK`
- `ACK`
- `ERROR`

## `GET_DATA`

`GET_DATA` is the single runtime stream.

Rules:

1. Client sends one `GET_DATA` after connect.
2. `GET_DATA` is protected runtime access:
   - on BLE it requires an authorized BLE session
   - on cloud it requires an already authenticated cloud session
   - in `SETUP_REQUIRED` or on an unauthorized BLE session it must fail instead of leaking runtime/config data
3. Server responds with a bootstrap sequence of `ONGOING` replies using the same `req_id`.
4. Each bootstrap reply carries one current payload and uses a reply `type` that matches that payload shape, for example `STATE_POSITION`, `STATE_WIND`, `STATE_ANCHOR_POSITION`, or `TRACK_BACKFILL`.
5. There is no dedicated snapshot container required by the protocol.
6. The server should send the current known state/config values needed by the client and then any retained track backfill for the backfill window.
7. Backfill starts at `min(last_anchor_down_ts, now - 30 minutes)`.
8. If no anchor-down timestamp exists, backfill starts at `now - 30 minutes`.
9. The server may split retained track backfill across multiple `TRACK_BACKFILL` replies.
10. After bootstrap, the same request stays open and later replies continue streaming whole-value replacements and `TRACK_BACKFILL` messages.
11. The request stays open until cancel, disconnect, or terminal error.

Server-side retention requirement behind this backfill:

- the server retains historical state samples for at least:
  - position
  - depth
  - wind
- retention covers the last 30 minutes or since the last anchor down, whichever window is longer

Example request and bootstrap sequence:

```json
{ "req_id": "01HZXJ0Q8J72E9K4N5P6R7S8T9", "type": "GET_DATA", "data": {} }
{ "req_id": "01HZXJ0Q8J72E9K4N5P6R7S8T9", "state": "ONGOING", "type": "STATE_POSITION", "data": { "lat": 54.3201, "lon": 10.1402, "gps_age_ms": 900, "valid": true, "sog_kn": 0.42, "cog_deg": 192.3, "heading_deg": 188.0 } }
{ "req_id": "01HZXJ0Q8J72E9K4N5P6R7S8T9", "state": "ONGOING", "type": "STATE_WIND", "data": { "wind_kn": 14.8, "wind_dir_deg": 205.0, "ts": 1770897600000 } }
{ "req_id": "01HZXJ0Q8J72E9K4N5P6R7S8T9", "state": "ONGOING", "type": "STATE_DEPTH", "data": { "depth_m": 3.1, "ts": 1770897600000 } }
{ "req_id": "01HZXJ0Q8J72E9K4N5P6R7S8T9", "state": "ONGOING", "type": "STATE_WLAN_STATUS", "data": { "wifi_state": "CONNECTED", "wifi_connected": true, "wifi_ssid": "Marina", "wifi_rssi": -63, "wifi_error": "" } }
{ "req_id": "01HZXJ0Q8J72E9K4N5P6R7S8T9", "state": "ONGOING", "type": "STATE_ANCHOR_POSITION", "data": { "state": "down", "lat": 54.3201, "lon": 10.1402 } }
{ "req_id": "01HZXJ0Q8J72E9K4N5P6R7S8T9", "state": "ONGOING", "type": "CONFIG_SYSTEM", "data": { "version": 2, "runtime_mode": "LIVE" } }
{ "req_id": "01HZXJ0Q8J72E9K4N5P6R7S8T9", "state": "ONGOING", "type": "TRACK_BACKFILL", "data": [ { "ts": 1770897600000, "lat": 54.3201, "lon": 10.1402, "cog_deg": 192.3, "heading_deg": 188.0, "sog_kn": 0.42, "depth_m": 3.1, "wind_kn": 14.8, "wind_dir_deg": 205.0 } ] }
```

On an authorized BLE session, the bootstrap sequence may additionally include:

```json
{ "req_id": "01HZXJ0Q8J72E9K4N5P6R7S8T9", "state": "ONGOING", "type": "CONFIG_CLOUD", "data": { "version": 4, "boat_id": "BOAT_123", "cloud_secret": "cloud-secret", "secret_configured": true } }
```

Example sequence updating range-related anchor settings:

```json
{ "req_id": "01HZXJ0Q8J72E9K4N5P6R7S8TA", "type": "UPDATE_CONFIG_ANCHOR_SETTINGS", "data": { "version": 8, "allowed_range_m": 35, "allowed_region": null } }
{ "req_id": "01HZXJ0Q8J72E9K4N5P6R7S8TA", "state": "CLOSED_OK", "type": "ACK", "data": {} }
{ "req_id": "01HZXJ0Q8J72E9K4N5P6R7S8T9", "state": "ONGOING", "type": "CONFIG_ANCHOR_SETTINGS", "data": { "version": 9, "allowed_range_m": 35, "allowed_region": null } }
```

Track backfill shape:

```json
[
  { "ts": 1770897630000, "lat": 54.3202, "lon": 10.1404, "cog_deg": 193.0, "heading_deg": 188.5, "sog_kn": 0.45, "depth_m": 3.0, "wind_kn": 15.2, "wind_dir_deg": 207.0 }
]
```

## Whole-value Semantics

Every streamed reply replaces the full value for its reply `type`. There are no dot-path patches and no deep merges on the wire.

Runtime state values use `STATE_*` reply types.

App-writable config values use `CONFIG_*` reply types:

- `CONFIG_ALARM`
- `CONFIG_OBSTACLES`
- `CONFIG_ANCHOR_SETTINGS`
- `CONFIG_PROFILES`
- `CONFIG_SYSTEM`
- `CONFIG_WLAN`
- `CONFIG_CLOUD`

Config DTOs carry a monotonic `version` field inside `data`.

Version matching is used for app-to-server config writes:

- the app sends the full config DTO directly in `data`, including its current `version`
- most config DTOs use one matching `UPDATE_CONFIG_*` request
- `CONFIG_CLOUD` is updated with `UPDATE_CLOUD_CREDENTIALS`
- the server accepts the write only if that version matches the current authoritative version
- on success the server increments the config DTO version and publishes the new full config DTO
- on mismatch the server replies with `type: "ERROR"` and `CLOSED_FAILED`

## Payload Catalog

Naming note:

- all protocol field names use `snake_case`

### State and config payloads

For every `STATE_*` and `CONFIG_*` reply:

- `type` identifies the payload kind
- `data` carries the full replacement payload directly
- only `CONFIG_*` payloads include their own `version` field

### `PositionValue`

Used as `data` when `type=STATE_POSITION`.

```json
{
  "lat": 54.3201,
  "lon": 10.1402,
  "gps_age_ms": 900,
  "valid": true,
  "sog_kn": 0.42,
  "cog_deg": 192.3,
  "heading_deg": 188.0
}
```

Fields:

- `lat`: latitude in WGS84 decimal degrees
- `lon`: longitude in WGS84 decimal degrees
- `gps_age_ms`: age of the GPS fix in milliseconds
- `valid`: whether the position fix is currently valid
- `sog_kn`: speed over ground in knots
- `cog_deg`: course over ground in degrees
- `heading_deg`: heading in degrees

### `DepthValue`

Used as `data` when `type=STATE_DEPTH`.

```json
{
  "depth_m": 3.1,
  "ts": 1770897600000
}
```

Fields:

- `depth_m`: depth in meters
- `ts`: sample timestamp in epoch milliseconds

### `WindValue`

Used as `data` when `type=STATE_WIND`.

```json
{
  "wind_kn": 14.8,
  "wind_dir_deg": 205.0,
  "ts": 1770897600000
}
```

Fields:

- `wind_kn`: wind speed in knots
- `wind_dir_deg`: wind direction in degrees
- `ts`: sample timestamp in epoch milliseconds

### `SystemStatusValue`

Used as `data` when `type=STATE_SYSTEM_STATUS`.

```json
{
  "cloud_reachable": true,
  "server_version": "run-20260324"
}
```

Fields:

- `cloud_reachable`: whether the cloud path is currently reachable
- `server_version`: current server build/version string

### `WlanStatusValue`

Used as `data` when `type=STATE_WLAN_STATUS`.

```json
{
  "wifi_state": "CONNECTED",
  "wifi_connected": true,
  "wifi_ssid": "Marina",
  "wifi_rssi": -63,
  "wifi_error": ""
}
```

Fields:

- `wifi_state`: WLAN runtime state enum such as `DISCONNECTED`, `CONNECTING`, `AUTHENTICATING`, `OBTAINING_IP`, `CONNECTED`, or `FAILED`
- `wifi_connected`: whether WLAN is currently connected
- `wifi_ssid`: current or configured WLAN SSID
- `wifi_rssi`: WLAN RSSI when available
- `wifi_error`: last WLAN connection error text, empty string if none

### `WlanConnectionState`

Allowed `wifi_state` values:

- `DISCONNECTED`
- `CONNECTING`
- `AUTHENTICATING`
- `OBTAINING_IP`
- `CONNECTED`
- `FAILED`

### `AlertRuntime`

Used inside `AlarmStateValue.alerts[]`.

```json
{
  "alert_type": "WIND_ABOVE",
  "state": "WATCHING",
  "severity": "WARNING",
  "above_threshold_since_ts": null,
  "alert_since_ts": null,
  "alert_silenced_until_ts": null
}
```

Fields:

- `alert_type`: alert type enum value in `UPPER_SNAKE_CASE`
- `state`: runtime state such as `DISABLED`, `WATCHING`, or `ALERT`
- `severity`: configured or computed severity such as `WARNING` or `ALARM`
- `above_threshold_since_ts`: timestamp when the alert first crossed threshold, or `null`
- `alert_since_ts`: timestamp when the alert became active, or `null`
- `alert_silenced_until_ts`: silence-until timestamp, or `null`

### `AlertType`

Allowed `alert_type` values:

- `ANCHOR_DISTANCE`
- `OBSTACLE_CLOSE`
- `WIND_ABOVE`
- `DEPTH_BELOW`
- `DATA_OUTDATED`

### `AlarmStateValue`

Used as `data` when `type=STATE_ALARM_STATE`.

```json
{
  "alerts": [
    {
      "alert_type": "WIND_ABOVE",
      "state": "ALERT",
      "severity": "WARNING",
      "above_threshold_since_ts": 1770897600000,
      "alert_since_ts": 1770897600000,
      "alert_silenced_until_ts": null
    }
  ]
}
```

Note:

- `AlarmStateValue` intentionally does not carry wrapper-level `state`, `severity`, or global silence/output fields
- silence is tracked per alert, not globally
- output routing is not configurable in the v2 protocol; raised alerts are signaled on all outputs available on that implementation
- `alerts` is an array for direct iteration, not a hash/map
- if the app wants an aggregate alarm summary, it derives that from the individual alert entries

Fields:

- `alerts`: array of `AlertRuntime`

### `AnchorPositionValue`

Used as `data` when `type=STATE_ANCHOR_POSITION`.

```json
{
  "state": "down",
  "lat": 54.3201,
  "lon": 10.1402
}
```

Fields:

- `state`: anchor state such as `up`, `down`, or `auto-pending`
- `lat`: current anchor latitude, or `null`
- `lon`: current anchor longitude, or `null`

### `WlanConfigValue`

Used as `data` when `type=CONFIG_WLAN`.

```json
{
  "version": 3,
  "ssid": "Marina",
  "passphrase": "secret",
  "security": "wpa2",
  "country": "DE",
  "hidden": false
}
```

Fields:

- `version`: config version used for compare-and-swap writes
- `ssid`: WLAN SSID
- `passphrase`: WLAN passphrase
- `security`: WLAN security mode
- `country`: WLAN regulatory country code
- `hidden`: whether the target WLAN is hidden

### `SystemConfigValue`

Used as `data` when `type=CONFIG_SYSTEM`.

```json
{
  "version": 2,
  "runtime_mode": "LIVE"
}
```

Fields:

- `version`: config version used for compare-and-swap writes
- `runtime_mode`: `RuntimeMode` enum value

Rules:

- `runtime_mode` controls whether the server uses real live inputs or the shared simulation scenario
- both firmware and Android implementations must follow the same simulation semantics when `runtime_mode = "SIMULATION"`

### `RuntimeMode`

Allowed `runtime_mode` values:

- `LIVE`
- `SIMULATION`

### `CloudConfigValue`

Used as `data` when `type=CONFIG_CLOUD`.

```json
{
  "version": 4,
  "boat_id": "BOAT_123",
  "cloud_secret": "cloud-secret",
  "secret_configured": true
}
```

Fields:

- `version`: config version used for credential update compare-and-swap writes
- `boat_id`: cloud routing identifier for this boat
- `cloud_secret`: current cloud relay secret
- `secret_configured`: whether a cloud server credential is currently configured on the server

Rules:

- `CONFIG_CLOUD` may be emitted only to an authorized BLE session
- `CONFIG_CLOUD` must not be emitted to unauthorized BLE sessions
- `CONFIG_CLOUD` must not be emitted over cloud transport
- the app should refresh its locally stored cloud secret whenever it receives `CONFIG_CLOUD` over an authorized BLE session

### `WlanNetworkValue`

Used as `data` when `type=WLAN_NETWORK`.

```json
{
  "ssid": "Marina",
  "security": "wpa2",
  "rssi": -63,
  "channel": 11,
  "hidden": false
}
```

Fields:

- `ssid`: discovered WLAN SSID
- `security`: discovered WLAN security mode
- `rssi`: signal strength when available, or `null`
- `channel`: channel when available, or `null`
- `hidden`: whether the discovered network is hidden

### `AlarmConfigValue`

Used as `data` when `type=CONFIG_ALARM`.

```json
{
  "version": 3,
  "alerts": [
    {
      "type": "ANCHOR_DISTANCE",
      "enabled": true,
      "min_time_ms": 20000,
      "severity": "ALARM",
      "default_silence_ms": 900000,
      "data": {
        "max_distance_m": 35
      }
    },
    {
      "type": "OBSTACLE_CLOSE",
      "enabled": true,
      "min_time_ms": 10000,
      "severity": "ALARM",
      "default_silence_ms": 900000,
      "data": {
        "min_distance_m": 10
      }
    }
  ]
}
```

Fields:

- `version`: config version used for compare-and-swap writes
- `alerts`: array of `AlarmConfigEntry`

Rules:

- every alert config entry uses the same common envelope
- `type` identifies which alert is being configured
- `data` carries the alert-specific configuration payload for that alert type
- each alert type should appear at most once in `alerts`
- output routing is not configurable here; raised alerts are signaled on all outputs available on that implementation

### `ObstaclesConfigValue`

Used as `data` when `type=CONFIG_OBSTACLES`.

```json
{
  "version": 2,
  "obstacles": [
    {
      "obstacle_id": "breakwater_1",
      "type": "PERMANENT",
      "polygon": [
        { "lat": 54.3194, "lon": 10.1388 },
        { "lat": 54.3212, "lon": 10.1388 },
        { "lat": 54.3212, "lon": 10.1418 }
      ]
    }
  ]
}
```

Fields:

- `version`: config version used for compare-and-swap writes
- `obstacles`: array of `ObstaclePolygon`

Rules:

- each obstacle defines a polygon where the boat must not go
- multiple obstacle polygons may be configured at once
- each obstacle should have a stable `obstacle_id` so the UI can edit/reorder them predictably

### `ObstacleType`

Allowed `type` values:

- `PERMANENT`
- `TEMPORARY`

### `ObstaclePolygon`

Used inside `ObstaclesConfigValue.obstacles`.

```json
{
  "obstacle_id": "breakwater_1",
  "type": "PERMANENT",
  "polygon": [
    { "lat": 54.3194, "lon": 10.1388 },
    { "lat": 54.3212, "lon": 10.1388 },
    { "lat": 54.3212, "lon": 10.1418 }
  ]
}
```

Fields:

- `obstacle_id`: stable obstacle identifier unique within the config value
- `type`: `ObstacleType` enum value
- `polygon`: polygon points in WGS84 decimal degrees; minimum 3 points

### `AlarmConfigEntry`

Used inside `AlarmConfigValue.alerts`.

```json
{
  "type": "DEPTH_BELOW",
  "enabled": true,
  "min_time_ms": 10000,
  "severity": "ALARM",
  "default_silence_ms": 900000,
  "data": {
    "min_depth_m": 2
  }
}
```

Fields:

- `type`: `AlertType` enum value
- `enabled`: whether this alert is evaluated
- `min_time_ms`: minimum time the alert condition must hold before the alert becomes active
- `severity`: configured alert severity such as `WARNING` or `ALARM`
- `default_silence_ms`: default silence duration used when the client sends `SILENCE_ALARM` for this alert type
- `data`: alert-specific configuration object

### `AnchorDistanceAlarmConfigData`

Used as `AlarmConfigEntry.data` when `type=ANCHOR_DISTANCE`.

```json
{
  "max_distance_m": 35
}
```

Fields:

- `max_distance_m`: maximum allowed distance from anchor position in meters

### `ObstacleCloseAlarmConfigData`

Used as `AlarmConfigEntry.data` when `type=OBSTACLE_CLOSE`.

```json
{
  "min_distance_m": 10
}
```

Fields:

- `min_distance_m`: minimum allowed distance to any configured obstacle polygon before the alert condition is true

### `WindAboveAlarmConfigData`

Used as `AlarmConfigEntry.data` when `type=WIND_ABOVE`.

```json
{
  "max_wind_kn": 30
}
```

Fields:

- `max_wind_kn`: maximum allowed wind in knots before the alert condition is true

### `DepthBelowAlarmConfigData`

Used as `AlarmConfigEntry.data` when `type=DEPTH_BELOW`.

```json
{
  "min_depth_m": 2
}
```

Fields:

- `min_depth_m`: minimum allowed depth in meters before the alert condition is true

### `DataOutdatedAlarmConfigData`

Used as `AlarmConfigEntry.data` when `type=DATA_OUTDATED`.

```json
{
  "max_age_ms": 5000
}
```

Fields:

- `max_age_ms`: maximum allowed age of required runtime data before the alert condition is true

### App-defined config payloads

These config payloads are intentionally whole-value and application-defined in the current version:

- `anchor_settings`
- `profiles`

They must still be sent and stored as complete replacement payloads, and each must include a top-level `version` field. Their remaining inner field catalog is owned by the corresponding feature/config docs and app config model rather than this protocol summary section.

### `TrackBackfill`

Used as `data` when `type=TRACK_BACKFILL`.

```json
[
  {
    "ts": 1770897600000,
    "lat": 54.3201,
    "lon": 10.1402,
    "cog_deg": 192.3,
    "heading_deg": 188.0,
    "sog_kn": 0.42,
    "depth_m": 3.1,
    "wind_kn": 14.8,
    "wind_dir_deg": 205.0
  }
]
```

This is an array of `TrackPoint` values. The server may split retained backfill across multiple `TRACK_BACKFILL` replies with the same `req_id`.
When retained depth or wind samples are available for a point timestamp, they should be included on the same track point.

### `TrackPoint`

Used inside `TrackBackfill`.

```json
{
  "ts": 1770897600000,
  "lat": 54.3201,
  "lon": 10.1402,
  "cog_deg": 192.3,
  "heading_deg": 188.0,
  "sog_kn": 0.42,
  "depth_m": 3.1,
  "wind_kn": 14.8,
  "wind_dir_deg": 205.0
}
```

Fields:

- `ts`: timestamp in epoch milliseconds
- `lat`: latitude in WGS84 decimal degrees
- `lon`: longitude in WGS84 decimal degrees
- `cog_deg`: course over ground in degrees
- `heading_deg`: heading in degrees
- `sog_kn`: speed over ground in knots
- `depth_m`: depth in meters, or `null` if unavailable for that track point
- `wind_kn`: wind speed in knots, or `null` if unavailable for that track point
- `wind_dir_deg`: wind direction in degrees, or `null` if unavailable for that track point

### `ErrorValue`

Used as `data` when `type=ERROR`.

```json
{
  "code": "VERSION_CONFLICT",
  "message": "alarm_config version mismatch"
}
```

Fields:

- `code`: stable machine-readable error code
- `message`: human-readable error summary

## Mutation Types

`SET_ANCHOR`

- sets anchor position from explicit coordinates or current position
- updates authoritative `anchor_position`

### `SetAnchorRequest`

Used as request `data` when `type=SET_ANCHOR`.

```json
{
  "lat": 54.3201,
  "lon": 10.1402
}
```

Fields:

- `lat`: anchor latitude in WGS84 decimal degrees, optional if the server should use current position
- `lon`: anchor longitude in WGS84 decimal degrees, optional if the server should use current position

Rules:

- if `lat` is present, `lon` must also be present
- if both `lat` and `lon` are omitted, the server uses current position
- if the server cannot resolve a valid position, the request fails

`MOVE_ANCHOR`

- replaces `anchor_position`

### `MoveAnchorRequest`

Used as request `data` when `type=MOVE_ANCHOR`.

```json
{
  "lat": 54.3201,
  "lon": 10.1402
}
```

Fields:

- `lat`: new anchor latitude in WGS84 decimal degrees
- `lon`: new anchor longitude in WGS84 decimal degrees

Rules:

- both `lat` and `lon` are required

`RAISE_ANCHOR`

- clears/deactivates anchored state

`SILENCE_ALARM`

- updates `alarm_state`

### `SilenceAlarmRequest`

Used as request `data` when `type=SILENCE_ALARM`.

```json
{
  "alert_type": "WIND_ABOVE"
}
```

Fields:

- `alert_type`: `AlertType` enum value

Rule:

- the server applies that alert type's configured `default_silence_ms`

`UNSILENCE_ALARM`

- updates `alarm_state`

### `UnsilenceAlarmRequest`

Used as request `data` when `type=UNSILENCE_ALARM`.

```json
{
  "alert_type": "WIND_ABOVE"
}
```

Fields:

- `alert_type`: `AlertType` enum value

`UPDATE_CONFIG_ALARM`

- replaces `CONFIG_ALARM`
- request `data` is the full alarm config DTO

`UPDATE_CONFIG_OBSTACLES`

- replaces `CONFIG_OBSTACLES`
- request `data` is the full obstacles config DTO

`UPDATE_CONFIG_ANCHOR_SETTINGS`

- replaces `CONFIG_ANCHOR_SETTINGS`
- request `data` is the full anchor settings DTO

`UPDATE_CONFIG_PROFILES`

- replaces `CONFIG_PROFILES`
- request `data` is the full profiles DTO

`UPDATE_CONFIG_SYSTEM`

- replaces `CONFIG_SYSTEM`
- request `data` is the full system config DTO

`UPDATE_CONFIG_WLAN`

- replaces `CONFIG_WLAN`
- request `data` is the full WLAN config DTO

`AUTHORIZE_BLE_SESSION`

- authorizes the current BLE session using the current `ble_connection_pin`
- used after the boat is already in `LOCAL_READY` or `CLOUD_READY`
- required before protected BLE functionality on an unauthorized session

`SET_INITIAL_BLE_PIN`

- valid only while the boat is still in `SETUP_REQUIRED`
- stores the first real per-boat BLE control pin
- moves the boat into `LOCAL_READY`
- authorizes the current BLE session on success

`UPDATE_CLOUD_CREDENTIALS`

- updates cloud identity/config after local BLE setup already works
- request `data` contains the current `CONFIG_CLOUD.version`, the desired `boat_id`, and the current `cloud_secret`
- the server persists the new values atomically
- on success the server increments `CONFIG_CLOUD.version` and publishes the new readable `CONFIG_CLOUD`
- this request is typically used from the WLAN/cloud-management flow, not from first setup

`UPDATE_BLE_PIN`

- rotates the current `ble_connection_pin`
- request `data` contains the current `old_ble_connection_pin` and the desired `new_ble_connection_pin`
- the server persists the new BLE pin atomically
- existing BLE-authorized sessions must reauthorize after success

For every `UPDATE_CONFIG_*` request:

- `data` contains exactly one full config DTO
- that DTO includes its own `version`
- the server accepts the write only if the supplied version matches the current authoritative version
- after success, the server increments the stored version and publishes the new config DTO

### `UpdateCloudCredentialsRequest`

Used as request `data` when `type=UPDATE_CLOUD_CREDENTIALS`.

```json
{
  "version": 4,
  "boat_id": "BOAT_123",
  "cloud_secret": "replace_me"
}
```

Fields:

- `version`: current `CONFIG_CLOUD.version`
- `boat_id`: desired cloud routing identifier for this boat
- `cloud_secret`: cloud relay credential

Rules:

- both `boat_id` and `cloud_secret` are required and must be non-empty
- the server accepts the write only if `version` matches the current authoritative `CONFIG_CLOUD.version`
- successful writes increment the stored cloud config version
- the server publishes the updated readable `CONFIG_CLOUD` value after success

### `AuthorizeSetupRequest`

Used as request `data` when `type=AUTHORIZE_SETUP`.

```json
{
  "factory_setup_pin": "123456"
}
```

Fields:

- `factory_setup_pin`: shared BLE-only setup credential used only while the boat is still in setup state

Rules:

- this request is BLE-only
- this request is valid only while the boat is in `SETUP_REQUIRED`
- success authorizes the current BLE setup session
- the shared factory setup PIN must never be accepted by the cloud relay for normal runtime access
- after the boat has left `SETUP_REQUIRED`, this request must fail with `type: "ERROR"` and `data.code = "INVALID_STATE"`

### `AuthorizeBleSessionRequest`

Used as request `data` when `type=AUTHORIZE_BLE_SESSION`.

```json
{
  "ble_connection_pin": "1234"
}
```

Fields:

- `ble_connection_pin`: current BLE control pin

Rules:

- this request authorizes the current BLE session
- it is valid only when the boat is already in `LOCAL_READY` or `CLOUD_READY`
- the server must never echo the supplied pin back in any reply

### `SetInitialBlePinRequest`

Used as request `data` when `type=SET_INITIAL_BLE_PIN`.

```json
{
  "ble_connection_pin": "1234"
}
```

Fields:

- `ble_connection_pin`: first real per-boat BLE control pin

Rules:

- this request is valid only while the boat is still in `SETUP_REQUIRED`
- this request is BLE-only
- it requires prior `AUTHORIZE_SETUP`
- on success the boat becomes `LOCAL_READY`
- the current BLE session becomes authorized
- after the boat has left `SETUP_REQUIRED`, this request must fail with `type: "ERROR"` and `data.code = "INVALID_STATE"`

### `UpdateBlePinRequest`

Used as request `data` when `type=UPDATE_BLE_PIN`.

```json
{
  "old_ble_connection_pin": "old-pin",
  "new_ble_connection_pin": "new-pin"
}
```

Fields:

- `old_ble_connection_pin`: current BLE control pin
- `new_ble_connection_pin`: desired replacement BLE control pin

Rules:

- this request is valid only on an already authorized BLE session
- both pin values are required and must be non-empty
- the supplied `old_ble_connection_pin` must match the current authoritative BLE control pin
- existing BLE-authorized sessions must be invalidated after success

Example:

```json
{
  "req_id": "01HZXJ0Q8J72E9K4N5P6R7S8TA",
  "type": "UPDATE_CONFIG_PROFILES",
  "data": {
    "version": 8,
    "mode": "auto",
    "day": {
      "color_scheme": "full",
      "brightness_pct": 100,
      "output_profile": "normal"
    },
    "night": {
      "color_scheme": "red",
      "brightness_pct": 20,
      "output_profile": "night"
    },
    "auto_switch": {
      "source": "time",
      "day_start_local": "07:00",
      "night_start_local": "22:00"
    }
  }
}
```

## Onboarding Types

`SCAN_WLAN`

- streaming request
- BLE-only request
- valid only after local setup, on an already authorized BLE session
- emits one discovered network at a time as `type: "WLAN_NETWORK"`
- ends with `type: "ACK"` and `state: "CLOSED_OK"` when the scan is complete
- the app shows incremental results while the request is open
- if the app leaves the scan view early, it cancels the request with `CANCEL`
- only one active `SCAN_WLAN` operation is allowed on the server at a time
- if another scan is already active, the new request fails with `type: "ERROR"` and `state: "CLOSED_FAILED"`
- `SCAN_WLAN` is not part of the factory setup step
- there is no `CONNECT_WLAN` request in v2; the app updates `CONFIG_WLAN` with `UPDATE_CONFIG_WLAN` and watches `STATE_WLAN_STATUS` plus `CONFIG_WLAN` on `GET_DATA` to observe connection progress and failure state

Example request and replies:

```json
{ "req_id": "01HZXJ0Q8J72E9K4N5P6R7S8TB", "type": "SCAN_WLAN", "data": {} }
{
  "req_id": "01HZXJ0Q8J72E9K4N5P6R7S8TB",
  "state": "ONGOING",
  "type": "WLAN_NETWORK",
  "data": { "ssid": "Marina", "security": "wpa2", "rssi": -63, "channel": 11, "hidden": false }
}
{
  "req_id": "01HZXJ0Q8J72E9K4N5P6R7S8TB",
  "state": "ONGOING",
  "type": "WLAN_NETWORK",
  "data": { "ssid": "HarborGuest", "security": "open", "rssi": -78, "channel": 1, "hidden": false }
}
{ "req_id": "01HZXJ0Q8J72E9K4N5P6R7S8TB", "state": "CLOSED_OK", "type": "ACK", "data": {} }
```

## Cancellation

Clients cancel an active request with a new request:

```json
{
  "req_id": "01HZXJ0Q8J72E9K4N5P6R7S8TD",
  "type": "CANCEL",
  "data": {
    "original_req_id": "01HZXJ0Q8J72E9K4N5P6R7S8TC"
  }
}
```

Rules:

1. `CANCEL` has its own `req_id`.
2. If the target request is active and cancelable, the original request closes with `type: "ERROR"`, `state: "CLOSED_FAILED"`, and `data.code = "CANCELED"`.
3. The `CANCEL` request itself always receives a terminal reply.
4. On successful cancellation, the `CANCEL` request closes with `type: "ACK"` and `state: "CLOSED_OK"`.
5. Unknown, already-closed, or non-cancelable targets return `type: "ERROR"` with `CLOSED_FAILED` on the `CANCEL` request.

## BLE Notes

BLE still uses the existing GATT UUIDs:

- service: `9f2d0000-87aa-4f4a-a0ea-4d5d4f415354`
- `control_tx`: `9f2d0001-87aa-4f4a-a0ea-4d5d4f415354`
- `event_rx`: `9f2d0002-87aa-4f4a-a0ea-4d5d4f415354`
- `snapshot`: `9f2d0003-87aa-4f4a-a0ea-4d5d4f415354`
- `auth`: `9f2d0004-87aa-4f4a-a0ea-4d5d4f415354`

Transport framing is still BLE-chunked at the characteristic level, but the logical message payload is always the v2 JSON envelope above.

The `auth` characteristic remains a separate pair/setup state channel. It is not a second business protocol.

Access model notes:

- a shared factory setup PIN may be used only for BLE-local setup authorization while the boat is still in `SETUP_REQUIRED`
- after setup is complete, normal BLE session authorization uses `AUTHORIZE_BLE_SESSION` with the current `ble_connection_pin`
- the shared factory setup PIN must never unlock normal runtime functionality by itself

## Cloud Relay Notes

The Cloudflare worker:

- authenticates cloud socket establishment
- routes cloud sockets by `boat_id`
- uses one durable object per `boat_id`
- forwards v2 protocol payloads between app and server cloud sockets
- preserves separate cloud request/reply sessions for each connected app

The relay does not:

- understand business request types
- understand business reply types
- emit protocol-local business messages
- store or derive runtime state
- merge config or track data
- create boats implicitly
- collapse multiple app cloud sessions into one shared request lifecycle

Cloud identity and routing notes:

- `boat_id` is a non-secret cloud routing key
- only explicitly created boats are allowed to use the relay
- cloud transport establishment does not rely on `boat_id` or `cloud_secret` being present in relay-routed runtime messages
- a local write request such as `UPDATE_CLOUD_CREDENTIALS` may carry `boat_id` and `cloud_secret` between app and server, but the relay must treat them as opaque business payloads
- app and server each obtain a short-lived WebSocket ticket before opening the cloud socket
- the relay validates the ticket, resolves the authorized `boat_id`, and then attaches the socket to that boat's durable object
- app-side ticket issuance is authorized from the logged-in user's access to the boat
- server-side ticket issuance is authorized from a boat-scoped server credential such as `cloud_secret`
- the shared factory setup PIN must never be accepted for normal runtime `ws-ticket` issuance

Cloud session-isolation notes:

- each app cloud socket is its own independent request/reply session to the server
- if two apps are connected to the same boat over cloud, each app can have its own in-flight requests and its own `GET_DATA` stream
- duplicated streamed data across multiple app sessions is acceptable for now
- the relay must preserve which cloud reply belongs to which app session
- to do that, the relay may use a minimal cloud-transport envelope carrying a relay-scoped connection identifier such as `cloud_conn_id`
- that cloud-transport envelope is outside the v2 business protocol and must not change the inner request/reply payloads

Long-term control-plane direction:

- users authenticate to the product with OAuth
- logged-in users explicitly create boats
- only explicitly created boats are allowed to use the relay
- app-side cloud access is authorized from the user session plus boat membership/access rights
- server-side cloud access is authorized with a boat-scoped server credential such as `cloud_secret`
- app and server both obtain WebSocket tickets over normal HTTPS endpoints instead of relying on custom WebSocket auth headers from the browser
