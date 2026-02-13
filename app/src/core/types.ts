export type Mode = "fake" | "device";
export type AppConnectivityState = "UNCONFIGURED" | "CONFIGURED_BUT_UNCONNECTED" | "CONNECTED";
export type LinkLedState = "bt" | "relay" | "unconnected" | "unconfigured";
export type InboundSource = "ble/eventRx" | "ble/snapshot" | "cloud/status.snapshot";
export type PillClass = "ok" | "warn" | "alarm";
export type ViewId = "summary" | "satellite" | "map" | "radar" | "config";
export type ConfigSectionId = "device" | "internet" | "information" | "anchor" | "triggers" | "profiles";
export type ConfigViewId = "settings" | ConfigSectionId;
export type AnchorMode = "current" | "offset" | "auto" | "manual";
export type ZoneType = "circle" | "polygon";
export type Severity = "warning" | "alarm";
export type ProfileMode = "manual" | "auto";
export type ColorScheme = "full" | "red" | "blue";
export type AutoSwitchSource = "time" | "sun";
export type WifiSecurity = "open" | "wpa2" | "wpa3" | "unknown";

export interface ConfigSectionStatusItem {
  id: ConfigSectionId;
  label: string;
  icon: string;
  status?: string;
}

export interface ConnectionState {
  mode: Mode;
  appState: AppConnectivityState;
  linkLedState: LinkLedState;
  linkLedTitle: string;
  bleSupported: boolean;
  bleStatusText: string;
  boatIdText: string;
  secretStatusText: string;
  cloudStatusText: string;
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
  mode: AnchorMode;
  offsetDistanceM: string;
  offsetAngleDeg: string;
  autoModeEnabled: boolean;
  autoModeMinForwardSogKn: string;
  autoModeStallMaxSogKn: string;
  autoModeReverseMinSogKn: string;
  autoModeConfirmSeconds: string;
  zoneType: ZoneType;
  zoneRadiusM: string;
  polygonPointsInput: string;
  manualAnchorLat: string;
  manualAnchorLon: string;
}

export interface TriggersConfigDraftState {
  windAboveEnabled: boolean;
  windAboveThresholdKn: string;
  windAboveHoldMs: string;
  windAboveSeverity: Severity;
  outsideAreaEnabled: boolean;
  outsideAreaHoldMs: string;
  outsideAreaSeverity: Severity;
  gpsAgeEnabled: boolean;
  gpsAgeMaxMs: string;
  gpsAgeHoldMs: string;
  gpsAgeSeverity: Severity;
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
  triggers: TriggersConfigDraftState;
  profiles: ProfilesConfigDraftState;
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

export interface BleState {
  device: BluetoothDevice | null;
  server: BluetoothRemoteGATTServer | null;
  service: BluetoothRemoteGATTService | null;
  controlTx: BluetoothRemoteGATTCharacteristic | null;
  eventRx: BluetoothRemoteGATTCharacteristic | null;
  snapshot: BluetoothRemoteGATTCharacteristic | null;
  auth: BluetoothRemoteGATTCharacteristic | null;
  connected: boolean;
  seq: number;
  pendingAcks: Map<string, PendingAck>;
  chunkAssemblies: Map<string, ChunkAssembly>;
  authState: JsonRecord | null;
}
