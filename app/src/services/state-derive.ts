import type { AnchorRuntimeState, JsonRecord, TrackPoint } from "../core/types";
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
