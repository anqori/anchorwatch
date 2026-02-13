import type { JsonRecord } from "../core/types";
import { buildConfigPatchPayload } from "./protocol-messages";

export interface CloudCredentials {
  base: string;
  boatId: string;
  boatSecret: string;
}

export interface CloudConfigPatchRequest {
  protocolVersion: string;
  deviceId: string;
  version: number;
  patch: JsonRecord;
  nowTs?: number;
}

export async function fetchCloudHealth(base: string): Promise<Response> {
  return fetch(`${base}/health`, { method: "GET" });
}

export async function fetchCloudState(credentials: CloudCredentials): Promise<Response> {
  const { base, boatId, boatSecret } = credentials;
  const url = `${base}/v1/state?boatId=${encodeURIComponent(boatId)}`;
  return fetch(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${boatSecret}`,
    },
  });
}

export async function fetchCloudTracks(credentials: CloudCredentials, limit: number): Promise<Response> {
  const { base, boatId, boatSecret } = credentials;
  const url = `${base}/v1/tracks?boatId=${encodeURIComponent(boatId)}&limit=${limit}`;
  return fetch(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${boatSecret}`,
    },
  });
}

export async function postCloudConfigPatch(credentials: CloudCredentials, request: CloudConfigPatchRequest): Promise<Response> {
  const { base, boatId, boatSecret } = credentials;
  const payload = buildConfigPatchPayload({
    version: request.version,
    patch: request.patch,
  });
  return fetch(`${base}/v1/config`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${boatSecret}`,
      "content-type": "application/json",
      "X-AnchorWatch-Client": "app",
    },
    body: JSON.stringify({
      ver: request.protocolVersion,
      msgType: "config.patch",
      boatId,
      deviceId: request.deviceId,
      ts: request.nowTs ?? Date.now(),
      ...payload,
    }),
  });
}
