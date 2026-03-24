# Firmware

ESP32-S3 firmware for Anqori AnchorWatch.

Firmware-specific implementation target details live in [`docs/server-firmware-spec.md`](/home/pm/dev/anchormaster/docs/server-firmware-spec.md).

## Current state

- Arduino sketch: `firmware/arduino-project/arduino-project.ino`
- multi-file runtime in `firmware/arduino-project/aw_*.{h,cpp}`
- BLE GATT service with:
  - `controlTx`
  - `eventRx`
  - `snapshot`
  - `auth`
- transport-stable BLE UUIDs and BLE chunk framing
- v2 `{ req_id, type, data }` request / `{ req_id, state, type, data }` reply protocol on BLE `controlTx`/`eventRx`
- `GET_DATA` bootstrap + ongoing stream
- whole-value config/state replies with config DTO compare-and-swap versioning
- `CONFIG_SYSTEM.runtime_mode` with shared `LIVE` / `SIMULATION` behavior
- `SCAN_WLAN` streamed as one `WLAN_NETWORK` reply at a time and closed with `ACK`
- explicit request cancellation with `type: "CANCEL"`
- cloud uplink over WLAN with relay-issued WebSocket tickets and session-isolated remote app traffic

The `auth` characteristic is now only for local pairing/privileged-session state. The main app/runtime protocol is the v2 JSON command stream described in [`docs/protocol-v2.md`](/home/pm/dev/anchormaster/docs/protocol-v2.md).

## Build

From repo root:

```bash
just firmware-core
just firmware-build
```

The default firmware recipes now build with `PartitionScheme=huge_app`, because TLS + cloud uplink no longer fits in the old 1.2 MB app partition.

## Serial helper commands

```text
help
pair on
pair off
pair status
wifi status
debug on
debug off
```
