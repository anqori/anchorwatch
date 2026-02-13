# Firmware

ESP32-S3 firmware for Anqori AnchorWatch.

Current state:

- Arduino sketch scaffold at `firmware/arduino-project/arduino-project.ino`
- Phase 2 connectivity scaffold implemented:
  - BLE GATT service (`controlTx`, `eventRx`, `snapshot`, `auth`)
  - physical pair-mode gate + auth session confirm
  - JSON message framework (parse/route/ack) for BLE with WLAN-ready handler path
  - onboarding messages (`onboarding.request_secret` -> `onboarding.boat_secret`)
  - `config.patch` handling for `network.wifi.*` plus Wi-Fi reconnect manager
  - periodic `status.patch` with `system.wifi.*` / `system.cloud.*`

Build from repo root:

```bash
just firmware-core
just firmware-build
```

Serial helper commands during bring-up:

```text
help
pair on
pair confirm
request secret
pair status
wifi status
debug on
debug off
```
