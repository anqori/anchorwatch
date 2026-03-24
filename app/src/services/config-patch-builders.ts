import type {
  AlertConfigDraft,
  AlertSeverity,
  AutoSwitchSource,
  ColorScheme,
  ObstacleDraftEntry,
  ObstacleType,
  ProfileMode,
  RuntimeMode,
  WifiSecurity,
} from "../core/types";
import {
  parseIntegerInput,
  parseNumberInput,
  parsePolygonPoints,
} from "./data-utils";

export interface AnchorSettingsInput {
  version: number;
  allowedRangeM: string;
}

export interface AlarmConfigInput {
  version: number;
  alerts: AlertConfigDraft[];
}

export interface ObstaclesConfigInput {
  version: number;
  items: ObstacleDraftEntry[];
}

export interface ProfilesConfigInput {
  version: number;
  profilesMode: ProfileMode;
  profileDayColorScheme: ColorScheme;
  profileDayBrightnessPct: string;
  profileDayOutputProfile: string;
  profileNightColorScheme: ColorScheme;
  profileNightBrightnessPct: string;
  profileNightOutputProfile: string;
  profileAutoSwitchSource: AutoSwitchSource;
  profileDayStartLocal: string;
  profileNightStartLocal: string;
}

export interface SystemConfigInput {
  version: number;
  runtimeMode: RuntimeMode;
}

export interface WlanConfigInput {
  version: number;
  ssid: string;
  passphrase: string;
  security: WifiSecurity;
  country: string;
  hidden: boolean;
}

export interface CloudCredentialsInput {
  version: number;
  boatId: string;
  cloudSecret: string;
}

export interface SetupAuthorizationInput {
  factorySetupPin: string;
}

export interface BleSessionAuthorizationInput {
  bleConnectionPin: string;
}

export interface SetInitialBlePinInput {
  bleConnectionPin: string;
}

export interface UpdateBlePinInput {
  oldBleConnectionPin: string;
  newBleConnectionPin: string;
}

function buildAlertCommonFields(alert: AlertConfigDraft, defaultMinTimeMs: number, severity: AlertSeverity): {
  enabled: boolean;
  min_time_ms: number;
  severity: AlertSeverity;
  default_silence_ms: number;
} {
  return {
    enabled: alert.enabled,
    min_time_ms: parseIntegerInput(alert.minTimeMs, defaultMinTimeMs, 0, 600000),
    severity,
    default_silence_ms: parseIntegerInput(alert.defaultSilenceMs, 900000, 0, 86400000),
  };
}

export function buildAnchorSettingsConfig(input: AnchorSettingsInput) {
  const allowedRange = input.allowedRangeM.trim();
  return {
    version: input.version,
    allowed_range_m: allowedRange ? parseNumberInput(allowedRange, 35, 0, 5000) : null,
    allowed_region: null,
  };
}

export function buildAlarmConfig(input: AlarmConfigInput) {
  return {
    version: input.version,
    alerts: input.alerts.map((alert) => {
      if (alert.type === "ANCHOR_DISTANCE") {
        return {
          type: alert.type,
          ...buildAlertCommonFields(alert, 20000, alert.severity),
          data: {
            max_distance_m: parseNumberInput(alert.maxDistanceM, 35, 0, 5000),
          },
        };
      }
      if (alert.type === "OBSTACLE_CLOSE") {
        return {
          type: alert.type,
          ...buildAlertCommonFields(alert, 10000, alert.severity),
          data: {
            min_distance_m: parseNumberInput(alert.minDistanceM, 10, 0, 1000),
          },
        };
      }
      if (alert.type === "WIND_ABOVE") {
        return {
          type: alert.type,
          ...buildAlertCommonFields(alert, 20000, alert.severity),
          data: {
            max_wind_kn: parseNumberInput(alert.maxWindKn, 30, 0, 200),
          },
        };
      }
      if (alert.type === "DEPTH_BELOW") {
        return {
          type: alert.type,
          ...buildAlertCommonFields(alert, 10000, alert.severity),
          data: {
            min_depth_m: parseNumberInput(alert.minDepthM, 2, 0, 500),
          },
        };
      }
      return {
        type: alert.type,
        ...buildAlertCommonFields(alert, 5000, alert.severity),
        data: {
          max_age_ms: parseIntegerInput(alert.maxAgeMs, 5000, 0, 600000),
        },
      };
    }),
  };
}

export function buildObstaclesConfig(input: ObstaclesConfigInput) {
  return {
    version: input.version,
    obstacles: input.items
      .map((item, index) => ({
        obstacle_id: item.obstacle_id.trim() || `obstacle_${index + 1}`,
        type: normalizeObstacleType(item.type),
        polygon: parsePolygonPoints(item.polygonInput),
      }))
      .filter((item) => item.polygon.length >= 3),
  };
}

export function buildProfilesConfig(input: ProfilesConfigInput) {
  return {
    version: input.version,
    mode: input.profilesMode,
    day: {
      color_scheme: input.profileDayColorScheme,
      brightness_pct: parseIntegerInput(input.profileDayBrightnessPct, 100, 1, 100),
      output_profile: input.profileDayOutputProfile.trim() || "normal",
    },
    night: {
      color_scheme: input.profileNightColorScheme,
      brightness_pct: parseIntegerInput(input.profileNightBrightnessPct, 20, 1, 100),
      output_profile: input.profileNightOutputProfile.trim() || "night",
    },
    auto_switch: {
      source: input.profileAutoSwitchSource,
      day_start_local: input.profileDayStartLocal,
      night_start_local: input.profileNightStartLocal,
    },
  };
}

export function buildSystemConfig(input: SystemConfigInput) {
  return {
    version: input.version,
    runtime_mode: input.runtimeMode,
  };
}

export function buildWlanConfig(input: WlanConfigInput) {
  return {
    version: input.version,
    ssid: input.ssid.trim(),
    passphrase: input.passphrase,
    security: input.security === "unknown" ? "wpa2" : input.security,
    country: input.country.trim().toUpperCase() || "DE",
    hidden: input.hidden,
  };
}

export function buildCloudCredentialsUpdate(input: CloudCredentialsInput) {
  return {
    version: input.version,
    boat_id: input.boatId.trim(),
    cloud_secret: input.cloudSecret.trim(),
  };
}

export function buildAuthorizeSetupRequest(input: SetupAuthorizationInput) {
  return {
    factory_setup_pin: input.factorySetupPin.trim(),
  };
}

export function buildAuthorizeBleSessionRequest(input: BleSessionAuthorizationInput) {
  return {
    ble_connection_pin: input.bleConnectionPin.trim(),
  };
}

export function buildSetInitialBlePinRequest(input: SetInitialBlePinInput) {
  return {
    ble_connection_pin: input.bleConnectionPin.trim(),
  };
}

export function buildUpdateBlePinRequest(input: UpdateBlePinInput) {
  return {
    old_ble_connection_pin: input.oldBleConnectionPin.trim(),
    new_ble_connection_pin: input.newBleConnectionPin.trim(),
  };
}

function normalizeObstacleType(type: ObstacleType): ObstacleType {
  return type === "TEMPORARY" ? "TEMPORARY" : "PERMANENT";
}
