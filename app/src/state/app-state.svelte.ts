import {
  CONNECTION_RUNTIME_MODE_REMOTE,
  CONFIG_SECTIONS,
  PWA_BUILD_VERSION,
  TRACK_MAX_POINTS,
} from "../core/constants";
import type {
  AlarmConfigEntry,
  AlertRuntime,
  AnchorPositionValue,
  AppConnectivityState,
  CloudConfigValue,
  ConfigDraftsState,
  ConnectionRuntimeMode,
  ConnectionState,
  DebugMessageDirection,
  DebugMessageEntry,
  DebugMessageLimit,
  DebugMessageRoute,
  DeviceDataSlices,
  InboundSource,
  JsonRecord,
  NavigationState,
  NetworkState,
  NotificationState,
  ObstaclesConfigValue,
  PillClass,
  ProfilesConfigValue,
  RuntimeMode,
  SystemConfigValue,
  TrackPoint,
  VersionState,
  WlanConfigValue,
  WifiScanNetwork,
} from "../core/types";
import { maskSecret } from "../services/local-storage";
import {
  ensurePhoneId,
  getBoatId,
  getBleConnectionPin,
  getCloudSecret,
  getRelayBaseUrl,
  hasConnectedViaBleOnce,
  loadConnectionRuntimeMode,
  setConnectionRuntimeMode as setConnectionRuntimeModeStored,
  setBoatId as setBoatIdStored,
  setBleConnectionPin as setBleConnectionPinStored,
  setCloudSecret as setCloudSecretStored,
} from "../services/persistence-domain";
import type { DeviceConnectionPhase } from "../connections/device-connection";
import {
  hasCloudCredentialsConfigured,
  hasConfiguredDevice,
} from "../services/connectivity-derive";
import { deriveTrackSummary, deriveRadarProjection } from "../services/track-derive";

export interface BleUiState {
  connected: boolean;
  phase: DeviceConnectionPhase;
  deviceName: string;
  authState: JsonRecord | null;
}

