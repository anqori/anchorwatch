# Firmware

ESP32-S3 firmware for Anqori AnchorWatch.

## Current state

- Arduino sketch: `firmware/arduino-project/arduino-project.ino`
- BLE GATT service with:
  - `controlTx`
  - `eventRx`
  - `snapshot`
  - `auth`
- v2 command/reply protocol on BLE `controlTx`/`eventRx`
- `get-data` snapshot + live stream
- anchor-track backfill from retained recent history
- whole-part config/state replacement with per-part versions
- `scan-wlan` and streamed `connect-wlan`
- explicit request cancellation with `command: "cancel"`

The `auth` characteristic is now only for pair/session state. The main app/runtime protocol is the v2 JSON command stream described in [`docs/protocol-v2.md`](/home/pm/dev/anchormaster/docs/protocol-v2.md).

## Build

From repo root:

```bash
just firmware-core
just firmware-build
```

## Serial helper commands

```text
help
pair on
pair off
pair status
pair confirm
request secret
wifi status
debug on
debug off
```

`request secret` now prints the current credentials to serial only when pair mode and the privileged session are active. It no longer emits a separate BLE protocol event.
