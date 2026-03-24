export type ConnectionRuntimeMode = "onboard" | "remote";
export type AppConnectivityState = "UNCONFIGURED" | "CONFIGURED_BUT_UNCONNECTED" | "CONNECTED";
export type InboundSource = "ble/eventRx" | "cloud/stream";
export type DebugMessageDirection = "incoming" | "outgoing";
export type DebugMessageRoute = "ble" | "relay";
export type PillClass = "ok" | "warn" | "alarm";
export type ViewId = "summary" | "satellite" | "map" | "radar" | "config";
export type ConfigSectionId =
  | "device"
  | "internet"
  | "connection"
  | "anchor"
  | "alerts"
  | "obstacles"
  | "profiles"
  | "debugging"
  | "information";
export type ConfigViewId = "settings" | ConfigSectionId | "device_manual" | "device_onboarding";
export type ProfileMode = "manual" | "auto";
export type ColorScheme = "full" | "red" | "blue";
export type AutoSwitchSource = "time" | "sun";
export type WifiSecurity = "open" | "wpa2" | "wpa3" | "unknown";
export type AnchorRuntimeState = "up" | "down" | "auto-pending";
export type AlertSeverity = "WARNING" | "ALARM";
export type AlertRuntimeState = "DISABLED" | "WATCHING" | "ALERT";
export type AlertType = "ANCHOR_DISTANCE" | "OBSTACLE_CLOSE" | "WIND_ABOVE" | "DEPTH_BELOW" | "DATA_OUTDATED";
export type ObstacleType = "PERMANENT" | "TEMPORARY";
export type RuntimeMode = "LIVE" | "SIMULATION";

export type JsonRecord = Record<string, unknown>;

export interface ConfigSectionStatusItem {
  id: ConfigSectionId;
  label: string;
  icon: string;
  status?: string;
  disabled?: boolean;
}

export interface ConnectionState {
  runtimeMode: ConnectionRuntimeMode;
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
  cloudSecret: string;
  wifiSecurity: WifiSecurity;
  wifiCountry: string;
  wifiHidden: boolean;
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
  allowedRangeM: string;
}

export interface AlertConfigDraftCommon {
  type: AlertType;
  enabled: boolean;
  minTimeMs: string;
  severity: AlertSeverity;
  defaultSilenceMs: string;
}

export interface AnchorDistanceAlertConfigDraft extends AlertConfigDraftCommon {
  type: "ANCHOR_DISTANCE";
  maxDistanceM: string;
}

export interface ObstacleCloseAlertConfigDraft extends AlertConfigDraftCommon {
  type: "OBSTACLE_CLOSE";
  minDistanceM: string;
}

export interface WindAboveAlertConfigDraft extends AlertConfigDraftCommon {
  type: "WIND_ABOVE";
  maxWindKn: string;
}

export interface DepthBelowAlertConfigDraft extends AlertConfigDraftCommon {
  type: "DEPTH_BELOW";
  minDepthM: string;
}

export interface DataOutdatedAlertConfigDraft extends AlertConfigDraftCommon {
  type: "DATA_OUTDATED";
  maxAgeMs: string;
}

export type AlertConfigDraft =
  | AnchorDistanceAlertConfigDraft
  | ObstacleCloseAlertConfigDraft
  | WindAboveAlertConfigDraft
  | DepthBelowAlertConfigDraft
  | DataOutdatedAlertConfigDraft;

export interface AlertsConfigDraftState {
  anchor_distance: AnchorDistanceAlertConfigDraft;
  obstacle_close: ObstacleCloseAlertConfigDraft;
  wind_above: WindAboveAlertConfigDraft;
  depth_below: DepthBelowAlertConfigDraft;
  data_outdated: DataOutdatedAlertConfigDraft;
}

export interface ObstacleDraftEntry {
  obstacle_id: string;
  type: ObstacleType;
  polygonInput: string;
}

export interface ObstaclesConfigDraftState {
  items: ObstacleDraftEntry[];
}

