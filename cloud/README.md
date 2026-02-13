# Cloud

Cloudflare Worker relay for AnchorWatch message forwarding.

## Layout

- `cloud/worker/wrangler.toml` worker config
- `cloud/worker/src/index.js` worker + Durable Object relay implementation

## Endpoint

- `GET /v1/pipe` with `Upgrade: websocket`
  - query params:
    - `boatId` required
    - `deviceId` recommended
    - `role` optional (`app` default, `device`)
    - `boatSecret` required when `BOAT_SECRET` is configured

## Relay behavior

- One Durable Object room per `boatId`.
- Messages are forwarded unchanged to all other sockets in the same room.
- No buffering, no replay, no derived state/config/track storage.
- Sender does not receive its own message back.

Relay-local control message:

- `relay.probe` -> relay responds directly with `relay.probe.result` (never routed to peers).

## Auth model (KISS v1)

- One shared `boatSecret` per boat/device.
- `boatId` is a non-secret identifier only.
- Optional `BOAT_ID` env var can lock relay requests to one boat ID.

Set secret and optional scope:

```bash
npx --yes wrangler secret put BOAT_SECRET
# Set BOAT_ID in cloud/worker/wrangler.toml [vars] for single-boat scope lock.
```

## Local dev

From repo root:

```bash
just cloudflare-run
```

## Deploy

From repo root:

```bash
just cloudflare-release
```

## Next implementation steps

- device-side WLAN relay WebSocket client
- secret rotation/recovery flow
- push fan-out pipeline
