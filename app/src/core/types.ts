export type Mode = "fake" | "device";
export type InboundSource = "ble/eventRx" | "ble/snapshot" | "cloud/status.snapshot";
export type PillClass = "ok" | "warn" | "alarm";
export type ViewId = "summary" | "satellite" | "map" | "radar" | "config";
export type ConfigSectionId = "onboarding" | "anchor" | "triggers" | "profiles";
export type ConfigViewId = "settings" | ConfigSectionId;
export type OnboardingStep = 1 | 2 | 3;
export type AnchorMode = "current" | "offset" | "auto" | "manual";
export type ZoneType = "circle" | "polygon";
export type Severity = "warning" | "alarm";
export type ProfileMode = "manual" | "auto";
export type ColorScheme = "full" | "red" | "blue";
export type AutoSwitchSource = "time" | "sun";
export type WifiSecurity = "open" | "wpa2" | "wpa3" | "unknown";

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
