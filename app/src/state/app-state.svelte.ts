import {
  CONFIG_SECTIONS,
  MODE_FAKE,
  PWA_BUILD_VERSION,
  TRACK_MAX_POINTS,
} from "../core/constants";
import type {
  ConnectionState,
  ConfigDraftsState,
  InboundSource,
  JsonRecord,
  NavigationState,
  NetworkState,
  NotificationState,
  PillClass,
  TrackPoint,
  VersionState,
  WifiScanNetwork,
} from "../core/types";
import { deepMerge, isObject, normalizePatch } from "../services/data-utils";
import { maskSecret } from "../services/local-storage";
import {
  ensurePhoneId,
  getBoatId,
  getBoatSecret,
  getRelayBaseUrl,
  hasConnectedViaBleOnce,
  loadMode,
  setBoatId as setBoatIdStored,
  setBoatSecret as setBoatSecretStored,
  setMode as setModeStored,
} from "../services/persistence-domain";
import {
  hasCloudCredentialsConfigured,
  hasConfiguredDevice,
} from "../services/connectivity-derive";
import { deriveTelemetry, readAnchorStatus } from "../services/state-derive";
import { deriveTrackSummary, deriveRadarProjection } from "../services/track-derive";

export interface BleUiState {
  connected: boolean;
  deviceName: string;
  authState: JsonRecord | null;
}

export interface RuntimeState {
  bootMs: number;
  lastBleMessageAtMs: number;
  lastCloudPollMs: number;
  lastCloudHealthPollMs: number;
}

export interface SummaryState {
  gpsAgeText: string;
  dataAgeText: string;
  depthText: string;
  windText: string;
  statePillText: string;
  statePillClass: PillClass;
  stateSourceText: string;
}

export interface TrackUiState {
  statusText: string;
  points: TrackPoint[];
  currentLatText: string;
  currentLonText: string;
  currentSogText: string;
  currentCogText: string;
  currentHeadingText: string;
  radarTargetX: number;
  radarTargetY: number;
  radarDistanceText: string;
  radarBearingText: string;
}

function defaultConfigDrafts(): ConfigDraftsState {
  return {
    anchor: {
      autoModeMinForwardSogKn: "0.8",
      autoModeStallMaxSogKn: "0.3",
      autoModeReverseMinSogKn: "0.4",
      autoModeConfirmSeconds: "20",
    },
    alerts: {
      anchor_distance: {
        id: "anchor_distance",
        isEnabled: true,
        minTimeMs: "20000",
        severity: "ALARM",
        maxDistanceM: "35",
      },
      boating_area: {
        id: "boating_area",
        isEnabled: true,
        minTimeMs: "20000",
        severity: "ALARM",
        polygonPointsInput: "54.3194,10.1388\n54.3212,10.1388\n54.3212,10.1418\n54.3194,10.1418",
      },
      wind_strength: {
        id: "wind_strength",
        isEnabled: true,
        minTimeMs: "20000",
        severity: "WARNING",
        maxTwsKn: "30.0",
      },
      depth: {
        id: "depth",
        isEnabled: false,
        minTimeMs: "10000",
        severity: "ALARM",
        minDepthM: "2",
      },
      data_outdated: {
        id: "data_outdated",
        isEnabled: true,
        minTimeMs: "5000",
        severity: "WARNING",
        minAgeMs: "5000",
      },
    },
    profiles: {
      mode: "auto",
      dayColorScheme: "full",
      dayBrightnessPct: "100",
      dayOutputProfile: "normal",
      nightColorScheme: "red",
      nightBrightnessPct: "20",
      nightOutputProfile: "night",
      autoSwitchSource: "time",
      dayStartLocal: "07:00",
      nightStartLocal: "21:30",
    },
  };
}

