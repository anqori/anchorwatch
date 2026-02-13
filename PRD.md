# Anqori AnchorWatch - Product Requirements Document (PRD)

## 1. Document Control

- Version: 0.1
- Date: 2026-02-12
- Status: Draft for implementation
- Scope choice: PRD + implementation plan only
- Baseline decisions:
  - Hardware: ESP32-S3 + CAN transceiver + Grove pluggable modules + siren output
  - NMEA2000 role: Read-only listener
  - Connectivity: BLE local + Wi-Fi remote (with PWA constraints noted below)
  - Docs location: repo root (`PRD.md`, `PLAN.md`)

## 2. Product Vision

Build a small, marine-ready anchor alarm device that reads NMEA2000 boat data (position, direction, depth, wind), runs alarm logic onboard, and alerts crew locally and remotely through a PWA so the phone can be taken ashore while the boat is still protected.

## 3. Problem Statement

Current anchor alarms are often single-signal and phone-tethered. They do not combine heading, wind, depth, and movement well enough to handle real anchoring edge cases (wind against tide, dragging with stale data, phone sleeping, user away from boat).

## 4. Product Goals

1. Detect dangerous anchor states earlier and with fewer false alarms than simple radius-only alarms.
2. Keep monitoring active on the boat even when no phone is nearby.
3. Support multiple phones for the same boat, with shared live state and config.
4. Use plug-and-play Grove hardware and provide printable STL case files.
5. Deliver core UX as installable PWA.

## 5. Non-Goals (v1)

1. Autopilot or engine control actions.
2. NMEA2000 transmit/talker behavior.
3. Full chartplotter replacement.
4. Cellular modem integration (assumes onboard internet/hotspot for remote use).

## 6. Key Differentiators

1. Multi-signal anchor safety model: GPS position + heading/direction + depth + wind.
2. "Pushed over anchor" trigger: boat points toward anchor while not above anchor.
3. Anchor set workflows beyond "drop pin now":
  - current position
  - offset + angle (angle set by phone pointing)
  - auto-detect anchoring sequence (forward, stall/drop, reverse/drift)
  - manual drag/drop
4. Remote-owner model: controller phone can leave boat; device keeps watching and can push alerts remotely.

## 7. Users and Core Use Cases

### Primary users

1. Solo sailors and cruising couples anchoring overnight.
2. Crew who split watch duties across multiple phones.

### Critical use cases

1. Set anchor point quickly in rough conditions and start monitoring in < 20 seconds.
2. Leave boat and still receive actionable alarms ashore.
3. Detect dragging, wind shifts, depth risk, stale data, and speed anomalies.
4. Temporarily silence alarm via intentional slider action (anti-accidental).

## 8. System Overview

### On-boat device

1. ESP32-S3 firmware.
2. NMEA2000 CAN read-only ingestion.
3. Local alarm engine and siren output.
4. BLE + Wi-Fi connectivity.
5. Persistent local storage for anchor sessions and boat tracks.

### Client layer

1. Installable PWA (phone/tablet).
2. Live dashboards (summary/map/satellite/radar).
3. Multi-phone shared configuration.
4. Remote alert delivery via push path.

### Cloudflare relay (for ashore alerts)

1. Device/app event uplink over Wi-Fi internet.
2. Push notification fan-out to all authorized phones.
3. Minimal account/boat binding and auth.

## 9. Functional Requirements

## 9.1 Hardware

1. CAN bus interface for NMEA2000 (marine CAN transceiver + proper connector strategy).
2. Wi-Fi and BLE radios via ESP32-S3.
3. Local siren output driver (with support for Grove relay/siren path).
4. Grove plug-and-play ports for supported peripherals.
5. Case:
  - printable STL enclosure
  - sealed or splash-resistant design target
  - mounting features for cockpit/cabin install
6. Power input suitable for boat supply through regulated conversion.

## 9.2 NMEA2000 Data Ingestion (read-only)

1. Ingest and normalize at minimum:
  - position
  - COG/SOG or heading/direction
  - depth
  - wind speed/direction
2. Track data age per signal family (GPS age, other data age).
3. Handle missing/stale PGNs gracefully and expose quality state to UI and alarms.

## 9.3 Anchor Position Setup Modes

1. Set anchor = current position.
2. Set anchor = offset (meters) + angle (degrees).
  - Angle can be set by phone pointing using orientation sensors.
3. Auto-mode:
  - Start tracking from activation.
  - Detect typical sequence: forward movement -> stall/drop -> reverse/drift.
  - Choose best estimated anchor point from that sequence.
4. Manual anchor move by drag/drop in map.

## 9.4 Allowed Area / Zone

1. Circle zone around anchor (radius meters).
2. Freehand/polygon zone painted on map around anchor.
3. Zone changes are versioned and synced to all connected phones.

## 9.5 Alarm Triggers (multiple active at once)

1. Wind shift above threshold.
2. Wind above X knots.
3. Pushed over anchor condition.
4. Depth below X meters.
5. Boat outside allowed area.
6. Boat speed > X knots for > Y seconds.
7. GPS data age too high.
8. Other critical data age too high.
9. Phone battery below threshold (per paired phone).

## 9.6 Trigger Configuration

1. Per-trigger hold time before state changes to active.
2. Trigger severity:
  - warning (escalating beeps, acknowledge required)
  - full alarm (immediate wake-up behavior)
3. Per-output delay after trigger (for siren and phone push independently).

## 9.7 Alarm Outputs (multiple active at once)

1. Local siren output.
2. Phone app alert (push/local notification path).