export interface ProfilesConfigDraftState {
  version: number | null;
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

export interface SystemConfigDraftState {
  runtimeMode: RuntimeMode;
}

export interface ConfigDraftsState {
  anchor: AnchorConfigDraftState;
  alerts: AlertsConfigDraftState;
  obstacles: ObstaclesConfigDraftState;
  profiles: ProfilesConfigDraftState;
  system: SystemConfigDraftState;
}

export interface AlertRuntimeEntry {
  alertType: AlertType;
  label: string;
  severity: AlertSeverity;
  state: AlertRuntimeState;
  aboveThresholdSinceTs: number | null;
  alertSinceTs: number | null;
  alertSilencedUntilTs: number | null;
}

export interface TrackPoint {
  ts: number;
  lat: number;
  lon: number;
  sogKn: number;
  cogDeg: number;
  headingDeg: number;
  depthM: number | null;
  windKn: number | null;
  windDirDeg: number | null;
}

export interface WifiScanNetwork {
  ssid: string;
  security: WifiSecurity;
  rssi: number | null;
  channel: number | null;
  hidden: boolean;
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

export interface DebugMessageEntry {
  id: number;
  ts: number;
  direction: DebugMessageDirection;
  route: DebugMessageRoute;
  msgType: string;
  body: string;
}

export type DebugMessageLimit = 1000 | 5000 | 10000 | "unlimited";

export interface PositionValue {
  lat: number;
  lon: number;
  gps_age_ms: number;
  valid: boolean;
  sog_kn: number;
  cog_deg: number;
  heading_deg: number;
}

export interface DepthValue {
  depth_m: number;
  ts: number;
}

export interface WindValue {
  wind_kn: number;
  wind_dir_deg: number;
  ts: number;
}

export interface SystemStatusValue {
  cloud_reachable: boolean;
  server_version: string;
}

export interface WlanStatusValue {
  wifi_state: "DISCONNECTED" | "CONNECTING" | "AUTHENTICATING" | "OBTAINING_IP" | "CONNECTED" | "FAILED";
  wifi_connected: boolean;
  wifi_ssid: string;
  wifi_rssi: number | null;
  wifi_error: string;
}

export interface AlertRuntime {
  alert_type: AlertType;
  state: AlertRuntimeState;
  severity: AlertSeverity;
  above_threshold_since_ts: number | null;
  alert_since_ts: number | null;
  alert_silenced_until_ts: number | null;
}

export interface AlarmStateValue {
  alerts: AlertRuntime[];
}

export interface AnchorPositionValue {
  state: AnchorRuntimeState;
  lat: number | null;
  lon: number | null;
}

export interface WlanConfigValue {
  version: number;
  ssid: string;
  passphrase: string;
  security: WifiSecurity;
  country: string;
  hidden: boolean;
}

export interface SystemConfigValue {
  version: number;
  runtime_mode: RuntimeMode;
}

export interface CloudConfigValue {
  version: number;
  boat_id: string;
  cloud_secret: string;
  secret_configured: boolean;
}

export interface ObstaclePoint {
  lat: number;
  lon: number;
}

export interface ObstaclePolygon {
  obstacle_id: string;
  type: ObstacleType;
  polygon: ObstaclePoint[];
}

export interface ObstaclesConfigValue {
  version: number;
  obstacles: ObstaclePolygon[];
}

export interface AlarmConfigEntryBase {
  type: AlertType;
  enabled: boolean;
  min_time_ms: number;
  severity: AlertSeverity;
  default_silence_ms: number;
}

export interface AnchorDistanceAlarmConfigEntry extends AlarmConfigEntryBase {
  type: "ANCHOR_DISTANCE";
  data: {
    max_distance_m: number;
  };
}

export interface ObstacleCloseAlarmConfigEntry extends AlarmConfigEntryBase {
  type: "OBSTACLE_CLOSE";
  data: {
    min_distance_m: number;
  };
}

export interface WindAboveAlarmConfigEntry extends AlarmConfigEntryBase {
  type: "WIND_ABOVE";
  data: {
    max_wind_kn: number;
  };
}

export interface DepthBelowAlarmConfigEntry extends AlarmConfigEntryBase {
  type: "DEPTH_BELOW";
  data: {
    min_depth_m: number;
  };
}

export interface DataOutdatedAlarmConfigEntry extends AlarmConfigEntryBase {
  type: "DATA_OUTDATED";
  data: {
    max_age_ms: number;
  };
}

export type AlarmConfigEntry =
  | AnchorDistanceAlarmConfigEntry
  | ObstacleCloseAlarmConfigEntry
  | WindAboveAlarmConfigEntry
  | DepthBelowAlarmConfigEntry
  | DataOutdatedAlarmConfigEntry;

export interface AlarmConfigValue {
  version: number;
  alerts: AlarmConfigEntry[];
}

export interface AnchorSettingsValue extends JsonRecord {
  version: number;
  allowed_range_m: number | null;
  allowed_region: JsonRecord | null;
}

export interface ProfilesConfigValue extends JsonRecord {
  version: number;
  mode: ProfileMode;
  day: JsonRecord;
  night: JsonRecord;
  auto_switch: JsonRecord;
}

export interface DeviceDataSlices {
  position: PositionValue | null;
  depth: DepthValue | null;
  wind: WindValue | null;
  wlanStatus: WlanStatusValue | null;
  systemStatus: SystemStatusValue | null;
  anchorPosition: AnchorPositionValue | null;
  alarmState: AlarmStateValue | null;
  alarmConfig: AlarmConfigValue | null;
  obstaclesConfig: ObstaclesConfigValue | null;
  anchorSettingsConfig: AnchorSettingsValue | null;
  profilesConfig: ProfilesConfigValue | null;
  systemConfig: SystemConfigValue | null;
  wlanConfig: WlanConfigValue | null;
  cloudConfig: CloudConfigValue | null;
  track: TrackPoint[];
}
