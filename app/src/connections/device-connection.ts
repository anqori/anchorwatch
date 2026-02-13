import type { ConfigPatchCommand } from "../services/protocol-messages";
import type { InboundSource, JsonRecord, TrackPoint, WifiScanNetwork } from "../core/types";

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

export interface DeviceOnboardingBoatSecretEvent extends DeviceEventBase {
  type: "onboarding.boatSecret";
  onboardingBoatId?: string;
  boatSecret?: string;
}

export interface DeviceTrackSnapshotEvent extends DeviceEventBase {
  type: "track.snapshot";
  points: TrackPoint[];
}

export interface DeviceUnknownEvent extends DeviceEventBase {
  type: "unknown";
  msgType: string;
  payload: JsonRecord;
}

export type DeviceEvent =
  | DeviceStatePatchEvent
  | DeviceStateSnapshotEvent
  | DeviceOnboardingBoatSecretEvent
  | DeviceTrackSnapshotEvent
  | DeviceUnknownEvent;

export interface DeviceConnection {
  readonly kind: DeviceConnectionKind;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  subscribeEvents(callback: (event: DeviceEvent) => void): () => void;
  subscribeStatus(callback: (status: DeviceConnectionStatus) => void): () => void;
  sendConfigPatch(command: ConfigPatchCommand): Promise<void>;
  commandWifiScan(maxResults: number, includeHidden: boolean): Promise<WifiScanNetwork[]>;
  commandAnchorRise(): Promise<DeviceCommandResult>;
  commandAnchorDown(lat: number, lon: number): Promise<DeviceCommandResult>;
  requestStateSnapshot(): Promise<JsonRecord | null>;
  requestTrackSnapshot(limit: number): Promise<TrackPoint[] | null>;
  probe(base?: string): Promise<DeviceConnectionProbeResult>;
}
