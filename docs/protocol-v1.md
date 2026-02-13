# Anqori AnchorWatch Protocol v1 (MVP Frozen)

Status: MVP frozen for implementation  
Date: 2026-02-12  
Version tag: `am.v1`

## 1. Purpose

Define a clear message protocol for:

1. `device -> Wi-Fi -> Cloudflare -> app`
2. `device -> BLE -> app`
3. Unified app state messages across transports (`status.patch` and `status.snapshot`)
4. Unified track initialization message across transports (`track.snapshot`)

This document is the frozen MVP contract baseline for implementation.

## 1.1 Freeze policy (MVP)

1. This `am.v1` contract is frozen as of 2026-02-12 for MVP work.
2. Breaking changes must use a new version tag (for example `am.v1.1` or `am.v2`) and add migration notes.
3. Additive optional fields and new optional message types are allowed if they do not break existing `am.v1` consumers.

## 2. Scope

In scope:

1. Message envelope and types
2. Transport expectations (HTTP + BLE GATT)
3. Auth, sequencing, retries, acknowledgements
4. Error model

Out of scope:

1. Detailed NMEA2000 PGN mapping internals
2. Cloud persistence schema details
3. Full push-provider implementation details

## 3. Topology

## 3.1 Path A (HTTPS + Web Push)

`Device (ESP32) -> HTTPS -> Cloudflare Worker (latest-state + events) -> app (HTTPS sync + Web Push)`

## 3.2 Path B (local direct)

`Device (ESP32) -> BLE GATT -> app`

## 4. Global Conventions

## 4.1 IDs and time

1. `msgId`: ULID string, globally unique per logical message.
2. `boatId`: stable non-secret boat identifier (routing/scope key only).
3. `deviceId`: stable hardware identifier.
4. `sessionId`: anchor session ID (ULID).
5. `ts`: Unix epoch milliseconds UTC.
6. `seq`: monotonic uint32 per device stream; wraps at `2^32-1`.

## 4.2 Units

1. Latitude/longitude: WGS84 decimal degrees.
2. Heading/COG/wind direction: degrees `[0, 360)`.
3. Speed: knots.
4. Depth: meters.
5. Ages/delays: milliseconds.

## 4.3 Severity levels

1. `info`
2. `warning`
3. `alarm`
4. `critical`

## 5. Logical Message Envelope (JSON)

All protocol messages use this envelope.

```json
{
  "ver": "am.v1",
  "msgType": "status.patch",
  "msgId": "01K2S3Q8PX9M0J4S6J2V4C7A9B",
  "boatId": "boat_demo_001",
  "deviceId": "dev_demo_001",
  "sessionId": "01K2S3N7Y4WQ2J9W9Y6Q5M5V8A",
  "seq": 1024,
  "ts": 1770897600000,
  "requiresAck": false,
  "payload": {}
}
```

Required top-level fields:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `ver` | string | yes | Protocol version. |
| `msgType` | string | yes | Message type enum. |
| `msgId` | string | yes | ULID; idempotency key. |
| `boatId` | string | yes | Logical boat scope; not an auth secret. |
| `deviceId` | string | yes | Producing device. |
| `seq` | number | yes | Monotonic per stream. |
| `ts` | number | yes | UTC epoch ms from sender. |
| `payload` | object | yes | Type-specific payload body. |
| `sessionId` | string | no | Required for anchor-session-scoped messages. |
| `requiresAck` | boolean | no | Default `false`. |

## 6. Message Catalog

## 6.1 `status.patch` (device -> cloud/app)

Payload:

```json
{
  "statePatch": {
    "telemetry.gps.lat": 54.3201,
    "telemetry.gps.lon": 10.1402,
    "telemetry.gps.ageMs": 900,
    "telemetry.gps.valid": true,
    "telemetry.motion.sogKn": 0.42,
    "telemetry.motion.cogDeg": 192.3,
    "telemetry.motion.headingDeg": 188.0,
    "telemetry.depth.meters": 3.1,
    "telemetry.depth.ageMs": 800,
    "telemetry.wind.knots": 14.8,
    "telemetry.wind.dirDeg": 205.0,
    "telemetry.wind.ageMs": 700,
    "anchor.state": "down",
    "anchor.position.lat": 54.3200,
    "anchor.position.lon": 10.1400,
    "triggers.wind_above.active": false,
    "triggers.wind_above.severity": "info"
  }
}
```

Use this same message over both transports:

1. BLE path: device sends `status.patch` continuously (no long batching).
2. Cloud path: device buffers status updates and sends aggregated `status.patch` every 30 seconds.
3. `statePatch` accepts dot-path keys (recommended) and nested objects; receivers normalize to canonical nested state before merge.

