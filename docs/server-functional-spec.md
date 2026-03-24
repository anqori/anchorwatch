# Server Functional Spec

Status: active  
Date: 2026-03-25  
Related wire contract: [`docs/protocol-v2.md`](/home/pm/dev/anchormaster/docs/protocol-v2.md)  
Related access lifecycle: [`docs/access-and-provisioning.md`](/home/pm/dev/anchormaster/docs/access-and-provisioning.md)

## Purpose

Define what the AnchorWatch server must do functionally, independent of whether it runs on:

- the hardware device, or
- a mini-Android helper app acting as the device runtime

This is a behavior spec, not an implementation spec.

This spec is the shared conformance target for both server implementations:

- firmware
- Android app helper/device runtime

Later, both implementations should satisfy the same externally visible behavior defined here, even if their internal architecture differs.

## System Context

The server is the single authoritative runtime for one boat.

Topology:

`server <-> BLE and/or WLAN->cloud relay <-> AnchorWatch PWA`

Key boundary:

- the server owns state, config, command execution, track history, and alarm behavior
- the cloud relay only authenticates sockets and forwards opaque messages
- the app renders UI and sends commands, but is never authoritative

For product purposes, "the server" means one role with two possible implementations:

- firmware implementation
- Android app implementation

They must present the same functional behavior to clients.

## Core Responsibilities

The server must:

- maintain authoritative runtime state for the boat
- maintain authoritative persisted configuration for the boat
- expose the same logical API over BLE and cloud-connected transport
- support multiple simultaneous client connections on both transports
- stream a consistent current view of state/config to all subscribed clients
- execute control and onboarding request types
- retain recent state history for initial backfill and alarm/runtime analysis
- continuously evaluate alarm state
- maintain authoritative alarm runtime state
- signal raised alarms
- protect privileged operations behind the appropriate authentication or local pairing rules

The server must not:

- depend on relay-side state
- require transport-specific business logic
- expose patch semantics on the wire
- let clients become authoritative for current state

## Authoritative Data Model

The server owns three classes of data.

### Runtime state

- `position`
  - latest GPS position and motion-derived values
- `anchor_position`
  - current anchor state and authoritative anchor location
- `depth`
  - latest depth sample
- `wind`
  - latest wind sample
- `wlan_status`
  - WLAN connection phase, connection result, selected SSID, signal strength, and related WLAN runtime details
- `system_status`
  - cloud reachability, build/version, and other non-anchor runtime metadata needed by the app
- `alarm_state`
  - active per-alert runtime data as an iterable alert array with explicit `alert_type` enum values in `UPPER_SNAKE_CASE`, including per-alert severities, per-alert silence state, and other alert runtime data

### App-writable config

- `alarm_config`
  - per-alert alarm settings using a common alert envelope with `type`, `enabled`, `min_time_ms`, `severity`, `default_silence_ms`, and alert-specific `data`
- `obstacles`
  - multiple obstacle polygons the boat must not enter, each tagged as `PERMANENT` or `TEMPORARY`
- `anchor_settings`
  - allowed region/range rules and other anchor-related settings
- `profiles`
  - profile/runtime preference groups the app can edit as a whole value
- `system_config`
  - global server runtime mode settings such as `LIVE` versus `SIMULATION`
- `wlan_config`
  - stored WLAN target and connection settings
- `cloud_config`
  - readable cloud identity metadata such as `boat_id` and whether a cloud server credential is configured; the credential itself is write-only and must never be emitted back to clients

### History

- retained state history for:
  - position
  - depth
  - wind
- last anchor-down timestamp
- any persisted runtime markers needed to build `GET_DATA` backfill correctly

Retention rule:

- the server must retain at least the last 30 minutes of position/depth/wind history
- if the last anchor-down timestamp is older than 30 minutes ago, the server must retain history back to that last anchor-down timestamp instead
- equivalently, the retained history window starts at `min(last_anchor_down_ts, now - 30 minutes)`

Each app-writable config DTO must have its own monotonic version carried inside the DTO. Runtime state is always server-authoritative and does not use app-visible compare-and-swap versioning.

## Connection Model

The server must support:

- zero, one, or many BLE clients at the same time
- zero, one, or many cloud-connected clients at the same time
- both transports active at the same time

Rules:

- requests are scoped to the connection they arrive on
- `req_id` correlation is per request
- one connection may hold independent in-flight requests
- long-lived requests are connection-scoped and must be cleaned up on disconnect

At minimum, per connection:

- at most one active `GET_DATA` stream

If a client wants a replacement stream, it should cancel the old one first.

