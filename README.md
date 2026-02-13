# Anqori AnchorWatch

Official product domain: https://anqori.com  
Repository: https://github.com/anqori/anchorwatch

Anchor alarm device + PWA system.

This repository is scaffolded for:

- ESP32-S3 firmware via `arduino-cli`
- PWA app layer hosted on Cloudflare Pages
- cloud relay for remote notifications on Cloudflare Workers
- CAD/STL enclosure artifacts

The product requirements and roadmap are in:

- `PRD.md`
- `PLAN.md`
- `BOM.md`

## Layout

- `firmware/arduino-project/` Arduino sketch (ESP32-S3)
- `app/` PWA implementation (`app/src` source, `app/dist` build output for Pages)
- `cloud/` Cloudflare Worker relay/push service
- `cad/` enclosure sources and STL outputs
- `docs/` technical notes and data contracts

## Local Workflow (`just`)

Install ESP32 core:

```bash
just firmware-core
```

Build:

```bash
just firmware-build
```

Upload:

```bash
PORT=/dev/ttyACM0 just firmware-upload
```

Serial monitor:

```bash
PORT=/dev/ttyACM0 BAUD=115200 just firmware-monitor
```

## Cloudflare Setup (Install + API Keys + Pages + Worker)

### 1) Install prerequisites

Install Node.js 20+.

Wrangler options:

- recommended in this repo: use `npx --yes wrangler ...` (no global install)
- optional global install: `npm install -g wrangler`

Verify Wrangler:

```bash
npx --yes wrangler --version
```

Install app dependencies once:

```bash
cd app && npm ci
```

### 2) Create the Cloudflare API token

Create a custom token in Cloudflare Dashboard:
`My Profile -> API Tokens -> Create Custom Token`.

Required permissions:

- `Account` -> `Cloudflare Pages:Edit` (Pages create/deploy)
- `Account` -> `Workers Scripts:Edit` (Worker deploy + `wrangler secret put`)
- `Account` -> `Workers KV Storage:Edit` (for `just worker-kv-create`)
- `Zone` -> `Workers Routes:Edit` (bind worker to `aw-cloud.anqori.com` / `dev-aw-cloud.anqori.com`)
- `Zone` -> `Zone:Read` (resolve zone ID for route checks)

Recommended permission:

- `Account` -> `Account Settings:Read` (Wrangler account discovery)

Scope the token to the Cloudflare account you deploy to.

### 3) Configure local deployment secrets

`.env` now contains non-secret defaults. Create `.env.secret` with only your token:

```bash
cat > .env.secret <<'EOF'
CLOUDFLARE_API_TOKEN=replace_with_cloudflare_api_token
EOF
```

Optional non-secret overrides live in `.env`:

```bash
# CLOUDFLARE_ACCOUNT_ID=your_account_id  # required for worker deploy; get via `npx --yes wrangler whoami`
# CF_PAGES_PROJECT_RELEASE=anqori-anchorwatch-pwa
# CF_PAGES_PROJECT_DEV=anqori-anchorwatch-pwa-dev
# CF_PAGES_DOMAIN_RELEASE=aw.anqori.com
# CF_PAGES_DOMAIN_DEV=dev-aw.anqori.com
# CF_PAGES_PRODUCTION_BRANCH=main
# CF_KV_NAMESPACE_NAME=anqori-anchorwatch-relay
# CF_KV_BINDING=RELAY_KV
```

`just` loads both `.env` and `.env.secret` for run/deploy targets.

### 4) Pages + domain auto-setup

`just cloudflare-dev` and `just cloudflare-release` now auto-create missing Pages projects and attach custom domains (`dev-aw.anqori.com`, `aw.anqori.com`) before deploy.
If Cloudflare reports `CNAME record not set`, create DNS CNAME records:
- `dev-aw.anqori.com` -> `anqori-anchorwatch-pwa-dev.pages.dev`
- `aw.anqori.com` -> `anqori-anchorwatch-pwa.pages.dev`

### 5) One-time Worker KV creation + binding injection

Create Worker KV namespaces (normal + preview) and auto-inject into `cloud/worker/wrangler.toml`:

```bash
just worker-kv-create
```

### 6) Local development

App frontend (Vite):

```bash
just pwa-run
```

Worker relay:

```bash
just cloudflare-run
```

### 7) Configure Worker API secrets

Set required API auth secret for `/v1/*` routes:

```bash
npx --yes wrangler secret put BOAT_SECRET
```

Optional boat scope lock:

```bash
npx --yes wrangler secret put BOAT_ID
```

### 8) Deploy

Deploy Pages:

```bash
just cloudflare-release
```

For dev deploys, use:

```bash
just cloudflare-dev
```

### 9) Quick verification

Check Worker health:

```bash
curl -i https://<your-worker-domain>/health
```

Open your Pages URL and confirm the app loads.
