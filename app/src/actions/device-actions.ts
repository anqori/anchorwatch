import {
  CONNECTION_RUNTIME_MODE_ONBOARD,
  CONNECTION_RUNTIME_MODE_REMOTE,
} from "../core/constants";
import type { AlertType, JsonRecord, WifiSecurity } from "../core/types";
import {
  buildAuthorizeBleSessionRequest,
  buildAuthorizeSetupRequest,
  buildAlarmConfig,
  buildAnchorSettingsConfig,
  buildCloudCredentialsUpdate,
  buildSetInitialBlePinRequest,
  buildObstaclesConfig,
  buildProfilesConfig,
  buildSystemConfig,
  buildUpdateBlePinRequest,
  buildWlanConfig,
} from "../services/config-patch-builders";
import {
  mapAlertDraftToConfigInput,
  mapAnchorDraftToConfigInput,
  mapCloudCredentialsToUpdateInput,
  mapObstaclesDraftToConfigInput,
  mapProfilesDraftToConfigInput,
  mapSystemDraftToConfigInput,
  mapWlanDraftToConfigInput,
} from "../services/config-draft-mappers";
import { normalizeRelayBaseUrl } from "../services/local-storage";
import { safeParseJson } from "../services/data-utils";
import { readCurrentGpsPosition } from "../services/state-derive";
import { getRelayBaseUrl, getBoatId, getBleConnectionPin, getCloudSecret, setRelayBaseUrl } from "../services/persistence-domain";
import { defaultConnectionForRuntimeMode, getBluetoothConnection } from "../connections/connection-factory";
import type { DeviceStreamHandle } from "../connections/device-connection";
import type { DeviceConnectionBleLike } from "../connections/ble/device-connection-ble-like";
import { deviceLinker } from "../linker/device-linker";
import {
  appState,
  logLine,
  refreshIdentityUi,
  resetLiveDataState,
  setBoatId,
  setBleConnectionPin,
  setCloudSecret,
  setConnectionRuntimeMode,
  upsertWifiScanNetwork,
} from "../state/app-state.svelte";

let wifiScanHandle: DeviceStreamHandle | null = null;

function clearWifiScanState(): void {
  appState.network.wifiScanRequestId = "";
  appState.network.wifiScanInFlight = false;
}

function ensureConfiguredDeviceForConnectionSelection(): void {
  if (!appState.connection.hasConfiguredDevice) {
    throw new Error("Complete device setup first.");
  }
}

function requireRelayBaseUrl(): string {
  const base = getRelayBaseUrl().trim();
  if (!base) {
    throw new Error("Relay base URL is required.");
  }
  return base;
}