Server-wide:

- at most one active `SCAN_WLAN` operation

## Access Model

The current access-control model is:

- shared BLE-only `factory_setup_pin` for first provisioning
- per-boat `ble_connection_pin` for normal BLE access
- per-boat `cloud_secret` for cloud relay access

The server must support these boat states:

- `SETUP_REQUIRED`
- `LOCAL_READY`
- `CLOUD_READY`

Rules:

- while the boat is in `SETUP_REQUIRED`, normal boat functionality must remain blocked
- the shared factory setup PIN must be accepted only for local BLE setup authorization
- once the boat has left `SETUP_REQUIRED`, setup requests using the factory setup PIN must fail with `INVALID_STATE`
- after setup is complete, the boat must use the per-boat `ble_connection_pin` for normal BLE session authorization
- cloud relay authentication must use the per-boat `cloud_secret`
- the server must never reveal the factory setup PIN back to clients
- the server may reveal `cloud_secret` only to an already authorized BLE session

The server must support these session states:

- `UNAUTHORIZED`
- `AUTHORIZED`

Rules:

- authorization is session-scoped
- existing authorized BLE sessions should be invalidated when the `ble_connection_pin` changes
- after BLE pin rotation, existing BLE sessions must reauthorize with the new pin

## Protocol Handling

The server must accept and emit the v2 envelope defined in [`docs/protocol-v2.md`](/home/pm/dev/anchormaster/docs/protocol-v2.md):

- request: `{ req_id, type, data }`
- reply: `{ req_id, state, type, data }`

Reply lifecycle:

- `ONGOING`
- `CLOSED_OK`
- `CLOSED_FAILED`

General rules:

- every request must receive at least one reply unless the transport disconnects first
- every reply echoes the original `req_id`
- reply `type` identifies the payload shape of that reply
- reply `type` may differ from the request `type`
- a streamed request may emit different reply `type` values on the same `req_id`
- terminal failures use `type: "ERROR"` and put the structured error object directly in `data`
- `CANCEL` is a normal request and must also receive its own terminal reply
- request-type semantics must be the same over BLE and cloud

## Functional Behavior

### 1. Runtime data consumption

The server may consume runtime data from one or more input providers.

This input layer is implementation-specific and may evolve over time, but it must feed the same authoritative runtime state model.

Current and planned input expectations:

- firmware implementation:
  - should use NMEA2000 input for position, depth, and wind
  - may later support SignalK as an alternative input source for position, depth, and wind
- Android app implementation:
  - should use local device GPS for position
  - may later support a SignalK server as an additional runtime source

Input-source rules:

- runtime inputs are optional at the provider level, but the resulting server behavior must remain consistent
- an implementation may have only a subset of providers available
- unavailable inputs must result in missing/stale runtime values rather than invented data
- the app-facing protocol and authoritative state model must stay the same regardless of the active provider set

### 1a. Shared simulation mode

Both server implementations must support a shared simulation mode controlled by `CONFIG_SYSTEM.runtime_mode`.

When `runtime_mode = SIMULATION`, the server must synthesize runtime data with these shared semantics:

- simulation clock starts at `2025-08-01T15:00:00Z`
- simulation center coordinate is `lat = 54.38329`, `lon = 10.16349`
- simulated position follows a random walk constrained to a 200 meter radius around that center
- simulated depth is `5.0 m` at the center and decreases linearly to `1.5 m` at the edge of that 200 meter circle
- simulated wind follows a slow random walk with a maximum change rate of:
  - `5 kn` per minute
  - `20 deg` per minute

These semantics must match for both:

- firmware
- Android app helper/device runtime

When `runtime_mode = LIVE`, the server must use real input providers only.

Live-mode rule:

- until a trustworthy GPS/GNSS-derived timestamp is available, the server must not produce authoritative timestamped position/depth/wind runtime samples, retain runtime history from them, or evaluate alarms from them
- config handling, WLAN handling, and other non-telemetry control behavior may still function before live time is available

### 2. Runtime data production

The server must continuously produce an internal authoritative runtime view from:

- GPS and motion inputs
- depth inputs
- wind inputs
- WLAN/cloud connectivity state
- anchor control state
- alarm evaluation results

When authoritative runtime state changes meaningfully, the server must:

- replace the full affected value internally
- push the new full value to every active `GET_DATA` stream
- append the corresponding historical sample to the retained state-history window when relevant

For WLAN behavior specifically, `wlan_status` must carry the connection phase and error state needed by the app after `CONNECT_WLAN` removal, including transitions such as:

