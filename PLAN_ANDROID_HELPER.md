# Android Helper Device Emulator Plan

Status date: 2026-02-25

Goal: add a small **native Android app** that behaves like the firmware runtime for development and integration testing:

- runs in a foreground service so it keeps working when UI is backgrounded,
- continuously emits GPS telemetry,
- accepts BLE central connections with the same GATT contract as firmware,
- publishes messages to the cloud relay using the same protocol envelope as firmware.

This plan is intentionally scoped to “device emulation” first, not full production feature parity.

---

## 0) Desired behavior matrix

| Requirement | Helper behavior |
| --- | --- |
| Foreground life-cycle | Persistent foreground service with status notification (required for continuous location + BLE + WS). |
| Telemetry source | `FusedLocationProviderClient` or `LocationManager` updates (target 1 Hz, best-available). |
| BLE role | Bluetooth **peripheral / GATT server** exposing the same UUIDs used by firmware. |
| BLE role details | Implement `controlTx`, `eventRx`, `snapshot`, `auth` characteristics with chunked transport framing. |
| Cloud role | WebSocket client to `/v1/pipe` with `role=device`, same `boatId/boatSecret/deviceId`. |
| Protocol | `am.v1` exactly (existing `docs/protocol-v1.md`), same `msgType`, envelope fields, and ACK semantics. |
| Scope | Start with location + status + anchor command simulation; add richer telemetry/config as optional phases. |

---

## 1) Architecture (recommended)

Create a small independent Android app (separate from the existing Capacitor wrapper) so `app/android` remains untouched and dedicated to the PWA packaging.

Suggested module: `android-helper/` (Gradle project)

### Runtime components

1. **`CoreService` (foreground service)**
   - Starts on app start and restarts if killed (where possible).
   - Owns lifecycle for BLE + relay + protocol pipeline.
   - Emits a stable notification with connection status + current `seq`.

2. **`LocationEngine`**
   - Produces a 1 Hz normalized `telemetry` payload.
   - Keeps latest `sogKn`, `cogDeg`, `headingDeg`, latency/age info.
   - Pushes values into shared `StateStore`.

3. **`ProtocolStore` (state + seq + IDs)**
   - stores `boatId`, `deviceId`, `boatSecret` (persisted securely), `seq`, `sessionId`, protocol version.
   - stores current anchor/runtime state and outgoing telemetry snapshot.

4. **`BlePeripheralController`**
   - Exposes firmware BLE UUIDs:
     - Service: `9f2d0000-87aa-4f4a-a0ea-4d5d4f415354`
     - `controlTx`, `eventRx`, `snapshot`, `auth`
   - Handles read/write/notify semantics and chunking (`msgId32`, `partIndex`, `partCount`, timeout 2s).
   - Reassembles command messages from `controlTx` and dispatches to command handlers.

5. **`CloudPipeClient`**
   - WebSocket client to `/v1/pipe` with query params:
     - `boatId`, `boatSecret`, `deviceId`, `role=device`.
   - Supports reconnect with backoff and publishes/consumes same envelopes as the app relay client does.

6. **`CommandRouter`**
   - Parses inbound envelopes from BLE and relay.
   - Handles:
     - `config.patch`
     - `anchor.down`, `anchor.rise`
     - `onboarding.request_secret`
     - `track.snapshot.request`
     - `onboarding.wifi.scan`
     - `alarm.silence.request`
     - optional future extension messages
   - Emits `command.ack` for ACK-required messages.

7. **`MessagePublisher`**
   - Coalesces and emits:
     - `status.patch` continuously
     - periodic `status.snapshot` on request
     - `track.snapshot` on request
     - optional `heartbeat`
   - Sends to both BLE notify stream and relay (to emulate real dual-path behavior).

---

## 2) Protocol and schema mapping (for parity)

### Mandatory envelope fields

Use `buildProtocolEnvelope(...)`-equivalent logic for all outbound messages:

