import type { JsonRecord } from "../core/types";

export type ProtocolReplyState = "ONGOING" | "CLOSED_OK" | "CLOSED_FAILED";

export type ProtocolRequestType =
  | "AUTHORIZE_SETUP"
  | "AUTHORIZE_BLE_SESSION"
  | "SET_INITIAL_BLE_PIN"
  | "GET_DATA"
  | "SET_ANCHOR"
  | "MOVE_ANCHOR"
  | "RAISE_ANCHOR"
  | "SILENCE_ALARM"
  | "UNSILENCE_ALARM"
  | "UPDATE_CONFIG_ALARM"
  | "UPDATE_CONFIG_OBSTACLES"
  | "UPDATE_CONFIG_ANCHOR_SETTINGS"
  | "UPDATE_CONFIG_PROFILES"
  | "UPDATE_CONFIG_SYSTEM"
  | "UPDATE_CONFIG_WLAN"
  | "UPDATE_CLOUD_CREDENTIALS"
  | "UPDATE_BLE_PIN"
  | "SCAN_WLAN"
  | "CANCEL";

export type ProtocolReplyType =
  | "STATE_POSITION"
  | "STATE_ANCHOR_POSITION"
  | "STATE_DEPTH"
  | "STATE_WIND"
  | "STATE_WLAN_STATUS"
  | "STATE_SYSTEM_STATUS"
  | "STATE_ALARM_STATE"
  | "CONFIG_ALARM"
  | "CONFIG_OBSTACLES"
  | "CONFIG_ANCHOR_SETTINGS"
  | "CONFIG_PROFILES"
  | "CONFIG_SYSTEM"
  | "CONFIG_WLAN"
  | "CONFIG_CLOUD"
  | "TRACK_BACKFILL"
  | "WLAN_NETWORK"
  | "ACK"
  | "ERROR";

export interface ProtocolRequestEnvelope {
  req_id: string;
  type: ProtocolRequestType | string;
  data: unknown;
}

export interface ProtocolReplyEnvelope {
  req_id: string;
  state: ProtocolReplyState;
  type: ProtocolReplyType | string;
  data: unknown;
}

export interface ProtocolErrorValue {
  code: string;
  message: string;
}

export function makeRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 12)}`;
}

export function buildRequestEnvelope(
  reqId: string,
  type: ProtocolRequestType | string,
  data: unknown = {},
): ProtocolRequestEnvelope {
  return {
    req_id: reqId,
    type,
    data,
  };
}

export function normalizeReplyState(value: unknown): ProtocolReplyState | null {
  if (value === "ONGOING" || value === "CLOSED_OK" || value === "CLOSED_FAILED") {
    return value;
  }
  return null;
}

export function isProtocolReplyEnvelope(value: unknown): value is ProtocolReplyEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.req_id === "string"
    && typeof record.type === "string"
    && normalizeReplyState(record.state) !== null
    && "data" in record;
}

export function parseProtocolError(data: unknown): ProtocolErrorValue {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {
      code: "PROTOCOL_ERROR",
      message: "command failed",
    };
  }

  const record = data as JsonRecord;
  return {
    code: typeof record.code === "string" ? record.code : "PROTOCOL_ERROR",
    message: typeof record.message === "string" ? record.message : "command failed",
  };
}

export function isTerminalReplyState(state: ProtocolReplyState): boolean {
  return state === "CLOSED_OK" || state === "CLOSED_FAILED";
}
