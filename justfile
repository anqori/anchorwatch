default:
  @just --list

help:
  @just --list

# Create next semantic release tag (vX.Y.Z) on current revision.
release:
  #!/usr/bin/env bash
  set -euo pipefail
  ./scripts/versioning.sh ensure-clean
  version="$(./scripts/versioning.sh create-next-release-tag)"
  echo "Created release tag: $version"
  echo "Tip: run 'just cloudflare-release' to deploy release artifacts."

[private]
firmware-core:
  #!/usr/bin/env bash
  set -euo pipefail
  arduino_cli="${ARDUINO_CLI:-arduino-cli}"
  cli_config="${CLI_CONFIG:-arduino-cli.yaml}"
  core="${CORE:-esp32:esp32}"
  "$arduino_cli" core update-index --config-file "$cli_config"
  "$arduino_cli" core install "$core" --config-file "$cli_config"

[private]
firmware-build:
  #!/usr/bin/env bash
  set -euo pipefail
  version="$(./scripts/versioning.sh firmware-id)"
  echo "Firmware build version: $version"
  arduino_cli="${ARDUINO_CLI:-arduino-cli}"
  cli_config="${CLI_CONFIG:-arduino-cli.yaml}"
  fqbn="${FQBN:-esp32:esp32:esp32s3}"
  board_options="${BOARD_OPTIONS:-}"
  build_dir="${BUILD_DIR:-build}"
  sketch_dir="${SKETCH_DIR:-firmware/arduino-project}"
  board_args=()
  if [[ -n "$board_options" ]]; then board_args=(--board-options "$board_options"); fi
  "$arduino_cli" compile --config-file "$cli_config" --fqbn "$fqbn" "${board_args[@]}" --build-property "build.extra_flags=-DANQORI_BUILD_VERSION=\"$version\"" --build-path "$build_dir" "$sketch_dir"

[private]
firmware-upload:
  #!/usr/bin/env bash
  set -euo pipefail
  arduino_cli="${ARDUINO_CLI:-arduino-cli}"
  cli_config="${CLI_CONFIG:-arduino-cli.yaml}"
  fqbn="${FQBN:-esp32:esp32:esp32s3}"
  board_options="${BOARD_OPTIONS:-}"
  build_dir="${BUILD_DIR:-build}"
  sketch_dir="${SKETCH_DIR:-firmware/arduino-project}"
  port="${PORT:-$($arduino_cli board list --config-file "$cli_config" | awk 'NR==2 {print $1}')}"
  if [[ -z "$port" ]]; then echo "PORT not set and no board auto-detected. Set PORT=/dev/tty..." >&2; exit 1; fi
  board_args=()
  if [[ -n "$board_options" ]]; then board_args=(--board-options "$board_options"); fi
  "$arduino_cli" upload --config-file "$cli_config" --fqbn "$fqbn" "${board_args[@]}" --build-path "$build_dir" -p "$port" "$sketch_dir"

[private]
firmware-monitor:
  #!/usr/bin/env bash
  set -euo pipefail
  arduino_cli="${ARDUINO_CLI:-arduino-cli}"
  cli_config="${CLI_CONFIG:-arduino-cli.yaml}"
  fqbn="${FQBN:-esp32:esp32:esp32s3}"
  port="${PORT:-$($arduino_cli board list --config-file "$cli_config" | awk 'NR==2 {print $1}')}"
  baud="${BAUD:-115200}"
  if [[ -z "$port" ]]; then echo "PORT not set and no board auto-detected. Set PORT=/dev/tty..." >&2; exit 1; fi
  "$arduino_cli" monitor --config-file "$cli_config" --fqbn "$fqbn" -p "$port" --config "baudrate=$baud"

# Build + upload firmware to local board.
# Uses release tag as version when on a tagged revision, otherwise run-<timestamp>.
firmware:
  just firmware-build
  just firmware-upload

