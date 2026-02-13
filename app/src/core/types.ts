export type Mode = "fake" | "device";
export type AppConnectivityState = "UNCONFIGURED" | "CONFIGURED_BUT_UNCONNECTED" | "CONNECTED";
export type InboundSource = "ble/eventRx" | "ble/snapshot" | "cloud/status.snapshot" | "fake/snapshot";
export type PillClass = "ok" | "warn" | "alarm";
export type ViewId = "summary" | "satellite" | "map" | "radar" | "config";
export type ConfigSectionId = "device" | "internet" | "connection" | "information" | "anchor" | "alerts" | "profiles";
export type ConfigViewId = "settings" | ConfigSectionId;
export type ProfileMode = "manual" | "auto";
export type ColorScheme = "full" | "red" | "blue";
export type AutoSwitchSource = "time" | "sun";
export type WifiSecurity = "open" | "wpa2" | "wpa3" | "unknown";
export type AnchorRuntimeState = "up" | "down" | "auto-pending";
export type AlertSeverity = "WARNING" | "ALARM";
export type AlertRuntimeState = "DISABLED" | "WATCHING" | "TRIGGERED" | "ALERT" | "ALERT_SILENCED";
export type AlertId = "anchor_distance" | "boating_area" | "wind_strength" | "depth" | "data_outdated";
export type AlertConfigDraft =
  | AnchorDistanceAlertConfigDraft
  | BoatingAreaAlertConfigDraft
  | WindStrengthAlertConfigDraft
  | DepthAlertConfigDraft
  | DataOutdatedAlertConfigDraft;

export interface ConfigSectionStatusItem {
  id: ConfigSectionId;
  label: string;
  icon: string;
  status?: string;
  disabled?: boolean;
}

export interface ConnectionState {
  mode: Mode;
  appState: AppConnectivityState;
  bleSupported: boolean;
  bleStatusText: string;
  boatIdText: string;
  secretStatusText: string;
  relayResult: string;
  connectedDeviceName: string;
  hasConfiguredDevice: boolean;
}

export interface VersionState {
  pwa: string;
  firmware: string;
  cloud: string;
}

export interface NetworkState {
  relayBaseUrlInput: string;
  wifiSsid: string;
  wifiPass: string;
  wifiSecurity: WifiSecurity;
  wifiCountry: string;
  wifiScanRequestId: string;
  wifiScanUpdatedAtMs: number;
  wifiScanInFlight: boolean;
  wifiScanStatusText: string;
  wifiScanErrorText: string;
  availableWifiNetworks: WifiScanNetwork[];
  selectedWifiSsid: string;
  selectedWifiNetwork: WifiScanNetwork | null;
  onboardingWifiSsid: string;
  onboardingWifiConnected: boolean;
  onboardingWifiRssiText: string;
  onboardingWifiErrorText: string;
  onboardingWifiStateText: string;
  settingsInternetStatusText: string;
}

export interface NavigationState {
  settingsDeviceStatusText: string;
  configSectionsWithStatus: ConfigSectionStatusItem[];
  activeView: ViewId;
  activeConfigView: ConfigViewId;
  depth: number;
  suppressedPopEvents: number;
  isFullScreenVizView: boolean;
  isConfigView: boolean;
}

export interface NotificationState {
  permissionText: string;
  statusText: string;
}

export interface AnchorConfigDraftState {
  autoModeMinForwardSogKn: string;
  autoModeStallMaxSogKn: string;
  autoModeReverseMinSogKn: string;
  autoModeConfirmSeconds: string;
}

export interface AlertConfigDraftCommon {
  isEnabled: boolean;
  minTimeMs: string;
  severity: AlertSeverity;
}

export interface AnchorDistanceAlertConfigDraft extends AlertConfigDraftCommon {
  id: "anchor_distance";
  maxDistanceM: string;
}

export interface BoatingAreaAlertConfigDraft extends AlertConfigDraftCommon {
  id: "boating_area";
  polygonPointsInput: string;
}

export interface WindStrengthAlertConfigDraft extends AlertConfigDraftCommon {
  id: "wind_strength";
  maxTwsKn: string;
}

export interface DepthAlertConfigDraft extends AlertConfigDraftCommon {
  id: "depth";
  minDepthM: string;
}

export interface DataOutdatedAlertConfigDraft extends AlertConfigDraftCommon {
  id: "data_outdated";
  minAgeMs: string;
}

export interface AlertsConfigDraftState {
  anchor_distance: AnchorDistanceAlertConfigDraft;
  boating_area: BoatingAreaAlertConfigDraft;
  wind_strength: WindStrengthAlertConfigDraft;
  depth: DepthAlertConfigDraft;
  data_outdated: DataOutdatedAlertConfigDraft;
}

export interface ProfilesConfigDraftState {
  mode: ProfileMode;
  dayColorScheme: ColorScheme;
  dayBrightnessPct: string;
  dayOutputProfile: string;
  nightColorScheme: ColorScheme;
  nightBrightnessPct: string;
  nightOutputProfile: string;
  autoSwitchSource: AutoSwitchSource;
  dayStartLocal: string;
  nightStartLocal: string;
}

export interface ConfigDraftsState {
  anchor: AnchorConfigDraftState;
  alerts: AlertsConfigDraftState;
  profiles: ProfilesConfigDraftState;
}

export interface AlertRuntimeEntry {
  id: AlertId;
  label: string;
  severity: AlertSeverity;
  state: AlertRuntimeState;
  aboveThresholdSinceTs: number | null;
  alertSinceTs: number | null;
  alertSilencedUntilTs: number | null;
}

export type JsonRecord = Record<string, unknown>;

export interface TrackPoint {
  ts: number;
  lat: number;
  lon: number;
  sogKn: number;
  cogDeg: number;
  headingDeg: number;
}

export interface WifiScanNetwork {
  ssid: string;
  security: WifiSecurity;
  rssi: number | null;
  channel: number | null;
  hidden: boolean;
}

export interface Envelope {
  ver?: string;
  msgType?: string;
  msgId?: string;
  boatId?: string;
  deviceId?: string;
  seq?: number;
  ts?: number;
  requiresAck?: boolean;
  payload?: JsonRecord;
}

export interface PendingAck {
  resolve: (payload: JsonRecord) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface ChunkAssembly {
  partCount: number;
  parts: Array<string | null>;
  updatedAt: number;
}
