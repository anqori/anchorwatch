import type { ConfigPatchCommand } from "../services/protocol-messages";
import type { Envelope, InboundSource, JsonRecord, TrackPoint } from "../core/types";

export type DeviceConnectionKind = "bluetooth" | "cloud-relay" | "fake";

export interface DeviceConnectionStatus {
  connected: boolean;
  deviceName?: string;
  authState?: JsonRecord | null;
}

export interface DeviceConnection {
  readonly kind: DeviceConnectionKind;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  subscribeEnvelope(callback: (envelope: Envelope, source: InboundSource) => void): () => void;
  subscribeStatus(callback: (status: DeviceConnectionStatus) => void): () => void;
  sendCommand(msgType: string, payload: JsonRecord, requiresAck?: boolean): Promise<JsonRecord | null>;
  sendConfigPatch(command: ConfigPatchCommand): Promise<void>;
  requestStateSnapshot(): Promise<JsonRecord | null>;
  requestTrackSnapshot(limit: number): Promise<TrackPoint[] | null>;
}