- `ver: "am.v1"`
- `msgType`
- `msgId` (ULID/UUID/ID generator)
- `boatId`
- `deviceId`
- `seq` (monotonic per session)
- `ts` (epoch ms)
- `requiresAck` as needed
- `payload`

### Message subset for initial MVP

- `status.patch` (primary loop):
  - `telemetry.gps.lat`, `telemetry.gps.lon`, `telemetry.gps.ageMs`, `telemetry.gps.valid`
  - `telemetry.motion.sogKn`, `telemetry.motion.cogDeg`, `telemetry.motion.headingDeg`
  - `anchor.state`, `anchor.position.lat`, `anchor.position.lon`
  - `system.ble.connected`, `system.cloud.reachable`, optional `system.cloud.role`
- `status.snapshot` (when requested)
- `track.snapshot` (for initial map fill)
- `onboarding.boat_secret` reply to request
- `onboarding.wifi.scan_result` (mock list acceptable for now)
- `command.ack` for command flows

### Transport parity notes

- BLE path remains chunked; cloud path is raw JSON strings.
- Keep one canonical command schema mapping internally, then serialize per transport.
- A single ACK registry should cover both BLE and relay send paths.

---

## 3) Permissions and foreground execution

### Core permissions

- Location:
  - `android.permission.ACCESS_FINE_LOCATION` (or `COARSE`, depending on precision plan)
  - runtime foreground-location permission + optional background-location policy handling
- BLE:
  - API 31+: `BLUETOOTH_CONNECT`, `BLUETOOTH_ADVERTISE`, `BLUETOOTH_SCAN`
  - API <31: legacy `BLUETOOTH`, `BLUETOOTH_ADMIN`, location if required by stack version
- Notifications:
  - `POST_NOTIFICATIONS` (API 33+)
- Foreground service:
  - `FOREGROUND_SERVICE`
  - Android 14+: `FOREGROUND_SERVICE_CONNECTED_DEVICE` or `FOREGROUND_SERVICE_LOCATION` type as appropriate

### Foreground contract

- Start immediately after setup.
- Keep a persistent notification:
  - current GPS fix state,
  - BLE connect state,
  - relay state.
- Stop only by explicit user action; avoid auto-stop on app backgrounding.

---

## 4) Implementation plan by phase

### Phase A — project scaffolding (days 1–2)

- [ ] Create separate `android-helper/` project.
- [ ] Add dependencies:
  - Kotlin coroutines/flow,
  - Google Play Services location (or direct `LocationManager` fallback),
  - OkHttp (WebSocket),
  - secure storage (Jetpack DataStore/EncryptedSharedPreferences),
  - ULID/UUID utility.
- [ ] Create bootstrap screen with:
  - start/stop switch,
  - relay URL,
  - `boatId`/`boatSecret` settings,
  - quick debug log view.

### Phase B — protocol-first core (days 2–3)

- [ ] Implement shared protocol models and serialization helpers.
- [ ] Implement outbound envelope validator + canonical payload builder.
- [ ] Implement `AckTracker` + pending request map.
- [ ] Implement `Sequence` and `state snapshot` builder.

### Phase C — location + state source (days 3–5)

- [ ] Implement location polling loop (1 Hz), with debounce + stale logic.
- [ ] Create normalized telemetry fields expected by firmware contract.
- [ ] Add in-memory & optional DB-backed track ring buffer.
- [ ] Emit continuous `status.patch` every N=1000ms (or adaptive if no fix).

### Phase D — BLE peripheral transport (days 5–8)

- [ ] Implement GATT service and characteristics.
- [ ] Implement chunking/un-chunking for `controlTx` and `eventRx`.
- [ ] Implement `snapshot` characteristic read responses for latest state.
- [ ] Implement auth challenge flow (`auth`) with permissive “paired” emulation for now.
- [ ] Implement command handlers and `command.ack` for required commands.

### Phase E — cloud relay transport (days 8–10)

- [ ] Implement websocket handshake and lifecycle in role `device`.
- [ ] Authenticate via `boatSecret` query param or header (matching worker behavior).
- [ ] Forward same outbound messages to relay.
- [ ] Consume relay inbound messages and route through same `CommandRouter`.
- [ ] Support `relay.probe` local handling.