## 6.2 `status.snapshot` (device/cloud -> app)

Payload:

```json
{
  "snapshot": {
    "telemetry": {
      "gps": { "lat": 54.3201, "lon": 10.1402, "ageMs": 900, "valid": true },
      "depth": { "meters": 3.1, "ageMs": 800 },
      "wind": { "knots": 14.8, "dirDeg": 205.0, "ageMs": 700 }
    },
    "triggers": {
      "wind_above": { "active": false, "severity": "info" }
    },
    "anchor": {
      "state": "down",
      "position": { "lat": 54.3200, "lon": 10.1400 }
    }
  },
  "updatedAt": 1770897600456
}
```

App state-update contract:

1. App state ingestion accepts only `status.patch` and `status.snapshot`.
2. This applies equally to cloud and BLE paths.
3. Transport-specific framing/metadata must not change the `statePatch`/`snapshot` schema.
4. Historical track initialization uses `track.snapshot`; ongoing track updates come from `status.patch` GPS updates.
5. Anchor runtime state keys:
   - `anchor.state` enum: `up`, `down`, `auto-pending`
   - `anchor.position.lat` and `anchor.position.lon` (present when anchor position is known)

## 6.2.1 `track.snapshot.request` (app -> device/cloud)

Payload:

```json
{
  "sinceTs": 1770897000000,
  "limit": 2000
}
```

Notes:

1. Used on BLE path (app -> device via `controlTx`).
2. Cloud path uses `GET /v1/tracks?boatId=...&sinceTs=...&limit=...` with equivalent parameters.

## 6.2.2 `track.snapshot` (device/cloud -> app)

Payload:

```json
{
  "points": [
    { "ts": 1770897600000, "lat": 54.3201, "lon": 10.1402, "cogDeg": 192.3, "headingDeg": 188.0, "sogKn": 0.42 },
    { "ts": 1770897630000, "lat": 54.3202, "lon": 10.1404, "cogDeg": 193.0, "headingDeg": 188.5, "sogKn": 0.45 }
  ],
  "totalPoints": 120,
  "returnedPoints": 120
}
```

Notes:

1. App requests this once on start/resume for initial map path.
2. App then extends local track from incoming `status.patch` GPS positions.

## 6.3 `trigger.state` (device -> cloud/app)

Payload:

```json
{
  "triggerId": "wind_above",
  "active": true,
  "severity": "warning",
  "value": 31.2,
  "threshold": 30.0,
  "heldMs": 18000
}
```

## 6.4 `alarm.event` (device -> cloud/app)

Payload:

```json
{
  "alarmId": "01K2S4F76NQ7S5D2R7QKM0B31C",
  "phase": "fired",
  "severity": "alarm",
  "outputs": ["local_siren", "phone_push"],
  "triggerIds": ["outside_area", "boatspeed_high"],
  "silenceUntilTs": null
}
```

`phase` enum:

1. `fired`
2. `acknowledged`
3. `silenced`
4. `rearmed`
5. `cleared`

## 6.5 `alarm.silence.request` (app -> device/cloud)

Payload:

```json
{
  "alarmId": "01K2S4F76NQ7S5D2R7QKM0B31C",
  "silenceForMs": 900000,
  "reason": "user_slider_ack"
}
```

## 6.6 `config.patch` (app -> device/cloud)

Payload:

```json
{
  "version": 17,
  "patch": {
    "anchor.defaultSetMode": "offset",
    "anchor.offset.distanceM": 8.0,
    "anchor.offset.angleDeg": 210.0,
    "zone.type": "circle",
    "zone.circle.radiusM": 45.0,
    "triggers.wind_above.enabled": true,
    "triggers.wind_above.thresholdKn": 30.0,
    "triggers.wind_above.holdMs": 15000,
    "triggers.wind_above.severity": "warning",
    "outputs.localSiren.warningDelayMs": 5000,
    "outputs.phoneAlert.fullAlarmDelayMs": 0,
    "profiles.mode": "auto",
    "profiles.night.colorScheme": "red",
    "profiles.night.brightnessPct": 20,
    "network.wifi.ssid": "BoatHotspot",
    "network.wifi.passphrase": "example-passphrase",
    "network.wifi.security": "wpa2",
    "network.wifi.hidden": false,
    "network.wifi.country": "DE"
  }
}
```

Notes:

