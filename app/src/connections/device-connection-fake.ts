import type { ConfigPatchCommand } from "../services/protocol-messages";
import type { Envelope, InboundSource, JsonRecord } from "../core/types";
import type { DeviceConnection, DeviceConnectionStatus } from "./device-connection";

export class DeviceConnectionFake implements DeviceConnection {
  readonly kind = "fake" as const;

  private statusSubscribers = new Set<(status: DeviceConnectionStatus) => void>();

  async connect(): Promise<void> {
    this.emitStatus();
  }

  async disconnect(): Promise<void> {
    this.emitStatus();
  }

  isConnected(): boolean {
    return true;
  }

  subscribeEnvelope(_callback: (envelope: Envelope, source: InboundSource) => void): () => void {
    return () => {
      // Fake mode has no remote envelope stream.
    };
  }

  subscribeStatus(callback: (status: DeviceConnectionStatus) => void): () => void {
    this.statusSubscribers.add(callback);
    callback(this.currentStatus());
    return () => {
      this.statusSubscribers.delete(callback);
    };
  }

  async sendCommand(_msgType: string, _payload: JsonRecord, _requiresAck?: boolean): Promise<null> {
    return null;
  }

  async sendConfigPatch(_command: ConfigPatchCommand): Promise<void> {
    // Intentionally no-op to keep fake mode behavior consistent.
  }

  async requestStateSnapshot(): Promise<null> {
    return null;
  }

  async requestTrackSnapshot(): Promise<null> {
    return null;
  }

  private currentStatus(): DeviceConnectionStatus {
    return {
      connected: true,
      deviceName: "",
      authState: null,
    };
  }

  private emitStatus(): void {
    const status = this.currentStatus();
    for (const subscriber of this.statusSubscribers) {
      subscriber(status);
    }
  }
}
