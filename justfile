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

# Monitor connected device serial output.
# Example: PORT=/dev/ttyACM0 BAUD=115200 just device-monitor
device-monitor:
  just firmware-monitor

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

# Build Android APK in Docker (no local Android SDK required).
# Override image with ANDROID_BUILD_IMAGE=... and task with APK_TASK=assembleRelease.
android-apk-docker:
  #!/usr/bin/env bash
  set -euo pipefail
  image="${ANDROID_BUILD_IMAGE:-mingc/android-build-box:latest}"
  apk_task="${APK_TASK:-assembleDebug}"
  app_dir="$(pwd)/app"
  uid="$(id -u)"
  gid="$(id -g)"
  test -d "$app_dir/android" || (echo "Missing app/android (run from repo root)." && exit 1)
  status=0
  docker run --rm \
    -v "$app_dir:/project" \
    "$image" \
    bash -lc "npm_config_production=false npm ci && npm run build && npx cap sync android && cd android && ./gradlew $apk_task" || status=$?
  docker run --rm \
    -v "$app_dir:/project" \
    "$image" \
    bash -lc "for p in /project/node_modules /project/android /project/dist; do if [ -e \"\$p\" ]; then chown -R $uid:$gid \"\$p\"; fi; done"
  if [[ "$status" -ne 0 ]]; then exit "$status"; fi
  case "$apk_task" in
    assembleDebug)
      echo "APK: app/android/app/build/outputs/apk/debug/app-debug.apk"
      ;;
    assembleRelease)
      echo "APK: app/android/app/build/outputs/apk/release/app-release.apk"
      echo "Release APK signing must be configured in app/android."
      ;;
    *)
      echo "Gradle task '$apk_task' completed."
      echo "Artifacts: app/android/app/build/outputs/"
      ;;
  esac

# Build/check Android Helper app in a plain Android SDK docker image.
# No local Android SDK needed.
# Cache dir defaults to: $HOME/.cache/anchormaster/android-helper-docker
android-helper-docker-debug:
  #!/usr/bin/env bash
  set -euo pipefail
  image="${ANDROID_HELPER_DOCKER_IMAGE:-ghcr.io/cirruslabs/android-sdk:35}"
  cache_root="${ANDROID_HELPER_DOCKER_CACHE_DIR:-$HOME/.cache/anchormaster/android-helper-docker}"
  gradle_home="$cache_root/gradle-home"
  uid="$(id -u)"
  gid="$(id -g)"
  version="${HELPER_BUILD_VERSION:-$(./scripts/versioning.sh run-id)}"
  mkdir -p "$gradle_home"
  echo "Android Helper build version: $version"
  echo "Gradle cache: $gradle_home"
  status=0
  docker run --rm \
    -v "$PWD:/build" \
    -v "$gradle_home:/tmp/gradle-home" \
    -e GRADLE_USER_HOME=/tmp/gradle-home \
    -w /build \
    "$image" \
    /bin/bash -lc "mkdir -p /tmp/gradle-home /tmp/gradle-project-cache && cd android-helper && ./gradlew --project-cache-dir /tmp/gradle-project-cache assembleDebug -PHELPER_BUILD_VERSION=\"$version\"" || status=$?
  docker run --rm \
    -v "$PWD:/build" \
    "$image" \
    /bin/bash -lc "for p in /build/android-helper/.gradle /build/android-helper/build /build/android-helper/app/build; do if [ -e \"\$p\" ]; then chown -R $uid:$gid \"\$p\"; fi; done"
  if [[ "$status" -ne 0 ]]; then exit "$status"; fi

android-helper-docker-release:
  #!/usr/bin/env bash
  set -euo pipefail
  image="${ANDROID_HELPER_DOCKER_IMAGE:-ghcr.io/cirruslabs/android-sdk:35}"
  cache_root="${ANDROID_HELPER_DOCKER_CACHE_DIR:-$HOME/.cache/anchormaster/android-helper-docker}"
  gradle_home="$cache_root/gradle-home"
  uid="$(id -u)"
  gid="$(id -g)"
  version="${HELPER_BUILD_VERSION:-$(./scripts/versioning.sh run-id)}"
  mkdir -p "$gradle_home"
  echo "Android Helper build version: $version"
  echo "Gradle cache: $gradle_home"
  status=0
  docker run --rm \
    -v "$PWD:/build" \
    -v "$gradle_home:/tmp/gradle-home" \
    -e GRADLE_USER_HOME=/tmp/gradle-home \
    -w /build \
    "$image" \
    /bin/bash -lc "mkdir -p /tmp/gradle-home /tmp/gradle-project-cache && cd android-helper && ./gradlew --project-cache-dir /tmp/gradle-project-cache assembleRelease -PHELPER_BUILD_VERSION=\"$version\"" || status=$?
  docker run --rm \
    -v "$PWD:/build" \
    "$image" \
    /bin/bash -lc "for p in /build/android-helper/.gradle /build/android-helper/build /build/android-helper/app/build; do if [ -e \"\$p\" ]; then chown -R $uid:$gid \"\$p\"; fi; done"
  if [[ "$status" -ne 0 ]]; then exit "$status"; fi

