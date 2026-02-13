import {
  BLE_CONNECTED_ONCE_KEY,
  BOAT_ID_KEY,
  BOAT_SECRET_KEY,
  DEFAULT_RELAY_BASE_URL,
  MODE_DEVICE,
  MODE_FAKE,
  MODE_KEY,
  PHONE_ID_KEY,
  RELAY_BASE_URL_KEY,
  WIFI_CFG_VERSION_KEY,
} from "../core/constants";
import type { Mode } from "../core/types";
import { loadStoredString, saveStoredString } from "./local-storage";

export function loadMode(): Mode {
  const saved = loadStoredString(MODE_KEY, MODE_FAKE);
  return saved === MODE_DEVICE ? MODE_DEVICE : MODE_FAKE;
}

export function setMode(mode: Mode): void {
  saveStoredString(MODE_KEY, mode);
}

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

export function getBoatSecret(): string {
  return loadStoredString(BOAT_SECRET_KEY);
}

export function setBoatSecret(secret: string): void {
  if (!secret) {
    return;
  }
  saveStoredString(BOAT_SECRET_KEY, secret);
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
  const hasBoatSecret = getBoatSecret().trim().length > 0;
  const hasRelayBaseUrl = getRelayBaseUrl().length > 0;
  const configVersion = Number(loadStoredString(WIFI_CFG_VERSION_KEY, "0"));
  const hasSavedConfigVersion = Number.isInteger(configVersion) && configVersion > 0;
  return hasBoatId || hasBoatSecret || hasRelayBaseUrl || hasSavedConfigVersion;
}

export function hasConnectedViaBleOnce(): boolean {
  return loadStoredString(BLE_CONNECTED_ONCE_KEY) === "1";
}

export function markConnectedViaBleOnce(): void {
  saveStoredString(BLE_CONNECTED_ONCE_KEY, "1");
}
