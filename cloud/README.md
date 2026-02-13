# Cloud

Cloudflare Worker relay for remote ashore notifications.

## Layout

- `cloud/worker/wrangler.toml` worker config
- `cloud/worker/src/index.js` worker entrypoint

## Endpoints

- `GET /health` health probe
- `POST /v1/config` ingest `config.patch` and merge latest fields per boat config
- `GET /v1/config?boatId=...` return latest config as `config.snapshot`
- `POST /v1/state` ingest `status.patch` and merge latest fields per boat (latest-value model)
- `GET /v1/state?boatId=...` return latest state as `status.snapshot`
- `GET /v1/tracks?boatId=...` return derived historical track as `track.snapshot`
- `POST /v1/events` accepts discrete events (for example alarm lifecycle/acks)
- `Authorization: Bearer <boatSecret>` required for `/v1/*` when `BOAT_SECRET` is configured

`status.patch` and `config.patch` are processed by the same merge engine:
- patch inputs support dot-path maps and nested objects (same parser for both)
- objects deep-merge by field with per-field last-write-wins (`ts`)
- arrays replace whole arrays

## Storage backend

- Preferred: Cloudflare KV via Worker binding `RELAY_KV`.
- Fallback: in-memory maps (used only when no KV binding is configured; suitable for tests/local scratch only).
- `GET /health` includes `storage: "kv"` or `storage: "memory"` for runtime verification.

Create KV namespace IDs:

```bash
just worker-kv-create
```

This target creates both normal + preview namespaces and injects the binding in `cloud/worker/wrangler.toml` using `--update-config`.

## Auth model (KISS v1)

- One shared `boatSecret` per boat/device.
- `boatId` is a non-secret identifier only.
- Optional `BOAT_ID` env var can lock worker requests to one boat ID.

Set secret and optional scope:

```bash
npx --yes wrangler secret put BOAT_SECRET
# Set BOAT_ID in cloud/worker/wrangler.toml [vars] when you want a single-boat scope lock.
```

Or set non-secret `BOAT_ID` in `wrangler.toml` under `[vars]`.

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

- secret rotation/recovery flow
- push fan-out pipeline
- ack/silence sync path