android-helper-docker-lint:
  #!/usr/bin/env bash
  set -euo pipefail
  image="${ANDROID_HELPER_DOCKER_IMAGE:-ghcr.io/cirruslabs/android-sdk:35}"
  cache_root="${ANDROID_HELPER_DOCKER_CACHE_DIR:-$HOME/.cache/anchormaster/android-helper-docker}"
  gradle_home="$cache_root/gradle-home"
  uid="$(id -u)"
  gid="$(id -g)"
  mkdir -p "$gradle_home"
  echo "Gradle cache: $gradle_home"
  status=0
  docker run --rm \
    -v "$PWD:/build" \
    -v "$gradle_home:/tmp/gradle-home" \
    -e GRADLE_USER_HOME=/tmp/gradle-home \
    -w /build \
    "$image" \
    /bin/bash -lc "mkdir -p /tmp/gradle-home /tmp/gradle-project-cache && cd android-helper && ./gradlew --project-cache-dir /tmp/gradle-project-cache lintRelease test -Dandroid.lint.abortOnError=false" || status=$?
  docker run --rm \
    -v "$PWD:/build" \
    "$image" \
    /bin/bash -lc "for p in /build/android-helper/.gradle /build/android-helper/build /build/android-helper/app/build; do if [ -e \"\$p\" ]; then chown -R $uid:$gid \"\$p\"; fi; done"
  if [[ "$status" -ne 0 ]]; then exit "$status"; fi

# Install Android Helper debug APK via USB ADB.
# Optional: ADB_SERIAL (device id), ADB_APK_PATH (default debug APK), ADB_PATH (default adb), ADB_UNINSTALL_FIRST (1 to force remove existing package first).
android-helper-adb-install:
  #!/usr/bin/env bash
  set -euo pipefail
  adb_path="${ADB_PATH:-adb}"
  apk_path="${ADB_APK_PATH:-android-helper/app/build/outputs/apk/debug/app-debug.apk}"
  serial="${ADB_SERIAL:-}"
  uninstall_first="${ADB_UNINSTALL_FIRST:-1}"

  if ! command -v "$adb_path" >/dev/null 2>&1; then
    echo "ADB command not found. Set ADB_PATH or install Android platform tools." >&2
    exit 1
  fi

  "$adb_path" start-server

  if [[ ! -f "$apk_path" ]]; then
    echo "APK not found: $apk_path" >&2
    echo "Run 'just android-helper-docker-debug' first." >&2
    exit 1
  fi

  package_name="com.anchormaster.helper"

  install_to_device() {
    local target="$1"

    if [[ "$uninstall_first" == "1" ]]; then
      "$adb_path" -s "$target" uninstall "$package_name" || true
    fi

    "$adb_path" -s "$target" install -r "$apk_path"
    echo "Installed: $apk_path"
    echo "Device: $target"
  }

  if [[ -n "$serial" ]]; then
    install_to_device "$serial"
    exit 0
  fi

  device_count="$($adb_path devices | awk 'NR>1 && $2=="device" {print $1}' | wc -l | tr -d ' ')"
  if [[ "$device_count" -eq 0 ]]; then
    echo "No connected adb devices found." >&2
    exit 1
  fi
  if [[ "$device_count" -gt 1 ]]; then
    echo "Multiple connected devices found. Set ADB_SERIAL to choose one:" >&2
    "$adb_path" devices | awk 'NR>1 && $2=="device" {print $1}'
    exit 1
  fi

  target_device="$($adb_path devices | awk 'NR>1 && $2=="device" {print $1}' | head -n 1)"
  install_to_device "$target_device"

android-helper-ble-diagnostics:
  #!/usr/bin/env bash
  set -euo pipefail
  scripts/android-helper-ble-diagnostics.sh
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
  npx --yes wrangler pages deploy app/dist --project-name "$pages_project" --branch "$pages_branch" --commit-dirty=true
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
  npx --yes wrangler pages deploy app/dist --project-name "$pages_project" --branch "$pages_branch" --commit-dirty=true
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