- `DISCONNECTED`
- `CONNECTING`
- `AUTHENTICATING`
- `OBTAINING_IP`
- `CONNECTED`
- `FAILED`

### 3. Alarm evaluation and signaling

The server must continuously evaluate alarm conditions from the latest:

- runtime telemetry
- anchor state and position
- configuration thresholds and rules
- per-alert silence state

For `OBSTACLE_CLOSE` specifically, the server must evaluate the alert against:

- the configured obstacle polygons from `obstacles`
- the alert's configured `min_distance_m` from `alarm_config`

The server must do this even if no app is currently connected.

When alarm state changes, the server must:

- update the authoritative `alarm_state`
- push the new `alarm_state` to every active `GET_DATA` stream

When an alarm is raised, the server must signal it through the outputs available on that implementation.

Examples:

- firmware: siren, buzzer, LED, or other onboard outputs
- Android app implementation: local notification, sound, vibration, foreground alert, or equivalent app-side signaling

Signaling behavior must remain consistent with the authoritative `alarm_state`, including warning/full-alarm transitions and silence behavior.

Note:

- silence is a per-alert concern, not a global wrapper state
- output routing is not configurable through `alarm_config`; raised alerts are signaled on all outputs available on that implementation
- `alarm_state.alerts` is an array of alert entries, not a hash/map
- if a client wants an aggregate alarm summary, it derives that from the individual alert entries in `alarm_state`

### 4. `GET_DATA`

`GET_DATA` is the main runtime subscription.

When the server receives `GET_DATA`, it must:

- reject the request if the caller is not authorized for protected runtime access
  - unauthorized BLE sessions must not receive runtime/config data
  - boats still in `SETUP_REQUIRED` must not expose runtime/config data
- open a long-lived request for that connection
- reply with a bootstrap sequence of `ONGOING` messages on the same `req_id`
- send current known state/config values as typed replies such as `STATE_POSITION`, `STATE_WIND`, `STATE_ANCHOR_POSITION`, `CONFIG_ALARM`, `CONFIG_OBSTACLES`, or `CONFIG_SYSTEM`
- include config DTO versions inside the `data` payload of `CONFIG_*` replies
- send retained track backfill as one or more `TRACK_BACKFILL` replies
- not require a dedicated snapshot payload shape
- keep the request open after bootstrap
- stream future whole-value replacements and track backfill messages on the same request

For authorized BLE sessions specifically, the bootstrap may additionally include `CONFIG_CLOUD`.

Track backfill rule:

- start at `min(last_anchor_down_ts, now - 30 minutes)`
- if no anchor-down timestamp exists, start at `now - 30 minutes`

The server must derive this backfill from its retained historical state window.
When retained depth or wind samples are available for a backfilled track point timestamp, the server should include them on that same track point.

The server must broadcast updates from one mutation to all active `GET_DATA` streams, not just the requester.

### 5. `SET_ANCHOR`

The server must:

- accept either explicit coordinates or a valid current position
- treat explicit coordinates as `data.lat` and `data.lon` when provided
- set the authoritative anchor location
- transition anchor state to anchored/down
- persist the anchor-down timestamp
- update authoritative `anchor_position` state
- emit any related runtime updates to active streams

### 6. `MOVE_ANCHOR`

The server must:

- validate the requested location
- require `data.lat` and `data.lon`
- replace the authoritative anchor location
- update authoritative `anchor_position` state
- emit related stream updates

### 7. `RAISE_ANCHOR`

The server must:

- clear or deactivate the anchored state
- clear the authoritative anchor position if the chosen product rule requires it
- update authoritative `anchor_position` state
- emit related stream updates

### 8. `SILENCE_ALARM`

The server must:

- validate the requested silence action
- require `data.alert_type`
- apply that alert type's configured `default_silence_ms`
- update the authoritative `alarm_state`
- emit the new `alarm_state` to active streams

### 9. `UNSILENCE_ALARM`

The server must:

- validate the requested unsilence action
- require `data.alert_type`
- update the authoritative `alarm_state`
- emit the new `alarm_state` to active streams

### 10. `UPDATE_CONFIG_*`

The server must expose separate single-payload config update requests:

- `UPDATE_CONFIG_ALARM`
- `UPDATE_CONFIG_OBSTACLES`
- `UPDATE_CONFIG_ANCHOR_SETTINGS`
- `UPDATE_CONFIG_PROFILES`
- `UPDATE_CONFIG_SYSTEM`
- `UPDATE_CONFIG_WLAN`

For every `UPDATE_CONFIG_*` request, the server must:

- accept exactly one full config DTO in request `data`
- validate that request against the matching config domain only
- apply whole-value replacement only
- reject payloads that do not match the request type
- require the supplied config DTO to include its current `version`
- accept the config write only if the supplied version matches the current authoritative version
- increment the version only after a successful write
- emit the updated config value to all active streams

Each `UPDATE_CONFIG_*` request is all-or-nothing:

- if validation fails, no change is applied
- if the supplied config version mismatches, no change is applied

`AUTHORIZE_SETUP` is the BLE-only setup authorization step.

For `AUTHORIZE_SETUP`, the server must:

- accept it only while the boat is in `SETUP_REQUIRED`
- accept it only over BLE/local setup transport
- validate the supplied shared factory setup PIN
- mark the current BLE setup session as authorized for setup-only operations
- reject it with `INVALID_STATE` once the boat has already left `SETUP_REQUIRED`

`AUTHORIZE_BLE_SESSION` is the normal BLE session-authorization step.

For `AUTHORIZE_BLE_SESSION`, the server must:

- accept it only over BLE
- accept it only while the boat is in `LOCAL_READY` or `CLOUD_READY`
- validate the supplied `ble_connection_pin`
- mark the current BLE session as authorized for protected operations

`SET_INITIAL_BLE_PIN` is the first local activation step.

For `SET_INITIAL_BLE_PIN`, the server must:

- accept it only while the boat is in `SETUP_REQUIRED`
- accept it only over BLE
- require that the current BLE setup session is already setup-authorized
- parse `ble_connection_pin` from request `data`
- require it to be non-empty
- persist the new BLE pin atomically
- move the boat from `SETUP_REQUIRED` to `LOCAL_READY`
- mark the current BLE session as authorized
- reject it with `INVALID_STATE` once the boat has already left `SETUP_REQUIRED`

`UPDATE_CLOUD_CREDENTIALS` is the cloud identity/config update step.

For `UPDATE_CLOUD_CREDENTIALS`, the server must:

- parse `version`, `boat_id`, and `cloud_secret` from request `data`
- require non-empty `boat_id` and `cloud_secret`
- require that the current BLE session is already authorized
- reject the request without side effects if the supplied version mismatches the current authoritative `cloud_config.version`
- persist the new `boat_id` and `cloud_secret` atomically
- move the boat to `CLOUD_READY`
- increment `cloud_config.version` only after a successful write
- emit the updated readable `CONFIG_CLOUD` value to authorized BLE sessions

This request belongs to the later WLAN/cloud-management flow, not to the first factory onboarding step.

`UPDATE_BLE_PIN` is the local BLE pin rotation step.

For `UPDATE_BLE_PIN`, the server must:

- accept it only while the boat is in `LOCAL_READY` or `CLOUD_READY`
- require that the current BLE session is already authorized
- parse `old_ble_connection_pin` and `new_ble_connection_pin` from request `data`
- require both pin values to be non-empty
- reject the request without side effects if `old_ble_connection_pin` does not match the current authoritative BLE pin
- persist the new BLE pin atomically
- invalidate existing authorized BLE sessions so they must reauthorize with the new pin

Rules:

- `cloud_secret` may appear only in `CONFIG_CLOUD` replies to an already authorized BLE session
- `cloud_secret` must never appear in `GET_DATA` replies sent over cloud transport
- `ble_connection_pin` must never appear in replies

### 11. `SCAN_WLAN`

The server must:

- accept it only over BLE
- require that the current BLE session is already authorized
- reject it while the boat is still in `SETUP_REQUIRED`
- perform a WLAN scan on the local device
- open a streamed request on the caller's `req_id`
- emit one discovered network at a time as `type: "WLAN_NETWORK"`
- include enough metadata for UI selection:
  - SSID
  - security type
  - RSSI when available
  - channel when available
  - hidden flag
- end the request with `type: "ACK"` and `state: "CLOSED_OK"` when the scan is complete
- allow the client to cancel the scan with `CANCEL` if it no longer needs results
- reject a new `SCAN_WLAN` request with `CLOSED_FAILED` if another scan is already active on the server

Implementation-specific rule:

- Android app implementation may treat `SCAN_WLAN` as a no-op and immediately close it with `type: "ACK"` and `state: "CLOSED_OK"` without emitting any `WLAN_NETWORK` replies

There is no `CONNECT_WLAN` request in v2. The app updates `wlan_config` with `UPDATE_CONFIG_WLAN` and observes WLAN behavior through normal runtime/config values such as `STATE_WLAN_STATUS` and `CONFIG_WLAN`. `STATE_WLAN_STATUS` must therefore expose the WLAN runtime phase and error state that the removed dedicated progress stream used to carry.