# Run worker locally on localhost.
cloudflare-run:
  #!/usr/bin/env bash
  set -euo pipefail
  if [[ -f .env ]]; then set -a; source .env; set +a; fi
  if [[ -f .env.secret ]]; then set -a; source .env.secret; set +a; fi
  version="$(./scripts/versioning.sh run-id)"
  echo "Cloud run version: $version"
  cd cloud/worker
  npx --yes wrangler dev --local --ip "${RUN_CLOUD_HOST:-127.0.0.1}" --port "${RUN_CLOUD_PORT:-8787}" --var "BUILD_VERSION:$version"

# Run PWA locally and point default relay URL to local worker.
pwa-run:
  #!/usr/bin/env bash
  set -euo pipefail
  if [[ -f .env ]]; then set -a; source .env; set +a; fi
  if [[ -f .env.secret ]]; then set -a; source .env.secret; set +a; fi
  version="$(./scripts/versioning.sh run-id)"
  echo "PWA run version: $version"
  cd app
  if [[ -f package-lock.json ]]; then npm ci || npm install; else npm install; fi
  VITE_BUILD_VERSION="$version" VITE_RELAY_BASE_URL="${RUN_CLOUD_URL:-http://127.0.0.1:8787}" npm run dev -- --host

# Build/check app and deploy PWA + Worker to dev domains.
# Version format: dev-<commit>-<timestamp>.
cloudflare-dev:
  #!/usr/bin/env bash
  set -euo pipefail
  if [[ -f .env ]]; then set -a; source .env; set +a; fi
  if [[ -f .env.secret ]]; then set -a; source .env.secret; set +a; fi
  test -n "${CLOUDFLARE_API_TOKEN:-}" || (echo "CLOUDFLARE_API_TOKEN missing in .env.secret" && exit 1)
  test -n "${CLOUDFLARE_ACCOUNT_ID:-}" || (echo "CLOUDFLARE_ACCOUNT_ID missing in .env (get it via: npx --yes wrangler whoami)" && exit 1)
  dev_cloud_url="${DEV_CLOUD_URL:-https://dev-aw-cloud.anqori.com}"
  dev_cloud_domain="${dev_cloud_url#http://}"
  dev_cloud_domain="${dev_cloud_domain#https://}"
  dev_cloud_domain="${dev_cloud_domain%%/*}"
  ./scripts/cloudflare.sh check-worker-route-access "$dev_cloud_domain"
  pages_project="${CF_PAGES_PROJECT_DEV:-anqori-anchorwatch-pwa-dev}"
  pages_domain="${CF_PAGES_DOMAIN_DEV:-dev-aw.anqori.com}"
  pages_branch="${CF_PAGES_PRODUCTION_BRANCH:-main}"
  ./scripts/cloudflare.sh ensure-pages-project "$pages_project" "$pages_branch"
  ./scripts/cloudflare.sh ensure-pages-domain "$pages_project" "$pages_domain"
  version="$(./scripts/versioning.sh dev-id)"
  echo "Cloudflare dev version: $version"
  cd app
  if [[ -f package-lock.json ]]; then npm ci || npm install; else npm install; fi
  npm run check
  VITE_BUILD_VERSION="$version" VITE_RELAY_BASE_URL="$dev_cloud_url" npm run build
  cd ..
  npx --yes wrangler pages deploy app/dist --project-name "$pages_project"
  cd cloud/worker
  npx --yes wrangler deploy --env dev --var "BUILD_VERSION:$version"