1. Wi-Fi provisioning is part of normal `config.patch`, not a separate onboarding message.
2. `network.wifi.passphrase` is write-only and should not be exposed in `config.snapshot`.
3. Device reports Wi-Fi connection progress/state via `status.patch` (for example `statePatch.system.wifi.*`).

## 6.6.1 Patch rules (normative)

1. `patch` is a partial object that may use dot-path keys or nested objects and maps to the canonical `config` structure (defined below).
2. Unknown keys must be rejected with `INVALID_PAYLOAD`.
3. Type mismatch must be rejected with `INVALID_PAYLOAD`.
4. Receivers normalize patch input to canonical nested form, then deep-merge by field; arrays replace whole target arrays (no element-wise merge).
5. `version` is monotonic and used for conflict handling (last accepted higher version wins).
6. Runtime actions (for example "set anchor now" and drag/drop anchor move) are commands, not persisted config keys.

## 6.6.2 Canonical `config` object (normative)

```json
{
  "network": {
    "wifi": {
      "ssid": "BoatHotspot",
      "passphrase": "***write-only***",
      "security": "wpa2",
      "hidden": false,
      "country": "DE"
    }
  },
  "anchor": {
    "defaultSetMode": "current",
    "offset": { "distanceM": 0.0, "angleDeg": 0.0 },
    "autoMode": {
      "enabled": true,
      "minForwardSogKn": 0.8,
      "stallMaxSogKn": 0.3,
      "reverseMinSogKn": 0.4,
      "confirmSeconds": 20
    }
  },
  "zone": {
    "type": "circle",
    "circle": { "radiusM": 45.0 },
    "polygon": {
      "points": [
        { "lat": 54.3201, "lon": 10.1402 },
        { "lat": 54.3202, "lon": 10.1403 },
        { "lat": 54.3203, "lon": 10.1401 }
      ]
    }
  },
  "triggers": {
    "wind_shift": { "enabled": true, "holdMs": 15000, "severity": "warning", "thresholdDeg": 35.0 },
    "wind_above": { "enabled": true, "holdMs": 15000, "severity": "warning", "thresholdKn": 30.0 },
    "pushed_over_anchor": { "enabled": true, "holdMs": 15000, "severity": "alarm", "minDistanceM": 8.0, "maxBearingErrorDeg": 45.0 },
    "depth_below": { "enabled": false, "holdMs": 10000, "severity": "alarm", "thresholdM": 2.0 },
    "outside_area": { "enabled": true, "holdMs": 10000, "severity": "alarm" },
    "boatspeed_high": { "enabled": true, "holdMs": 10000, "severity": "alarm", "thresholdKn": 1.8 },
    "gps_age": { "enabled": true, "holdMs": 5000, "severity": "warning", "maxAgeMs": 5000 },
    "other_data_age": { "enabled": true, "holdMs": 5000, "severity": "warning", "maxAgeMs": 8000 },
    "phone_battery_below": { "enabled": false, "holdMs": 30000, "severity": "warning", "thresholdPct": 20, "appliesTo": "any" }
  },
  "outputs": {
    "localSiren": { "enabled": true, "warningDelayMs": 0, "fullAlarmDelayMs": 0 },
    "phoneAlert": { "enabled": true, "warningDelayMs": 0, "fullAlarmDelayMs": 0 }
  },
  "silence": {
    "sliderRequired": true,
    "defaultMs": 900000
  },
  "profiles": {
    "mode": "auto",
    "day": { "colorScheme": "full", "brightnessPct": 100, "outputProfile": "normal" },
    "night": { "colorScheme": "red", "brightnessPct": 20, "outputProfile": "night" },
    "autoSwitch": { "source": "time", "dayStartLocal": "07:00", "nightStartLocal": "21:30" }
  },
  "track": {
    "recordWhenAnchored": true,
    "maxPointsLocal": 20000
  }
}
```

## 6.6.3 Config key catalog (normative, reference paths)

