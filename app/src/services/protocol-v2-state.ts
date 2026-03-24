import type {
  AlarmConfigValue,
  AlarmStateValue,
  AlertRuntimeEntry,
  AlertType,
  AnchorPositionValue,
  AnchorSettingsValue,
  CloudConfigValue,
  DepthValue,
  JsonRecord,
  ObstaclesConfigValue,
  PositionValue,
  ProfilesConfigValue,
  SystemConfigValue,
  SystemStatusValue,
  TrackPoint,
  WlanConfigValue,
  WlanStatusValue,
  WindValue,
} from "../core/types";
import { isObject, toFiniteNumber, toTrackPoint } from "./data-utils";

const ALERT_LABELS: Record<AlertType, string> = {
  ANCHOR_DISTANCE: "Anchor Distance",
  OBSTACLE_CLOSE: "Obstacle Close",
  WIND_ABOVE: "Wind Above",
  DEPTH_BELOW: "Depth Below",
  DATA_OUTDATED: "Data Outdated",
};

export function readPositionValue(data: unknown): PositionValue | null {
  if (!isObject(data)) {
    return null;
  }
  const lat = toFiniteNumber(data.lat);
  const lon = toFiniteNumber(data.lon);
  if (lat === null || lon === null) {
    return null;
  }
  return {
    lat,
    lon,
    gps_age_ms: Math.max(0, Math.floor(toFiniteNumber(data.gps_age_ms) ?? 0)),
    valid: data.valid === true,
    sog_kn: toFiniteNumber(data.sog_kn) ?? 0,
    cog_deg: normalizeDegrees(toFiniteNumber(data.cog_deg) ?? 0),
    heading_deg: normalizeDegrees(toFiniteNumber(data.heading_deg) ?? toFiniteNumber(data.cog_deg) ?? 0),
  };
}

export function readDepthValue(data: unknown): DepthValue | null {
  if (!isObject(data)) {
    return null;
  }
  const depth = toFiniteNumber(data.depth_m);
  const ts = toFiniteNumber(data.ts);
  if (depth === null || ts === null) {
    return null;
  }
  return {
    depth_m: depth,
    ts: Math.floor(ts),
  };
}

export function readWindValue(data: unknown): WindValue | null {
  if (!isObject(data)) {
    return null;
  }
  const wind = toFiniteNumber(data.wind_kn);
  const dir = toFiniteNumber(data.wind_dir_deg);
  const ts = toFiniteNumber(data.ts);
  if (wind === null || dir === null || ts === null) {
    return null;
  }
  return {
    wind_kn: wind,
    wind_dir_deg: normalizeDegrees(dir),
    ts: Math.floor(ts),
  };
}

export function readWlanStatusValue(data: unknown): WlanStatusValue | null {
  if (!isObject(data)) {
    return null;
  }
  const wifiState = typeof data.wifi_state === "string" ? data.wifi_state : "";
  if (
    wifiState !== "DISCONNECTED"
    && wifiState !== "CONNECTING"
    && wifiState !== "AUTHENTICATING"
    && wifiState !== "OBTAINING_IP"
    && wifiState !== "CONNECTED"
    && wifiState !== "FAILED"
  ) {
    return null;
  }
  return {
    wifi_state: wifiState,
    wifi_connected: data.wifi_connected === true,
    wifi_ssid: typeof data.wifi_ssid === "string" ? data.wifi_ssid : "",
    wifi_rssi: toFiniteNumber(data.wifi_rssi),
    wifi_error: typeof data.wifi_error === "string" ? data.wifi_error : "",
  };
}

export function readSystemStatusValue(data: unknown): SystemStatusValue | null {
  if (!isObject(data)) {
    return null;
  }
  return {
    cloud_reachable: data.cloud_reachable === true,
    server_version: typeof data.server_version === "string" ? data.server_version : "",
  };
}

export function readAnchorPositionValue(data: unknown): AnchorPositionValue | null {
  if (!isObject(data)) {
    return null;
  }
  const state = data.state === "down" || data.state === "auto-pending" ? data.state : "up";
  const lat = toFiniteNumber(data.lat);
  const lon = toFiniteNumber(data.lon);
  return {
    state,
    lat,
    lon,
  };
}

export function readAlarmStateValue(data: unknown): AlarmStateValue | null {
  if (!isObject(data) || !Array.isArray(data.alerts)) {
    return null;
  }
  const alerts = data.alerts
    .map((entry) => readAlertRuntime(entry))
    .filter((entry): entry is AlarmStateValue["alerts"][number] => entry !== null);
  return {
    alerts,
  };
}

