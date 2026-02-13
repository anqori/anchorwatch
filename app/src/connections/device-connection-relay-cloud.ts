import type { Envelope, InboundSource, JsonRecord, TrackPoint } from "../core/types";
import type { ConfigPatchCommand } from "../services/protocol-messages";
import { postCloudConfigPatch } from "../services/cloud-client";
import {
  fetchCloudBuildVersion,
  fetchCloudSnapshot,
  fetchCloudTrackSnapshot,
  probeCloudRelay,
  type CloudAuthVerifyResult,
  type ProbeCloudRelayResult,
  verifyCloudStateAuth,
} from "../services/cloud-runtime";
import type { DeviceConnection, DeviceConnectionStatus } from "./device-connection";

export interface RelayCloudCredentials {
  base: string;
  boatId: string;
  boatSecret: string;
}

export class DeviceConnectionRelayCloud implements DeviceConnection {
  readonly kind = "cloud-relay" as const;

  private connected = false;

  private statusSubscribers = new Set<(status: DeviceConnectionStatus) => void>();

  constructor(
    private readonly readCredentials: () => RelayCloudCredentials | null,
    private readonly getDeviceId: () => string,
    private readonly protocolVersion: string,
  ) {}

  async connect(): Promise<void> {
    this.connected = this.readCredentials() !== null;
    this.emitStatus();
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emitStatus();
  }

  isConnected(): boolean {
    return this.connected;
  }

  subscribeEnvelope(_callback: (envelope: Envelope, source: InboundSource) => void): () => void {
    return () => {
      // Relay path is pull-based in v1; no live subscription channel.
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
    throw new Error("Cloud relay command channel is not available for generic sendCommand");
  }

  async sendConfigPatch(command: ConfigPatchCommand): Promise<void> {
    const credentials = this.requireCredentials();
    const response = await postCloudConfigPatch(credentials, {
      protocolVersion: this.protocolVersion,
      deviceId: this.getDeviceId(),
      version: command.version,
      patch: command.patch,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`cloud config.patch failed ${response.status}: ${text}`);
    }
  }

  async requestStateSnapshot(): Promise<Record<string, unknown> | null> {
    const credentials = this.readCredentials();
    if (!credentials) {
      this.connected = false;
      this.emitStatus();
      return null;
    }

    const result = await fetchCloudSnapshot(credentials);
    this.connected = true;
    this.emitStatus();
    if (result.status === 404) {
      return null;
    }
    return (result.snapshot ?? null) as Record<string, unknown> | null;
  }

  async requestTrackSnapshot(limit: number): Promise<TrackPoint[] | null> {
    const credentials = this.readCredentials();
    if (!credentials) {
      this.connected = false;
      this.emitStatus();
      return null;
    }

    const result = await fetchCloudTrackSnapshot(credentials, limit);
    this.connected = true;
    this.emitStatus();
    if (result.status === 404) {
      return null;
    }
    return result.points;
  }

  async probeRelay(base: string): Promise<ProbeCloudRelayResult> {
    return probeCloudRelay(base);
  }

  async verifyStateAuth(): Promise<CloudAuthVerifyResult> {
    const credentials = this.requireCredentials();
    return verifyCloudStateAuth(credentials);
  }

  async fetchBuildVersion(base: string): Promise<string | null> {
    return fetchCloudBuildVersion(base);
  }

  private currentStatus(): DeviceConnectionStatus {
    return {
      connected: this.connected,
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

  private requireCredentials(): RelayCloudCredentials {
    const credentials = this.readCredentials();
    if (!credentials) {
      throw new Error("Cloud relay credentials missing (relay URL + boatId + boatSecret)");
    }
    return credentials;
  }
}
