import type { TrackPoint, WifiScanNetwork } from "../../core/types";
import type { ConfigPatchCommand } from "../../services/protocol-messages";
import { postCloudConfigPatch } from "./cloud-client";
import {
  fetchCloudSnapshot,
  fetchCloudTrackSnapshot,
  probeCloudRelay,
} from "./cloud-runtime";
import type {
  DeviceConnection,
  DeviceEvent,
  DeviceConnectionProbeResult,
  DeviceConnectionStatus,
} from "../device-connection";

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
    const credentials = this.readCredentials();
    if (!credentials) {
      this.setConnected(false);
      return;
    }
    try {
      const probeResult = await probeCloudRelay(credentials.base);
      this.setConnected(probeResult.ok);
    } catch {
      this.setConnected(false);
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emitStatus();
  }

  isConnected(): boolean {
    return this.connected;
  }

  subscribeEvents(_callback: (_event: DeviceEvent) => void): () => void {
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

  async sendConfigPatch(command: ConfigPatchCommand): Promise<void> {
    const credentials = this.requireCredentials();
    try {
      const response = await postCloudConfigPatch(credentials, {
        protocolVersion: this.protocolVersion,
        deviceId: this.getDeviceId(),
        version: command.version,
        patch: command.patch,
      });

      if (!response.ok) {
        const text = await response.text();
        this.setConnected(false);
        throw new Error(`cloud config.patch failed ${response.status}: ${text}`);
      }
      this.setConnected(true);
    } catch (error) {
      this.setConnected(false);
      throw error;
    }
  }

  async commandWifiScan(_maxResults: number, _includeHidden: boolean): Promise<WifiScanNetwork[]> {
    throw new Error("Wi-Fi scan requires an active Bluetooth or fake connection");
  }

  async requestStateSnapshot(): Promise<Record<string, unknown> | null> {
    const credentials = this.readCredentials();
    if (!credentials) {
      this.connected = false;
      this.emitStatus();
      return null;
    }

    try {
      const result = await fetchCloudSnapshot(credentials);
      this.setConnected(true);
      if (result.status === 404) {
        return null;
      }
      return (result.snapshot ?? null) as Record<string, unknown> | null;
    } catch (error) {
      this.setConnected(false);
      throw error;
    }
  }

  async requestTrackSnapshot(limit: number): Promise<TrackPoint[] | null> {
    const credentials = this.readCredentials();
    if (!credentials) {
      this.connected = false;
      this.emitStatus();
      return null;
    }

    try {
      const result = await fetchCloudTrackSnapshot(credentials, limit);
      this.setConnected(true);
      if (result.status === 404) {
        return null;
      }
      return result.points;
    } catch (error) {
      this.setConnected(false);
      throw error;
    }
  }

  async probe(base?: string): Promise<DeviceConnectionProbeResult> {
    const resolvedBase = (base ?? this.readCredentials()?.base ?? "").trim();
    if (!resolvedBase) {
      this.setConnected(false);
      return {
        ok: false,
        resultText: "Set relay base URL first.",
        buildVersion: null,
      };
    }
    try {
      const result = await probeCloudRelay(resolvedBase);
      this.setConnected(result.ok);
      return result;
    } catch (error) {
      this.setConnected(false);
      throw error;
    }
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

  private setConnected(connected: boolean): void {
    this.connected = connected;
    this.emitStatus();
  }

  private requireCredentials(): RelayCloudCredentials {
    const credentials = this.readCredentials();
    if (!credentials) {
      throw new Error("Cloud relay credentials missing (relay URL + boatId + boatSecret)");
    }
    return credentials;
  }
}