| Path | Type | Default | Constraints / Notes |
| --- | --- | --- | --- |
| `network.wifi.ssid` | string | `""` | 1..32 chars when set |
| `network.wifi.passphrase` | string | `""` | write-only; 8..63 chars for WPA2/3 PSK |
| `network.wifi.security` | enum | `wpa2` | `open`, `wpa2`, `wpa3` |
| `network.wifi.hidden` | boolean | `false` | none |
| `network.wifi.country` | string | `""` | ISO 3166-1 alpha-2 upper-case |
| `anchor.defaultSetMode` | enum | `current` | `current`, `offset`, `auto`, `manual` |
| `anchor.offset.distanceM` | number | `0` | `>= 0`, meters |
| `anchor.offset.angleDeg` | number | `0` | `[0,360)` |
| `anchor.autoMode.enabled` | boolean | `true` | none |
| `anchor.autoMode.minForwardSogKn` | number | `0.8` | `>= 0` |
| `anchor.autoMode.stallMaxSogKn` | number | `0.3` | `>= 0` |
| `anchor.autoMode.reverseMinSogKn` | number | `0.4` | `>= 0` |
| `anchor.autoMode.confirmSeconds` | integer | `20` | `1..300` |
| `zone.type` | enum | `circle` | `circle`, `polygon` |
| `zone.circle.radiusM` | number | `45` | `> 0` |
| `zone.polygon.points` | array | `[]` | each point must contain finite `lat`, `lon`; minimum 3 points when active |
| `outputs.localSiren.enabled` | boolean | `true` | none |
| `outputs.localSiren.warningDelayMs` | integer | `0` | `0..600000` |
| `outputs.localSiren.fullAlarmDelayMs` | integer | `0` | `0..600000` |
| `outputs.phoneAlert.enabled` | boolean | `true` | none |
| `outputs.phoneAlert.warningDelayMs` | integer | `0` | `0..600000` |
| `outputs.phoneAlert.fullAlarmDelayMs` | integer | `0` | `0..600000` |
| `silence.sliderRequired` | boolean | `true` | must remain `true` in v1 UI |
| `silence.defaultMs` | integer | `900000` | `1000..86400000` |
| `profiles.mode` | enum | `auto` | `manual`, `auto` |
| `profiles.day.colorScheme` | enum | `full` | `full`, `red`, `blue` |
| `profiles.day.brightnessPct` | integer | `100` | `1..100` |
| `profiles.day.outputProfile` | string | `normal` | implementation-defined profile id |
| `profiles.night.colorScheme` | enum | `red` | `full`, `red`, `blue` |
| `profiles.night.brightnessPct` | integer | `20` | `1..100` |
| `profiles.night.outputProfile` | string | `night` | implementation-defined profile id |
| `profiles.autoSwitch.source` | enum | `time` | `time`, `sun` |
| `profiles.autoSwitch.dayStartLocal` | string | `07:00` | `HH:MM` local |
| `profiles.autoSwitch.nightStartLocal` | string | `21:30` | `HH:MM` local |
| `track.recordWhenAnchored` | boolean | `true` | none |
| `track.maxPointsLocal` | integer | `20000` | `100..200000` |

## 6.6.4 Trigger key catalog (normative, reference paths)

Common trigger keys (apply to every trigger id):

| Path pattern | Type | Default | Constraints / Notes |
| --- | --- | --- | --- |
| `triggers.<id>.enabled` | boolean | `false` | `<id>` from list below |
| `triggers.<id>.holdMs` | integer | `10000` | `0..600000` |
| `triggers.<id>.severity` | enum | `warning` | `warning`, `alarm` |

Trigger-specific threshold keys:

| Trigger id | Extra keys |
| --- | --- |
| `wind_shift` | `thresholdDeg` (number, `0..180`) |
| `wind_above` | `thresholdKn` (number, `>= 0`) |
| `pushed_over_anchor` | `minDistanceM` (number, `>= 0`), `maxBearingErrorDeg` (number, `0..180`) |
| `depth_below` | `thresholdM` (number, `>= 0`) |
| `outside_area` | none |
| `boatspeed_high` | `thresholdKn` (number, `>= 0`) |
| `gps_age` | `maxAgeMs` (integer, `0..600000`) |
| `other_data_age` | `maxAgeMs` (integer, `0..600000`) |
| `phone_battery_below` | `thresholdPct` (integer, `1..99`), `appliesTo` (enum: `any`, `all`) |

## 6.7 `config.snapshot` (device/cloud -> app)

Payload:

```json
{
  "version": 17,
  "config": {
    "network": {
      "wifi": {
        "ssid": "BoatHotspot",
        "security": "wpa2",
        "hidden": false,
        "country": "DE"
      }
    },
    "anchor": {
      "defaultSetMode": "current",
      "offset": { "distanceM": 0.0, "angleDeg": 0.0 }
    },
    "zone": {
      "type": "circle",
      "circle": { "radiusM": 45.0 }
    },
    "triggers": {
      "wind_above": { "enabled": true, "holdMs": 15000, "severity": "warning", "thresholdKn": 30.0 },
      "outside_area": { "enabled": true, "holdMs": 10000, "severity": "alarm" }
    },
    "outputs": {
      "localSiren": { "enabled": true, "warningDelayMs": 0, "fullAlarmDelayMs": 0 },
      "phoneAlert": { "enabled": true, "warningDelayMs": 0, "fullAlarmDelayMs": 0 }
    },
    "silence": { "sliderRequired": true, "defaultMs": 900000 },
    "profiles": {
      "mode": "auto",
      "day": { "colorScheme": "full", "brightnessPct": 100, "outputProfile": "normal" },
      "night": { "colorScheme": "red", "brightnessPct": 20, "outputProfile": "night" }
    },
    "track": { "recordWhenAnchored": true, "maxPointsLocal": 20000 }
  }
}
```

