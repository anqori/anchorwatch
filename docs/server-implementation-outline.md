# Server Implementation Outline

Status: active  
Date: 2026-03-24  
Related behavior spec: [`docs/server-functional-spec.md`](/home/pm/dev/anchormaster/docs/server-functional-spec.md)  
Related wire contract: [`docs/protocol-v2.md`](/home/pm/dev/anchormaster/docs/protocol-v2.md)

## Purpose

Define the shared implementation expectations for the server runtime.

This document does not require firmware and Android to use the same code structure. C/ESP and Kotlin/Android have different constraints and should be structured differently internally.

What must be shared is:

- the same authoritative state model
- the same request/response behavior
- the same ordering semantics
- the same persistence guarantees
- the same externally visible results

The goal is that both implementations are different internally but indistinguishable from the app's point of view.

## Non-Goals

This document does not define:

- class hierarchies
- threading primitives
- memory layout
- exact BLE framing internals
- exact cloud socket implementation details

Those are implementation choices.

## Core Rule

Both implementations must behave as if each boat is processed by one logical serialized executor.

That means:

- business mutations must have a deterministic order
- config writes must not interleave partially
- alarm evaluation must observe a coherent state/config snapshot
- publications to `GET_DATA` streams must reflect a coherent post-mutation state

Implementation examples:

- Android: one coroutine actor / serialized dispatcher / single-threaded state owner
- ESP: one main-loop event queue / single authoritative mutation pass

The mechanism may differ. The externally visible behavior must match.

## Shared Runtime Model

Each server instance owns exactly one boat runtime.

It should have these conceptual subsystems:

1. `transport_adapters`
   - BLE adapter
   - cloud adapter
   - both convert transport traffic into the same internal request/session events
2. `connection_registry`
   - tracks logical client connections
   - tracks active `GET_DATA` requests per connection
   - tracks cancelable in-flight requests
3. `state_store`
   - authoritative runtime state
   - `position`
   - `anchor_position`
   - `depth`
   - `wind`
   - `wlan_status`
   - `system_status`
   - `alarm_state`
4. `config_store`
   - authoritative persisted config
   - `alarm_config`
   - `obstacles`
   - `anchor_settings`
   - `profiles`
   - `wlan_config`
5. `history_store`
   - retained position/depth/wind history
   - last anchor-down timestamp
6. `command_handlers`
   - one handler per request type
7. `alarm_engine`
   - evaluates alerts from state + config
8. `publisher`
   - emits typed replies to active streams
9. `persistence_layer`
   - stores config and required retained state
10. `output_signaler`
   - siren / local notification / other implementation outputs

These are conceptual modules. Real code may combine or split them.

## Logical Connection Abstraction

The core server logic should not care whether a request arrived over BLE or cloud.

Both implementations should normalize transport input into a logical connection/session model:

- `connection_id`
- transport kind
- authorization level
- active requests by `req_id`

Requirements:

- BLE and cloud must reach the same command handlers
- request tracking must be per logical connection
- disconnect cleanup must be per logical connection
- transport-specific mechanics must stay in the adapters, not in business handlers

## Required Ordering Semantics

The server must produce results equivalent to this order:

1. accept one external event
2. validate and normalize it
3. mutate authoritative state/config if needed
4. update derived state
5. reevaluate alarms
6. persist required changes
7. publish resulting replies/stream updates
8. move to the next event

External events include:

- inbound client request
- request cancellation
- client disconnect
- sensor/input sample
- timer/tick event
- WLAN scan result

Two important rules:

- config writes are atomic from the app's point of view
- every published reply must correspond to a fully applied state transition, never a half-applied one

## Command Handling Expectations

Each request type should have its own handler with the same conceptual phases:

1. authorization
2. payload validation
3. lookup of required current state/config
4. mutation planning
5. commit
6. publish replies

Handlers must not:

- mutate transport state directly
- write partial config fragments outside the config store
- publish replies before the authoritative mutation is complete

## Config Update Expectations

For every `UPDATE_CONFIG_*` request:

1. parse the full DTO from `data`
2. validate the DTO only against its own config domain
3. compare the DTO's `version` with the current authoritative version
4. reject on mismatch without side effects
5. on success:
   - replace the full stored config value
   - increment the version
   - persist it
   - publish the new full config DTO

Important expectation:

- all successful config writes must become visible to every active `GET_DATA` stream in the same order

## Alarm Evaluation Expectations

Alarm evaluation should be a pure function of:

- authoritative runtime state
- authoritative config
- per-alert runtime timing/silence state

The implementation should treat it as a separate engine, even if it is not a separate module in code.

Minimum alert-specific expectations:

- `ANCHOR_DISTANCE`
  - uses current boat position, authoritative anchor position, and configured `max_distance_m`
