import type { ConfigPartsCommand } from "../services/protocol-messages";
import type { AlertRuntimeEntry, InboundSource, JsonRecord, TrackPoint, WifiScanNetwork } from "../core/types";

export type DeviceConnectionKind = "bluetooth" | "cloud-relay" | "fake";

export interface DeviceConnectionStatus {
  connected: boolean;
  deviceName?: string;
  authState?: JsonRecord | null;
}

export interface DeviceConnectionProbeResult {
  ok: boolean;
  resultText: string;
  buildVersion: string | null;
}

export type DeviceCommandStatus = "ok" | "rejected" | "failed" | "accepted";

export interface DeviceCommandResult {
  accepted: boolean;
  status: DeviceCommandStatus;
  errorCode: string | null;
  errorDetail: string | null;
}

export interface DeviceWifiConnectInput {
  ssid: string;
  passphrase: string;
  security: string;
  country: string;
  hidden: boolean;
}

export interface DeviceEventBase {
  source: InboundSource;
  boatId?: string;
}

export interface DeviceStatePatchEvent extends DeviceEventBase {
  type: "state.patch";
  patch: unknown;
}

export interface DeviceStateSnapshotEvent extends DeviceEventBase {
  type: "state.snapshot";
  snapshot: unknown;
}

export interface DeviceTrackSnapshotEvent extends DeviceEventBase {
  type: "track.snapshot";
  points: TrackPoint[];
}

export interface DeviceAlertsStateEvent extends DeviceEventBase {
  type: "alerts.state";
  alerts: AlertRuntimeEntry[];
}

export interface DeviceUnknownEvent extends DeviceEventBase {
  type: "unknown";
  msgType: string;
  payload: JsonRecord;
}

export type DeviceEvent =
  | DeviceStatePatchEvent
  | DeviceStateSnapshotEvent
  | DeviceTrackSnapshotEvent
  | DeviceAlertsStateEvent
  | DeviceUnknownEvent;

export interface DeviceConnection {
  readonly kind: DeviceConnectionKind;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  subscribeEvents(callback: (event: DeviceEvent) => void): () => void;
  subscribeStatus(callback: (status: DeviceConnectionStatus) => void): () => void;
  sendConfigParts(command: ConfigPartsCommand): Promise<void>;
  commandWifiScan(maxResults: number, includeHidden: boolean): Promise<WifiScanNetwork[]>;
  commandWifiConnect(input: DeviceWifiConnectInput): Promise<DeviceCommandResult>;
  commandAnchorRise(): Promise<DeviceCommandResult>;
  commandAnchorDown(lat: number, lon: number): Promise<DeviceCommandResult>;
  commandAlarmSilence(seconds: number): Promise<DeviceCommandResult>;
  requestStateSnapshot(): Promise<JsonRecord | null>;
  requestTrackSnapshot(limit: number): Promise<TrackPoint[] | null>;
  probe(base?: string): Promise<DeviceConnectionProbeResult>;
}
