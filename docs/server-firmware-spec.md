# Server Firmware Spec

Status: active  
Date: 2026-03-25  
Related shared behavior spec: [`docs/server-functional-spec.md`](/home/pm/dev/anchormaster/docs/server-functional-spec.md)  
Related implementation outline: [`docs/server-implementation-outline.md`](/home/pm/dev/anchormaster/docs/server-implementation-outline.md)  
Related wire contract: [`docs/protocol-v2.md`](/home/pm/dev/anchormaster/docs/protocol-v2.md)  
Related access lifecycle: [`docs/access-and-provisioning.md`](/home/pm/dev/anchormaster/docs/access-and-provisioning.md)

## Purpose

Capture the firmware-specific details that the shared server specs intentionally leave open.

This document exists so the ESP32-S3 rewrite has a concrete target for hardware behavior, transport details, persistence choices, and local operational rules.

The shared server specs still define the externally visible behavior. This document fills in the firmware-side blanks needed to implement that behavior on the hardware device.

## Platform Baseline

- MCU/platform: ESP32-S3
- framework/toolchain: Arduino
- product role: one firmware instance is the authoritative runtime for one boat
- required local transports:
  - BLE local control path
  - WLAN station connectivity
- required remote transport:
  - cloud relay client over WLAN using the same server core
- current build target:
  - ESP32-S3 with `PartitionScheme=huge_app`, because BLE + WLAN + TLS cloud uplink does not fit in the old 1.2 MB default app partition

The firmware should be structured as a multi-file runtime, not one monolithic sketch, in line with [`docs/server-implementation-outline.md`](/home/pm/dev/anchormaster/docs/server-implementation-outline.md).

## Hardware Baseline

Current bring-up assumptions from the existing hardware sketch:

- siren output pin: `4`
- status LED pin: `LED_BUILTIN`, fallback `2`
- serial console baud rate: `115200`

Output behavior baseline:

- outputs are active-high
- `WARNING` alarms should light the status LED without driving the siren
- `ALARM` alarms should drive the siren and light the status LED
- clearing the alarm should silence the siren and turn off the LED unless another local status policy requires the LED

If hardware wiring changes later, this document should be updated explicitly rather than relying on constants hidden in firmware code.

## BLE Contract

The firmware should keep the existing BLE service and characteristic UUIDs as the hardware-side contract:

- service: `9f2d0000-87aa-4f4a-a0ea-4d5d4f415354`
- `control_tx`: `9f2d0001-87aa-4f4a-a0ea-4d5d4f415354`
- `event_rx`: `9f2d0002-87aa-4f4a-a0ea-4d5d4f415354`
- `snapshot`: `9f2d0003-87aa-4f4a-a0ea-4d5d4f415354`
- `auth`: `9f2d0004-87aa-4f4a-a0ea-4d5d4f415354`

Role of each characteristic:

- `control_tx`
  - writable by the app
  - carries inbound v2 request envelopes
- `event_rx`
  - notify-only
  - carries outbound v2 reply envelopes
- `snapshot`
  - optional read-only helper for local diagnostics/bootstrap convenience
  - must not become a second business protocol with divergent payloads
- `auth`
  - local onboarding/pairing status channel
  - not part of the main business request/reply protocol

BLE framing baseline:

- business payloads are UTF-8 JSON messages
- BLE transport may chunk messages at the characteristic level
- MTU/chunk sizing and retry logic are transport details, not protocol features
- the rewrite should preserve a practical high-MTU path on ESP32-S3, but the app-visible protocol must remain the v2 envelope only

BLE device identity baseline:

- advertised device name should keep the `Anqori-AnchorWatch-` prefix
- the suffix may continue to derive from the device identity

## Local Pairing and Trusted Maintenance

The firmware needs a local privileged path for onboarding and trusted maintenance.

Current bring-up mechanism:

- BLE pair mode is active automatically on startup
- automatic pair mode times out after 120 seconds
- while pair mode is active, BLE-local setup/session authorization is allowed
- no separate local privileged-session confirmation step is required

Expected local maintenance channel:

- serial console is acceptable for bring-up and development
- current bring-up does not require a physical button to open pair mode
- a later productized device may add a physical action such as a button to reopen pair mode after startup timeout
- the shared server behavior must not depend on which local trigger is used

Local maintenance command baseline:

