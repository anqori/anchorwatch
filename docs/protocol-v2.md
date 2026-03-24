# Anqori AnchorWatch Protocol v2

Status: active  
Date: 2026-03-24

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
- `SET_ANCHOR`
- `MOVE_ANCHOR`
- `RAISE_ANCHOR`
- `SILENCE_ALARM`
- `UNSILENCE_ALARM`
- `UPDATE_CONFIG_ALARM`
- `UPDATE_CONFIG_ANCHOR_SETTINGS`
- `UPDATE_CONFIG_PROFILES`
- `UPDATE_CONFIG_WLAN`
- `CANCEL`

Onboarding types:

- `SCAN_WLAN`

## Reply Type Catalog

Runtime/config reply types:

- `STATE_POSITION`
- `STATE_ANCHOR_POSITION`
- `STATE_DEPTH`
- `STATE_WIND`
- `STATE_WLAN_STATUS`
- `STATE_BLE_STATUS`
- `STATE_SYSTEM_STATUS`
- `STATE_ALARM_STATE`
- `CONFIG_ALARM`
- `CONFIG_ANCHOR_SETTINGS`
- `CONFIG_PROFILES`
- `CONFIG_WLAN`

Other reply types:

- `TRACK_BACKFILL`
- `WLAN_NETWORK`
- `ACK`
- `ERROR`

## `GET_DATA`

`GET_DATA` is the single runtime stream.

Rules:

1. Client sends one `GET_DATA` after connect.
2. Server responds with a bootstrap sequence of `ONGOING` replies using the same `req_id`.
3. Each bootstrap reply carries one current payload and uses a reply `type` that matches that payload shape, for example `STATE_POSITION`, `STATE_WIND`, `STATE_ANCHOR_POSITION`, or `TRACK_BACKFILL`.
4. There is no dedicated snapshot container required by the protocol.
5. The server should send the current known state/config values needed by the client and then any retained track backfill for the backfill window.
6. Backfill starts at `min(last_anchor_down_ts, now - 30 minutes)`.
7. If no anchor-down timestamp exists, backfill starts at `now - 30 minutes`.
8. The server may split retained track backfill across multiple `TRACK_BACKFILL` replies.
9. After bootstrap, the same request stays open and later replies continue streaming whole-value replacements and `TRACK_BACKFILL` messages.
10. The request stays open until cancel, disconnect, or terminal error.

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
{ "req_id": "01HZXJ0Q8J72E9K4N5P6R7S8T9", "state": "ONGOING", "type": "STATE_BLE_STATUS", "data": { "pair_mode_active": false, "pair_mode_until_ts": null } }
{ "req_id": "01HZXJ0Q8J72E9K4N5P6R7S8T9", "state": "ONGOING", "type": "STATE_ANCHOR_POSITION", "data": { "state": "down", "lat": 54.3201, "lon": 10.1402 } }
{ "req_id": "01HZXJ0Q8J72E9K4N5P6R7S8T9", "state": "ONGOING", "type": "TRACK_BACKFILL", "data": [ { "ts": 1770897600000, "lat": 54.3201, "lon": 10.1402, "cog_deg": 192.3, "heading_deg": 188.0, "sog_kn": 0.42, "depth_m": 3.1, "wind_kn": 14.8, "wind_dir_deg": 205.0 } ] }
```

`STATE_BLE_STATUS` is transport-specific:

- it is relevant on local BLE connections
- it may be omitted on cloud-only connections

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
- `CONFIG_ANCHOR_SETTINGS`
- `CONFIG_PROFILES`
- `CONFIG_WLAN`

Config DTOs carry a monotonic `version` field inside `data`.

Version matching is only used for app-to-server config writes:

- the app sends the full config DTO directly in `data`, including its current `version`
- the app uses one matching `UPDATE_CONFIG_*` request per config DTO
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

### `BleStatusValue`

Used as `data` when `type=STATE_BLE_STATUS`.

```json
{
  "pair_mode_active": false,
  "pair_mode_until_ts": null
}
```

Fields:

- `pair_mode_active`: whether local BLE pair mode is active
- `pair_mode_until_ts`: epoch-millisecond timestamp when local BLE pair mode ends, or `null` when pair mode is inactive

Notes:

- `STATE_BLE_STATUS` is specific to local BLE transport visibility
- it is separate from `STATE_SYSTEM_STATUS`
- it does not describe a privileged session state

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
  "alert_type": "WIND_STRENGTH",
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
- `BOATING_AREA`
- `WIND_STRENGTH`
- `DEPTH`
- `DATA_OUTDATED`

### `AlarmStateValue`

Used as `data` when `type=STATE_ALARM_STATE`.

```json
{
  "alerts": [
    {
      "alert_type": "WIND_STRENGTH",
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
- silence and output are tracked per alert, not globally
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

### App-defined config payloads

These config payloads are intentionally whole-value and application-defined in the current version:

- `alarm_config`
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
  "alert_type": "WIND_STRENGTH"
}
```

Fields:

- `alert_type`: `AlertType` enum value

`UNSILENCE_ALARM`

- updates `alarm_state`

### `UnsilenceAlarmRequest`

Used as request `data` when `type=UNSILENCE_ALARM`.

```json
{
  "alert_type": "WIND_STRENGTH"
}
```

Fields:

- `alert_type`: `AlertType` enum value

`UPDATE_CONFIG_ALARM`

- replaces `CONFIG_ALARM`
- request `data` is the full alarm config DTO

`UPDATE_CONFIG_ANCHOR_SETTINGS`

- replaces `CONFIG_ANCHOR_SETTINGS`
- request `data` is the full anchor settings DTO

`UPDATE_CONFIG_PROFILES`

- replaces `CONFIG_PROFILES`
- request `data` is the full profiles DTO

`UPDATE_CONFIG_WLAN`

- replaces `CONFIG_WLAN`
- request `data` is the full WLAN config DTO

For every `UPDATE_CONFIG_*` request:

- `data` contains exactly one full config DTO
- that DTO includes its own `version`
- the server accepts the write only if the supplied version matches the current authoritative version
- after success, the server increments the stored version and publishes the new config DTO

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
- emits one discovered network at a time as `type: "WLAN_NETWORK"`
- ends with `type: "ACK"` and `state: "CLOSED_OK"` when the scan is complete
- the app shows incremental results while the request is open
- if the app leaves the scan view early, it cancels the request with `CANCEL`
- only one active `SCAN_WLAN` operation is allowed on the server at a time
- if another scan is already active, the new request fails with `type: "ERROR"` and `state: "CLOSED_FAILED"`
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

The `auth` characteristic remains a separate pair/session state channel. It is not a second business protocol.

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
- the normal v2 message envelope does not carry `boat_id` or cloud secrets
- app and server each obtain a short-lived WebSocket ticket before opening the cloud socket
- the relay validates the ticket, resolves the authorized `boat_id`, and then attaches the socket to that boat's durable object
- app-side ticket issuance is authorized from the logged-in user's access to the boat
- server-side ticket issuance is authorized from a boat-scoped server credential such as `boat_secret`

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
- server-side cloud access is authorized with a boat-scoped server credential such as `boat_secret`
- app and server both obtain WebSocket tickets over normal HTTPS endpoints instead of relying on custom WebSocket auth headers from the browser
