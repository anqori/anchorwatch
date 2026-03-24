# Cloud

Cloudflare Worker relay for AnchorWatch WebSocket traffic.

## Layout

- `cloud/worker/wrangler.toml`
- `cloud/worker/src/index.js`

## Endpoint

- `GET /v1/pipe` with `Upgrade: websocket`

Query params:

- `boatId` required
- `deviceId` recommended
- `role` optional (`app` default, `device`)
- `boatSecret` required when `BOAT_SECRET` is configured

## Relay behavior

- one Durable Object room per `boatId`
- authenticated socket acceptance on connect
- opaque fan-out to every other socket in the same room
- no replay
- no state/config/track storage
- no protocol-specific control messages
- sender does not receive its own payload back

The worker is intentionally dumb. If a message is valid enough for the client/device to send, the relay just forwards it.

## Auth model

- one shared `boatSecret` per boat/device
- optional `BOAT_ID` env var can lock the worker to one boat ID

Set the secret:

```bash
npx --yes wrangler secret put BOAT_SECRET
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
