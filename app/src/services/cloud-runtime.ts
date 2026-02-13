import type { CloudCredentials } from "./cloud-client";
import { fetchCloudHealth, fetchCloudState, fetchCloudTracks } from "./cloud-client";
import type { JsonRecord, TrackPoint } from "../core/types";
import { isObject, parseTrackSnapshot } from "./data-utils";

export function extractCloudBuildVersion(raw: unknown): string | null {
  if (!isObject(raw)) {
    return null;
  }
  const buildVersion = typeof raw.buildVersion === "string" ? raw.buildVersion.trim() : "";
  return buildVersion || null;
}

export async function fetchCloudBuildVersion(base: string): Promise<string | null> {
  const response = await fetchCloudHealth(base);
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as unknown;
  return extractCloudBuildVersion(body);
}

export interface ProbeCloudRelayResult {
  resultText: string;
  buildVersion: string | null;
}

export async function probeCloudRelay(base: string): Promise<ProbeCloudRelayResult> {
  const response = await fetchCloudHealth(base);
  const text = await response.text();
  let buildVersion: string | null = null;
  try {
    buildVersion = extractCloudBuildVersion(JSON.parse(text) as unknown);
  } catch {
    buildVersion = null;
  }
  return {
    resultText: `${response.status} ${text}`,
    buildVersion,
  };
}

export interface CloudAuthVerifyResult {
  status: number;
  ok: boolean;
  errorText: string;
}

export async function verifyCloudStateAuth(credentials: CloudCredentials): Promise<CloudAuthVerifyResult> {
  const response = await fetchCloudState(credentials);
  if (response.status === 200 || response.status === 404) {
    return {
      status: response.status,
      ok: true,
      errorText: "",
    };
  }
  const text = await response.text();
  return {
    status: response.status,
    ok: false,
    errorText: text,
  };
}

export interface CloudSnapshotResult {
  status: number;
  snapshot: unknown | null;
}

export async function fetchCloudSnapshot(credentials: CloudCredentials): Promise<CloudSnapshotResult> {
  const response = await fetchCloudState(credentials);
  if (response.status === 404) {
    return {
      status: 404,
      snapshot: null,
    };
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const body = (await response.json()) as JsonRecord;
  const payload = isObject(body.payload) ? body.payload : {};
  return {
    status: response.status,
    snapshot: payload.snapshot ?? body.snapshot ?? null,
  };
}

export interface CloudTrackSnapshotResult {
  status: number;
  points: TrackPoint[];
}

export async function fetchCloudTrackSnapshot(credentials: CloudCredentials, limit: number): Promise<CloudTrackSnapshotResult> {
  const response = await fetchCloudTracks(credentials, limit);
  if (response.status === 404) {
    return {
      status: 404,
      points: [],
    };
  }
  if (!response.ok) {
    throw new Error(`track snapshot failed ${response.status}`);
  }

  const body = (await response.json()) as JsonRecord;
  const payload = isObject(body.payload) ? body.payload : body;
  return {
    status: response.status,
    points: parseTrackSnapshot(payload),
  };
}
