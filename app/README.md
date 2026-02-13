# App

PWA client for Anqori AnchorWatch, deployed on Cloudflare Pages.

Stack:

- Vite
- Svelte
- TypeScript
- Konsta UI
- Tailwind CSS (for Konsta theme classes)

## Responsibilities

- device pairing and session auth
- live telemetry and trigger display
- anchor placement workflows
- day/night profile configuration
- alarm acknowledgement/silence slider
- multi-phone collaboration
- fake mode for offline/demo use without device connection

## Connectivity strategy for v1

- BLE local control/onboarding path (no non-BLE fallback in v1)
- cloud sync via HTTPS to Cloudflare Worker using `boatSecret` bearer auth
- remote push via Cloudflare Worker relay

## Files

- `app/src/App.svelte` main UI and control-plane logic
- `app/src/main.ts` app bootstrap
- `app/public/manifest.webmanifest` install metadata
- `app/public/sw.js` service worker
- `app/public/icons/` app icons

## Local development

From repo root (first install once):

```bash
cd app && npm ci
just pwa-run
```

Type check and build:

```bash
cd app && npm ci && npm run check
```

## Deploy to Cloudflare Pages

From repo root:

```bash
just cloudflare-release
```

After deploy, install from browser:

1. Open Pages URL on phone.
2. Use browser install flow (`Add to Home Screen` / `Install app`).

## BLE prerequisites / troubleshooting

- Web Bluetooth requires a secure context (`https://` or `localhost`).
- Linux Chrome may need experimental web platform features enabled for BLE:
  1. Open `chrome://flags/#enable-experimental-web-platform-features`
  2. Enable the flag.
  3. Restart Chrome.