## 9.8 Alarm Silence / Snooze

1. Active alarm can be silenced only via slider gesture.
2. Silence duration is preconfigured.
3. On silence expiry, active trigger state is re-evaluated and alarms can re-fire.

## 9.9 Day/Night Profiles

1. Separate day/night settings for:
  - color scheme: full, red, blue
  - brightness
  - alarm behavior/output profile
2. Optional automatic switching (time-based and/or sunset-sunrise based).

## 9.10 Main App Screens

1. Summary screen:
  - text-first key values, trigger status, GPS age, tiny map
2. Satellite view:
  - satellite tiles, anchor + boat markers, trigger OSD, optional path overlay
3. Map view:
  - standard map tiles, same overlays
4. Radar view:
  - relative anchor/boat orientation-centric display

## 9.11 Multi-Phone Collaboration

1. Multiple phones concurrently connected to one boat.
2. All can view live state.
3. Authorized users can update config; updates sync in near real time.
4. Conflict handling: last-write-wins with audit log entry.

## 9.12 Connectivity and Pairing

1. Local:
  - BLE path required for onboarding and local control.
2. Remote:
  - Device uses internet uplink via boat hotspot/starlink.
  - Remote alerts and status via Cloudflare Worker relay + push.
3. Pairing flow:
  - physical device ownership action
  - QR or numeric code onboarding
  - shared boat secret distributed during BLE onboarding.

## 10. PWA Feasibility and Constraints (explicit check)

## 10.1 What is possible

1. Push notifications in PWA are supported on iOS/iPadOS home-screen web apps and use APNs.
2. Push can wake service worker paths even when app is not foreground/loaded.
3. Device orientation APIs can be used for "point phone to set angle" in secure contexts; some agents require explicit permission from a user gesture.
4. Screen Wake Lock API can reduce sleep while app is actively displayed.

## 10.2 What is not reliable/available

1. Service workers are event-driven and are not continuously running in background.
2. Background Sync / Periodic Background Sync are not supported in Safari/iOS (current compatibility data).
3. Web Bluetooth is not supported in Safari/iOS; therefore BLE-only local control cannot be PWA-universal.

## 10.3 Product decision for v1

1. Keep PWA as primary client.
2. Local onboarding/control is BLE-only (no non-BLE fallback in v1).
3. Keep alarm evaluation on device, not in phone, so app sleep does not break safety.
4. Use remote push relay for ashore notifications.

## 11. Data Model (v1)

1. Boat
2. Device
3. Anchor session
4. Anchor point versions
5. Zone versions (circle/polygon)
6. Telemetry samples (position/heading/wind/depth/speed/data age)
7. Trigger evaluations and transitions
8. Alarm events and acknowledgements/silence windows
9. User/phone membership and permissions

## 12. Non-Functional Requirements

1. Safety and reliability:
  - local alarms continue without phone connection
  - reboot recovery to safe state
2. Latency:
  - trigger evaluation tick <= 1s target
  - local siren start <= 2s from confirmed trigger
3. Data retention:
  - at least recent anchor sessions locally
4. Security:
  - authenticated pairing
  - encrypted remote transport
  - signed firmware updates (roadmap)
5. UX:
  - readable at night with red/blue schemes
  - glove/wet-finger tolerant core controls

## 13. Acceptance Criteria (MVP)

1. Device reads live NMEA2000 inputs (position/direction/depth/wind) and displays freshness.
2. All four anchor-point workflows operate end-to-end.
3. Circle and polygon zones both trigger correctly on breach.
4. All listed triggers can be enabled simultaneously and evaluated independently.
5. Warning/full alarm severities and per-output delays function as configured.
6. Slider-based silence applies for configured snooze and then re-arms correctly.
7. Two or more phones can observe and edit one boat configuration with sync.
8. Local siren alarms without any phone connected.
9. Remote push reaches a paired phone while away from local boat network.
10. Grove-based assembly guide + printable STL case provided.

## 14. Risks and Mitigations

1. iOS BLE gap for PWA:
  - Mitigation: explicit product constraint in v1; require at least one BLE-capable onboarding/client device.
2. NMEA2000 vendor/PGN variability:
  - Mitigation: tolerant parser + data-quality flags + field testing on real networks.
3. False positives in complex tide/wind scenarios:
  - Mitigation: hold-time filters, multi-signal confirmation, replay tooling from logs.
4. Notification delivery delays due to OS focus/battery policies:
  - Mitigation: local siren as primary safety output; push as secondary remote channel.

## 15. References

1. WebKit: Web Push for iOS/iPadOS Home Screen web apps  
   https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
2. WebKit: Declarative Web Push (energy/privacy model, no silent push)  
   https://webkit.org/blog/16535/meet-declarative-web-push/
3. MDN: Push API (foreground/background delivery model)  
   https://developer.mozilla.org/en-US/docs/Web/API/Push_API
4. MDN: Offline and background operation (service workers are event-driven, not always running)  
   https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation
5. Can I use: Web Bluetooth (Safari/iOS not supported as of Jan 2026 data)  
   https://caniuse.com/web-bluetooth
6. Can I use: Background Sync API (Safari/iOS not supported)  
   https://caniuse.com/background-sync
7. Can I use: Periodic Background Sync (Safari/iOS not supported)  
   https://caniuse.com/wf-periodic-background-sync
8. MDN: Detecting device orientation (permission + user gesture requirements)  
   https://developer.mozilla.org/en-US/docs/Web/API/Device_orientation_events/Detecting_device_orientation
9. MDN: Screen Wake Lock API  
   https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API
