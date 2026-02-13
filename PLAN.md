# Anqori AnchorWatch - Implementation Plan (Checklist)

Status date: 2026-02-12  
Legend: `[x] done`, `[ ] open`

## 1. Purpose

Build an MVP for:

1. On-boat ESP32-S3 device (NMEA2000 read-only, alarm logic, siren output)
2. Phone PWA control/monitoring
3. Cloudflare relay path for remote alerts
4. Grove-friendly build and printable case workflow

## 2. Progress Snapshot

- [x] Repository scaffold created (`firmware/`, `app/`, `cloud/`, `cad/`, `docs/`)
- [x] PRD and protocol draft created (`PRD.md`, `docs/protocol-v1.md`)
- [x] Cloudflare Pages + Worker scaffolds created
- [x] Cloud latest-config API scaffold created (`/v1/config`)
- [x] Cloud latest-state API scaffold created (`/v1/state`)
- [x] PWA fake mode implemented (works without device connection)
- [x] Firmware scaffold compiles with `just firmware-build`
- [x] Phase 2 firmware connectivity scaffold implemented (BLE + pair gate + onboarding + Wi-Fi config/status)
- [x] Phase 3 app control-plane scaffold implemented (BLE onboarding UI + boatSecret persistence + cloud verify)
- [x] App migrated to `Vite + Svelte + TypeScript` build-step workflow
- [x] Local validation automation added (lint + test + firmware build commands)
- [x] Execution order reprioritized to connectivity-first firmware bring-up
- [ ] Real device/cloud end-to-end alarm flow

## 3. Phase Checklist

## Phase 0 - Project Bootstrap

- [x] Create module folders (`firmware/`, `app/`, `cloud/`, `cad/`, `docs/`)
- [x] Add baseline docs (`PRD.md`, `BOM.md`, `docs/cloudflare-setup.md`)
- [x] Define initial message envelope and message catalog (`docs/protocol-v1.md`)
- [x] Define local transport approach (Wi-Fi HTTP + BLE GATT draft)
- [x] Add local lint/build/test validation commands
- [x] Freeze protocol contract for MVP

## Phase 1 - Hardware EVT

- [x] Select baseline hardware modules and alternatives (`BOM.md`)
- [x] Draft Berrybase-first BOM with direct links
- [ ] Create connector and pin map doc (CAN, power, siren, Grove)
- [ ] Bench-test power stability and siren switching
- [ ] Bench-test CAN RX on real NMEA2000 network
- [ ] Finalize first wiring guide

## Phase 2 - Firmware Connectivity Bring-up (Priority)

- [x] Firmware scaffold with 1 Hz loop and placeholder telemetry
- [x] Compile target working (`esp32:esp32:esp32s3`)
- [x] Implement BLE GATT profile on firmware (`controlTx`, `eventRx`, `snapshot`, `auth`)
- [x] Implement physical pair mode and BLE pairing gate (serial pair mode + auth session confirm)
- [x] Implement message processing framework (BLE first, WLAN later): JSON envelope parsing, validation, patch application, command routing, and ACK generation
- [x] Implement onboarding messages (`onboarding.boat_secret`, onboarding status fields, and secret-request handler)
- [x] Implement `config.patch` handling for `network.wifi.*` fields
- [x] Implement Wi-Fi station manager (connect/reconnect/backoff)
- [x] Implement cloud uplink status in `status.patch` (`system.wifi.*`, `system.cloud.*`)
- [x] Add serial debug logging/toggles for onboarding and connectivity traces

## Phase 3 - App/Device Control Plane

- [x] PWA mode framework exists (fake mode + device mode toggle)
- [x] Implement app BLE client path
- [x] Implement onboarding wizard (pair -> receive boat secret -> set Wi-Fi -> verify cloud)
- [x] Persist/use `boatSecret` in app for cloud `Authorization` header
- [x] Connect PWA device mode to real device endpoint (replace placeholder)
- [ ] Implement multi-phone sync conflict handling

## Phase 4 - Firmware Data Plane (NMEA + Tracking)

- [ ] Implement NMEA2000 PGN ingestion (position, direction, depth, wind)
- [ ] Implement data-age tracking and staleness flags
- [ ] Implement anchor modes (current, offset/angle, auto-detect, manual move)
- [ ] Persist sessions, tracks, and alarm history
- [ ] Publish normalized telemetry/state for app and cloud consumers

