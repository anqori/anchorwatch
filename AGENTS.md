# Repository Guidelines

## Project Structure & Module Organization

This repository is split by deployment target:

- `firmware/arduino-project/`: ESP32-S3 Arduino firmware (`arduino-project.ino`)
- `app/site/`: installable PWA assets (`index.html`, `main.js`, `sw.js`, manifest, icons)
- `cloud/worker/`: Cloudflare Worker relay (`wrangler.toml`, `src/index.js`)
- `cad/`: enclosure docs and generated STL outputs (`cad/out/`)
- `docs/`: architecture, setup, and protocol contracts (`docs/protocol-v1.md`)

Keep new files in the matching domain folder. Cross-cutting docs belong in `docs/`.

## Build, Test, and Development Commands

Use root `just` recipes:

- `just firmware-core`: install/update Arduino core dependencies (ESP32)
- `just firmware-build`: compile firmware for `esp32:esp32:esp32s3`
- `PORT=/dev/ttyACM0 BAUD=115200 just firmware-monitor`: serial monitor
- `just pwa-run`: run PWA locally (Vite)
- `just cloudflare-run`: run Worker locally
- `just cloudflare-dev`: deploy cloud + PWA to dev domains
- `just cloudflare-release`: deploy cloud + PWA to release domains

Validation tools used in this repo:

- `npx --yes markdownlint-cli2 <files...>`
- `node --check cloud/worker/src/index.js`

## Coding Style & Naming Conventions

- Use 2-space indentation in JS/JSON/HTML.
- Prefer small, explicit functions over large monolithic handlers.
- Use clear constants for protocol keys and endpoints (for example `MODE_FAKE`, `DEVICE_STATUS_URL`).
- Keep protocol terms aligned with `docs/protocol-v1.md` (`msgType`, `msgId`, `seq`, `ts`).

## Testing Guidelines

There is no full automated test suite yet. Minimum required before review:

1. Firmware compiles (`just firmware-build`).
2. Edited JS passes syntax check (`node --check ...`).
3. Edited Markdown passes lint (`markdownlint-cli2`).

When adding protocol or transport logic, include at least one replayable example payload in docs or tests.

## Commit & Pull Request Guidelines

- Write commit summaries in imperative mood and include scope.
  Example: `Add protocol v1 envelope and BLE characteristic map`.
- Keep PRs focused by domain (`firmware`, `app`, `cloud`, `docs`, `cad`).
- PR description should include:
  - what changed
  - how to validate (commands run)
  - screenshots for UI changes
  - any config or token requirements (for example `CLOUDFLARE_API_TOKEN`)

## Security & Configuration Tips

- Never commit secrets or tokens.
- Use environment variables for Cloudflare auth (`CLOUDFLARE_API_TOKEN`).
- Treat onboard siren logic as primary safety path; cloud/push alerts are secondary.
