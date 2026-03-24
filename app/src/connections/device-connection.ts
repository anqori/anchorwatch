import type { InboundSource, JsonRecord } from "../core/types";
import type {
  ProtocolReplyEnvelope,
  ProtocolRequestType,
} from "../services/protocol-messages";

export type DeviceConnectionKind = "bluetooth" | "cloud-relay";
export type DeviceConnectionPhase = "disconnected" | "connecting" | "connected";

export interface DeviceConnectionStatus {
  connected: boolean;
  phase?: DeviceConnectionPhase;
  deviceName?: string;
  authState?: JsonRecord | null;
}

export interface DeviceConnectionProbeResult {
  ok: boolean;
  resultText: string;
  buildVersion: string | null;
}

export interface DeviceStreamMessage {
  source: InboundSource;
  reply: ProtocolReplyEnvelope;
}

export interface DeviceStreamHandle {
  reqId: string;
  done: Promise<ProtocolReplyEnvelope>;
  cancel(): Promise<void>;
}

export interface DeviceConnection {
  readonly kind: DeviceConnectionKind;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  subscribeStatus(callback: (status: DeviceConnectionStatus) => void): () => void;
  request(type: ProtocolRequestType, data?: unknown): Promise<ProtocolReplyEnvelope>;
  openStream(
    type: ProtocolRequestType,
    data: unknown,
    onReply: (message: DeviceStreamMessage) => void,
  ): Promise<DeviceStreamHandle>;
  cancelRequest(reqId: string): Promise<ProtocolReplyEnvelope>;
  probe(base?: string): Promise<DeviceConnectionProbeResult>;
}
