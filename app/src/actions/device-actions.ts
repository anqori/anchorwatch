import { TRACK_SNAPSHOT_LIMIT } from "../core/constants";
import type { JsonRecord } from "../core/types";
import { mapAnchorDraftToConfigInput, mapProfilesDraftToConfigInput, mapTriggerDraftToConfigInput } from "../services/config-draft-mappers";
import { buildAnchorConfigPatch, buildProfilesConfigPatch, buildTriggerConfigPatch, manualAnchorLogMessage } from "../services/config-patch-builders";
import { parseWifiScanNetworks } from "../services/data-utils";
import { normalizeRelayBaseUrl } from "../services/local-storage";
import {
  getRelayBaseUrl,
  nextConfigVersion,
  setConfigVersion,
  setRelayBaseUrl,
} from "../services/persistence-domain";
import type { ConfigPatchCommand } from "../services/protocol-messages";
import { defaultConnectionForMode, getBluetoothConnection, getFakeConnection, getRelayCloudConnection } from "../connections/connection-factory";
import { deviceLinker } from "../linker/device-linker";
import {
  appState,
  applyMode,
  applyStateSnapshot,
  applyWifiScanNetworks,
  logLine,
  markBleMessageSeen,
  readCloudCredentialFields,
  refreshIdentityUi,
  replaceTrackPoints,
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

function ensureActiveBluetoothConnection(): void {
  const connection = deviceLinker.getConnection();
  if (connection.kind !== "bluetooth" || !connection.isConnected()) {
    throw new Error("Connect BLE before using this action");
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
  applyMode("fake");
  await deviceLinker.setConnection(getFakeConnection());
  clearWifiScanTimeout();
  appState.network.wifiScanInFlight = false;
  appState.network.wifiScanStatusText = "Scan for available WLAN networks.";
  logLine("fake connection.mode selected; skipped BLE/cloud setup");
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

export async function probeRelay(): Promise<void> {
  const base = getRelayBaseUrl();
  if (!base) {
    appState.connection.relayResult = "Set relay base URL first.";
    return;
  }

  try {
    const probe = await getRelayCloudConnection().probeRelay(base);
    appState.connection.relayResult = probe.resultText;
    if (probe.buildVersion) {
      appState.versions.cloud = probe.buildVersion;
    }
  } catch (error) {
    appState.connection.relayResult = `Relay probe failed: ${String(error)}`;
  }
}

export async function verifyCloudAuth(): Promise<void> {
  const { base, boatId, boatSecret } = readCloudCredentialFields();

  if (!base) {
    throw new Error("Relay base URL missing");
  }
  if (!boatId) {
    throw new Error("Boat ID missing");
  }
  if (!boatSecret) {
    throw new Error("Boat secret missing");
  }

  try {
    const buildVersion = await getRelayCloudConnection().fetchBuildVersion(base);
    if (buildVersion) {
      appState.versions.cloud = buildVersion;
    }
  } catch {
    // Ignore build version lookup errors in verify flow.
  }

  const authVerify = await getRelayCloudConnection().verifyStateAuth();
  if (authVerify.ok) {
    appState.connection.cloudStatusText = `ok (${authVerify.status})`;
    logLine(`cloud auth verify ok (${authVerify.status})`);
    return;
  }

  appState.connection.cloudStatusText = `failed (${authVerify.status})`;
  throw new Error(`cloud verify failed ${authVerify.status}: ${authVerify.errorText}`);
}

export async function scanWifiNetworks(): Promise<void> {
  ensureActiveBluetoothConnection();

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
    const ack = await deviceLinker.getConnection().sendCommand("onboarding.wifi.scan", {
      requestId,
      maxResults: 20,
      includeHidden: false,
    }, true);

    const ackNetworks = parseWifiScanNetworks(ack?.networks);
    if (ackNetworks.length > 0) {
      applyWifiScanNetworks(ackNetworks);
      clearWifiScanTimeout();
      appState.network.wifiScanInFlight = false;
      appState.network.wifiScanStatusText = `Found ${ackNetworks.length} WLAN network${ackNetworks.length === 1 ? "" : "s"}.`;
    }
  } catch (error) {
    clearWifiScanTimeout();
    appState.network.wifiScanInFlight = false;
    appState.network.wifiScanErrorText = String(error);
    appState.network.wifiScanStatusText = "WLAN scan failed.";
    throw error;
  }
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

  if (connection.kind === "bluetooth") {
    applyStateSnapshot(snapshot, "ble/snapshot");
    markBleMessageSeen(Date.now());
    logLine("status.snapshot read");
    return;
  }

  if (connection.kind === "cloud-relay") {
    applyStateSnapshot(snapshot, "cloud/status.snapshot");
    logLine("cloud status.snapshot read");
  }
}

export async function applyWifiConfigFromInternetPage(): Promise<void> {
  await applyWifiConfig();
  await refreshStateSnapshot();
}

export async function applyAnchorConfig(): Promise<void> {
  const anchorInput = mapAnchorDraftToConfigInput(appState.configDrafts.anchor);
  const patch = buildAnchorConfigPatch(anchorInput);

  await sendConfigPatch(patch, "anchor+zone");
  const manualLog = manualAnchorLogMessage(anchorInput);
  if (manualLog) {
    logLine(manualLog);
  }
}

export async function applyTriggerConfig(): Promise<void> {
  const patch = buildTriggerConfigPatch(mapTriggerDraftToConfigInput(appState.configDrafts.triggers));
  await sendConfigPatch(patch, "triggers");
}

export async function applyProfilesConfig(): Promise<void> {
  const patch = buildProfilesConfigPatch(mapProfilesDraftToConfigInput(appState.configDrafts.profiles));
  await sendConfigPatch(patch, "profiles");
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