### Phase F — emulator behavior parity (days 10–12)

- [ ] `onboarding.request_secret`: create/persist stable boatSecret and send `onboarding.boat_secret`.
- [ ] `onboarding.wifi.scan`: return mocked scan results quickly.
- [ ] `config.patch`: validate keys/version and store last-write-wins config snapshot.
- [ ] `track.snapshot.request`: return recent points using requested `limit` and `sinceTs` filter.
- [ ] `anchor.down/up`: persist anchor state and update next status patch accordingly.

### Phase G — QA/integration (ongoing)

- [ ] End-to-end smoke:
  - app (helper) emits status to relay + PWA receives stream,
  - app sends `config.patch` commands via cloud and BLE and receives ACK,
  - app issues `track.snapshot.request` and map initializes.
- [ ] Validate BLE payload integrity:
  - chunk boundaries, reorder/timeout behavior,
  - invalid payload rejection (`INVALID_PAYLOAD`, `UNSUPPORTED_MSG_TYPE`).
- [ ] Test reconnect behavior under network loss and BLE disconnects.

---

## 8) Build and CI with plain Android SDK in Docker

Recommended during Phase A/B so no local Android SDK install is required.

Use the common image with plain Gradle environment:

```bash

docker run --rm -it \
  -v "$PWD:/build" \
  -w /build \
  ghcr.io/cirruslabs/android-sdk:35 \
  /bin/bash -lc "cd android-helper && ./gradlew clean assembleDebug"
```

Notes:

- Keep the working directory as repo root and run from inside `android-helper`.
- Example above uses the **assembleDebug** task; switch to `assembleRelease` once signing is configured.
- If you use a local Gradle cache, mount it to speed repeated builds:

```bash
docker run --rm -it \
  -v "$PWD:/build" \
  -v "$HOME/.gradle:/root/.gradle" \
  -w /build \
  ghcr.io/cirruslabs/android-sdk:35 \
  /bin/bash -lc "cd android-helper && ./gradlew assembleDebug"
```

Suggested minimum CI job (example pattern):

1. Build in container with `assembleDebug` (or `assembleRelease`).
2. Upload artifacts (`android-helper/app/build/outputs/apk/...`) and any debug logs.
3. Optionally add lint/test steps (`./gradlew lint` / `./gradlew test`) in the same container.


## 9) Suggested app-level acceptance checklist

- [ ] Starts BLE + relay + location immediately when in “Run” mode and stays alive in background.
- [ ] Reports position over BLE at 1 Hz with monotonic `seq`.
- [ ] Responds to `onboarding.request_secret` and emits stable `onboarding.boat_secret`.
- [ ] Accepts and ACKs `config.patch`, `anchor.down`, `anchor.rise`.
- [ ] Publishes to `/v1/pipe` with `role=device` and accepted auth.
- [ ] Can be used as temporary replacement device while real hardware is unavailable.

---

## 10) Integration with current repo architecture

- Keep this helper decoupled from the PWA JS app; it is only a **test harness/protocol peer**.
- No need to modify existing app connection code for MVP.
- Optionally add a small note in `README.md` + `PLAN.md` explaining “Android helper path for CI/manual QA” once stable.

---

## 11) Risks and dependencies

- Android acting as BLE peripheral support is inconsistent across manufacturers; validate on at least two test phones.
- Location/background permission friction is OEM-specific (battery optimization, auto-kill policies).
- Keep BLE chunking strict; firmware currently has tight parsing assumptions.
- For parity with firmware security, decide whether to emulate pair-mode; start with permissive auth and tighten later.

---

## 12) Next concrete action

1. Implement `android-helper/` skeleton with Gradle and foreground service.
2. Add protocol models + BLE characteristic scaffolding in parallel.
3. Once both are in, integrate relay websocket sender/receiver.
4. Execute integration test scripts from this plan with the current PWA + worker stack.
