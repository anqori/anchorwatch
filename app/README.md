# App

PWA client for Anqori AnchorWatch, deployed on Cloudflare Pages.

Stack:

- Vite
- Svelte
- TypeScript
- Konsta UI
- Tailwind CSS

## Responsibilities

- live telemetry and alarm display
- anchor placement workflows
- config editing
- BLE local control
- remote relay control
- fake mode for offline/demo use

## Connectivity strategy

- BLE local path uses the same v2 command/reply envelopes as the cloud path
- remote path uses WebSocket relay fan-out via Cloudflare Worker
- relay is transport-only and forwards opaque payloads
- app keeps the existing UI/state shape and maps v2 multipart payloads back into it

See [`docs/protocol-v2.md`](/home/pm/dev/anchormaster/docs/protocol-v2.md) for the active contract.

## Local development

From repo root:

```bash
cd app && npm ci
just pwa-run
```

Type check:

```bash
cd app && npm run check
```

## Deploy

From repo root:

```bash
just cloudflare-release
```