function defaultNetworkState(): NetworkState {
  return {
    relayBaseUrlInput: "",
    wifiSsid: "",
    wifiPass: "",
    wifiSecurity: "wpa2",
    wifiCountry: "",
    wifiScanRequestId: "",
    wifiScanUpdatedAtMs: 0,
    wifiScanInFlight: false,
    wifiScanStatusText: "Scan for available WLAN networks.",
    wifiScanErrorText: "",
    availableWifiNetworks: [],
    selectedWifiSsid: "",
    selectedWifiNetwork: null,
    onboardingWifiSsid: "--",
    onboardingWifiConnected: false,
    onboardingWifiRssiText: "--",
    onboardingWifiErrorText: "",
    onboardingWifiStateText: "Waiting for Wi-Fi status...",
    settingsInternetStatusText: "Internet not configured",
  };
}

function defaultNavigationState(): NavigationState {
  return {
    settingsDeviceStatusText: "No Device connected yet",
    configSectionsWithStatus: CONFIG_SECTIONS,
    activeView: "summary",
    activeConfigView: "settings",
    depth: 0,
    suppressedPopEvents: 0,
    isFullScreenVizView: false,
    isConfigView: false,
  };
}

function defaultVersionState(): VersionState {
  return {
    pwa: PWA_BUILD_VERSION,
    firmware: "--",
    cloud: "--",
  };
}

function defaultNotificationState(): NotificationState {
  return {
    permissionText: "not checked",
    statusText: "No notification checks yet.",
  };
}

function defaultSummaryState(): SummaryState {
  return {
    gpsAgeText: "--",
    dataAgeText: "--",
    depthText: "--",
    windText: "--",
    statePillText: "BOOT",
    statePillClass: "ok",
    stateSourceText: "Source: --",
  };
}

function defaultTrackState(): TrackUiState {
  return {
    statusText: "No track yet",
    points: [],
    currentLatText: "--",
    currentLonText: "--",
    currentSogText: "--",
    currentCogText: "--",
    currentHeadingText: "--",
    radarTargetX: 110,
    radarTargetY: 110,
    radarDistanceText: "--",
    radarBearingText: "--",
  };
}

interface ExtendedConnectionState extends ConnectionState {
  activeConnection: "fake" | "bluetooth" | "cloud-relay";
  activeConnectionConnected: boolean;
}

function defaultConnectionState(): ExtendedConnectionState {
  return {
    mode: loadMode(),
    appState: "UNCONFIGURED",
    bleSupported: false,
    bleStatusText: "disconnected",
    boatIdText: "--",
    secretStatusText: "not stored",
    relayResult: "No request yet.",
    connectedDeviceName: "",
    hasConfiguredDevice: false,
    activeConnection: "fake" as "fake" | "bluetooth" | "cloud-relay",
    activeConnectionConnected: false,
  };
}

export const appState = $state({
  runtime: {
    bootMs: performance.now(),
    lastBleMessageAtMs: 0,
    lastCloudPollMs: 0,
    lastCloudHealthPollMs: 0,
  } as RuntimeState,
  latestState: {} as JsonRecord,
  latestStateSource: "--" as InboundSource | "--",
  latestStateUpdatedAtMs: 0,
  ble: {
    connected: false,
    deviceName: "",
    authState: null,
  } as BleUiState,
  summary: defaultSummaryState(),
  track: defaultTrackState(),
  maptilerStatusText: "Map ready state pending.",
  connection: defaultConnectionState(),
  versions: defaultVersionState(),
  network: defaultNetworkState(),
  navigation: defaultNavigationState(),
  notifications: defaultNotificationState(),
  configDrafts: defaultConfigDrafts(),
  logLines: [] as string[],
});

export function initAppStateEnvironment(hasBluetooth: boolean, hasMaptilerKey: boolean): void {
  appState.connection.bleSupported = hasBluetooth;
  appState.maptilerStatusText = hasMaptilerKey ? "Map ready state pending." : "MapTiler token missing.";
  refreshIdentityUi();
  appState.network.wifiSecurity = "wpa2";
  appState.network.relayBaseUrlInput = getRelayBaseUrl();
  setSummarySource("--");
}

function computeConfiguredDeviceState(): boolean {
  return hasConfiguredDevice(getBoatId(), hasConnectedViaBleOnce());
}

export function readCloudCredentialFields(): { base: string; boatId: string; boatSecret: string } {
  return {
    base: getRelayBaseUrl(),
    boatId: getBoatId(),
    boatSecret: getBoatSecret(),
  };
}