- `help`
- `pair on`
- `pair off`
- `pair status`
- `wifi status`
- `debug on`
- `debug off`

Secret and identity handling baseline:

- there is no secret readback path
- the firmware must never reveal `factory_setup_pin` or `ble_connection_pin` over the main BLE business protocol, the local auth channel, or the serial maintenance interface
- for the current pre-control-plane phase, the app must be able to:
  - authorize first setup over BLE using the shared factory setup PIN
  - set the first real per-boat `ble_connection_pin`
  - rotate the `ble_connection_pin` later
  - read the current `cloud_secret` only after BLE authorization succeeds
- the readable local/runtime view may expose `boat_id`, `cloud_secret`, and whether a cloud secret is configured, but only to an authorized BLE session

The `auth` characteristic may expose transport-local status such as:

- `pair_mode_active`
- `pair_mode_until_ts`
- `boat_id`
- whether the boat is still in `SETUP_REQUIRED`

This status is local onboarding state, not shared runtime state.

## Identity and Persistence

The firmware should use ESP persistent storage through NVS/Preferences.

Persistent firmware-owned values:

- stable `boat_id`
- stable `device_id`
- stable `ble_connection_pin`
- stable `cloud_secret`
- app-writable config DTOs:
  - `alarm_config`
  - `obstacles`
  - `anchor_settings`
  - `profiles`
  - `system_config`
  - `wlan_config`
  - `cloud_config`
- any firmware markers required across reboot:
  - last anchor-down timestamp
  - last known anchor position if anchored

Identity defaults:

- `device_id` may derive from the ESP efuse MAC
- `boat_id` may default from the same hardware identity with a stable prefix
- `ble_connection_pin` may start unset
- `cloud_secret` may start unset
- the shared `factory_setup_pin` is flashed into firmware for the current bring-up phase
- if `cloud_secret` is unset, the firmware should expose that through `CONFIG_CLOUD.secret_configured = false`

Cloud identity/credential update expectations:

- the firmware should expose a readable `CONFIG_CLOUD` value containing:
  - `version`
  - `boat_id`
  - `cloud_secret`
  - `secret_configured`
- the firmware should accept BLE-local first setup through `AUTHORIZE_SETUP`
- the firmware should accept the first local activation through `SET_INITIAL_BLE_PIN`
- `SET_INITIAL_BLE_PIN` must persist the new BLE pin atomically and move the boat from `SETUP_REQUIRED` to `LOCAL_READY`
- the firmware should accept later BLE pin rotation through `UPDATE_BLE_PIN`
- the firmware should accept later cloud config writes through `UPDATE_CLOUD_CREDENTIALS`
- `CONFIG_CLOUD` must be emitted only to authorized BLE sessions

No backward compatibility with old persistence layout is required for the greenfield rewrite. Internal key names and storage layout may change freely if the new implementation is cleaner.

## Time Source Expectations

The shared protocol uses epoch-millisecond timestamps in:

- `STATE_DEPTH.ts`
- `STATE_WIND.ts`
- `TRACK_BACKFILL[].ts`
- alert timing fields
- any `*_until_ts` fields

This is a real firmware concern because the MCU does not automatically have valid wall-clock time on boot.

Firmware rule:

- the rewrite must not publish bare `millis()` uptime values in fields documented as epoch timestamps

Expected approach:

- in `LIVE` mode, initialize the local clock to Unix time `0` on boot until a real time source is available
- in `LIVE` mode, set the local clock from GPS/GNSS datetime when that becomes available
- in `SIMULATION` mode, start the local clock at `2025-08-01T15:00:00Z`
- use that local clock as the source for protocol epoch timestamps
- keep internal monotonic timing separately for scheduling and timeout logic

If no trustworthy epoch source is available yet:

- the firmware may still run internal timers from monotonic uptime
- in `LIVE` mode, app-visible epoch timestamp fields may therefore initially be at or near Unix time `0` until GPS/GNSS time has been acquired
- this pre-time-sync state should be treated as not-yet-real wall-clock time rather than as a meaningful historical timestamp
- in `LIVE` mode, the firmware should not publish authoritative timestamped runtime samples, append retained history, or evaluate alarms from position/depth/wind until GPS/GNSS time has been acquired

## Runtime Data Inputs

Target runtime inputs for the firmware implementation:

- NMEA2000 for:
  - position
  - depth
  - wind

Planned later extension:

- SignalK may be supported later as an alternative input source