export function readAlarmConfigValue(data: unknown): AlarmConfigValue | null {
  if (!isObject(data) || !Array.isArray(data.alerts)) {
    return null;
  }
  const version = toFiniteNumber(data.version);
  if (version === null) {
    return null;
  }
  return data as unknown as AlarmConfigValue;
}

export function readObstaclesConfigValue(data: unknown): ObstaclesConfigValue | null {
  if (!isObject(data) || !Array.isArray(data.obstacles)) {
    return null;
  }
  const version = toFiniteNumber(data.version);
  if (version === null) {
    return null;
  }
  return data as unknown as ObstaclesConfigValue;
}

export function readAnchorSettingsValue(data: unknown): AnchorSettingsValue | null {
  if (!isObject(data)) {
    return null;
  }
  const version = toFiniteNumber(data.version);
  if (version === null) {
    return null;
  }
  return data as unknown as AnchorSettingsValue;
}

export function readProfilesConfigValue(data: unknown): ProfilesConfigValue | null {
  if (!isObject(data)) {
    return null;
  }
  const version = toFiniteNumber(data.version);
  if (version === null) {
    return null;
  }
  return data as unknown as ProfilesConfigValue;
}

export function readSystemConfigValue(data: unknown): SystemConfigValue | null {
  if (!isObject(data)) {
    return null;
  }
  const version = toFiniteNumber(data.version);
  const runtimeMode = data.runtime_mode === "SIMULATION" ? "SIMULATION" : data.runtime_mode === "LIVE" ? "LIVE" : null;
  if (version === null || !runtimeMode) {
    return null;
  }
  return {
    version: Math.floor(version),
    runtime_mode: runtimeMode,
  };
}

export function readWlanConfigValue(data: unknown): WlanConfigValue | null {
  if (!isObject(data)) {
    return null;
  }
  const version = toFiniteNumber(data.version);
  if (version === null) {
    return null;
  }
  return {
    version: Math.floor(version),
    ssid: typeof data.ssid === "string" ? data.ssid : "",
    passphrase: typeof data.passphrase === "string" ? data.passphrase : "",
    security: data.security === "open" || data.security === "wpa3" || data.security === "unknown" ? data.security : "wpa2",
    country: typeof data.country === "string" ? data.country : "",
    hidden: data.hidden === true,
  };
}

export function readCloudConfigValue(data: unknown): CloudConfigValue | null {
  if (!isObject(data)) {
    return null;
  }
  const version = toFiniteNumber(data.version);
  if (version === null) {
    return null;
  }
  return {
    version: Math.floor(version),
    boat_id: typeof data.boat_id === "string" ? data.boat_id : "",
    cloud_secret: typeof data.cloud_secret === "string" ? data.cloud_secret : "",
    secret_configured: data.secret_configured === true,
  };
}

export function readTrackBackfill(data: unknown): TrackPoint[] {
  if (!Array.isArray(data)) {
    return [];
  }
  return data.map((entry) => toTrackPoint(entry)).filter((entry): entry is TrackPoint => entry !== null);
}

export function readAlertRuntimeEntries(value: AlarmStateValue | null): AlertRuntimeEntry[] {
  if (!value) {
    return [];
  }
  return value.alerts.map((alert) => ({
    alertType: alert.alert_type,
    label: ALERT_LABELS[alert.alert_type],
    severity: alert.severity,
    state: alert.state,
    aboveThresholdSinceTs: alert.above_threshold_since_ts,
    alertSinceTs: alert.alert_since_ts,
    alertSilencedUntilTs: alert.alert_silenced_until_ts,
  }));
}

function readAlertRuntime(data: unknown): AlarmStateValue["alerts"][number] | null {
  if (!isObject(data)) {
    return null;
  }
  const alertType = typeof data.alert_type === "string" ? data.alert_type : "";
  if (
    alertType !== "ANCHOR_DISTANCE"
    && alertType !== "OBSTACLE_CLOSE"
    && alertType !== "WIND_ABOVE"
    && alertType !== "DEPTH_BELOW"
    && alertType !== "DATA_OUTDATED"
  ) {
    return null;
  }
  const state = data.state === "DISABLED" || data.state === "ALERT" ? data.state : "WATCHING";
  const severity = data.severity === "ALARM" ? "ALARM" : "WARNING";
  return {
    alert_type: alertType,
    state,
    severity,
    above_threshold_since_ts: readOptionalTimestamp(data.above_threshold_since_ts),
    alert_since_ts: readOptionalTimestamp(data.alert_since_ts),
    alert_silenced_until_ts: readOptionalTimestamp(data.alert_silenced_until_ts),
  };
}

function readOptionalTimestamp(value: unknown): number | null {
  const numeric = toFiniteNumber(value);
  if (numeric === null || numeric <= 0) {
    return null;
  }
  return Math.floor(numeric);
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}
