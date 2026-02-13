import { TRACK_SNAPSHOT_LIMIT } from "../core/constants";
import type { JsonRecord, WifiSecurity } from "../core/types";
import { mapAlertDraftToConfigInput, mapAnchorDraftToConfigInput, mapProfilesDraftToConfigInput } from "../services/config-draft-mappers";
import { buildAlertConfigPatch, buildAnchorConfigPatch, buildProfilesConfigPatch } from "../services/config-patch-builders";
import { normalizeRelayBaseUrl } from "../services/local-storage";
import { readCurrentGpsPosition } from "../services/state-derive";
import {
  getRelayBaseUrl,
  markConnectedViaBleOnce,
  nextConfigVersion,
  setConfigVersion,
  setRelayBaseUrl,
} from "../services/persistence-domain";
import type { ConfigPatchCommand } from "../services/protocol-messages";
import { defaultConnectionForMode, getBluetoothConnection, getFakeConnection } from "../connections/connection-factory";
import { deviceLinker } from "../linker/device-linker";
import {
  appState,
  applyMode,
  applyWifiScanNetworks,
  logLine,
  resetLiveDataState,
  refreshIdentityUi,
  replaceTrackPoints,
  setBoatId,
  setBoatSecret,
} from "../state/app-state.svelte";

let wifiScanTimeout: ReturnType<typeof setTimeout> | null = null;

function makeRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 12)}`;
}

function clearWifiScanTimeout(): void {
  if (!wifiScanTimeout) {
    return;
  }
  clearTimeout(wifiScanTimeout);
  wifiScanTimeout = null;
}

async function sendConfigPatch(patch: JsonRecord, reason: string): Promise<void> {
  const version = nextConfigVersion();
  const command: ConfigPatchCommand = { version, patch };
  const connection = deviceLinker.getConnection();
  await connection.sendConfigPatch(command);
  setConfigVersion(version);
  logLine(`config.patch sent via ${connection.kind} (${reason}) version=${version}`);
}

function ensureConfiguredDeviceForConnectionSelection(): void {
  if (!appState.connection.hasConfiguredDevice) {
    throw new Error("Complete device setup first.");
  }
}

export async function startDeviceRuntime(): Promise<void> {
  const active = defaultConnectionForMode(appState.connection.mode);
  await deviceLinker.setConnection(active, false);
  await deviceLinker.start();
}

export async function stopDeviceRuntime(): Promise<void> {
  clearWifiScanTimeout();
  await deviceLinker.stop();
}

export async function selectDeviceModeForSetup(): Promise<void> {
  if (appState.connection.mode !== "device") {
    applyMode("device");
    logLine("device connection.mode selected for setup");
  }
  resetLiveDataState();
  await deviceLinker.setConnection(defaultConnectionForMode("device"));
}

export async function searchForDeviceViaBluetooth(): Promise<void> {
  await selectDeviceModeForSetup();

  const bleConnection = getBluetoothConnection();
  if (bleConnection.isConnected()) {
    await bleConnection.disconnect();
  }

  await deviceLinker.setConnection(bleConnection);
  refreshIdentityUi();
  logLine("BLE connected and active connection switched to bluetooth");
}

export async function useFakeMode(): Promise<void> {
  setBoatId("boat_demo_001");
  setBoatSecret("demo_secret_001");
  markConnectedViaBleOnce();
  applyMode("fake", false);
  resetLiveDataState();
  await deviceLinker.setConnection(getFakeConnection());
  clearWifiScanTimeout();
  appState.network.wifiScanInFlight = false;
  appState.network.wifiScanStatusText = "Scan for available WLAN networks.";
  logLine("fake connection.mode selected; demo credentials applied; switched to fake device connection");
}

export async function selectRelayConnection(): Promise<void> {
  ensureConfiguredDeviceForConnectionSelection();
  if (appState.connection.mode !== "device") {
    applyMode("device");
  }
  resetLiveDataState();
  await deviceLinker.setConnection(defaultConnectionForMode("device"));
  logLine("active connection switched to cloud-relay");
}

export async function selectBluetoothConnection(): Promise<void> {
  ensureConfiguredDeviceForConnectionSelection();
  if (!appState.connection.bleSupported) {
    throw new Error("Bluetooth is not supported in this browser/app environment.");
  }
  if (appState.connection.mode !== "device") {
    applyMode("device");
  }
  resetLiveDataState();
  await deviceLinker.setConnection(getBluetoothConnection());
  logLine("active connection switched to bluetooth");
}

export async function saveRelayUrl(): Promise<void> {
  const normalized = normalizeRelayBaseUrl(appState.network.relayBaseUrlInput);
  setRelayBaseUrl(normalized);
  appState.network.relayBaseUrlInput = normalized;
  logLine(`relay base URL saved: ${normalized || "(empty)"}`);

  if (appState.connection.mode === "device" && deviceLinker.getConnection().kind !== "bluetooth") {
    await deviceLinker.setConnection(defaultConnectionForMode("device"));
  }
}

export async function probe(): Promise<void> {
  const base = getRelayBaseUrl();
  try {
    const connection = deviceLinker.getConnection();
    const probeResult = await connection.probe(base);
    appState.connection.relayResult = probeResult.resultText;
    if (probeResult.buildVersion) {
      appState.versions.cloud = probeResult.buildVersion;
    }
    logLine(`probe via ${connection.kind}: ${probeResult.resultText}`);
  } catch (error) {
    appState.connection.relayResult = `Probe failed: ${String(error)}`;
  }
}

export async function scanWifiNetworks(): Promise<void> {
  clearWifiScanTimeout();

  const requestId = makeRequestId();
  appState.network.wifiScanRequestId = requestId;
  appState.network.wifiScanInFlight = true;
  appState.network.wifiScanErrorText = "";
  appState.network.wifiScanStatusText = "Scanning nearby WLAN networks...";

  wifiScanTimeout = setTimeout(() => {
    if (!appState.network.wifiScanInFlight || appState.network.wifiScanRequestId !== requestId) {
      return;
    }
    appState.network.wifiScanInFlight = false;
    appState.network.wifiScanErrorText = "No scan result received from device.";
    appState.network.wifiScanStatusText = "WLAN scan timed out. Try scanning again.";
    logLine("onboarding.wifi.scan_result timeout");
  }, 10_000);

  try {
    const networks = await deviceLinker.getConnection().commandWifiScan(20, false);
    applyWifiScanNetworks(networks);
    appState.network.wifiScanUpdatedAtMs = Date.now();
    clearWifiScanTimeout();
    appState.network.wifiScanInFlight = false;
    appState.network.wifiScanStatusText = networks.length > 0
      ? `Found ${networks.length} WLAN network${networks.length === 1 ? "" : "s"}.`
      : "No WLAN networks found. Try scanning again.";
  } catch (error) {
    clearWifiScanTimeout();
    appState.network.wifiScanInFlight = false;
    appState.network.wifiScanErrorText = String(error);
    appState.network.wifiScanStatusText = "WLAN scan failed.";
    throw error;
  }
}

export async function connectToWifiNetwork(ssid: string, security: WifiSecurity, passphrase: string): Promise<void> {
  const normalizedSsid = ssid.trim();
  if (!normalizedSsid) {
    throw new Error("Wi-Fi SSID is required");
  }

  appState.network.wifiSsid = normalizedSsid;
  appState.network.selectedWifiSsid = normalizedSsid;
  appState.network.wifiSecurity = security === "unknown" ? "wpa2" : security;
  appState.network.wifiPass = appState.network.wifiSecurity === "open" ? "" : passphrase;
  if (!appState.network.wifiCountry.trim()) {
    appState.network.wifiCountry = "DE";
  }

  await applyWifiConfigFromInternetPage();
}

export async function applyWifiConfig(): Promise<void> {
  const ssid = appState.network.wifiSsid.trim();
  const passphrase = appState.network.wifiPass;
  const security = appState.network.wifiSecurity === "unknown" ? "wpa2" : appState.network.wifiSecurity;
  const country = appState.network.wifiCountry.trim().toUpperCase();

  if (!ssid) {
    throw new Error("Wi-Fi SSID is required");
  }

  const patch: JsonRecord = {
    "network.wifi.ssid": ssid,
    "network.wifi.passphrase": passphrase,
    "network.wifi.security": security,
    "network.wifi.country": country || "DE",
    "network.wifi.hidden": appState.network.selectedWifiNetwork?.hidden ?? false,
  };

  await sendConfigPatch(patch, "wifi");
}

export async function refreshStateSnapshot(): Promise<void> {
  const connection = deviceLinker.getConnection();
  const snapshot = await connection.requestStateSnapshot();
  if (snapshot === null) {
    return;
  }
  logLine(`status.snapshot read via ${connection.kind}`);
}

export async function applyWifiConfigFromInternetPage(): Promise<void> {
  await applyWifiConfig();
  await refreshStateSnapshot();
}

export async function applyAnchorConfig(): Promise<void> {
  const anchorInput = mapAnchorDraftToConfigInput(appState.configDrafts.anchor);
  const patch = buildAnchorConfigPatch(anchorInput);
  await sendConfigPatch(patch, "anchor-auto-placement");
}

export async function applyAlertConfig(): Promise<void> {
  const patch = buildAlertConfigPatch(mapAlertDraftToConfigInput(appState.configDrafts.alerts));
  await sendConfigPatch(patch, "alerts");
}

export async function applyProfilesConfig(): Promise<void> {
  const patch = buildProfilesConfigPatch(mapProfilesDraftToConfigInput(appState.configDrafts.profiles));
  await sendConfigPatch(patch, "profiles");
}

export async function raiseAnchor(): Promise<void> {
  const connection = deviceLinker.getConnection();
  const result = await connection.commandAnchorRise();
  if (!result.accepted) {
    throw new Error(result.errorDetail || result.errorCode || "anchor.rise rejected");
  }
  logLine(`anchor.rise sent via ${connection.kind}`);
  await refreshStateSnapshot();
}

export async function silenceAlarm(seconds: number): Promise<void> {
  const durationSeconds = Math.max(1, Math.min(24 * 60 * 60, Math.floor(seconds)));
  const connection = deviceLinker.getConnection();
  const result = await connection.commandAlarmSilence(durationSeconds);
  if (!result.accepted) {
    throw new Error(result.errorDetail || result.errorCode || "alarm.silence rejected");
  }
  logLine(`alarm.silence sent via ${connection.kind} for ${durationSeconds}s`);
}

export async function moveAnchorToPosition(lat: number, lon: number, resetTrack = true): Promise<void> {
  const connection = deviceLinker.getConnection();
  const result = await connection.commandAnchorDown(lat, lon);
  if (!result.accepted) {
    throw new Error(result.errorDetail || result.errorCode || "anchor.down rejected");
  }
  if (resetTrack) {
    replaceTrackPoints([]);
    logLine("track reset after anchor.down");
  }
  logLine(`anchor moved via ${connection.kind} to lat=${lat.toFixed(5)} lon=${lon.toFixed(5)}`);
  await refreshStateSnapshot();
}

export async function dropAnchorAtCurrentPosition(): Promise<void> {
  const gps = readCurrentGpsPosition(appState.latestState);
  if (!gps) {
    throw new Error("Current GPS position unavailable.");
  }
  await moveAnchorToPosition(gps.lat, gps.lon);
}

export async function fetchTrackSnapshot(): Promise<void> {
  const connection = deviceLinker.getConnection();
  const points = await connection.requestTrackSnapshot(TRACK_SNAPSHOT_LIMIT);
  if (points === null) {
    if (connection.kind === "cloud-relay") {
      appState.track.statusText = "No cloud track available yet.";
      logLine("track snapshot not found (404)");
      return;
    }
    if (connection.kind === "fake") {
      appState.track.statusText = "Track snapshots are unavailable in fake mode.";
      logLine("track snapshot skipped in fake mode");
      return;
    }
    throw new Error("Bluetooth transport does not provide track snapshots");
  }

  replaceTrackPoints(points);
  logLine(`track snapshot loaded (${points.length} points)`);
}