### 12. `CANCEL`

The server must let clients cancel active requests using a separate cancel request.

When a valid cancel arrives:

- the original request must be closed deterministically
- the original request must end with `CLOSED_FAILED`
- the original request must use `type: "ERROR"` with an error code such as `CANCELED` in `data.code`
- the cancel request itself must also receive a terminal reply
- the cancel request itself must end with `type: "ACK"` and `CLOSED_OK`

If the target request is unknown, already closed, or not cancelable:

- the cancel request must end with `type: "ERROR"` and `CLOSED_FAILED`

## Config Write Versioning

Version matching exists only for app-to-server config updates.

Rules:

- the app reads config DTOs that include their current `version`
- when the app sends an `UPDATE_CONFIG_*` request, it sends back the same full config DTO with its version
- the server compares each supplied config DTO version against the current authoritative version
- if any supplied config DTO version is stale, the request must fail with conflict
- failed version checks must not partially apply the request

Successful `UPDATE_CONFIG_*` requests must:

- update authoritative config values
- increment affected config DTO versions
- broadcast resulting config DTO replacements to all active streams

## Persistence Requirements

The server must persist enough data to survive restarts without losing core behavior.

Required persistence:

- boat identity needed by the runtime
- persisted config values
- latest authoritative anchor state/location
- last anchor-down timestamp
- retained position/depth/wind history needed for `GET_DATA` backfill and related runtime behavior
- WLAN configuration needed for reconnect behavior

Persistence does not need to preserve every historical event forever. It only needs to preserve enough data to fulfill the functional requirements above.

## Authorization and Pairing

The server must distinguish between:

- transport connectivity
- read access
- privileged control access

Expected rules:

- cloud transport is authenticated before socket establishment, using short-lived WebSocket tickets
- local BLE onboarding/configuration requires explicit setup/session authorization rules
- privileged mutation and onboarding commands must be rejected when the caller lacks sufficient authorization

Cloud authorization direction:

- `boat_id` is the cloud routing key, not a secret
- the relay should route one durable object per `boat_id`
- only explicitly created boats are allowed to use the cloud relay
- user-authenticated apps should obtain cloud WebSocket tickets from the control plane based on boat membership/access rights
- the boat/server should obtain cloud WebSocket tickets using the current `cloud_secret`
- in the current pre-control-plane phase, firmware/server-side cloud credentials may be set locally through `UPDATE_CLOUD_CREDENTIALS`
- whenever an authorized BLE session is established, the server should make the current `CONFIG_CLOUD` value available so the app can refresh its stored cloud secret
- the shared factory setup PIN must never be accepted as a normal cloud runtime credential
- app and server cloud connections remain separate request/reply sessions even when they target the same boat
- duplicated streamed data across multiple app sessions is acceptable for now

The detailed ticket, credential, and rotation flow is a separate spec. This document only requires that privileged operations are enforceable and that cloud access can be authorized independently for apps and servers.

## Relay Interaction

The server must treat the cloud relay as an untrusted dumb pipe.

The server must not rely on the relay for:

- state storage
- config storage
- command execution
- replay
- fan-in merge logic
- special protocol control messages

If the relay disappears, the server remains the same authoritative runtime and local BLE operation continues.

## Out of Scope

This document does not define:

- UI behavior in the PWA
- exact BLE chunk framing details
- detailed credential rotation/recovery
- detailed NMEA2000 parsing internals
- exact siren hardware wiring behavior

Those belong in separate protocol, hardware, or implementation docs.

## Acceptance Criteria

The server functional spec is satisfied when all of the following are true:

- the same v2 commands work over BLE and cloud
- two or more clients can stay connected simultaneously
- all active `GET_DATA` streams see the same authoritative updates
- `GET_DATA` always starts with a bootstrap burst of replies on the same `req_id`, covering current state/config values and anchor-track backfill
- the server retains position/depth/wind history for the last 30 minutes or since the last anchor down, whichever window is longer
- whole-value replacement is used for state and config
- config version conflicts in `UPDATE_CONFIG_*` requests are rejected deterministically
- `SCAN_WLAN` streams discovered networks one entry at a time and ends explicitly with `ACK`
- a second `SCAN_WLAN` request fails while another scan is already active
- Android can satisfy `SCAN_WLAN` as a no-op `ACK`
- every request, including `CANCEL`, receives a reply unless the transport disconnects first
- request cancellation closes both the original request and the cancel request deterministically
- the relay can stay completely dumb without breaking product behavior