# Build/check app and deploy PWA + Worker to release domains.
# Requires current revision to be a semantic version tag (vX.Y.Z).
cloudflare-release:
  #!/usr/bin/env bash
  set -euo pipefail
  if [[ -f .env ]]; then set -a; source .env; set +a; fi
  if [[ -f .env.secret ]]; then set -a; source .env.secret; set +a; fi
  test -n "${CLOUDFLARE_API_TOKEN:-}" || (echo "CLOUDFLARE_API_TOKEN missing in .env.secret" && exit 1)
  test -n "${CLOUDFLARE_ACCOUNT_ID:-}" || (echo "CLOUDFLARE_ACCOUNT_ID missing in .env (get it via: npx --yes wrangler whoami)" && exit 1)
  release_cloud_url="${RELEASE_CLOUD_URL:-https://aw-cloud.anqori.com}"
  release_cloud_domain="${release_cloud_url#http://}"
  release_cloud_domain="${release_cloud_domain#https://}"
  release_cloud_domain="${release_cloud_domain%%/*}"
  ./scripts/cloudflare.sh check-worker-route-access "$release_cloud_domain"
  pages_project="${CF_PAGES_PROJECT_RELEASE:-anqori-anchorwatch-pwa}"
  pages_domain="${CF_PAGES_DOMAIN_RELEASE:-aw.anqori.com}"
  pages_branch="${CF_PAGES_PRODUCTION_BRANCH:-main}"
  ./scripts/cloudflare.sh ensure-pages-project "$pages_project" "$pages_branch"
  ./scripts/cloudflare.sh ensure-pages-domain "$pages_project" "$pages_domain"
  ./scripts/versioning.sh ensure-clean
  version="$(./scripts/versioning.sh release-id)"
  echo "Cloudflare release version: $version"
  cd app
  if [[ -f package-lock.json ]]; then npm ci || npm install; else npm install; fi
  npm run check
  VITE_BUILD_VERSION="$version" VITE_RELAY_BASE_URL="$release_cloud_url" npm run build
  cd ..
  npx --yes wrangler pages deploy app/dist --project-name "$pages_project"
  cd cloud/worker
  npx --yes wrangler deploy --var "BUILD_VERSION:$version"

# One-time helper to create KV bindings in wrangler.toml.
[private]
worker-kv-create:
  #!/usr/bin/env bash
  set -euo pipefail
  if [[ -f .env ]]; then set -a; source .env; set +a; fi
  if [[ -f .env.secret ]]; then set -a; source .env.secret; set +a; fi
  test -n "${CLOUDFLARE_API_TOKEN:-}" || (echo "CLOUDFLARE_API_TOKEN missing in .env.secret" && exit 1)
  test -n "${CLOUDFLARE_ACCOUNT_ID:-}" || (echo "CLOUDFLARE_ACCOUNT_ID missing in .env (get it via: npx --yes wrangler whoami)" && exit 1)
  cd cloud/worker
  npx --yes wrangler kv namespace create "${CF_KV_NAMESPACE_NAME:-anqori-anchorwatch-relay}" --binding "${CF_KV_BINDING:-RELAY_KV}" --update-config
  npx --yes wrangler kv namespace create "${CF_KV_NAMESPACE_NAME:-anqori-anchorwatch-relay}" --binding "${CF_KV_BINDING:-RELAY_KV}" --preview --update-config

# Set BOAT_SECRET in release and dev workers.
[private]
worker-secret-put-release:
  #!/usr/bin/env bash
  set -euo pipefail
  if [[ -f .env ]]; then set -a; source .env; set +a; fi
  if [[ -f .env.secret ]]; then set -a; source .env.secret; set +a; fi
  test -n "${CLOUDFLARE_API_TOKEN:-}" || (echo "CLOUDFLARE_API_TOKEN missing in .env.secret" && exit 1)
  test -n "${CLOUDFLARE_ACCOUNT_ID:-}" || (echo "CLOUDFLARE_ACCOUNT_ID missing in .env (get it via: npx --yes wrangler whoami)" && exit 1)
  cd cloud/worker
  npx --yes wrangler secret put BOAT_SECRET

[private]
worker-secret-put-dev:
  #!/usr/bin/env bash
  set -euo pipefail
  if [[ -f .env ]]; then set -a; source .env; set +a; fi
  if [[ -f .env.secret ]]; then set -a; source .env.secret; set +a; fi
  test -n "${CLOUDFLARE_API_TOKEN:-}" || (echo "CLOUDFLARE_API_TOKEN missing in .env.secret" && exit 1)
  test -n "${CLOUDFLARE_ACCOUNT_ID:-}" || (echo "CLOUDFLARE_ACCOUNT_ID missing in .env (get it via: npx --yes wrangler whoami)" && exit 1)
  cd cloud/worker
  npx --yes wrangler secret put BOAT_SECRET --env dev
