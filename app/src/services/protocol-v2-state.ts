import type { JsonRecord, TrackPoint } from "../core/types";
import { isObject, toTrackPoint } from "./data-utils";

export interface ProtocolPartValue {
  version: number;
  value: unknown;
}

export interface ProtocolSnapshotParts {
  stateParts: Record<string, ProtocolPartValue>;
  configParts: Record<string, ProtocolPartValue>;
  trackPoints: TrackPoint[];
}

export interface ProtocolPartUpdate {
  group: "state" | "config";
  name: string;
  version: number;
  value: unknown;
}

function readPartMap(value: unknown): Record<string, ProtocolPartValue> {
  if (!isObject(value)) {
    return {};
  }

  const out: Record<string, ProtocolPartValue> = {};
  for (const [name, raw] of Object.entries(value)) {
    if (!isObject(raw)) {
      continue;
    }
    const version = Number.isFinite(Number(raw.version)) ? Math.max(0, Math.floor(Number(raw.version))) : 0;
    out[name] = {
      version,
      value: raw.value,
    };
  }
  return out;
}

export function readProtocolSnapshotParts(data: JsonRecord): ProtocolSnapshotParts | null {
  const stateParts = readPartMap(data.state_parts);
  const configParts = readPartMap(data.config_parts);
  const rawTrackPoints = Array.isArray(data.track_points) ? data.track_points : [];
  const trackPoints: TrackPoint[] = [];
  for (const rawTrackPoint of rawTrackPoints) {
    const trackPoint = toTrackPoint(rawTrackPoint);
    if (trackPoint) {
      trackPoints.push(trackPoint);
    }
  }

  if (!Object.keys(stateParts).length && !Object.keys(configParts).length && !trackPoints.length) {
    return null;
  }

  return {
    stateParts,
    configParts,
    trackPoints,
  };
}

export function readProtocolPartUpdate(data: JsonRecord): ProtocolPartUpdate | null {
  const rawPart = data.part;
  if (!isObject(rawPart)) {
    return null;
  }

  const group = rawPart.group === "config" ? "config" : rawPart.group === "state" ? "state" : null;
  const name = typeof rawPart.name === "string" ? rawPart.name.trim() : "";
  if (!group || !name) {
    return null;
  }

  const version = Number.isFinite(Number(rawPart.version)) ? Math.max(0, Math.floor(Number(rawPart.version))) : 0;
  return {
    group,
    name,
    version,
    value: rawPart.value,
  };
}

export function readProtocolTrackAppend(data: JsonRecord): TrackPoint[] {
  const rawTrackPoints = Array.isArray(data.track_append) ? data.track_append : [];
  const trackPoints: TrackPoint[] = [];
  for (const rawTrackPoint of rawTrackPoints) {
    const trackPoint = toTrackPoint(rawTrackPoint);
    if (trackPoint) {
      trackPoints.push(trackPoint);
    }
  }
  return trackPoints;
}

export function mapProtocolPartsToLegacyState(parts: ProtocolSnapshotParts): JsonRecord {
  const out: JsonRecord = {};
  for (const [name, part] of Object.entries(parts.stateParts)) {
    const patch = mapProtocolPartToLegacyPatch("state", name, part.value);
    mergeShallow(out, patch);
  }
  for (const [name, part] of Object.entries(parts.configParts)) {
    const patch = mapProtocolPartToLegacyPatch("config", name, part.value);
    mergeShallow(out, patch);
  }
  return out;
}

export function mapProtocolPartToLegacyPatch(
  group: "state" | "config",
  name: string,
  value: unknown,
): JsonRecord {
  if (!isObject(value)) {
    return {};
  }

  if (group === "state" && name === "position") {
    return {
      telemetry: {
        gps: {
          lat: Number(value.lat ?? 0),
          lon: Number(value.lon ?? 0),
          ageMs: Number(value.gps_age_ms ?? 0),
          valid: value.valid === true,
          sogKn: Number(value.sog_kn ?? 0),
          cogDeg: Number(value.cog_deg ?? 0),
          headingDeg: Number(value.heading_deg ?? value.cog_deg ?? 0),
        },
        motion: {
          sogKn: Number(value.sog_kn ?? 0),
          cogDeg: Number(value.cog_deg ?? 0),
          headingDeg: Number(value.heading_deg ?? value.cog_deg ?? 0),
        },
      },
    };
  }

  if (group === "state" && name === "nav_data") {
    return {
      telemetry: {
        depth: {
          meters: Number(value.depth_m ?? 0),
          ageMs: Number(value.data_age_ms ?? 0),
        },
        wind: {
          knots: Number(value.wind_kn ?? 0),
          dirDeg: Number(value.wind_dir_deg ?? 0),
          ageMs: Number(value.data_age_ms ?? 0),
        },
      },
      system: {
        wifi: {
          connected: value.wifi_connected === true,
          ssid: typeof value.wifi_ssid === "string" ? value.wifi_ssid : "",
          rssi: Number(value.wifi_rssi ?? 0),
          lastError: typeof value.wifi_error === "string" ? value.wifi_error : "",
        },
        cloud: {
          reachable: value.cloud_reachable === true,
        },
        firmware: {
          version: typeof value.firmware_version === "string" ? value.firmware_version : "",
        },
        pairMode: {
          active: value.pair_mode_active === true,
          remainingMs: Number(value.pair_mode_remaining_ms ?? 0),
          sessionPaired: value.session_paired === true,
        },
      },
    };
  }

  if (group === "state" && name === "alarm_state") {
    return {
      alerts: isObject(value.alerts) ? value.alerts : {},
      alarm: {
        level: typeof value.level === "string" ? value.level : "none",
        silenceUntilTs: Number(value.silence_until_ts ?? 0) || null,
      },
    };
  }

  if (group === "config" && name === "anchor_position") {
    return {
      anchor: {
        state: typeof value.state === "string" ? value.state : "up",
        position: isObject(value.position) ? value.position : null,
      },
    };
  }

  return {};
}

export function applyPartVersions(target: Record<string, number>, snapshot: ProtocolSnapshotParts): void {
  for (const [name, part] of Object.entries(snapshot.stateParts)) {
    target[`state:${name}`] = part.version;
  }
  for (const [name, part] of Object.entries(snapshot.configParts)) {
    target[`config:${name}`] = part.version;
  }
}

export function applyUpdateVersion(target: Record<string, number>, update: ProtocolPartUpdate): void {
  target[`${update.group}:${update.name}`] = update.version;
}

function mergeShallow(target: JsonRecord, patch: JsonRecord): void {
  for (const [key, value] of Object.entries(patch)) {
    if (isObject(value) && isObject(target[key])) {
      mergeShallow(target[key] as JsonRecord, value);
      continue;
    }
    target[key] = value;
  }
}
