import type { JsonRecord } from "../core/types";
import type { CloudCredentials } from "./cloud-client";
import { postCloudConfigPatch } from "./cloud-client";

export type ConfigPatchTransport = "ble" | "cloud";

export interface DispatchConfigPatchInput {
  patch: JsonRecord;
  version: number;
  bleConnected: boolean;
  sendViaBle: (version: number, patch: JsonRecord) => Promise<void>;
  cloudCredentials: CloudCredentials | null;
  protocolVersion: string;
  deviceId: string;
}

export async function dispatchConfigPatch(input: DispatchConfigPatchInput): Promise<ConfigPatchTransport> {
  if (input.bleConnected) {
    await input.sendViaBle(input.version, input.patch);
    return "ble";
  }

  if (!input.cloudCredentials) {
    throw new Error("Need BLE connection or cloud credentials (relay URL + boatId + boatSecret)");
  }

  const res = await postCloudConfigPatch(input.cloudCredentials, {
    protocolVersion: input.protocolVersion,
    deviceId: input.deviceId,
    version: input.version,
    patch: input.patch,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`cloud config.patch failed ${res.status}: ${text}`);
  }

  return "cloud";
}
