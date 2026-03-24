# Cloud

Cloudflare Worker relay for AnchorWatch cloud traffic.

This relay is transport-only. It authenticates boats, issues short-lived WebSocket tickets, and routes opaque protocol payloads between apps and the authoritative server for one boat.

## Layout

- `cloud/worker/wrangler.toml`
- `cloud/worker/src/index.js`

## Runtime Model

- one registry durable object for the preconfigured boat auth store and `ws_ticket` lifecycle
- one durable object per `boat_id` for live socket routing
- at most one active server cloud socket per boat
- zero or many active app cloud sockets per boat
- one relay-scoped `cloud_conn_id` per app cloud session

The relay does not store or derive business state. It only forwards opaque v2 payloads.

## HTTP API

### `POST /v1/ws-ticket`

Request:

```json
{
  "boat_id": "BOAT_123",
  "boat_secret": "secret",
  "role": "app"
}
```

Response:

```json
{
  "boat_id": "BOAT_123",
  "role": "app",
  "ws_ticket": "6b8173b4-4a7d-4616-8f31-91ead89470c5",
  "expires_at": 1770897600000
}
```

### `POST /v1/update-boat-secret`

Request:

```json
{
  "boat_id": "BOAT_123",
  "old_secret": "old_secret",
  "new_secret": "new_secret"
}
```

Response:

```json
{
  "boat_id": "BOAT_123",
  "updated": true
}
```

### `GET /v1/pipe?ticket=...`

This upgrades to WebSocket after redeeming the ticket.

The accepted socket belongs to exactly one `boat_id` and one role (`app` or `server`).

## Server-Facing Relay Envelope

App sockets send and receive plain v2 business messages.

The server cloud socket receives a relay transport envelope so multiple app sessions can stay isolated:

```json
{
  "kind": "PAYLOAD",
  "cloud_conn_id": "c_1",
  "payload": {
    "req_id": "01HZXJ0Q8J72E9K4N5P6R7S8T9",
    "type": "GET_DATA",
    "data": {}
  }
}
```

Supported relay transport kinds:

- `OPEN`
- `PAYLOAD`
- `CLOSE`

## Configuration

`PRECONFIGURED_BOATS_JSON` is the bootstrap boat registry input. Store it as a Worker secret, not in `wrangler.toml`.

For deployment through the repo `just` recipes, provide `PRECONFIGURED_BOATS_JSON` in `.env.secret`.

Example:

```bash
npx --yes wrangler secret put PRECONFIGURED_BOATS_JSON
```

Example JSON:

```json
[
  {
    "boat_id": "BOAT_123",
    "boat_secret": "secret-a",
    "enabled": true
  },
  {
    "boat_id": "BOAT_456",
    "boat_secret": "secret-b",
    "enabled": true
  }
]
```

Notes:

- boats are seeded from this secret on first use
- rotated secrets are persisted in the registry durable object
- `WS_TICKET_TTL_MS` controls ticket lifetime and defaults to 60 seconds
- `just cloudflare-dev` and `just cloudflare-release` now push `PRECONFIGURED_BOATS_JSON` automatically before deploying the worker

## Local Dev

From repo root:

```bash
just cloudflare-run
```

## Deploy

From repo root:

```bash
just cloudflare-release
```
