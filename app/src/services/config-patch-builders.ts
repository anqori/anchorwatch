import type {
  AlertConfigDraft,
  AlertSeverity,
  AutoSwitchSource,
  ColorScheme,
  JsonRecord,
  ProfileMode,
} from "../core/types";
import {
  parseIntegerInput,
  parseNumberInput,
  parsePolygonPoints,
} from "./data-utils";

export interface AnchorConfigInput {
  autoModeMinForwardSogKn: string;
  autoModeStallMaxSogKn: string;
  autoModeReverseMinSogKn: string;
  autoModeConfirmSeconds: string;
}

export interface AlertConfigInput {
  alerts: AlertConfigDraft[];
}

export interface ProfilesConfigInput {
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

function buildAlertCommonFields(alert: AlertConfigDraft, defaultMinTimeMs: number, severity: AlertSeverity): JsonRecord {
  return {
    is_enabled: alert.isEnabled,
    min_time_ms: parseIntegerInput(alert.minTimeMs, defaultMinTimeMs, 0, 600000),
    severity,
  };
}

export function buildAnchorConfigPart(input: AnchorConfigInput): JsonRecord {
  return {
    auto_mode: {
      min_forward_sog_kn: parseNumberInput(input.autoModeMinForwardSogKn, 0.8, 0, 20),
      stall_max_sog_kn: parseNumberInput(input.autoModeStallMaxSogKn, 0.3, 0, 20),
      reverse_min_sog_kn: parseNumberInput(input.autoModeReverseMinSogKn, 0.4, 0, 20),
      confirm_seconds: parseIntegerInput(input.autoModeConfirmSeconds, 20, 1, 300),
    },
  };
}

export function buildAlertConfigPart(input: AlertConfigInput): JsonRecord {
  const alarmConfig: JsonRecord = {};

  for (const alert of input.alerts) {
    if (alert.id === "anchor_distance") {
      alarmConfig.anchor_distance = {
        ...buildAlertCommonFields(alert, 20000, alert.severity),
        max_distance_m: parseNumberInput(alert.maxDistanceM, 35, 0, 1000),
      };
      continue;
    }
    if (alert.id === "boating_area") {
      alarmConfig.boating_area = {
        ...buildAlertCommonFields(alert, 20000, alert.severity),
        polygon: parsePolygonPoints(alert.polygonPointsInput),
      };
      continue;
    }
    if (alert.id === "wind_strength") {
      alarmConfig.wind_strength = {
        ...buildAlertCommonFields(alert, 20000, alert.severity),
        max_tws: parseNumberInput(alert.maxTwsKn, 30, 0, 200),
      };
      continue;
    }
    if (alert.id === "depth") {
      alarmConfig.depth = {
        ...buildAlertCommonFields(alert, 10000, alert.severity),
        min_depth: parseNumberInput(alert.minDepthM, 2, 0, 500),
      };
      continue;
    }
    if (alert.id === "data_outdated") {
      alarmConfig.data_outdated = {
        ...buildAlertCommonFields(alert, 5000, alert.severity),
        min_age: parseIntegerInput(alert.minAgeMs, 5000, 0, 600000),
      };
    }
  }

  return alarmConfig;
}

export function buildProfilesConfigPart(input: ProfilesConfigInput): JsonRecord {
  return {
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
