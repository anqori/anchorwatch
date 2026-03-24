# Anqori AnchorWatch Backend/API Cleanup Plan

Status date: 2026-03-24

## Goal

Keep the existing component topology and UI architecture, but replace the accumulated backend/API drift with one transport-agnostic protocol:

`server (hardware or mini-android app) <-> BLE or WLAN->cloud relay <-> AnchorWatch PWA`

The cloud worker is a dumb authenticated proxy. BLE and cloud carry the same request/reply messages. State and config are updated as whole values, never patches.

## Core Decisions

1. One wire contract for BLE and cloud:
   - client -> server: `{ req_id, type, data }`
   - server -> client: `{ req_id, state, type, data }`
   - reply states: `ONGOING`, `CLOSED_OK`, `CLOSED_FAILED`
2. `GET_DATA` is the single runtime stream:
   - bootstrap is a sequence of replies on the same `req_id`, not a special snapshot object
   - reply `type` changes across that sequence and names the payload, for example `STATE_POSITION`, `STATE_DEPTH`, `STATE_ANCHOR_POSITION`, or `TRACK_BACKFILL`
   - bootstrap includes current state/config values plus anchor-track backfill from `min(last_anchor_down_ts, now - 30 minutes)`
   - later replies continue streaming whole-value replacements and track backfill messages
3. Runtime state is server-authoritative and includes `anchor_position`.
   - app-writable config is limited to `alarm_config`, `obstacles`, `anchor_settings`, `profiles`, and `wlan_config`
4. Config writes use separate single-payload commands and compare-and-swap on the config DTO's own `version` field.
   - `UPDATE_CONFIG_ALARM`
   - `UPDATE_CONFIG_OBSTACLES`
   - `UPDATE_CONFIG_ANCHOR_SETTINGS`
   - `UPDATE_CONFIG_PROFILES`
   - `UPDATE_CONFIG_WLAN`
   - server-to-app replies are always authoritative overrides
5. Client cancellation is explicit with `type: "CANCEL"` and `data.original_req_id`.
6. Onboarding WLAN flows use the same protocol:
   - `SCAN_WLAN` is a streamed request that emits one `WLAN_NETWORK` entry at a time and closes with `ACK`
   - there is no `CONNECT_WLAN`; the app updates `wlan_config` with `UPDATE_CONFIG_WLAN` and observes WLAN behavior through streamed state/config replies, especially WLAN phase/error data in `STATE_WLAN_STATUS`
7. Every request, including `CANCEL`, must receive a reply unless the transport disconnects first.

## Current Refactor Status

- App BLE, cloud-relay, and fake transports now use the v2 command/state protocol.
- Firmware BLE command handling now uses v2 request/reply envelopes, whole-value updates, cancellation, and `GET_DATA` streaming.
- Relay worker now forwards opaque WebSocket payloads unchanged instead of understanding protocol message types.
- Active docs are being switched to v2; v1 plan/protocol material is archived under [`docs/history/v1/`](/home/pm/dev/anchormaster/docs/history/v1).

## Remaining Work

- Finish device/cloud end-to-end validation on real hardware.
- Add the device-side WLAN/cloud uplink runtime that publishes the same v2 envelopes over the relay.
- Decide the long-term greenfield onboarding secret exchange that replaces the old ad-hoc BLE event flow. The current code keeps pair/session state on the auth characteristic and exposes manual secret retrieval over serial while the v2 transport cleanup lands.
- Add the long-term cloud control plane:
  - users authenticate with OAuth
  - logged-in users explicitly create boats
  - only explicitly created boats are allowed on the relay
  - one durable object per `boat_id`
  - app and server both obtain short-lived WebSocket tickets before cloud socket establishment
  - app tickets are authorized from user access to the boat
  - server tickets are authorized from a boat-scoped server credential such as `boat_secret`

## Validation Rules

- App changes: `cd app && npm run check`
- Firmware changes: `just firmware-build`
- Cloud worker changes: `node --check cloud/worker/src/index.js`
- Markdown changes: `npx --yes markdownlint-cli2 <files...>`

## Archive

- Previous active plan: [`docs/history/v1/PLAN.md`](/home/pm/dev/anchormaster/docs/history/v1/PLAN.md)
- Previous Android helper plan: [`docs/history/v1/PLAN_ANDROID_HELPER.md`](/home/pm/dev/anchormaster/docs/history/v1/PLAN_ANDROID_HELPER.md)
- Previous protocol: [`docs/history/v1/protocol-v1.md`](/home/pm/dev/anchormaster/docs/history/v1/protocol-v1.md)