## 6.8 `heartbeat` (device -> cloud)

Payload:

```json
{
  "uptimeMs": 86400000,
  "fwVersion": "0.1.0",
  "wifiRssi": -62,
  "bleClients": 1
}
```

## 6.9 `command.ack` (device -> app/cloud)

Payload:

```json
{
  "ackForMsgId": "01K2S5BGM2G4M73Z35FKE9YF12",
  "status": "ok",
  "errorCode": null,
  "errorDetail": null
}
```

`status` enum:

1. `ok`
2. `rejected`
3. `failed`

## 6.10 `error` (any direction)

Payload:

```json
{
  "code": "INVALID_PAYLOAD",
  "detail": "payload.wind.knots missing",
  "retryable": false
}
```

## 6.11 `onboarding.request_secret` (app -> device)

Payload:

```json
{
  "reason": "initial_pairing"
}
```

Notes:

1. Sent after BLE stack pairing/bonding and physical pair-mode authorization.
2. Device responds with `onboarding.boat_secret` and `command.ack` on success.
3. Device rejects with `AUTH_FAILED` when pair-mode/session auth is missing.

## 6.12 `onboarding.boat_secret` (device -> app)

Payload:

```json
{
  "boatId": "boat_demo_001",
  "boatSecret": "am_bs_3KZfQ2xJm9aL8pT1vN6rU4yD7wE0cH5",
  "issuedAt": 1770897605000
}
```

Notes:

1. `boatSecret` is generated on device.
2. Device shares it only after BLE stack pairing/bonding plus explicit physical pair-mode action on device.
3. App stores it securely and uses it as cloud bearer secret.
4. `boatSecret` must never be put in URL query params or logs.
5. Cloud connectivity state is published via `status.patch` (for example `statePatch.system.cloud.reachable`).

## 6.13 `onboarding.wifi.scan` (app -> device)

Payload:

```json
{
  "requestId": "01K2S8V4J5A8M9Q2P8D5R6T7Y0",
  "maxResults": 20,
  "includeHidden": false
}
```

Notes:

1. Sent over BLE (`controlTx`) from onboarding step 2 to request nearby WLAN scan.
2. Device should send `command.ack` immediately and then emit `onboarding.wifi.scan_result` on `eventRx`.
3. Device may cap `maxResults` to implementation limits.
4. If a scan is already running, reject with `DEVICE_BUSY`.

## 6.14 `onboarding.wifi.scan_result` (device -> app)

Payload:

```json
{
  "requestId": "01K2S8V4J5A8M9Q2P8D5R6T7Y0",
  "completedAt": 1770897612000,
  "networks": [
    { "ssid": "BoatHotspot", "security": "wpa2", "rssi": -51, "channel": 6, "hidden": false },
    { "ssid": "Marina-WiFi", "security": "open", "rssi": -74, "channel": 11, "hidden": false }
  ]
}
```

Notes:

1. `requestId` must match the corresponding `onboarding.wifi.scan` request.
2. `security` enum: `open`, `wpa2`, `wpa3`, `unknown`.
3. `rssi` is in dBm (higher/less negative means stronger).
4. Devices should avoid duplicates by SSID when possible (or provide strongest reading first).
5. App uses selected network + passphrase to send regular `config.patch` with `network.wifi.*`.

## 6.15 `anchor.down` (app -> device/cloud)

Payload:

```json
{
  "lat": 54.3201,
  "lon": 10.1402
}
```

Notes:

1. Runtime command to mark anchor as set/dropped.
2. `lat`/`lon` should be current vessel position from latest telemetry.
3. Device responds with `command.ack`.
4. Device publishes updated `status.patch` / `status.snapshot` with:
   - `anchor.state = "down"`
   - `anchor.position.lat`
   - `anchor.position.lon`

## 6.16 `anchor.rise` (app -> device/cloud)

Payload:

```json
{}
```

Notes:

1. Runtime command to mark anchor as raised.
2. Device responds with `command.ack`.
3. Device publishes updated `status.patch` / `status.snapshot` with:
   - `anchor.state = "up"`
   - `anchor.position = null` (or omitted)

