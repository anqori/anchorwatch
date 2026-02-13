import type { JsonRecord, TrackPoint, WifiScanNetwork, WifiSecurity } from "../core/types";

export function isObject(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toFiniteNumber(value: unknown): number | null {
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? asNumber : null;
}

export function clampNumber(value: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, value));
}

export function parseNumberInput(raw: string, fallback: number, minValue: number, maxValue: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clampNumber(parsed, minValue, maxValue);
}

export function parseIntegerInput(raw: string, fallback: number, minValue: number, maxValue: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clampNumber(parsed, minValue, maxValue);
}

export function normalizeWifiSecurity(value: unknown): WifiSecurity {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "open") {
    return "open";
  }
  if (raw === "wpa3" || raw === "wpa3-psk" || raw === "wpa3_psk") {
    return "wpa3";
  }
  if (raw === "wpa2" || raw === "wpa2-psk" || raw === "wpa2_psk") {
    return "wpa2";
  }
  return "unknown";
}

export function formatWifiSecurity(security: WifiSecurity): string {
  if (security === "open") {
    return "OPEN";
  }
  if (security === "wpa3") {
    return "WPA3";
  }
  if (security === "wpa2") {
    return "WPA2";
  }
  return "UNKNOWN";
}

export function parseWifiScanNetworks(value: unknown): WifiScanNetwork[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const strongestBySsid = new Map<string, WifiScanNetwork>();
  for (const candidate of value) {
    if (!isObject(candidate)) {
      continue;
    }

    const ssid = typeof candidate.ssid === "string" ? candidate.ssid.trim() : "";
    if (!ssid) {
      continue;
    }

    const network: WifiScanNetwork = {
      ssid,
      security: normalizeWifiSecurity(candidate.security),
      rssi: toFiniteNumber(candidate.rssi),
      channel: toFiniteNumber(candidate.channel),
      hidden: candidate.hidden === true,
    };

    const existing = strongestBySsid.get(ssid);
    if (!existing) {
      strongestBySsid.set(ssid, network);
      continue;
    }

    const existingScore = existing.rssi ?? -999;
    const candidateScore = network.rssi ?? -999;
    if (candidateScore > existingScore) {
      strongestBySsid.set(ssid, network);
    }
  }

  return Array.from(strongestBySsid.values()).sort((a, b) => {
    const rssiA = a.rssi ?? -999;
    const rssiB = b.rssi ?? -999;
    if (rssiA !== rssiB) {
      return rssiB - rssiA;
    }
    return a.ssid.localeCompare(b.ssid);
  });
}

export function parsePolygonPoints(raw: string): Array<{ lat: number; lon: number }> {
  const lines = raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const points: Array<{ lat: number; lon: number }> = [];

  for (const line of lines) {
    const [rawLat, rawLon] = line.split(",").map((part) => part.trim());
    const lat = Number(rawLat);
    const lon = Number(rawLon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error(`invalid polygon point: "${line}"`);
    }
    points.push({ lat, lon });
  }
  return points;
}

export function deepMerge(baseValue: unknown, patchValue: JsonRecord): JsonRecord {
  const base: JsonRecord = isObject(baseValue) ? { ...baseValue } : {};
  for (const [key, value] of Object.entries(patchValue)) {
    if (isObject(value) && isObject(base[key])) {
      base[key] = deepMerge(base[key], value);
    } else {
      base[key] = value;
    }
  }
  return base;
}

export function assignPath(target: JsonRecord, path: string, value: unknown): boolean {
  const parts = path.split(".");
  if (parts.some((part) => !part)) {
    return false;
  }

  let cursor: JsonRecord = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (!isObject(cursor[part])) {
      cursor[part] = {};
    }
    cursor = cursor[part] as JsonRecord;
  }

  const leaf = parts[parts.length - 1];
  cursor[leaf] = isObject(value) ? normalizePatch(value) : value;
  return true;
}

export function normalizePatch(rawPatch: unknown): JsonRecord | null {
  if (!isObject(rawPatch)) {
    return null;
  }

  const out: JsonRecord = {};
  for (const [key, value] of Object.entries(rawPatch)) {
    if (key.includes(".")) {
      if (!assignPath(out, key, value)) {
        return null;
      }
      continue;
    }

    if (isObject(value)) {
      const nested = normalizePatch(value);
      if (!nested) {
        return null;
      }
      out[key] = nested;
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function extractAckError(payload: JsonRecord): string {
  const code = typeof payload.errorCode === "string" ? payload.errorCode : "ACK_FAILED";
  const detail = typeof payload.errorDetail === "string" ? payload.errorDetail : "command rejected";
  return `${code}: ${detail}`;
}

export function dataViewToBytes(view: DataView): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
}

export function safeParseJson(raw: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(raw);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function toTrackPoint(value: unknown): TrackPoint | null {
  if (!isObject(value)) {
    return null;
  }

  const lat = toFiniteNumber(value.lat);
  const lon = toFiniteNumber(value.lon);
  if (lat === null || lon === null) {
    return null;
  }

  const ts = toFiniteNumber(value.ts) ?? Date.now();
  const sogKn = toFiniteNumber(value.sogKn) ?? 0;
  const cogDeg = toFiniteNumber(value.cogDeg) ?? 0;
  const headingDeg = toFiniteNumber(value.headingDeg) ?? cogDeg;

  return {
    ts,
    lat,
    lon,
    sogKn,
    cogDeg: (cogDeg + 360) % 360,
    headingDeg: (headingDeg + 360) % 360,
  };
}

export function parseTrackSnapshot(payload: JsonRecord): TrackPoint[] {
  const rawPoints = payload.points;
  if (!Array.isArray(rawPoints)) {
    return [];
  }

  const out: TrackPoint[] = [];
  for (const point of rawPoints) {
    const parsed = toTrackPoint(point);
    if (parsed) {
      out.push(parsed);
    }
  }
  return out;
}

export function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
