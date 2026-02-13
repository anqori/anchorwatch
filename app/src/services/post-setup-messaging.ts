import type { Envelope, JsonRecord, Mode, TrackPoint } from "../core/types";
import type { CloudCredentials } from "../connections/cloud/cloud-client";
import { postCloudConfigPatch } from "../connections/cloud/cloud-client";
import { fetchCloudSnapshot, fetchCloudTrackSnapshot } from "../connections/cloud/cloud-runtime";
import { isObject } from "./data-utils";
import { buildConfigPatchPayload, type ConfigPatchCommand } from "./protocol-messages";

export type PostSetupTransport = "bluetooth" | "cloud-relay" | "fake";

export interface PostSetupMessenger {
  readonly transport: PostSetupTransport;
  sendConfigPatch(command: ConfigPatchCommand): Promise<void>;
  requestStateSnapshot(): Promise<unknown | null>;
  requestTrackSnapshot(limit: number): Promise<TrackPoint[] | null>;
}

export interface ActivePostSetupMessengerContext {
  mode: Mode;
  bleConnected: boolean;
  sendControlMessage: (msgType: string, payload: JsonRecord, requiresAck?: boolean) => Promise<JsonRecord | null>;
  readBleSnapshotEnvelope: () => Promise<Envelope | null>;
  readCloudCredentials: () => CloudCredentials | null;
  protocolVersion: string;
  getDeviceId: () => string;
}

function buildBluetoothMessenger(context: ActivePostSetupMessengerContext): PostSetupMessenger {
  return {
    transport: "bluetooth",
    async sendConfigPatch(command: ConfigPatchCommand): Promise<void> {
      await context.sendControlMessage("config.patch", buildConfigPatchPayload(command), true);
    },
    async requestStateSnapshot(): Promise<unknown | null> {
      const envelope = await context.readBleSnapshotEnvelope();
      if (!envelope || envelope.msgType !== "status.snapshot") {
        return null;
      }
      const payload = isObject(envelope.payload) ? envelope.payload : {};
      return payload.snapshot ?? null;
    },
    async requestTrackSnapshot(): Promise<TrackPoint[] | null> {
      return null;
    },
  };
}

function readCloudCredentialsOrNull(context: ActivePostSetupMessengerContext): CloudCredentials | null {
  return context.readCloudCredentials();
}

function requireCloudCredentials(context: ActivePostSetupMessengerContext): CloudCredentials {
  const credentials = context.readCloudCredentials();
  if (!credentials) {
    throw new Error("Cloud relay credentials missing (relay URL + boatId + boatSecret)");
  }
  return credentials;
}

function buildCloudRelayMessenger(context: ActivePostSetupMessengerContext): PostSetupMessenger {
  return {
    transport: "cloud-relay",
    async sendConfigPatch(command: ConfigPatchCommand): Promise<void> {
      const credentials = requireCloudCredentials(context);
      const response = await postCloudConfigPatch(credentials, {
        protocolVersion: context.protocolVersion,
        deviceId: context.getDeviceId(),
        version: command.version,
        patch: command.patch,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`cloud config.patch failed ${response.status}: ${text}`);
      }
    },
    async requestStateSnapshot(): Promise<unknown | null> {
      const credentials = readCloudCredentialsOrNull(context);
      if (!credentials) {
        return null;
      }
      const result = await fetchCloudSnapshot(credentials);
      if (result.status === 404) {
        return null;
      }
      return result.snapshot ?? null;
    },
    async requestTrackSnapshot(limit: number): Promise<TrackPoint[] | null> {
      const credentials = requireCloudCredentials(context);
      const result = await fetchCloudTrackSnapshot(credentials, limit);
      if (result.status === 404) {
        return null;
      }
      return result.points;
    },
  };
}

function buildFakeMessenger(): PostSetupMessenger {
  return {
    transport: "fake",
    async sendConfigPatch(): Promise<void> {
      // In fake mode there is no remote peer; keep API no-op for consistent behavior.
    },
    async requestStateSnapshot(): Promise<unknown | null> {
      return null;
    },
    async requestTrackSnapshot(): Promise<TrackPoint[] | null> {
      return null;
    },
  };
}

export function resolveActivePostSetupMessenger(context: ActivePostSetupMessengerContext): PostSetupMessenger {
  if (context.mode === "fake") {
    return buildFakeMessenger();
  }
  if (context.bleConnected) {
    return buildBluetoothMessenger(context);
  }
  return buildCloudRelayMessenger(context);
}