## 7. Path A: Device -> HTTPS -> Cloudflare -> App (HTTPS + Web Push)

## 7.1 Endpoints

| Endpoint | Method | Direction | Purpose |
| --- | --- | --- | --- |
| `/health` | `GET` | any -> cloud | Health probe. |
| `/v1/config` | `POST` | app/device -> cloud | Merge config patch into latest boat config. |
| `/v1/config?boatId=...` | `GET` | app/device <- cloud | Fetch latest config as `config.snapshot`. |
| `/v1/state` | `POST` | device -> cloud | Merge status patch into latest boat state. |
| `/v1/state?boatId=...` | `GET` | app <- cloud | Fetch latest state as `status.snapshot` (no history replay). |
| `/v1/tracks?boatId=...` | `GET` | app <- cloud | Fetch derived historical track as `track.snapshot`. |
| `/v1/events` | `POST` | device/app -> cloud | Ingest discrete events and runtime commands (for example alarm lifecycle, `anchor.down`, `anchor.rise`). |

Note: in scaffold code, `/v1/config`, `/v1/state`, `/v1/tracks`, and `/v1/events` are available.

## 7.2 Headers

Required for authenticated calls:

1. `Authorization: Bearer <boatSecret>`
2. `Content-Type: application/json`
3. `X-AnchorWatch-Client: device|app`

Optional:

1. `Idempotency-Key: <msgId>`

Note:

1. `GET /health` is intentionally unauthenticated.

## 7.3 Ingest response contract (`POST /v1/state`)

Success:

```json
{
  "ok": true,
  "accepted": true,
  "boatId": "boat_demo_001",
  "updatedAt": 1770897600456,
  "mode": "latest-state"
}
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_PAYLOAD",
    "detail": "boatId and object statePatch/patch required (nested object or dot-path map); if msgType is provided it must be status.patch",
    "retryable": false
  }
}
```

## 7.4 Snapshot response contract (`GET /v1/state?boatId=...`)

Success:

```json
{
  "ok": true,
  "ver": "am.v1",
  "msgType": "status.snapshot",
  "boatId": "boat_demo_001",
  "deviceId": "dev_demo_001",
  "ts": 1770897600456,
  "payload": {
    "snapshot": {
      "telemetry": {
        "gps": { "lat": 54.3201, "lon": 10.1402, "ageMs": 900, "valid": true }
      }
    },
    "updatedAt": 1770897600456
  }
}
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "detail": "no state for boatId"
  }
}
```

## 7.4.1 Config ingest response contract (`POST /v1/config`)

Success:

```json
{
  "ok": true,
  "accepted": true,
  "boatId": "boat_demo_001",
  "version": 18,
  "updatedAt": 1770897600456,
  "mode": "latest-config"
}
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_PAYLOAD",
    "detail": "boatId, integer version>=0, and object patch/configPatch required (nested object or dot-path map); if msgType is provided it must be config.patch"
  }
}
```

Version conflict:

```json
{
  "ok": false,
  "error": {
    "code": "VERSION_CONFLICT",
    "detail": "version must be greater than current (17)"
  }
}
```

## 7.4.2 Config snapshot response contract (`GET /v1/config?boatId=...`)

Success:

```json
{
  "ok": true,
  "ver": "am.v1",
  "msgType": "config.snapshot",
  "boatId": "boat_demo_001",
  "deviceId": "phone_pm_001",
  "ts": 1770897600456,
  "payload": {
    "version": 18,
    "config": {
      "zone": { "type": "circle", "circle": { "radiusM": 45.0 } }
    },
    "updatedAt": 1770897600456
  }
}
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "detail": "no config for boatId"
  }
}
```

## 7.5 Latest-state semantics (status updates)

1. Status updates are merged field-by-field (last write wins per field path).
2. Cloud does not maintain full status history as a message queue.
3. Device sends only `status.patch` messages for GPS/depth/wind/motion state.
4. Device buffers state changes and sends one aggregated `status.patch` every 30 seconds.
5. App reads current status via `GET /v1/state?boatId=...` as `status.snapshot`.
6. Device may send full snapshot or partial patch in `statePatch`.
7. Arrays in patch replace the target array (not element-wise merge).
8. For network/5xx, device retries with exponential backoff:
   - 1s, 2s, 4s, 8s, 16s, 30s max

## 7.5.1 Config merge semantics (`config.patch`)