export function readCloudCredentials(): { base: string; boatId: string; boatSecret: string } | null {
  const credentials = readCloudCredentialFields();
  if (!hasCloudCredentialsConfigured(credentials.base, credentials.boatId, credentials.boatSecret)) {
    return null;
  }
  return credentials;
}

export function refreshIdentityUi(): void {
  const boatId = getBoatId();
  const boatSecret = getBoatSecret();
  appState.connection.hasConfiguredDevice = computeConfiguredDeviceState();
  appState.connection.boatIdText = boatId || "--";
  appState.connection.secretStatusText = maskSecret(boatSecret);
  appState.network.relayBaseUrlInput = getRelayBaseUrl();
}

export function setBoatId(value: string): void {
  setBoatIdStored(value);
  refreshIdentityUi();
}

export function setBoatSecret(secret: string): void {
  setBoatSecretStored(secret);
  refreshIdentityUi();
}

export function applyMode(mode: "fake" | "device", persist = true): void {
  appState.connection.mode = mode;
  if (persist) {
    setModeStored(mode);
  }
}

export function setActiveConnection(kind: "fake" | "bluetooth" | "cloud-relay"): void {
  appState.connection.activeConnection = kind;
  appState.connection.activeConnectionConnected = false;
}

export function setActiveConnectionConnected(connected: boolean): void {
  appState.connection.activeConnectionConnected = connected;
}

export function setBleConnectionState(connected: boolean, deviceName = ""): void {
  appState.ble.connected = connected;
  appState.ble.deviceName = deviceName;
}

export function setBleAuthState(authState: JsonRecord | null): void {
  appState.ble.authState = authState;
}

export function markBleMessageSeen(nowTs = Date.now()): void {
  appState.runtime.lastBleMessageAtMs = nowTs;
}

export function setCloudPollTimestamp(nowTs = Date.now()): void {
  appState.runtime.lastCloudPollMs = nowTs;
}

export function setCloudHealthPollTimestamp(nowTs = Date.now()): void {
  appState.runtime.lastCloudHealthPollMs = nowTs;
}

export function setSummaryState(text: string, klass: PillClass): void {
  appState.summary.statePillText = text;
  appState.summary.statePillClass = klass;
}

export function setSummarySource(text: string): void {
  appState.summary.stateSourceText = `Source: ${text}`;
}

export function setTelemetry(gpsAgeS: number, dataAgeS: number, depthM: number, windKn: number): void {
  appState.summary.gpsAgeText = `${Math.max(0, Math.round(gpsAgeS))}s`;
  appState.summary.dataAgeText = `${Math.max(0, Math.round(dataAgeS))}s`;
  appState.summary.depthText = `${depthM.toFixed(1)} m`;
  appState.summary.windText = `${windKn.toFixed(1)} kn`;
}

export function applyStateSnapshot(snapshot: unknown, source: InboundSource): void {
  if (!isObject(snapshot)) {
    return;
  }
  appState.latestState = snapshot;
  appState.latestStateSource = source;
  appState.latestStateUpdatedAtMs = Date.now();
}

export function applyStatePatch(rawPatch: unknown, source: InboundSource): void {
  const patch = normalizePatch(rawPatch);
  if (!patch) {
    return;
  }
  appState.latestState = deepMerge(appState.latestState, patch);
  appState.latestStateSource = source;
  appState.latestStateUpdatedAtMs = Date.now();
}

export function resetLiveDataState(): void {
  appState.latestState = {};
  appState.latestStateSource = "--";
  appState.latestStateUpdatedAtMs = 0;

  appState.summary.gpsAgeText = "--";
  appState.summary.dataAgeText = "--";
  appState.summary.depthText = "--";
  appState.summary.windText = "--";
  appState.summary.statePillText = "BOOT";
  appState.summary.statePillClass = "ok";
  appState.summary.stateSourceText = "Source: --";

  appState.track.points = [];
  appState.track.statusText = "No track yet";
  appState.track.currentLatText = "--";
  appState.track.currentLonText = "--";
  appState.track.currentSogText = "--";
  appState.track.currentCogText = "--";
  appState.track.currentHeadingText = "--";
  appState.track.radarTargetX = 110;
  appState.track.radarTargetY = 110;
  appState.track.radarDistanceText = "--";
  appState.track.radarBearingText = "--";
}