export interface RuntimeState {
  bootMs: number;
  lastBleMessageAtMs: number;
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

export interface ToastUiState {
  opened: boolean;
  message: string;
  serial: number;
}

function defaultAnchorDistanceDraft(): ConfigDraftsState["alerts"]["anchor_distance"] {
  return {
    type: "ANCHOR_DISTANCE",
    enabled: true,
    minTimeMs: "20000",
    severity: "ALARM",
    defaultSilenceMs: "900000",
    maxDistanceM: "35",
  };
}

function defaultObstacleCloseDraft(): ConfigDraftsState["alerts"]["obstacle_close"] {
  return {
    type: "OBSTACLE_CLOSE",
    enabled: true,
    minTimeMs: "10000",
    severity: "ALARM",
    defaultSilenceMs: "900000",
    minDistanceM: "10",
  };
}

function defaultWindAboveDraft(): ConfigDraftsState["alerts"]["wind_above"] {
  return {
    type: "WIND_ABOVE",
    enabled: true,
    minTimeMs: "20000",
    severity: "WARNING",
    defaultSilenceMs: "900000",
    maxWindKn: "30",
  };
}

function defaultDepthBelowDraft(): ConfigDraftsState["alerts"]["depth_below"] {
  return {
    type: "DEPTH_BELOW",
    enabled: false,
    minTimeMs: "10000",
    severity: "ALARM",
    defaultSilenceMs: "900000",
    minDepthM: "2",
  };
}

function defaultDataOutdatedDraft(): ConfigDraftsState["alerts"]["data_outdated"] {
  return {
    type: "DATA_OUTDATED",
    enabled: true,
    minTimeMs: "5000",
    severity: "WARNING",
    defaultSilenceMs: "900000",
    maxAgeMs: "5000",
  };
}

function defaultConfigDrafts(): ConfigDraftsState {
  return {
    anchor: {
      allowedRangeM: "35",
    },
    alerts: {
      anchor_distance: defaultAnchorDistanceDraft(),
      obstacle_close: defaultObstacleCloseDraft(),
      wind_above: defaultWindAboveDraft(),
      depth_below: defaultDepthBelowDraft(),
      data_outdated: defaultDataOutdatedDraft(),
    },
    obstacles: {
      items: [],
    },
    profiles: {
      version: null,
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
    system: {
      runtimeMode: "LIVE",
    },
  };
}

function defaultDeviceDataSlices(): DeviceDataSlices {
  return {
    position: null,
    depth: null,
    wind: null,
    wlanStatus: null,
    systemStatus: null,
    anchorPosition: null,
    alarmState: null,
    alarmConfig: null,
    obstaclesConfig: null,
    anchorSettingsConfig: null,
    profilesConfig: null,
    systemConfig: null,
    wlanConfig: null,
    cloudConfig: null,
    track: [],
  };
}

function defaultNetworkState(): NetworkState {
  return {
    relayBaseUrlInput: "",
    wifiSsid: "",
    wifiPass: "",
    cloudSecret: "",
    wifiSecurity: "wpa2",
    wifiCountry: "",
    wifiHidden: false,
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
  activeConnection: "bluetooth" | "cloud-relay";
  activeConnectionConnected: boolean;
}

function defaultConnectionState(): ExtendedConnectionState {
  return {
    runtimeMode: loadConnectionRuntimeMode(),
    appState: "UNCONFIGURED",
    bleSupported: false,
    bleStatusText: "disconnected",
    boatIdText: "--",
    secretStatusText: "not stored",
    relayResult: "No request yet.",
    connectedDeviceName: "",
    hasConfiguredDevice: false,
    activeConnection: "cloud-relay",
    activeConnectionConnected: false,
  };
}

export const appState = $state({
  runtime: {
    bootMs: performance.now(),
    lastBleMessageAtMs: 0,
  } as RuntimeState,
  deviceData: defaultDeviceDataSlices(),
  latestSource: "--" as InboundSource | "--",
  latestUpdatedAtMs: 0,
  ble: {
    connected: false,
    phase: "disconnected",
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
  toast: {
    opened: false,
    message: "",
    serial: 0,
  } as ToastUiState,
  configDrafts: defaultConfigDrafts(),
  debugMessageLimit: 1000 as DebugMessageLimit,
  logLines: [] as string[],
  debugMessages: [] as DebugMessageEntry[],
});

let debugMessageNextId = 1;

export function initAppStateEnvironment(hasBluetooth: boolean, hasMaptilerKey: boolean): void {
  appState.connection.bleSupported = hasBluetooth;
  appState.maptilerStatusText = hasMaptilerKey ? "Map ready state pending." : "MapTiler token missing.";
  refreshIdentityUi();
  appState.network.wifiSecurity = "wpa2";
  appState.network.cloudSecret = getCloudSecret();
  appState.network.relayBaseUrlInput = getRelayBaseUrl();
  setSummarySource("--");
}

function computeConfiguredDeviceState(): boolean {
  return hasConfiguredDevice(getBoatId(), getBleConnectionPin(), getCloudSecret(), hasConnectedViaBleOnce());
}

export function readCloudCredentialFields(): { base: string; boatId: string; cloudSecret: string } {
  return {
    base: getRelayBaseUrl(),
    boatId: getBoatId(),
    cloudSecret: getCloudSecret(),
  };
}

export function readCloudCredentials(): { base: string; boatId: string; cloudSecret: string } | null {
  const credentials = readCloudCredentialFields();
  if (!hasCloudCredentialsConfigured(credentials.base, credentials.boatId, credentials.cloudSecret)) {
    return null;
  }
  return credentials;
}

export function refreshIdentityUi(): void {
  const boatId = getBoatId();
  const cloudSecret = getCloudSecret();
  appState.connection.hasConfiguredDevice = computeConfiguredDeviceState();
  appState.connection.boatIdText = boatId || "--";
  appState.connection.secretStatusText = maskSecret(cloudSecret);
  appState.network.cloudSecret = cloudSecret;
  appState.network.relayBaseUrlInput = getRelayBaseUrl();
}

export function setBoatId(value: string): void {
  setBoatIdStored(value);
  refreshIdentityUi();
}

export function setBleConnectionPin(secret: string): void {
  setBleConnectionPinStored(secret);
  refreshIdentityUi();
}

export function setCloudSecret(secret: string): void {
  setCloudSecretStored(secret);
  refreshIdentityUi();
}

export function setActiveConnection(kind: "bluetooth" | "cloud-relay"): void {
  appState.connection.activeConnection = kind;
  appState.connection.activeConnectionConnected = false;
}

export function setConnectionRuntimeMode(mode: ConnectionRuntimeMode, persist = true): void {
  appState.connection.runtimeMode = mode;
  if (persist) {
    setConnectionRuntimeModeStored(mode);
  }
}

export function setActiveConnectionConnected(connected: boolean): void {
  appState.connection.activeConnectionConnected = connected;
}

export function setBleConnectionState(connected: boolean, deviceName = "", phase: DeviceConnectionPhase = connected ? "connected" : "disconnected"): void {
  appState.ble.connected = connected;
  appState.ble.phase = phase;
  appState.ble.deviceName = deviceName;
}

export function setBleAuthState(authState: JsonRecord | null): void {
  appState.ble.authState = authState;
}

export function markBleMessageSeen(nowTs = Date.now()): void {
  appState.runtime.lastBleMessageAtMs = nowTs;
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
  appState.summary.depthText = Number.isFinite(depthM) ? `${depthM.toFixed(1)} m` : "--";
  appState.summary.windText = Number.isFinite(windKn) ? `${windKn.toFixed(1)} kn` : "--";
}

export function setLatestInbound(source: InboundSource): void {
  appState.latestSource = source;
  appState.latestUpdatedAtMs = Date.now();
}

export function resetLiveDataState(): void {
  appState.deviceData = defaultDeviceDataSlices();
  appState.latestSource = "--";
  appState.latestUpdatedAtMs = 0;
  appState.versions.firmware = "--";
  appState.network.onboardingWifiSsid = "--";
  appState.network.onboardingWifiConnected = false;
  appState.network.onboardingWifiRssiText = "--";
  appState.network.onboardingWifiErrorText = "";
  appState.network.onboardingWifiStateText = "Waiting for Wi-Fi status...";
  appState.network.availableWifiNetworks = [];
  appState.network.selectedWifiNetwork = null;
  appState.network.selectedWifiSsid = "";
  appState.summary = defaultSummaryState();
  appState.track = defaultTrackState();
}

export function showErrorToast(message: string): void {
  const normalized = message.trim();
  appState.toast.message = normalized || "Something failed.";
  appState.toast.opened = true;
  appState.toast.serial += 1;
}

export function closeErrorToast(): void {
  appState.toast.opened = false;
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

function syncCurrentBoatDataFromPosition(): void {
  const position = appState.deviceData.position;
  if (!position || !position.valid) {
    appState.track.currentLatText = "--";
    appState.track.currentLonText = "--";
    appState.track.currentSogText = "--";
    appState.track.currentCogText = "--";
    appState.track.currentHeadingText = "--";
    return;
  }
  appState.track.currentLatText = position.lat.toFixed(5);
  appState.track.currentLonText = position.lon.toFixed(5);
  appState.track.currentSogText = `${position.sog_kn.toFixed(2)} kn`;
  appState.track.currentCogText = `${position.cog_deg.toFixed(0)} deg`;
  appState.track.currentHeadingText = `${position.heading_deg.toFixed(0)} deg`;
}

export function appendTrackPoint(point: TrackPoint): void {
  const previous = appState.deviceData.track[appState.deviceData.track.length - 1];
  if (
    previous
    && Math.abs(previous.lat - point.lat) < 0.000001
    && Math.abs(previous.lon - point.lon) < 0.000001
    && Math.abs(previous.ts - point.ts) < 1000
  ) {
    return;
  }

  appState.deviceData.track = [...appState.deviceData.track, point].slice(-TRACK_MAX_POINTS);
  appState.track.points = appState.deviceData.track;
  applyTrackDerived(appState.deviceData.track);
}

export function replaceTrackPoints(points: TrackPoint[]): void {
  appState.deviceData.track = points.slice(-TRACK_MAX_POINTS);
  appState.track.points = appState.deviceData.track;
  applyTrackDerived(appState.deviceData.track);
}

export function upsertWifiScanNetwork(network: WifiScanNetwork): void {
  const withoutCurrent = appState.network.availableWifiNetworks.filter((candidate) => candidate.ssid !== network.ssid);
  appState.network.availableWifiNetworks = [...withoutCurrent, network].sort((left, right) => {
    const leftRssi = left.rssi ?? -999;
    const rightRssi = right.rssi ?? -999;
    if (leftRssi !== rightRssi) {
      return rightRssi - leftRssi;
    }
    return left.ssid.localeCompare(right.ssid);
  });
  appState.network.selectedWifiNetwork =
    appState.network.availableWifiNetworks.find((candidate) => candidate.ssid === appState.network.selectedWifiSsid) ?? null;
}

function currentDataAgeSeconds(): number {
  const now = Date.now();
  const ages: number[] = [];

  if (appState.deviceData.position) {
    ages.push(Math.max(0, appState.deviceData.position.gps_age_ms / 1000));
  }
  if (appState.deviceData.depth) {
    ages.push(Math.max(0, (now - appState.deviceData.depth.ts) / 1000));
  }
  if (appState.deviceData.wind) {
    ages.push(Math.max(0, (now - appState.deviceData.wind.ts) / 1000));
  }
  if (!ages.length) {
    return Math.floor((performance.now() - appState.runtime.bootMs) / 1000);
  }
  return Math.max(...ages);
}

export function refreshDerivedDeviceState(): void {
  const position = appState.deviceData.position;
  const depth = appState.deviceData.depth;
  const wind = appState.deviceData.wind;
  const systemStatus = appState.deviceData.systemStatus;
  const wlanStatus = appState.deviceData.wlanStatus;

  if (position) {
    setTelemetry(
      Math.max(0, position.gps_age_ms / 1000),
      currentDataAgeSeconds(),
      depth?.depth_m ?? Number.NaN,
      wind?.wind_kn ?? Number.NaN,
    );
  } else {
    const ageS = Math.floor((performance.now() - appState.runtime.bootMs) / 1000);
    setTelemetry(ageS, ageS, Number.NaN, Number.NaN);
  }

  appState.network.onboardingWifiConnected = wlanStatus?.wifi_connected === true;
  appState.network.onboardingWifiSsid = wlanStatus?.wifi_ssid?.trim() || "--";
  appState.network.onboardingWifiRssiText = wlanStatus?.wifi_rssi === null || wlanStatus?.wifi_rssi === undefined
    ? "--"
    : `${wlanStatus.wifi_rssi} dBm`;
  appState.network.onboardingWifiErrorText = wlanStatus?.wifi_error ?? "";
  if (wlanStatus?.wifi_connected) {
    appState.network.onboardingWifiStateText = `Connected to ${appState.network.onboardingWifiSsid}`;
  } else if (wlanStatus?.wifi_error) {
    appState.network.onboardingWifiStateText = `Not connected (${wlanStatus.wifi_error})`;
  } else if (wlanStatus) {
    appState.network.onboardingWifiStateText = wlanStatus.wifi_state;
  }

  if (typeof systemStatus?.server_version === "string" && systemStatus.server_version.trim()) {
    appState.versions.firmware = systemStatus.server_version.trim();
  }

  if (position && appState.deviceData.anchorPosition?.state === "down" && position.valid) {
    appendTrackPoint({
      ts: Date.now(),
      lat: position.lat,
      lon: position.lon,
      sogKn: position.sog_kn,
      cogDeg: position.cog_deg,
      headingDeg: position.heading_deg,
      depthM: depth?.depth_m ?? null,
      windKn: wind?.wind_kn ?? null,
      windDirDeg: wind?.wind_dir_deg ?? null,
    });
    return;
  }

  if (appState.deviceData.track.length === 0) {
    applyTrackDerived([]);
  }

  syncCurrentBoatDataFromPosition();
}

function syncAlarmDrafts(entries: AlarmConfigEntry[]): void {
  const defaults = defaultConfigDrafts().alerts;
  appState.configDrafts.alerts.anchor_distance = defaults.anchor_distance;
  appState.configDrafts.alerts.obstacle_close = defaults.obstacle_close;
  appState.configDrafts.alerts.wind_above = defaults.wind_above;
  appState.configDrafts.alerts.depth_below = defaults.depth_below;
  appState.configDrafts.alerts.data_outdated = defaults.data_outdated;

  for (const entry of entries) {
    if (entry.type === "ANCHOR_DISTANCE") {
      appState.configDrafts.alerts.anchor_distance = {
        type: entry.type,
        enabled: entry.enabled,
        minTimeMs: String(entry.min_time_ms),
        severity: entry.severity,
        defaultSilenceMs: String(entry.default_silence_ms),
        maxDistanceM: String(entry.data.max_distance_m),
      };
      continue;
    }
    if (entry.type === "OBSTACLE_CLOSE") {
      appState.configDrafts.alerts.obstacle_close = {
        type: entry.type,
        enabled: entry.enabled,
        minTimeMs: String(entry.min_time_ms),
        severity: entry.severity,
        defaultSilenceMs: String(entry.default_silence_ms),
        minDistanceM: String(entry.data.min_distance_m),
      };
      continue;
    }
    if (entry.type === "WIND_ABOVE") {
      appState.configDrafts.alerts.wind_above = {
        type: entry.type,
        enabled: entry.enabled,
        minTimeMs: String(entry.min_time_ms),
        severity: entry.severity,
        defaultSilenceMs: String(entry.default_silence_ms),
        maxWindKn: String(entry.data.max_wind_kn),
      };
      continue;
    }
    if (entry.type === "DEPTH_BELOW") {
      appState.configDrafts.alerts.depth_below = {
        type: entry.type,
        enabled: entry.enabled,
        minTimeMs: String(entry.min_time_ms),
        severity: entry.severity,
        defaultSilenceMs: String(entry.default_silence_ms),
        minDepthM: String(entry.data.min_depth_m),
      };
      continue;
    }
    if (entry.type === "DATA_OUTDATED") {
      appState.configDrafts.alerts.data_outdated = {
        type: entry.type,
        enabled: entry.enabled,
        minTimeMs: String(entry.min_time_ms),
        severity: entry.severity,
        defaultSilenceMs: String(entry.default_silence_ms),
        maxAgeMs: String(entry.data.max_age_ms),
      };
    }
  }
}

function syncObstaclesDraft(config: ObstaclesConfigValue): void {
  appState.configDrafts.obstacles.items = config.obstacles.map((obstacle) => ({
    obstacle_id: obstacle.obstacle_id,
    type: obstacle.type,
    polygonInput: obstacle.polygon.map((point) => `${point.lat},${point.lon}`).join("\n"),
  }));
}

function syncProfilesDraft(config: ProfilesConfigValue): void {
  appState.configDrafts.profiles.version = config.version;
  appState.configDrafts.profiles.mode = config.mode === "manual" ? "manual" : "auto";
  appState.configDrafts.profiles.dayColorScheme = config.day.color_scheme === "red" || config.day.color_scheme === "blue" ? config.day.color_scheme : "full";
  appState.configDrafts.profiles.dayBrightnessPct = String(config.day.brightness_pct ?? "100");
  appState.configDrafts.profiles.dayOutputProfile = String(config.day.output_profile ?? "normal");
  appState.configDrafts.profiles.nightColorScheme = config.night.color_scheme === "full" || config.night.color_scheme === "blue" ? config.night.color_scheme : "red";
  appState.configDrafts.profiles.nightBrightnessPct = String(config.night.brightness_pct ?? "20");
  appState.configDrafts.profiles.nightOutputProfile = String(config.night.output_profile ?? "night");
  appState.configDrafts.profiles.autoSwitchSource = config.auto_switch.source === "sun" ? "sun" : "time";
  appState.configDrafts.profiles.dayStartLocal = String(config.auto_switch.day_start_local ?? "07:00");
  appState.configDrafts.profiles.nightStartLocal = String(config.auto_switch.night_start_local ?? "21:30");
}

function syncWlanConfig(config: WlanConfigValue): void {
  appState.network.wifiSsid = config.ssid;
  appState.network.wifiPass = config.passphrase;
  appState.network.wifiSecurity = config.security;
  appState.network.wifiCountry = config.country;
  appState.network.wifiHidden = config.hidden;
}

function syncSystemConfig(config: SystemConfigValue): void {
  appState.configDrafts.system.runtimeMode = config.runtime_mode;
}

function syncAnchorSettings(): void {
  appState.configDrafts.anchor.allowedRangeM = appState.deviceData.anchorSettingsConfig?.allowed_range_m === null
    ? ""
    : String(appState.deviceData.anchorSettingsConfig?.allowed_range_m ?? "");
}

export function setAlarmConfig(config: DeviceDataSlices["alarmConfig"]): void {
  appState.deviceData.alarmConfig = config;
  if (config) {
    syncAlarmDrafts(config.alerts);
  }
}

export function setObstaclesConfig(config: ObstaclesConfigValue | null): void {
  appState.deviceData.obstaclesConfig = config;
  if (config) {
    syncObstaclesDraft(config);
  }
}

export function setProfilesConfig(config: ProfilesConfigValue | null): void {
  appState.deviceData.profilesConfig = config;
  if (config) {
    syncProfilesDraft(config);
  }
}

export function setSystemConfig(config: SystemConfigValue | null): void {
  appState.deviceData.systemConfig = config;
  if (config) {
    syncSystemConfig(config);
  }
}

export function setWlanConfig(config: WlanConfigValue | null): void {
  appState.deviceData.wlanConfig = config;
  if (config) {
    syncWlanConfig(config);
  }
}

export function setCloudConfig(config: CloudConfigValue | null): void {
  appState.deviceData.cloudConfig = config;
}

export function setAnchorSettingsConfig(config: DeviceDataSlices["anchorSettingsConfig"]): void {
  appState.deviceData.anchorSettingsConfig = config;
  syncAnchorSettings();
}

export function logLine(message: string): void {
  const stamp = new Date().toISOString().slice(11, 19);
  const line = `${stamp} ${message}`;
  appState.logLines = [...appState.logLines, line].slice(-140);
}

function debugMessageBody(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function pruneDebugMessagesToLimit(limit: DebugMessageLimit): void {
  if (limit === "unlimited") {
    return;
  }
  appState.debugMessages = appState.debugMessages.slice(0, limit);
}

export function appendDebugMessage(input: {
  direction: DebugMessageDirection;
  route: DebugMessageRoute;
  msgType: string;
  body: unknown;
}): void {
  const entry: DebugMessageEntry = {
    id: debugMessageNextId++,
    ts: Date.now(),
    direction: input.direction,
    route: input.route,
    msgType: input.msgType.trim() || "unknown",
    body: debugMessageBody(input.body),
  };
  appState.debugMessages = [entry, ...appState.debugMessages];
  pruneDebugMessagesToLimit(appState.debugMessageLimit);
}

export function setDebugMessageLimit(limit: DebugMessageLimit): void {
  appState.debugMessageLimit = limit;
  pruneDebugMessagesToLimit(limit);
}

export function initAppStateEffects(): void {
  // Intentionally no-op. Derived/UI synchronization is registered from App.svelte.
}

refreshIdentityUi();
ensurePhoneId();
appState.connection.activeConnection = appState.connection.runtimeMode === CONNECTION_RUNTIME_MODE_REMOTE
  ? "cloud-relay"
  : "bluetooth";
