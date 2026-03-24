import type {
  AlertRuntimeEntry,
  AnchorRuntimeState,
  DeviceDataSlices,
  PositionValue,
  TrackPoint,
  WlanStatusValue,
} from "../core/types";
import { readAlertRuntimeEntries as mapAlertRuntimeEntries } from "./protocol-v2-state";

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

export function readOnboardingWifiStatus(wlanStatus: WlanStatusValue | null): OnboardingWifiStatus {
  return {
    connected: wlanStatus?.wifi_connected === true,
    ssid: wlanStatus?.wifi_ssid?.trim() || "",
    rssi: wlanStatus?.wifi_rssi ?? null,
    error: wlanStatus?.wifi_connected ? "" : wlanStatus?.wifi_error ?? "",
  };
}

export function readFirmwareVersionFromState(deviceData: DeviceDataSlices): string {
  return deviceData.systemStatus?.server_version?.trim() || "--";
}

export function readCurrentGpsPosition(position: PositionValue | null): CurrentGpsPosition | null {
  if (!position || !position.valid) {
    return null;
  }
  return {
    lat: position.lat,
    lon: position.lon,
  };
}

export function readAnchorStatus(anchorPosition: DeviceDataSlices["anchorPosition"]): AnchorStatusDerived {
  if (!anchorPosition || anchorPosition.lat === null || anchorPosition.lon === null) {
    return {
      state: anchorPosition?.state ?? "up",
      position: null,
    };
  }
  return {
    state: anchorPosition.state,
    position: {
      lat: anchorPosition.lat,
      lon: anchorPosition.lon,
    },
  };
}

export function deriveTelemetry(deviceData: DeviceDataSlices, nowTs = Date.now()): TelemetryDerived {
  const position = deviceData.position;
  const depth = deviceData.depth;
  const wind = deviceData.wind;

  const gpsAgeS = position ? Math.max(0, position.gps_age_ms / 1000) : 0;
  const dataAgeCandidates = [
    gpsAgeS,
    depth ? Math.max(0, (nowTs - depth.ts) / 1000) : 0,
    wind ? Math.max(0, (nowTs - wind.ts) / 1000) : 0,
  ];

  if (!position || !position.valid) {
    return {
      gpsAgeS,
      dataAgeS: Math.max(...dataAgeCandidates),
      depthM: depth?.depth_m ?? 0,
      windKn: wind?.wind_kn ?? 0,
      trackPoint: null,
    };
  }

  return {
    gpsAgeS,
    dataAgeS: Math.max(...dataAgeCandidates),
    depthM: depth?.depth_m ?? 0,
    windKn: wind?.wind_kn ?? 0,
    trackPoint: {
      ts: nowTs,
      lat: position.lat,
      lon: position.lon,
      sogKn: position.sog_kn,
      cogDeg: position.cog_deg,
      headingDeg: position.heading_deg,
      depthM: depth?.depth_m ?? null,
      windKn: wind?.wind_kn ?? null,
      windDirDeg: wind?.wind_dir_deg ?? null,
    },
  };
}

export function readAlertRuntimeEntries(alarmState: DeviceDataSlices["alarmState"]): AlertRuntimeEntry[] {
  return mapAlertRuntimeEntries(alarmState);
}