## Phase 5 - Alarm Engine

- [x] Placeholder trigger evaluation path exists in scaffold
- [ ] Implement all trigger types from PRD
- [ ] Implement hold-time and warning/full severity model
- [ ] Implement alarm output routing and delays
- [ ] Implement slider-based silence/snooze logic
- [ ] Add transition/audit log events

## Phase 6 - Cloudflare Relay + Push

- [x] Worker scaffold with `/health` and `/v1/events`
- [x] Worker scaffold with `/v1/config` latest-config API
- [x] Worker scaffold with `/v1/state` latest-state API
- [x] Worker scaffold with `/v1/tracks` derived track API
- [x] Align `status.patch` and `config.patch` merge logic via shared merge engine
- [x] Add KISS auth validation (shared `boatSecret`, optional `BOAT_ID` scope lock)
- [x] Replace in-memory latest-state map with durable storage
- [x] Persist cloud-derived track points with durable storage
- [x] Implement field-level last-write-wins merge rules in persistent layer
- [ ] Add push fan-out pipeline for alarm events
- [ ] Add acknowledge/silence sync via cloud
- [ ] Add delivery telemetry and operational metrics

## Phase 7 - PWA UX

- [x] Installable PWA shell (manifest + service worker)
- [x] Summary screen scaffold with simulated telemetry
- [x] Fake mode works without device connection
- [x] Shell to switch between different views / config
- [x] Onboarding Flow (bt-connect, key-exchange, wlan-config)
- [x] Satellite view screen
- [x] Map view screen
- [x] Radar view screen
- [ ] Anchor set flows (current/offset/auto/manual drag)
- [x] Trigger config UI + day/night profiles
- [x] Notification handling and reliability UX

## Phase 8 - Mechanical / STL

- [x] CAD workspace scaffold (`cad/`, `cad/out/`)
- [ ] Build enclosure CAD for selected stack
- [ ] Print and fit iteration #1
- [ ] Print and fit iteration #2
- [ ] Publish final `cad/out/*.stl`
- [ ] Add assembly and mounting notes

## Phase 9 - Verification

- [ ] Replay tests for anchor and trigger edge cases
- [ ] Hardware-in-loop CAN + siren tests
- [ ] On-water trial (calm anchorage)
- [ ] On-water trial (gusty/tidal anchorage)
- [ ] Soak test and reboot recovery verification
- [ ] MVP acceptance checklist sign-off

## 4. MVP Deliverables Checklist

- [x] `PRD.md`
- [x] `PLAN.md` (tickable execution plan)
- [x] `BOM.md`
- [x] Firmware scaffold buildable via `just firmware-build`
- [x] PWA scaffold deployable via Cloudflare Pages workflow
- [x] Worker scaffold deployable via Cloudflare Workers workflow
- [ ] Firmware NMEA2000 parser + full alarm engine
- [x] Full app screens (summary + satellite + map + radar)
- [ ] Remote push alert pipeline
- [ ] Grove wiring guide
- [ ] Final STL case files
- [ ] Bench + sea-trial test report

## 5. Next Steps (Now)

- [x] Review and freeze `docs/protocol-v1.md` for MVP
- [x] Implement firmware BLE GATT profile (`controlTx`, `eventRx`)
- [x] Implement firmware onboarding (`onboarding.boat_secret`) and config command ACKs
- [x] Implement firmware Wi-Fi apply/status via `config.patch` + `status.patch` (`system.wifi.*`, `system.cloud.*`)
- [x] Implement app BLE onboarding wizard and store/use `boatSecret`
- [x] Connect PWA device mode to real device endpoint (replace placeholder)
- [ ] Run first end-to-end control-plane test (BLE onboarding -> Wi-Fi -> cloud `GET /v1/state`)
- [x] Implement durable latest-state and track stores before push fan-out (KISS auth scaffold is in place)
- [ ] Start NMEA2000 ingestion after control-plane path is stable
- [ ] Write `docs/pin-map-v1.md` for exact hardware wiring
- [ ] Run first bench test: power + relay + siren + CAN listener
- [ ] Generate first enclosure draft STL around chosen modules

## 6. Known Blockers

- [x] Cloud deploy in this shell requires `CLOUDFLARE_API_TOKEN` set.
- [ ] Hardware not yet available for real device/cloud end-to-end test execution.