1. `config.patch.patch` uses the same merge engine semantics as `status.patch.statePatch`.
2. Both status and config patch inputs are normalized using the same parser (dot-path and nested-object compatible).
3. Objects are deep-merged by field; arrays replace whole target arrays.
4. `version` must be integer `>= 0` and strictly increase per boat.
5. `config.*` messages must use `/v1/config` (not `/v1/events`).

## 7.6 Event behavior and push

1. For `alarm.event` with severity `alarm|critical`, cloud emits web push.
2. Push payload should be concise (alarm summary + IDs).
3. Discrete events use `/v1/events`; status uses `/v1/state`.
4. App fetches current status via `GET /v1/state?boatId=...` when opened/resumed.
5. Cloud state sync to app uses `status.snapshot` and `status.patch` schema only.

## 7.7 Onboarding end-to-end flow

Onboarding flow (BLE required):

1. User installs PWA from Cloudflare Pages URL and opens onboarding.
2. User puts device into physical pair mode and completes BLE stack pairing/bonding in OS/browser flow.
3. PWA connects to BLE service UUID `9f2d0000-87aa-4f4a-a0ea-4d5d4f415354`.
4. PWA writes auth action `pair.confirm` on `auth` characteristic to open privileged session.
5. PWA sends `onboarding.request_secret`; device returns `onboarding.boat_secret`; app stores `boatSecret` securely.
6. PWA sends `onboarding.wifi.scan`; device returns `onboarding.wifi.scan_result`; user selects WLAN and enters passphrase.
7. App sends normal `config.patch` with `network.wifi.*` fields (dot-path or nested); device reports progress/state via `status.patch` (`statePatch.system.wifi.*`) and `command.ack`.
8. App calls cloud APIs with `Authorization: Bearer <boatSecret>` and verifies access (200/404 on `GET /v1/state?boatId=...` means auth OK).
9. Device reports cloud connectivity via `status.patch` (`statePatch.system.cloud.*`).
10. App initializes map track via `track.snapshot` and starts normal operation (`status.patch`/`status.snapshot`, alarms, config).

## 7.8 Onboarding message coverage

1. Covered:
   - `config.patch` with `network.wifi.*` fields (dot-path or nested)
   - `onboarding.request_secret`
   - `onboarding.boat_secret`
   - `onboarding.wifi.scan`
   - `onboarding.wifi.scan_result`
   - `status.patch` onboarding progress fields (`statePatch.system.wifi.*`, `statePatch.system.cloud.*`)
   - runtime anchor commands (`anchor.down`, `anchor.rise`)
2. Constraint:
   - no fallback onboarding path for non-BLE-capable clients in v1

## 7.9 Track response contract (`GET /v1/tracks?boatId=...`)

Query params:

1. `boatId` required
2. `sinceTs` optional (epoch ms)
3. `limit` optional (bounded by server)

Success:

```json
{
  "ok": true,
  "ver": "am.v1",
  "msgType": "track.snapshot",
  "boatId": "boat_demo_001",
  "deviceId": "cloud",
  "ts": 1770897900000,
  "payload": {
    "points": [
      { "ts": 1770897600000, "lat": 54.3201, "lon": 10.1402, "cogDeg": 192.3, "headingDeg": 188.0, "sogKn": 0.42 }
    ],
    "totalPoints": 120,
    "returnedPoints": 1,
    "builtFrom": "status.patch.statePatch.telemetry.gps"
  }
}
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_PAYLOAD",
    "detail": "boatId query param required"
  }
}
```

## 7.10 Cloud track build semantics

1. On each accepted `status.patch` containing `statePatch.telemetry.gps.lat/lon`, cloud appends one track point.
2. Cloud stores a bounded per-boat ring buffer (KV-backed durable storage in deployed worker; in-memory fallback only for local test/dev without KV binding).
3. App startup/resume flow:
   - fetch `track.snapshot` from `/v1/tracks`
   - fetch latest `status.snapshot` from `/v1/state`
   - extend track locally using subsequent `status.patch` GPS updates
4. Consecutive unchanged positions may be de-duplicated by cloud.

## 8. Path B: Device -> BLE -> App

## 8.1 GATT profile

Service UUID:

1. `9f2d0000-87aa-4f4a-a0ea-4d5d4f415354`

Characteristics:

| Characteristic | UUID | Properties | Direction | Purpose |
| --- | --- | --- | --- | --- |
| `controlTx` | `9f2d0001-87aa-4f4a-a0ea-4d5d4f415354` | `WriteWithoutResponse` | app -> device | Commands/config patches, including onboarding WLAN scan requests. |
| `eventRx` | `9f2d0002-87aa-4f4a-a0ea-4d5d4f415354` | `Notify` | device -> app | `status.patch`, `track.snapshot`, trigger/alarm messages, and onboarding WLAN scan results. |
| `snapshot` | `9f2d0003-87aa-4f4a-a0ea-4d5d4f415354` | `Read` | app <- device | Current compact state snapshot. |
| `auth` | `9f2d0004-87aa-4f4a-a0ea-4d5d4f415354` | `Read,Write` | both | Session authentication handshake (`pair.confirm`, status read, optional `request_secret`). |