- `OBSTACLE_CLOSE`
  - uses configured obstacle polygons from `obstacles`
  - uses configured `min_distance_m` from the matching alert config entry
- `WIND_ABOVE`
  - uses current wind and configured `max_wind_kn`
- `DEPTH_BELOW`
  - uses current depth and configured `min_depth_m`
- `DATA_OUTDATED`
  - uses sample freshness and configured `max_age_ms`

The engine must also handle:

- `enabled`
- `min_time_ms`
- `severity`
- `default_silence_ms`
- `alert_silenced_until_ts`

Expected evaluation lifecycle:

1. determine whether the raw condition is true
2. track threshold-crossing time
3. apply `min_time_ms`
4. apply silence state
5. produce the current `alarm_state`
6. trigger output signaling if required

## Output Signaling Expectations

Outputs are implementation-specific, but output policy is shared.

Shared expectations:

- output routing is not configurable in protocol/config
- raised alerts are signaled on all outputs available on that implementation
- silence suppresses signaling for that alert according to the runtime silence state
- warning/alarm transitions must stay consistent with published `alarm_state`

Examples:

- firmware: siren, buzzer, LED
- Android: local notification, sound, vibration

## History Expectations

History recording must happen as part of the same logical mutation flow as runtime updates.

Required behavior:

- keep position/depth/wind history for at least the last 30 minutes
- if last anchor-down is older, keep history back to that timestamp
- use the retained history for `GET_DATA` track bootstrap
- include depth/wind on track points when available for the same timestamp

Implementations may store history differently:

- Android: database, file, ring buffer, in-memory plus persistence
- ESP: bounded ring buffers with persistence of the required subset

The externally visible backfill behavior must match.

## Streaming Expectations

`GET_DATA` should be implemented through a dedicated stream manager.

It must:

- register the request on open
- emit the bootstrap burst
- keep the request open
- publish later state/config updates
- publish terminal closure on cancel/error when required
- clean up on disconnect

Bootstrap expectations:

- send current runtime values
- send current config values including:
  - `CONFIG_ALARM`
  - `CONFIG_OBSTACLES`
  - other active config domains
- send retained `TRACK_BACKFILL`

Important rule:

- stream publication is a view of authoritative state after mutation, not a transport-side cache

## Cancellation Expectations

Cancellation should be implemented as first-class request handling, not as a transport hack.

Required behavior:

- `CANCEL` is a normal request with its own reply
- successful cancel closes:
  - the original request with `ERROR` / `CLOSED_FAILED` / `CANCELED`
  - the cancel request with `ACK` / `CLOSED_OK`
- failed cancel closes the cancel request with `ERROR` / `CLOSED_FAILED`

The request registry should therefore track:

- request owner connection
- request kind
- cancelability
- current lifecycle state

## Persistence Boundary Expectations

Both implementations must make the same promises about what survives restart.

Must survive restart:

- config values and their versions
- latest authoritative anchor state/location
- last anchor-down timestamp
- enough retained history to satisfy the functional spec
- WLAN config

Should not be treated as durable product state:

- per-connection request registry
- active `GET_DATA` subscriptions
- transient transport sessions

## Resource Bound Expectations

The implementation outline should explicitly document resource limits, especially for ESP.

At minimum define:

- max history points retained in memory
- max obstacle polygons
- max points per polygon
- max concurrent client connections
- max in-flight requests per connection
- max WLAN scan duration

Android may exceed these limits internally, but it should still respect the same externally visible validation behavior where limits are part of the product contract.

## Feature Availability Expectations

Not every implementation will support every underlying capability the same way.

Examples:

- Android may implement `SCAN_WLAN` as a no-op
- ESP may have tighter memory limits for obstacle geometry
- one implementation may lack a given input source

What must be shared:

- deterministic documented behavior for unavailable features
- same request/reply shape
- same error or noop semantics where specified

## Conformance Expectations

Both implementations should be tested with the same black-box scenarios.

At minimum:

1. `GET_DATA` bootstrap returns the same categories of state/config data.
2. successful config writes increment versions and publish the new full DTO.
3. stale config versions fail without side effects.
4. `OBSTACLE_CLOSE` uses `CONFIG_OBSTACLES` polygons plus `CONFIG_ALARM` threshold.
5. `SILENCE_ALARM` uses `default_silence_ms`.
6. `SCAN_WLAN` behavior matches the documented implementation-specific rule.
7. cancellation closes requests deterministically.
8. disconnect removes active stream/request state.

## Recommended Next Docs

To keep both implementations aligned, the repo should eventually also have:

- a server conformance test matrix
- an alert-evaluation spec with exact threshold/hold/silence state transitions
- a resource-limits doc for embedded/runtime constraints

Those are the next level below the functional spec and this outline.
