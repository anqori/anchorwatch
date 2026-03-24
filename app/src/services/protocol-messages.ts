import type { JsonRecord } from "../core/types";

export type ProtocolReplyState = "ONGOING" | "CLOSED_OK" | "CLOSED_FAILED";

export type ProtocolCommand =
  | "get-data"
  | "set-anchor"
  | "move-anchor"
  | "raise-anchor"
  | "silence-alarm"
  | "update-config"
  | "scan-wlan"
  | "connect-wlan"
  | "cancel";

export interface ConfigPartsCommand {
  parts: JsonRecord;
  ifVersions?: Record<string, number>;
}

export type ConfigPatchCommand = ConfigPartsCommand;

export interface ProtocolCommandEnvelope {
  req_id: string;
  command: string;
  data: JsonRecord;
}

export interface ProtocolReplyEnvelope {
  req_id?: string;
  state?: ProtocolReplyState;
  command?: string;
  data?: JsonRecord;
}

export interface ProtocolCommandBuildInput {
  reqId: string;
  command: ProtocolCommand | string;
  data?: JsonRecord;
}

export function makeRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 12)}`;
}

export function buildCommandEnvelope(input: ProtocolCommandBuildInput): ProtocolCommandEnvelope {
  return {
    req_id: input.reqId,
    command: input.command,
    data: input.data ?? {},
  };
}

export function buildConfigUpdatePayload(command: ConfigPartsCommand): JsonRecord {
  return {
    parts: command.parts,
    if_versions: command.ifVersions ?? {},
  };
}

export function buildCancelPayload(originalReqId: string): JsonRecord {
  return {
    original_req_id: originalReqId,
  };
}

export function normalizeReplyState(value: unknown): ProtocolReplyState | null {
  if (value === "ONGOING" || value === "CLOSED_OK" || value === "CLOSED_FAILED") {
    return value;
  }
  return null;
}

export function extractProtocolError(data: JsonRecord): { code: string; message: string } {
  const rawError = data.error;
  if (rawError && typeof rawError === "object" && !Array.isArray(rawError)) {
    const errorObject = rawError as Record<string, unknown>;
    const code = typeof errorObject.code === "string" ? errorObject.code : "COMMAND_FAILED";
    const message = typeof errorObject.message === "string" ? errorObject.message : "command failed";
    return { code, message };
  }
  return {
    code: "COMMAND_FAILED",
    message: "command failed",
  };
}
