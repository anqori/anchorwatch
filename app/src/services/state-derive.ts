import type { AlertId, AlertRuntimeEntry, AlertRuntimeState, AlertSeverity, AnchorRuntimeState, JsonRecord, TrackPoint } from "../core/types";
import { isObject, toFiniteNumber } from "./data-utils";

export interface OnboardingWifiStatus {
  connected: boolean;
  ssid: string;
  rssi: number | null;
  error: string;
}

export interface TelemetryDerived {
  gpsAgeS: number;
  dataAgeS: number;
  depthM: number;
  windKn: number;
  trackPoint: TrackPoint | null;
}

export interface CurrentGpsPosition {
  lat: number;
  lon: number;
}

export interface AnchorStatusDerived {
  state: AnchorRuntimeState;
  position: CurrentGpsPosition | null;
}

const ALERT_LABELS: Record<AlertId, string> = {
  anchor_distance: "Anchor Distance",
  boating_area: "Boating Area",
  wind_strength: "Wind Strength",
  depth: "Depth",
  data_outdated: "Data Outdated",
};

const ALERT_IDS: AlertId[] = [
  "anchor_distance",
  "boating_area",
  "wind_strength",
  "depth",
  "data_outdated",
];

export function readOnboardingWifiStatus(latestState: JsonRecord): OnboardingWifiStatus {
  const system = isObject(latestState.system) ? latestState.system : {};
  const wifi = isObject(system.wifi) ? system.wifi : {};
  const connected = wifi.connected === true;
  const ssid = typeof wifi.ssid === "string" ? wifi.ssid.trim() : "";
  const rssi = toFiniteNumber(wifi.rssi);
  const rawError = typeof wifi.lastError === "string" ? wifi.lastError.trim() : "";
  const error = connected || rawError.toLowerCase() === "connecting" ? "" : rawError;
  return { connected, ssid, rssi, error };
}

export function readFirmwareVersionFromState(latestState: JsonRecord): string {
  const system = isObject(latestState.system) ? latestState.system : {};
  const firmware = isObject(system.firmware) ? system.firmware : {};
  const version = typeof firmware.version === "string" ? firmware.version.trim() : "";
  return version || "--";
}

export function readCurrentGpsPosition(latestState: JsonRecord): CurrentGpsPosition | null {
  const telemetry = isObject(latestState.telemetry) ? latestState.telemetry : {};
  const gps = isObject(telemetry.gps) ? telemetry.gps : {};
  const lat = toFiniteNumber(gps.lat);
  const lon = toFiniteNumber(gps.lon);
  if (lat === null || lon === null) {
    return null;
  }
  return { lat, lon };
}

export function readAnchorStatus(latestState: JsonRecord): AnchorStatusDerived {
  const anchor = isObject(latestState.anchor) ? latestState.anchor : {};
  const stateRaw = typeof anchor.state === "string" ? anchor.state.trim() : "";
  const state: AnchorRuntimeState = stateRaw === "down" || stateRaw === "auto-pending" ? stateRaw : "up";

  const positionRaw = isObject(anchor.position) ? anchor.position : {};
  const lat = toFiniteNumber(positionRaw.lat);
  const lon = toFiniteNumber(positionRaw.lon);

  if (lat === null || lon === null) {
    return {
      state,
      position: null,
    };
  }
  return {
    state,
    position: { lat, lon },
  };
}

export function deriveTelemetry(latestState: JsonRecord, nowTs = Date.now()): TelemetryDerived {
  const telemetry = isObject(latestState.telemetry) ? latestState.telemetry : {};
  const gps = isObject(telemetry.gps) ? telemetry.gps : {};
  const depth = isObject(telemetry.depth) ? telemetry.depth : {};
  const wind = isObject(telemetry.wind) ? telemetry.wind : {};
  const motion = isObject(telemetry.motion) ? telemetry.motion : {};

  const gpsAgeS = Number(gps.ageMs ?? 0) / 1000;
  const dataAgeS = Number(depth.ageMs ?? wind.ageMs ?? gps.ageMs ?? 0) / 1000;
  const depthM = Number(depth.meters ?? 0);
  const windKn = Number(wind.knots ?? 0);

  const lat = toFiniteNumber(gps.lat);
  const lon = toFiniteNumber(gps.lon);
  if (lat === null || lon === null) {
    return {
      gpsAgeS,
      dataAgeS,
      depthM,
      windKn,
      trackPoint: null,
    };
  }

  const sogKn = toFiniteNumber(gps.sogKn ?? motion.sogKn) ?? 0;
  const cogDeg = toFiniteNumber(gps.cogDeg ?? motion.cogDeg) ?? 0;
  const headingDeg = toFiniteNumber(gps.headingDeg ?? motion.headingDeg ?? cogDeg) ?? cogDeg;

  return {
    gpsAgeS,
    dataAgeS,
    depthM,
    windKn,
    trackPoint: {
      ts: nowTs,
      lat,
      lon,
      sogKn,
      cogDeg: (cogDeg + 360) % 360,
      headingDeg: (headingDeg + 360) % 360,
    },
  };
}

function parseAlertSeverity(value: unknown): AlertSeverity {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
  return raw === "ALARM" ? "ALARM" : "WARNING";
}

function parseAlertState(value: unknown): AlertRuntimeState {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (raw === "DISABLED" || raw === "TRIGGERED" || raw === "ALERT" || raw === "ALERT_SILENCED") {
    return raw;
  }
  return "WATCHING";
}

function parseAlertTs(value: unknown): number | null {
  const numeric = toFiniteNumber(value);
  if (numeric === null || numeric <= 0) {
    return null;
  }
  return Math.floor(numeric);
}

export function readAlertRuntimeEntries(latestState: JsonRecord): AlertRuntimeEntry[] {
  const alerts = isObject(latestState.alerts) ? latestState.alerts : {};
  const out: AlertRuntimeEntry[] = [];

  for (const id of ALERT_IDS) {
    const raw = isObject(alerts[id]) ? alerts[id] : {};
    out.push({
      id,
      label: ALERT_LABELS[id],
      severity: parseAlertSeverity(raw.severity),
      state: parseAlertState(raw.state),
      aboveThresholdSinceTs: parseAlertTs(raw.above_threshold_since_ts),
      alertSinceTs: parseAlertTs(raw.alert_since_ts),
      alertSilencedUntilTs: parseAlertTs(raw.alert_silenced_until_ts),
    });
  }
  return out;
}