async function requestProxyJson(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(new URL(path, requireRelayBaseUrl()).toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = safeParseJson(await response.text());
  if (!response.ok) {
    const errorRecord = payload && typeof payload === "object" && !Array.isArray(payload) && "error" in payload
      ? (payload as JsonRecord).error
      : null;
    if (errorRecord && typeof errorRecord === "object" && errorRecord !== null) {
      const error = errorRecord as JsonRecord;
      const code = typeof error.code === "string" ? error.code : "REQUEST_FAILED";
      const message = typeof error.message === "string" ? error.message : `request failed (${response.status})`;
      throw new Error(`${code}: ${message}`);
    }
    throw new Error(`request failed (${response.status})`);
  }

  return payload;
}

async function refreshBleAuthStateIfNeeded(): Promise<void> {
  const connection = deviceLinker.getConnection();
  if (connection.kind !== "bluetooth") {
    return;
  }
  const bleConnection = connection as DeviceConnectionBleLike;
  await bleConnection.refreshAuthState();
}

async function authorizeCurrentBleSessionWithPin(bleConnectionPin: string): Promise<void> {
  const normalizedBleConnectionPin = bleConnectionPin.trim();
  if (!normalizedBleConnectionPin) {
    throw new Error("ble_connection_pin is required");
  }
  await requestAck("AUTHORIZE_BLE_SESSION", buildAuthorizeBleSessionRequest({
    bleConnectionPin: normalizedBleConnectionPin,
  }));
  await refreshBleAuthStateIfNeeded();
  await deviceLinker.restartRuntimeStream();
}

async function requestAck(type: Parameters<typeof deviceLinker.request>[0], data: unknown = {}): Promise<void> {
  const reply = await deviceLinker.request(type, data);
  if (reply.type !== "ACK") {
    throw new Error(`${type} closed without ACK`);
  }
}

export async function startDeviceRuntime(): Promise<void> {
  await deviceLinker.start();
}

export async function stopDeviceRuntime(): Promise<void> {
  await cancelWifiScan();
  await deviceLinker.stop();
}

export async function selectDeviceModeForSetup(): Promise<void> {
  setConnectionRuntimeMode(CONNECTION_RUNTIME_MODE_ONBOARD);
}

export async function searchForDeviceViaBluetooth(): Promise<void> {
  await selectDeviceModeForSetup();
  resetLiveDataState();

  const bleConnection = getBluetoothConnection();
  bleConnection.requestPickerOnNextConnect();
  if (bleConnection.isConnected()) {
    await bleConnection.disconnect();
  }

  await deviceLinker.setConnection(bleConnection);
  refreshIdentityUi();
  logLine("BLE connected and active connection switched to bluetooth");
}

export async function saveManualConnectionCredentials(boatId: string, cloudSecret: string): Promise<void> {
  const normalizedBoatId = boatId.trim();
  const normalizedCloudSecret = cloudSecret.trim();
  if (!normalizedBoatId) {
    throw new Error("boat_id is required");
  }
  if (!normalizedCloudSecret) {
    throw new Error("cloud_secret is required");
  }

  setBoatId(normalizedBoatId);
  setCloudSecret(normalizedCloudSecret);
  setConnectionRuntimeMode(CONNECTION_RUNTIME_MODE_REMOTE);
  refreshIdentityUi();

  logLine("manual connection credentials saved");
}

export async function activateBoatSetup(factorySetupPin: string, bleConnectionPin: string): Promise<void> {
  const normalizedFactorySetupPin = factorySetupPin.trim();
  const normalizedBleConnectionPin = bleConnectionPin.trim();

  if (deviceLinker.getConnection().kind !== "bluetooth") {
    throw new Error("Initial setup requires a local BLE connection.");
  }
  if (!normalizedFactorySetupPin) {
    throw new Error("factory setup PIN is required");
  }
  if (!normalizedBleConnectionPin) {
    throw new Error("ble_connection_pin is required");
  }

  await requestAck("AUTHORIZE_SETUP", buildAuthorizeSetupRequest({
    factorySetupPin: normalizedFactorySetupPin,
  }));
  await requestAck("SET_INITIAL_BLE_PIN", buildSetInitialBlePinRequest({
    bleConnectionPin: normalizedBleConnectionPin,
  }));
  const bleBoatId = typeof appState.ble.authState?.boat_id === "string" ? appState.ble.authState.boat_id.trim() : "";
  if (bleBoatId) {
    setBoatId(bleBoatId);
  }
  setBleConnectionPin(normalizedBleConnectionPin);
  setConnectionRuntimeMode(CONNECTION_RUNTIME_MODE_ONBOARD);
  await refreshBleAuthStateIfNeeded();
  await deviceLinker.restartRuntimeStream();
  logLine("initial BLE onboarding completed");
}

export async function authorizeCurrentSession(boatId: string, bleConnectionPin: string): Promise<void> {
  const normalizedBoatId = boatId.trim();
  const normalizedBleConnectionPin = bleConnectionPin.trim();
  if (normalizedBoatId) {
    setBoatId(normalizedBoatId);
  }
  setBleConnectionPin(normalizedBleConnectionPin);
  await authorizeCurrentBleSessionWithPin(normalizedBleConnectionPin);
  logLine(`AUTHORIZE_BLE_SESSION sent via ${deviceLinker.getConnection().kind}`);
}

export async function rotateBleConnectionPin(newBleConnectionPin: string): Promise<void> {
  const oldBleConnectionPin = getBleConnectionPin().trim();
  const normalizedNewBleConnectionPin = newBleConnectionPin.trim();
  const connection = deviceLinker.getConnection();

  if (connection.kind !== "bluetooth") {
    throw new Error("BLE pin rotation requires a local BLE connection.");
  }
  if (!oldBleConnectionPin) {
    throw new Error("current ble_connection_pin is required");
  }
  if (!normalizedNewBleConnectionPin) {
    throw new Error("new ble_connection_pin is required");
  }

  await requestAck("UPDATE_BLE_PIN", buildUpdateBlePinRequest({
    oldBleConnectionPin,
    newBleConnectionPin: normalizedNewBleConnectionPin,
  }));
  setBleConnectionPin(normalizedNewBleConnectionPin);
  await authorizeCurrentBleSessionWithPin(normalizedNewBleConnectionPin);
  logLine("BLE connection pin rotated over BLE");
}

export async function selectRelayConnection(): Promise<void> {
  ensureConfiguredDeviceForConnectionSelection();
  setConnectionRuntimeMode(CONNECTION_RUNTIME_MODE_REMOTE);
  resetLiveDataState();
  await deviceLinker.setConnection(defaultConnectionForRuntimeMode(CONNECTION_RUNTIME_MODE_REMOTE));
  logLine("active connection switched to cloud-relay");
}

export async function selectBluetoothConnection(): Promise<void> {
  ensureConfiguredDeviceForConnectionSelection();
  if (!appState.connection.bleSupported) {
    throw new Error("Bluetooth is not supported in this browser/app environment.");
  }
  setConnectionRuntimeMode(CONNECTION_RUNTIME_MODE_ONBOARD);
  resetLiveDataState();
  await deviceLinker.setConnection(getBluetoothConnection());
  logLine("active connection switched to bluetooth");
}

export async function switchToOnboardMode(): Promise<void> {
  ensureConfiguredDeviceForConnectionSelection();
  setConnectionRuntimeMode(CONNECTION_RUNTIME_MODE_ONBOARD);
  resetLiveDataState();
  await deviceLinker.setConnection(getBluetoothConnection());
  logLine("runtime mode switched to onboard (BLE only)");
}

export async function switchToRemoteMode(): Promise<void> {
  ensureConfiguredDeviceForConnectionSelection();
  setConnectionRuntimeMode(CONNECTION_RUNTIME_MODE_REMOTE);
  resetLiveDataState();
  await deviceLinker.setConnection(defaultConnectionForRuntimeMode(CONNECTION_RUNTIME_MODE_REMOTE));
  logLine("runtime mode switched to remote (relay only)");
}

export async function reconnectLastKnownBleDevice(): Promise<void> {
  ensureConfiguredDeviceForConnectionSelection();
  setConnectionRuntimeMode(CONNECTION_RUNTIME_MODE_ONBOARD);
  resetLiveDataState();
  const bleConnection = getBluetoothConnection();
  const reconnectState = await bleConnection.refreshReconnectAvailability();
  if (!reconnectState.available) {
    bleConnection.requestPickerOnNextConnect();
    logLine("no remembered BLE device found; opening picker");
  }
  await deviceLinker.setConnection(bleConnection);
  logLine("reconnect requested for last known BLE device");
}

export async function saveRelayUrl(): Promise<void> {
  const normalized = normalizeRelayBaseUrl(appState.network.relayBaseUrlInput);
  setRelayBaseUrl(normalized);
  appState.network.relayBaseUrlInput = normalized;
  logLine(`relay base URL saved: ${normalized || "(empty)"}`);

  if (deviceLinker.getConnection().kind !== "bluetooth") {
    await deviceLinker.setConnection(defaultConnectionForRuntimeMode(appState.connection.runtimeMode));
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

export async function cancelWifiScan(): Promise<void> {
  const current = wifiScanHandle;
  wifiScanHandle = null;
  clearWifiScanState();
  if (!current) {
    return;
  }
  try {
    await current.cancel();
  } catch {
    // ignore
  }
}

export async function scanWifiNetworks(): Promise<void> {
  if (appState.network.wifiScanInFlight) {
    return;
  }

  const connection = deviceLinker.getConnection();
  if (connection.kind === "cloud-relay") {
    throw new Error("WLAN scan requires local Bluetooth. Switch Connection to 'Connected via BT'.");
  }
  const authState = appState.ble.authState ?? {};
  const boatAccessState = typeof authState.boat_access_state === "string" ? authState.boat_access_state : "";
  const sessionState = typeof authState.session_state === "string" ? authState.session_state : "";
  if (boatAccessState === "SETUP_REQUIRED") {
    throw new Error("Boat setup required before WLAN scan.");
  }
  if (sessionState !== "AUTHORIZED") {
    throw new Error("Authorize the BLE session before WLAN scan.");
  }

  await cancelWifiScan();
  appState.network.availableWifiNetworks = [];
  appState.network.wifiScanErrorText = "";
  appState.network.wifiScanInFlight = true;
  appState.network.wifiScanStatusText = "Scanning nearby WLAN networks...";

  const handle = await connection.openStream("SCAN_WLAN", {}, ({ reply }) => {
    if (reply.type === "WLAN_NETWORK" && typeof reply.data === "object" && reply.data !== null) {
      const data = reply.data as JsonRecord;
      upsertWifiScanNetwork({
        ssid: typeof data.ssid === "string" ? data.ssid : "",
        security: data.security === "open" || data.security === "wpa3" || data.security === "unknown" ? data.security : "wpa2",
        rssi: typeof data.rssi === "number" ? data.rssi : null,
        channel: typeof data.channel === "number" ? data.channel : null,
        hidden: data.hidden === true,
      });
      appState.network.wifiScanUpdatedAtMs = Date.now();
      appState.network.wifiScanStatusText = `Found ${appState.network.availableWifiNetworks.length} WLAN network${appState.network.availableWifiNetworks.length === 1 ? "" : "s"}...`;
    }
  });

  wifiScanHandle = handle;
  appState.network.wifiScanRequestId = handle.reqId;

  try {
    await handle.done;
    appState.network.wifiScanStatusText = appState.network.availableWifiNetworks.length > 0
      ? `Found ${appState.network.availableWifiNetworks.length} WLAN network${appState.network.availableWifiNetworks.length === 1 ? "" : "s"}.`
      : "No WLAN networks found. Try scanning again.";
  } catch (error) {
    appState.network.wifiScanErrorText = String(error);
    appState.network.wifiScanStatusText = "WLAN scan failed.";
    throw error;
  } finally {
    if (wifiScanHandle === handle) {
      wifiScanHandle = null;
    }
    clearWifiScanState();
  }
}

export async function connectToWifiNetwork(ssid: string, security: WifiSecurity, passphrase: string, cloudSecret: string): Promise<void> {
  const normalizedSsid = ssid.trim();
  if (!normalizedSsid) {
    throw new Error("Wi-Fi SSID is required");
  }

  appState.network.wifiSsid = normalizedSsid;
  appState.network.selectedWifiSsid = normalizedSsid;
  appState.network.wifiSecurity = security === "unknown" ? "wpa2" : security;
  appState.network.wifiPass = appState.network.wifiSecurity === "open" ? "" : passphrase;
  appState.network.cloudSecret = cloudSecret.trim();
  if (!appState.network.wifiCountry.trim()) {
    appState.network.wifiCountry = "DE";
  }

  await applyWifiConfig();
}

export async function applyWifiConfig(): Promise<void> {
  const currentVersion = appState.deviceData.wlanConfig?.version;
  if (typeof currentVersion !== "number") {
    throw new Error("WLAN config version unavailable.");
  }

  await requestAck("UPDATE_CONFIG_WLAN", buildWlanConfig(
    mapWlanDraftToConfigInput({
      version: currentVersion,
      ssid: appState.network.wifiSsid,
      passphrase: appState.network.wifiPass,
      security: appState.network.wifiSecurity,
      country: appState.network.wifiCountry,
      hidden: appState.network.selectedWifiNetwork?.hidden ?? appState.network.wifiHidden,
    }),
  ));
  logLine(`UPDATE_CONFIG_WLAN sent via ${deviceLinker.getConnection().kind} for ${appState.network.wifiSsid}`);

  const normalizedCloudSecret = appState.network.cloudSecret.trim();
  if (normalizedCloudSecret) {
    const boatId = getBoatId().trim() || appState.deviceData.cloudConfig?.boat_id?.trim() || "";
    await applyCloudCredentials(boatId, normalizedCloudSecret);
  }
}

export async function applyAnchorConfig(): Promise<void> {
  const version = appState.deviceData.anchorSettingsConfig?.version;
  if (typeof version !== "number") {
    throw new Error("Anchor settings version unavailable.");
  }
  await requestAck(
    "UPDATE_CONFIG_ANCHOR_SETTINGS",
    buildAnchorSettingsConfig(mapAnchorDraftToConfigInput(appState.configDrafts.anchor, version)),
  );
}

export async function applyCloudCredentials(boatId: string, cloudSecret: string): Promise<void> {
  const normalizedBoatId = boatId.trim();
  const normalizedCloudSecret = cloudSecret.trim();
  const version = appState.deviceData.cloudConfig?.version;
  if (typeof version !== "number") {
    throw new Error("Cloud config version unavailable.");
  }
  if (!normalizedBoatId) {
    throw new Error("boat_id is required");
  }
  if (!normalizedCloudSecret) {
    throw new Error("cloud_secret is required");
  }

  await requestProxyJson("/v1/update-boat-secret", {
    boat_id: normalizedBoatId,
    old_secret: getCloudSecret().trim(),
    new_secret: normalizedCloudSecret,
  });
  await requestAck("UPDATE_CLOUD_CREDENTIALS", buildCloudCredentialsUpdate(
    mapCloudCredentialsToUpdateInput(version, normalizedBoatId, normalizedCloudSecret),
  ));
  setBoatId(normalizedBoatId);
  setCloudSecret(normalizedCloudSecret);
  logLine("cloud credentials updated over BLE + proxy");
}

export async function applyAlertConfig(): Promise<void> {
  const version = appState.deviceData.alarmConfig?.version;
  if (typeof version !== "number") {
    throw new Error("Alarm config version unavailable.");
  }
  await requestAck(
    "UPDATE_CONFIG_ALARM",
    buildAlarmConfig(mapAlertDraftToConfigInput(appState.configDrafts.alerts, version)),
  );
}

export async function applyObstaclesConfig(): Promise<void> {
  const version = appState.deviceData.obstaclesConfig?.version;
  if (typeof version !== "number") {
    throw new Error("Obstacles config version unavailable.");
  }
  await requestAck(
    "UPDATE_CONFIG_OBSTACLES",
    buildObstaclesConfig(mapObstaclesDraftToConfigInput(appState.configDrafts.obstacles, version)),
  );
}

export async function applyProfilesConfig(): Promise<void> {
  const version = appState.deviceData.profilesConfig?.version;
  if (typeof version !== "number") {
    throw new Error("Profiles config version unavailable.");
  }
  appState.configDrafts.profiles.version = version;
  await requestAck(
    "UPDATE_CONFIG_PROFILES",
    buildProfilesConfig(mapProfilesDraftToConfigInput(appState.configDrafts.profiles)),
  );
}

export async function applySystemConfig(): Promise<void> {
  const version = appState.deviceData.systemConfig?.version;
  if (typeof version !== "number") {
    throw new Error("System config version unavailable.");
  }
  await requestAck(
    "UPDATE_CONFIG_SYSTEM",
    buildSystemConfig(mapSystemDraftToConfigInput(appState.configDrafts.system, version)),
  );
}

export async function raiseAnchor(): Promise<void> {
  await requestAck("RAISE_ANCHOR");
  logLine(`RAISE_ANCHOR sent via ${deviceLinker.getConnection().kind}`);
}

export async function silenceAlarm(alertType: AlertType): Promise<void> {
  await requestAck("SILENCE_ALARM", {
    alert_type: alertType,
  });
  logLine(`SILENCE_ALARM sent via ${deviceLinker.getConnection().kind} for ${alertType}`);
}

export async function unsilenceAlarm(alertType: AlertType): Promise<void> {
  await requestAck("UNSILENCE_ALARM", {
    alert_type: alertType,
  });
  logLine(`UNSILENCE_ALARM sent via ${deviceLinker.getConnection().kind} for ${alertType}`);
}

export async function moveAnchorToPosition(lat: number, lon: number): Promise<void> {
  await requestAck("MOVE_ANCHOR", {
    lat,
    lon,
  });
  logLine(`MOVE_ANCHOR sent via ${deviceLinker.getConnection().kind} to lat=${lat.toFixed(5)} lon=${lon.toFixed(5)}`);
}

export async function dropAnchorAtCurrentPosition(): Promise<void> {
  const gps = readCurrentGpsPosition(appState.deviceData.position);
  if (!gps) {
    throw new Error("Current GPS position unavailable.");
  }
  await requestAck("SET_ANCHOR", {
    lat: gps.lat,
    lon: gps.lon,
  });
  logLine(`SET_ANCHOR sent via ${deviceLinker.getConnection().kind}`);
}

export async function fetchTrackSnapshot(): Promise<void> {
  logLine("track snapshot request skipped; GET_DATA owns runtime track backfill");
}
