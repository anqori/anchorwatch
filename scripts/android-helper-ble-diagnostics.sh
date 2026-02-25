#!/usr/bin/env bash
set -euo pipefail

ADB_PATH="${ADB_PATH:-adb}"
ADB_SERIAL="${ADB_SERIAL:-}"
ADB_CMD_TIMEOUT="${ADB_CMD_TIMEOUT:-12}"
PACKAGE_NAME="com.anchormaster.helper"
LOG_TAG_BLE="AnchorHelper-BLE"
LOG_TAG_SERVICE="AnchorHelper-Service"
LOG_TAG_RELAY="AnchorHelper-Relay"
DEVICE_ARGS=()
HAS_TIMEOUT=0

if ! command -v "$ADB_PATH" >/dev/null 2>&1; then
  echo "ADB not found at: $ADB_PATH" >&2
  exit 1
fi

if command -v timeout >/dev/null 2>&1; then
  HAS_TIMEOUT=1
fi

if [[ -n "$ADB_SERIAL" ]]; then
  DEVICE_ARGS=("-s" "$ADB_SERIAL")
else
  connected_count="$($ADB_PATH devices | awk 'NR>1 && $2=="device" {count++} END {print count + 0}')"
  if [[ "$connected_count" -eq 0 ]]; then
    echo "No connected adb devices found." >&2
    exit 1
  fi

  if [[ "$connected_count" -gt 1 ]]; then
    echo "Multiple adb devices found. Set ADB_SERIAL=" >&2
    $ADB_PATH devices | awk 'NR>1 && $2=="device" {print $1}' >&2
    exit 1
  fi

  selected="$($ADB_PATH devices | awk 'NR>1 && $2=="device" {print $1; exit}')"
  DEVICE_ARGS=("-s" "$selected")
fi

run_adb() {
  if [[ "$HAS_TIMEOUT" == "1" ]]; then
    timeout "$ADB_CMD_TIMEOUT" "$ADB_PATH" "${DEVICE_ARGS[@]}" "$@"
  else
    "$ADB_PATH" "${DEVICE_ARGS[@]}" "$@"
  fi
}

run_adb_checked() {
  local label="$1"
  shift

  local out err
  out="$(mktemp)"
  err="$(mktemp)"

  if ! run_adb "$@" >"$out" 2>"$err"; then
    echo "WARN: $label failed (exit $?)" >&2
    if [[ -s "$err" ]]; then
      sed 's/^/[stderr] /' "$err" >&2
    fi
  else
    if [[ -s "$out" ]]; then
      cat "$out"
    fi
  fi

  rm -f "$out" "$err"
}

echo "=== helper pid ==="
run_adb_checked "pidof $PACKAGE_NAME" shell pidof "$PACKAGE_NAME"

echo "=== helper prefs ==="
out_file="$(mktemp)"
err_file="$(mktemp)"
if ! run_adb shell run-as "$PACKAGE_NAME" sh -lc "cat /data/data/$PACKAGE_NAME/shared_prefs/android-helper.xml || true" >"$out_file" 2>"$err_file"; then
  echo "WARN: run-as prefs read failed (package not debuggable or denied)." >&2
  if [[ -s "$err_file" ]]; then
    sed 's/^/[stderr] /' "$err_file" >&2
  fi
  echo "Attempting fallback: package list via dumpsys (non-private fields only)."
  run_adb_checked "dumpsys package" shell dumpsys package "$PACKAGE_NAME"
else
  if [[ -s "$out_file" ]]; then
    cat "$out_file"
  else
    echo "(no shared prefs file yet)"
  fi
fi
rm -f "$out_file" "$err_file"

echo "=== service status ==="
run_adb_checked "activity services" shell dumpsys activity services "$PACKAGE_NAME"

echo "=== foreground notification ==="
run_adb_checked "notification dump" shell dumpsys notification "$PACKAGE_NAME"

echo "=== bluetooth service map ==="
echo "(running with command timeout ${ADB_CMD_TIMEOUT}s)"
run_adb_checked "bluetooth_manager map" shell sh -lc "dumpsys bluetooth_manager | grep -E '(app_if|gatt|service map|Ongoing advertisements|Advertiser|$PACKAGE_NAME|9f2d0000-87aa-4f4a-a0ea-4d5d4f415354|Anqori-AnchorWatch|nearby_presence)' || true"

echo "=== BLE logs ==="
run_adb_checked "BLE logcat snapshot" shell logcat -d -v time -s "$LOG_TAG_BLE:V" "$LOG_TAG_SERVICE:V" "$LOG_TAG_RELAY:V" "BluetoothAdapter:I" "BluetoothLeAdvertiser:I" "BluetoothGattServer:I"

echo "=== recent generic Bluetooth events ==="
run_adb_checked "generic Bluetooth logcat snapshot" shell sh -lc "logcat -d -v time -s BluetoothLeScanner:I BluetoothGattCallback:I BluetoothAdapterService:D | sed -n '1,220p'"