function applyTrackDerived(points: TrackPoint[]): void {
  const radarProjection = deriveRadarProjection(points);
  appState.track.radarTargetX = radarProjection.targetX;
  appState.track.radarTargetY = radarProjection.targetY;
  appState.track.radarDistanceText = radarProjection.distanceText;
  appState.track.radarBearingText = radarProjection.bearingText;

  const trackSummary = deriveTrackSummary(points);
  appState.track.currentLatText = trackSummary.currentLatText;
  appState.track.currentLonText = trackSummary.currentLonText;
  appState.track.currentSogText = trackSummary.currentSogText;
  appState.track.currentCogText = trackSummary.currentCogText;
  appState.track.currentHeadingText = trackSummary.currentHeadingText;
  appState.track.statusText = trackSummary.statusText;
}

function applyLiveTrackPoint(point: TrackPoint | null): void {
  if (!point) {
    appState.track.currentLatText = "--";
    appState.track.currentLonText = "--";
    appState.track.currentSogText = "--";
    appState.track.currentCogText = "--";
    appState.track.currentHeadingText = "--";
    return;
  }

  appState.track.currentLatText = point.lat.toFixed(5);
  appState.track.currentLonText = point.lon.toFixed(5);
  appState.track.currentSogText = `${point.sogKn.toFixed(2)} kn`;
  appState.track.currentCogText = `${point.cogDeg.toFixed(0)} deg`;
  appState.track.currentHeadingText = `${point.headingDeg.toFixed(0)} deg`;
}

export function appendTrackPoint(point: TrackPoint): void {
  const previous = appState.track.points[appState.track.points.length - 1];
  if (previous && Math.abs(previous.lat - point.lat) < 0.000001 && Math.abs(previous.lon - point.lon) < 0.000001) {
    return;
  }
  appState.track.points = [...appState.track.points, point].slice(-TRACK_MAX_POINTS);
  applyTrackDerived(appState.track.points);
}

export function replaceTrackPoints(points: TrackPoint[]): void {
  appState.track.points = points.slice(-TRACK_MAX_POINTS);
  applyTrackDerived(appState.track.points);
}

export function renderTelemetryFromLatestState(): void {
  const telemetry = deriveTelemetry(appState.latestState, Date.now());
  setTelemetry(telemetry.gpsAgeS, telemetry.dataAgeS, telemetry.depthM, telemetry.windKn);
  applyLiveTrackPoint(telemetry.trackPoint ?? null);
  const anchorStatus = readAnchorStatus(appState.latestState);
  if (telemetry.trackPoint && anchorStatus.state === "down") {
    appendTrackPoint(telemetry.trackPoint);
  }
}

export function applyFakeTelemetryTick(gpsAgeS: number, dataAgeS: number, depthM: number, windKn: number, trackPoint: TrackPoint): void {
  setTelemetry(gpsAgeS, dataAgeS, depthM, windKn);
  appendTrackPoint(trackPoint);
}

export function applyWifiScanNetworks(networks: WifiScanNetwork[]): void {
  appState.network.availableWifiNetworks = networks;
  if (!networks.some((wifiNetwork) => wifiNetwork.ssid === appState.network.selectedWifiSsid)) {
    appState.network.selectedWifiSsid = "";
  }

  if (appState.network.wifiSsid && !appState.network.selectedWifiSsid) {
    const match = networks.find((wifiNetwork) => wifiNetwork.ssid === appState.network.wifiSsid);
    if (match) {
      appState.network.selectedWifiSsid = match.ssid;
    }
  }
}

export function logLine(message: string): void {
  const stamp = new Date().toISOString().slice(11, 19);
  const line = `${stamp} ${message}`;
  appState.logLines = [...appState.logLines, line].slice(-140);
}

export function initAppStateEffects(): void {
  // Intentionally no-op. Derived/UI synchronization is registered from App.svelte.
}

refreshIdentityUi();
ensurePhoneId();
if (appState.connection.mode !== MODE_FAKE) {
  appState.connection.activeConnection = "cloud-relay";
}
