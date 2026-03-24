import type { InboundSource, JsonRecord } from "../core/types";
import {
  appendDebugMessage,
} from "../state/app-state.svelte";
import {
  buildRequestEnvelope,
  isProtocolReplyEnvelope,
  isTerminalReplyState,
  makeRequestId,
  parseProtocolError,
  type ProtocolReplyEnvelope,
  type ProtocolRequestType,
} from "../services/protocol-messages";
import type {
  DeviceConnection,
  DeviceConnectionPhase,
  DeviceConnectionStatus,
  DeviceStreamHandle,
  DeviceStreamMessage,
} from "./device-connection";

interface PendingRequest {
  resolve: (reply: ProtocolReplyEnvelope) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingStream {
  onReply: (message: DeviceStreamMessage) => void;
  resolve: (reply: ProtocolReplyEnvelope) => void;
  reject: (error: Error) => void;
}

export abstract class DeviceConnectionBase implements DeviceConnection {
  abstract readonly kind: "bluetooth" | "cloud-relay";

  abstract connect(): Promise<void>;

  abstract disconnect(): Promise<void>;

  abstract probe(base?: string): Promise<{ ok: boolean; resultText: string; buildVersion: string | null }>;

  private readonly statusSubscribers = new Set<(status: DeviceConnectionStatus) => void>();

  private readonly pendingRequests = new Map<string, PendingRequest>();

  private readonly pendingStreams = new Map<string, PendingStream>();

  private connected = false;

  private phase: DeviceConnectionPhase = "disconnected";

  private authState: JsonRecord | null = null;

  private deviceName = "";

  async request(type: ProtocolRequestType, data: unknown = {}): Promise<ProtocolReplyEnvelope> {
    await this.connect();

    const reqId = makeRequestId();
    const reply = new Promise<ProtocolReplyEnvelope>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(new Error(`${type} timeout`));
      }, 8000);
      this.pendingRequests.set(reqId, { resolve, reject, timeout });
    });

    try {
      await this.sendEnvelope(buildRequestEnvelope(reqId, type, data));
      return await reply;
    } catch (error) {
      const pending = this.pendingRequests.get(reqId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(reqId);
      }
      throw error;
    }
  }

  async openStream(
    type: ProtocolRequestType,
    data: unknown,
    onReply: (message: DeviceStreamMessage) => void,
  ): Promise<DeviceStreamHandle> {
    await this.connect();

    const reqId = makeRequestId();
    let resolveDone!: (reply: ProtocolReplyEnvelope) => void;
    let rejectDone!: (error: Error) => void;
    const done = new Promise<ProtocolReplyEnvelope>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });

    this.pendingStreams.set(reqId, {
      onReply,
      resolve: resolveDone,
      reject: rejectDone,
    });

    try {
      await this.sendEnvelope(buildRequestEnvelope(reqId, type, data));
    } catch (error) {
      this.pendingStreams.delete(reqId);
      throw error;
    }

    return {
      reqId,
      done,
      cancel: async () => {
        await this.cancelRequest(reqId);
      },
    };
  }

  async cancelRequest(reqId: string): Promise<ProtocolReplyEnvelope> {
    return await this.request("CANCEL", {
      original_req_id: reqId,
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  subscribeStatus(callback: (status: DeviceConnectionStatus) => void): () => void {
    this.statusSubscribers.add(callback);
    callback(this.currentStatus());
    return () => {
      this.statusSubscribers.delete(callback);
    };
  }

  protected currentStatus(): DeviceConnectionStatus {
    return {
      connected: this.connected,
      phase: this.phase,
      deviceName: this.deviceName,
      authState: this.authState,
    };
  }

  protected setTransportStatus(status: {
    connected: boolean;
    phase?: DeviceConnectionPhase;
    deviceName?: string;
    authState?: JsonRecord | null;
  }): void {
    this.connected = status.connected;
    this.phase = status.phase ?? (status.connected ? "connected" : "disconnected");
    this.deviceName = status.deviceName ?? "";
    this.authState = status.authState ?? null;
    this.emitStatus();
  }

  protected handleIncomingRaw(raw: string, source: InboundSource): void {
    this.debugTraffic("incoming", raw);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    if (!isProtocolReplyEnvelope(parsed)) {
      return;
    }
    this.handleIncomingReply(parsed, source);
  }

  protected handleTransportDisconnected(reason: string): void {
    this.connected = false;
    this.phase = "disconnected";
    this.deviceName = "";
    this.authState = null;
    this.emitStatus();
    this.failPending(new Error(reason));
  }

  protected abstract sendRaw(raw: string): Promise<void>;

  private emitStatus(): void {
    const status = this.currentStatus();
    for (const subscriber of this.statusSubscribers) {
      subscriber(status);
    }
  }

  private async sendEnvelope(envelope: { req_id: string; type: string; data: unknown }): Promise<void> {
    this.debugTraffic("outgoing", JSON.stringify(envelope));
    await this.sendRaw(JSON.stringify(envelope));
  }

  private handleIncomingReply(reply: ProtocolReplyEnvelope, source: InboundSource): void {
    const stream = this.pendingStreams.get(reply.req_id);
    if (stream) {
      stream.onReply({ source, reply });
      if (isTerminalReplyState(reply.state)) {
        this.pendingStreams.delete(reply.req_id);
        if (reply.state === "CLOSED_OK") {
          stream.resolve(reply);
        } else {
          const error = parseProtocolError(reply.data);
          stream.reject(new Error(`${error.code}: ${error.message}`));
        }
      }
      return;
    }

    if (!isTerminalReplyState(reply.state)) {
      return;
    }

    const pending = this.pendingRequests.get(reply.req_id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(reply.req_id);
    if (reply.state === "CLOSED_OK") {
      pending.resolve(reply);
      return;
    }

    const error = parseProtocolError(reply.data);
    pending.reject(new Error(`${error.code}: ${error.message}`));
  }

  private failPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();

    for (const stream of this.pendingStreams.values()) {
      stream.reject(error);
    }
    this.pendingStreams.clear();
  }

  private debugTraffic(direction: "incoming" | "outgoing", body: string): void {
    appendDebugMessage({
      direction,
      route: this.kind === "bluetooth" ? "ble" : "relay",
      msgType: this.extractDebugType(body),
      body,
    });
  }

  private extractDebugType(body: string): string {
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const record = parsed as JsonRecord;
        if (typeof record.type === "string" && record.type.trim()) {
          return record.type;
        }
      }
    } catch {
      // ignore
    }
    return "unknown";
  }
}
