import {
  BLE_LAST_DEVICE_ID_KEY,
  BLE_LAST_DEVICE_NAME_KEY,
  BLE_CONNECTED_ONCE_KEY,
  BLE_CONNECTION_PIN_KEY,
  BOAT_ID_KEY,
  CONNECTION_RUNTIME_MODE_KEY,
  CONNECTION_RUNTIME_MODE_ONBOARD,
  CONNECTION_RUNTIME_MODE_REMOTE,
  CLOUD_SECRET_KEY,
  DEFAULT_RELAY_BASE_URL,
  PHONE_ID_KEY,
  RELAY_BASE_URL_KEY,
  WIFI_CFG_VERSION_KEY,
} from "../core/constants";
import type { ConnectionRuntimeMode } from "../core/types";
import { loadStoredString, saveStoredString } from "./local-storage";

export function getRelayBaseUrl(): string {
  return loadStoredString(RELAY_BASE_URL_KEY, DEFAULT_RELAY_BASE_URL).trim();
}

export function setRelayBaseUrl(value: string): void {
  saveStoredString(RELAY_BASE_URL_KEY, value);
}

export function getBoatId(): string {
  return loadStoredString(BOAT_ID_KEY);
}

export function setBoatId(value: string): void {
  if (!value) {
    return;
  }
  saveStoredString(BOAT_ID_KEY, value);
}

export function getBleConnectionPin(): string {
  return loadStoredString(BLE_CONNECTION_PIN_KEY);
}

export function setBleConnectionPin(secret: string): void {
  if (!secret) {
    return;
  }
  saveStoredString(BLE_CONNECTION_PIN_KEY, secret);
}

export function getCloudSecret(): string {
  return loadStoredString(CLOUD_SECRET_KEY);
}

export function setCloudSecret(secret: string): void {
  if (!secret) {
    return;
  }
  saveStoredString(CLOUD_SECRET_KEY, secret);
}

export function ensurePhoneId(): string {
  let phoneId = loadStoredString(PHONE_ID_KEY);
  if (!phoneId) {
    const rand = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    phoneId = `phone_${rand}`;
    saveStoredString(PHONE_ID_KEY, phoneId);
  }
  return phoneId;
}

export function nextConfigVersion(): number {
  const current = Number(loadStoredString(WIFI_CFG_VERSION_KEY, "0"));
  if (!Number.isInteger(current) || current < 0) {
    return 1;
  }
  return current + 1;
}

export function setConfigVersion(version: number): void {
  saveStoredString(WIFI_CFG_VERSION_KEY, String(version));
}

export function hasPersistedSetup(): boolean {
  const hasBoatId = getBoatId().trim().length > 0;
  const hasBleConnectionPin = getBleConnectionPin().trim().length > 0;
  const hasCloudSecret = getCloudSecret().trim().length > 0;
  const hasRelayBaseUrl = getRelayBaseUrl().length > 0;
  const configVersion = Number(loadStoredString(WIFI_CFG_VERSION_KEY, "0"));
  const hasSavedConfigVersion = Number.isInteger(configVersion) && configVersion > 0;
  return hasBoatId || hasBleConnectionPin || hasCloudSecret || hasRelayBaseUrl || hasSavedConfigVersion;
}

export function hasConnectedViaBleOnce(): boolean {
  return loadStoredString(BLE_CONNECTED_ONCE_KEY) === "1";
}

export function markConnectedViaBleOnce(): void {
  saveStoredString(BLE_CONNECTED_ONCE_KEY, "1");
}

export function loadConnectionRuntimeMode(): ConnectionRuntimeMode {
  const raw = loadStoredString(CONNECTION_RUNTIME_MODE_KEY, CONNECTION_RUNTIME_MODE_REMOTE).trim();
  return raw === CONNECTION_RUNTIME_MODE_ONBOARD ? CONNECTION_RUNTIME_MODE_ONBOARD : CONNECTION_RUNTIME_MODE_REMOTE;
}

export function setConnectionRuntimeMode(mode: ConnectionRuntimeMode): void {
  saveStoredString(CONNECTION_RUNTIME_MODE_KEY, mode);
}

export function getLastBleDeviceId(): string {
  return loadStoredString(BLE_LAST_DEVICE_ID_KEY).trim();
}

export function getLastBleDeviceName(): string {
  return loadStoredString(BLE_LAST_DEVICE_NAME_KEY).trim();
}

export function setLastBleDevice(deviceId: string, deviceName: string): void {
  saveStoredString(BLE_LAST_DEVICE_ID_KEY, deviceId.trim());
  saveStoredString(BLE_LAST_DEVICE_NAME_KEY, deviceName.trim());
}