## 8.2 BLE message framing

Logical envelope remains the same (`am.v1` JSON envelope).

Chunk format for BLE transport:

| Field | Size | Notes |
| --- | ---: | --- |
| `msgId32` | 4 bytes | Lower 32 bits hash of `msgId` (transport key). |
| `partIndex` | 1 byte | Starts at 0. |
| `partCount` | 1 byte | Total parts for one logical message. |
| `payloadChunk` | N bytes | UTF-8 JSON chunk. |

Rules:

1. Negotiate MTU first.
2. Max chunk payload = `MTU - 6`.
3. Reassemble by `(msgId32, partCount)`.
4. Discard incomplete message after 2s timeout.

## 8.3 BLE command acknowledgement

1. App commands set `requiresAck: true`.
2. Device must respond with `command.ack` within 1s target.
3. App retries up to 3 times if no `command.ack`.

## 8.4 BLE local auth flow

1. BLE stack pairing/bonding is handled by OS/browser BLE flow.
2. Device requires explicit physical pair-mode action before exposing `onboarding.boat_secret` and privileged control.
3. App confirms pairing session by writing auth action `pair.confirm` on `auth` characteristic.
4. After successful pairing/bonding and pair-mode authorization, device accepts `controlTx` commands for session TTL (default 10 minutes idle timeout).

## 8.5 BLE status cadence

1. Device streams `status.patch` continuously over BLE while connected.
2. BLE path does not use the 30-second cloud batching window.
3. Each patch may be full or partial, following the same `statePatch` schema as cloud.
4. Snapshot reads over BLE must use `status.snapshot` schema.

## 8.6 BLE track retrieval

1. App sends `track.snapshot.request` over `controlTx` (typically with `requiresAck: true`).
2. Device replies with `track.snapshot` over `eventRx` (chunked according to BLE framing if needed).
3. App initializes map path from `track.snapshot`, then appends new points from ongoing `status.patch` GPS updates.

## 9. Security Requirements

## 9.1 Cloud path

1. TLS 1.2+ required.
2. Single shared `boatSecret` is required for device/app read and write operations (`Authorization: Bearer <boatSecret>`).
3. `boatId` is not an auth factor; it is an identifier only.
4. CORS restricted to approved app origins in production.

## 9.2 BLE path

1. LE secure pairing required.
2. Command writes rejected until BLE pairing/bonding and physical pair-mode authorization succeed.
3. Session invalidated on disconnect.

## 10. Error Codes

| Code | Meaning | Retryable |
| --- | --- | --- |
| `AUTH_FAILED` | Missing/invalid/expired auth | no |
| `INVALID_PAYLOAD` | Envelope or payload validation failed | no |
| `UNSUPPORTED_MSG_TYPE` | Unknown `msgType` | no |
| `DEVICE_BUSY` | Device temporarily unable to process command | yes |
| `RATE_LIMITED` | Sender exceeded rate quota | yes |
| `INTERNAL_ERROR` | Unexpected server/device failure | yes |

## 11. Compatibility and Versioning

1. `ver` must be present in every message.
2. Backward-compatible additions:
   - add optional fields
   - add new `msgType` values
3. Breaking changes require new major tag (example: `am.v2`).

## 12. Current Implementation Gap (explicit)

Already implemented:

1. Worker `/health`, `/v1/config` (latest-config merge/read), `/v1/state` (latest-state merge/read), `/v1/tracks` (derived track read), and `/v1/events` scaffold.
2. App fake mode and placeholder device polling mode.
3. Firmware BLE GATT scaffold (`controlTx`, `eventRx`, `snapshot`, `auth`) with chunked BLE framing and 2s reassembly timeout.
4. Firmware onboarding/control scaffold: physical pair-mode gate, auth session confirm, `onboarding.request_secret` -> `onboarding.boat_secret`, `config.patch` Wi-Fi apply, and `command.ack`.

Not yet implemented:

1. Shared `boatSecret` lifecycle (rotation/recovery/revoke flow).
2. Firmware status batching policy (30-second cloud flush, continuous BLE stream).
3. Full envelope, message-type, and config-schema validation hardening.
4. Push fan-out pipeline.
