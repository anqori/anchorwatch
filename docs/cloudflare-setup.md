# Cloudflare Setup (Local CD with `just`)

This repository uses local commands for build/deploy orchestration.

Environments:

- `run`: localhost only
- `dev`: Cloudflare dev domains
- `release`: Cloudflare live domains

## 1) Domain map

PWA:

- release: `aw.anqori.com`
- dev: `dev-aw.anqori.com`

Worker:

- release: `aw-cloud.anqori.com`
- dev: `dev-aw-cloud.anqori.com`

`run` uses localhost:

- local worker URL: `http://127.0.0.1:8787`

## 2) Command map

- `just firmware`
  - compile + upload firmware to local board
- `just cloudflare-dev`
  - build app + deploy PWA to dev Pages project
  - deploy Worker with `--env dev`
- `just cloudflare-release`
  - build app + deploy PWA to release Pages project
  - deploy Worker (top-level env)
- `just release`
  - ensure clean repo
  - create next semantic tag `vX.Y.Z`
- `just pwa-run`
  - run PWA locally
  - defaults relay base URL to local worker URL
- `just cloudflare-run`
  - run Worker locally on `127.0.0.1:8787`

## 3) Prerequisites

1. Install Node.js 20+.
2. Install `just`.
3. Install Arduino CLI + ESP32 core for firmware commands.
4. Create a Cloudflare API token with:
   - `Cloudflare Workers Scripts:Edit`
   - `Cloudflare Pages:Edit`
   - `Zone:Workers Routes:Edit`
   - `Zone:Zone:Read`
   - `Account Settings:Read` (recommended)

## 4) Local env files

Use tracked `.env` for non-secrets and local `.env.secret` for secrets.
Create `.env.secret`:

```bash
cat > .env.secret <<'EOF'
CLOUDFLARE_API_TOKEN=replace_with_token
EOF
```

Configure non-secret values in `.env` (defaults already point to `anqori` domains):

```bash
# CLOUDFLARE_ACCOUNT_ID=your_account_id  # required for worker deploy; get via `npx --yes wrangler whoami`
# CF_PAGES_PROJECT_RELEASE=anqori-anchorwatch-pwa
# CF_PAGES_PROJECT_DEV=anqori-anchorwatch-pwa-dev
# CF_PAGES_DOMAIN_RELEASE=aw.anqori.com
# CF_PAGES_DOMAIN_DEV=dev-aw.anqori.com
# CF_PAGES_PRODUCTION_BRANCH=main
```

Optional local-run overrides:

```bash
RUN_CLOUD_URL=http://127.0.0.1:8787
RUN_CLOUD_HOST=127.0.0.1
RUN_CLOUD_PORT=8787
```

Only `.env.secret` should contain sensitive values and is gitignored.

## 5) One-time Cloudflare setup

Pages setup is automatic on deploy:

- `just cloudflare-dev` ensures `anqori-anchorwatch-pwa-dev` exists and attaches `dev-aw.anqori.com`
- `just cloudflare-release` ensures `anqori-anchorwatch-pwa` exists and attaches `aw.anqori.com`
- If Cloudflare reports `CNAME record not set`, create DNS CNAME records:
  - `dev-aw.anqori.com` -> `anqori-anchorwatch-pwa-dev.pages.dev`
  - `aw.anqori.com` -> `anqori-anchorwatch-pwa.pages.dev`

Set Worker secrets:

```bash
just worker-secret-put-release
just worker-secret-put-dev
```

Worker custom domains/routes are defined in `cloud/worker/wrangler.toml` and deployed automatically:

- release worker -> `https://aw-cloud.anqori.com`
- dev worker (`--env dev`) -> `https://dev-aw-cloud.anqori.com`

## 6) Local run workflow

Terminal 1:

```bash
just cloudflare-run
```

Terminal 2:

```bash
just pwa-run
```

In app onboarding, relay URL defaults to local worker URL if no relay URL is stored yet.

## 7) Deploy workflow

Dev deploy:

```bash
just cloudflare-dev
```

Release deploy:

```bash
just release
just cloudflare-release
```

Firmware build + upload:

```bash
just firmware
```
