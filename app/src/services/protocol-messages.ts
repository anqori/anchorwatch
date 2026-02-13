import type { Envelope, JsonRecord } from "../core/types";

export interface ConfigPatchCommand {
  version: number;
  patch: JsonRecord;
}

export interface EnvelopeBuildInput {
  protocolVersion: string;
  msgType: string;
  msgId: string;
  boatId: string;
  deviceId: string;
  seq: number;
  payload: JsonRecord;
  requiresAck?: boolean;
  ts?: number;
}

export function buildProtocolEnvelope(input: EnvelopeBuildInput): Envelope {
  return {
    ver: input.protocolVersion,
    msgType: input.msgType,
    msgId: input.msgId,
    boatId: input.boatId,
    deviceId: input.deviceId,
    seq: input.seq,
    ts: input.ts ?? Date.now(),
    requiresAck: input.requiresAck ?? true,
    payload: input.payload,
  };
}

export function buildConfigPatchPayload(command: ConfigPatchCommand): JsonRecord {
  return {
    version: command.version,
    patch: command.patch,
  };
}