Simulation mode:

- simulation is controlled by `CONFIG_SYSTEM.runtime_mode`
- when `runtime_mode = SIMULATION`, the firmware must synthesize the same scenario defined in [`docs/server-functional-spec.md`](/home/pm/dev/anchormaster/docs/server-functional-spec.md):
  - clock starts at `2025-08-01T15:00:00Z`
  - random-walk position within a 200 meter radius around Kiel Plueschow Bucht center
  - depth decreases from `5.0 m` at the center to `1.5 m` at the edge
  - wind changes slowly with maximum drift of `5 kn` and `20 deg` per minute
- simulation mode is a deliberate shared runtime mode, not an ad-hoc firmware-only debug feed

Live mode:

- when `runtime_mode = LIVE`, the firmware must wait for real runtime providers and a trustworthy GPS/GNSS-derived timestamp before producing authoritative position/depth/wind telemetry
- before that time source exists, non-telemetry behavior such as config handling, pairing, WLAN scanning, and WLAN config updates may still operate

Input expectations:

- missing hardware inputs must result in stale/unavailable data, not fabricated live values
- `DATA_OUTDATED` should therefore become meaningful on real hardware when inputs disappear

## WLAN and Cloud Baseline

WLAN behavior on firmware:

- station mode only
- no firmware-owned access-point mode in the runtime server path
- WiFi sleep disabled for predictable runtime behavior
- hostname may remain `anchorwatch` unless a better productized naming rule is introduced

Protocol expectations:

- `SCAN_WLAN` is a real firmware operation
- only one active scan may run at a time
- discovered networks should be emitted incrementally as `WLAN_NETWORK` replies
- `UPDATE_CONFIG_WLAN` replaces the stored WLAN target/config
- WLAN connection progress and failures are surfaced through `STATE_WLAN_STATUS`

Cloud reachability expectations:

- `STATE_SYSTEM_STATUS.cloud_reachable` must reflect the actual firmware cloud-link state once the cloud client exists
- until a cloud client is implemented, the firmware may report `cloud_reachable: false`
- the internal firmware architecture should still reserve a separate cloud adapter boundary so the later cloud client can reuse the same server core

## Alarm and Output Policy

Firmware-specific output expectations:

- all raised alerts are signaled on all available onboard outputs
- there is no configurable per-output routing in firmware config
- silence is tracked per alert type, not globally
- silence suppresses signaling for that alert but does not erase the underlying alert runtime state

Firmware output set currently assumed:

- siren
- status LED

If the hardware later adds buzzer, relay, or other outputs, they should follow the same shared output policy and be documented here.

## History and Resource Strategy

The shared specs require:

- retained position/depth/wind history for at least 30 minutes
- longer retention back to last anchor-down if that window is longer

Firmware cannot treat this as unbounded storage.

Firmware-specific implementation expectation:

- use bounded ring buffers and/or compact retained history structures sized for ESP32-S3 memory limits
- choose sample cadence and retention strategy so the shared behavior is still satisfied
- include depth and wind values on retained track points when those samples are available for the same retained point timestamp

The rewrite should make the memory budget for retained history explicit in code rather than leaving it as an accidental constant.

## Serial Diagnostics

The serial console is a firmware maintenance interface, not part of the app protocol.

Expected use cases:

- enable or disable pair mode
- confirm privileged local session
- inspect WLAN status
- toggle debug logging

The serial console may also expose development diagnostics for:

- BLE connection state
- WLAN connect attempts
- NMEA input status
- cloud adapter status
- memory pressure or ring-buffer usage

Those diagnostics are firmware-local and do not change the app-facing protocol contract.

## Firmware-Specific Gaps This Document Resolves

This document makes the following firmware-side choices explicit:

- ESP32-S3 + Arduino is the baseline runtime platform
- BLE UUIDs and characteristic roles remain the hardware-side contract
- serial remains the trusted local bring-up/maintenance path
- pair mode and privileged session state stay on the local auth path, not in shared runtime state
- NVS/Preferences is the expected persistence mechanism
- NMEA2000 is the target runtime input source for position/depth/wind
- WLAN is station-mode runtime connectivity, not AP-mode onboarding
- siren and status LED are the initial onboard outputs
- epoch timestamp handling needs a real time-source strategy and must not reuse raw uptime counters

If a future firmware decision changes any of those, this document should be updated before or together with the code change.
