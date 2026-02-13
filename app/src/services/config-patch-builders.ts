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

export function buildAnchorConfigPatch(input: AnchorConfigInput): JsonRecord {
  return {
    "anchor.autoMode.minForwardSogKn": parseNumberInput(input.autoModeMinForwardSogKn, 0.8, 0, 20),
    "anchor.autoMode.stallMaxSogKn": parseNumberInput(input.autoModeStallMaxSogKn, 0.3, 0, 20),
    "anchor.autoMode.reverseMinSogKn": parseNumberInput(input.autoModeReverseMinSogKn, 0.4, 0, 20),
    "anchor.autoMode.confirmSeconds": parseIntegerInput(input.autoModeConfirmSeconds, 20, 1, 300),
  };
}

const FIXED_ANCHOR_DISTANCE_MAX_M = 35;
const FIXED_BOATING_AREA_POLYGON: Array<{ lat: number; lon: number }> = [
  { lat: 54.3194, lon: 10.1388 },
  { lat: 54.3212, lon: 10.1388 },
  { lat: 54.3212, lon: 10.1418 },
  { lat: 54.3194, lon: 10.1418 },
];

function applyAlertCommonFields(patch: JsonRecord, alert: AlertConfigDraft, defaultMinTimeMs: number, severity: AlertSeverity): void {
  patch[`alerts.${alert.id}.is_enabled`] = alert.isEnabled;
  patch[`alerts.${alert.id}.min_time_ms`] = parseIntegerInput(alert.minTimeMs, defaultMinTimeMs, 0, 600000);
  patch[`alerts.${alert.id}.severity`] = severity;
}

export function buildAlertConfigPatch(input: AlertConfigInput): JsonRecord {
  const patch: JsonRecord = {};

  for (const alert of input.alerts) {
    if (alert.id === "anchor_distance") {
      applyAlertCommonFields(patch, alert, 20000, alert.severity);
      patch["alerts.anchor_distance.max_distance_m"] = FIXED_ANCHOR_DISTANCE_MAX_M;
      continue;
    }
    if (alert.id === "boating_area") {
      applyAlertCommonFields(patch, alert, 20000, alert.severity);
      patch["alerts.boating_area.polygon"] = FIXED_BOATING_AREA_POLYGON;
      continue;
    }
    if (alert.id === "wind_strength") {
      applyAlertCommonFields(patch, alert, 20000, alert.severity);
      patch["alerts.wind_strength.max_tws"] = parseNumberInput(alert.maxTwsKn, 30, 0, 200);
      continue;
    }
    if (alert.id === "depth") {
      applyAlertCommonFields(patch, alert, 10000, alert.severity);
      patch["alerts.depth.min_depth"] = parseNumberInput(alert.minDepthM, 2, 0, 500);
      continue;
    }
    if (alert.id === "data_outdated") {
      applyAlertCommonFields(patch, alert, 5000, alert.severity);
      patch["alerts.data_outdated.min_age"] = parseIntegerInput(alert.minAgeMs, 5000, 0, 600000);
    }
  }

  return patch;
}

export function buildProfilesConfigPatch(input: ProfilesConfigInput): JsonRecord {
  return {
    "profiles.mode": input.profilesMode,
    "profiles.day.colorScheme": input.profileDayColorScheme,
    "profiles.day.brightnessPct": parseIntegerInput(input.profileDayBrightnessPct, 100, 1, 100),
    "profiles.day.outputProfile": input.profileDayOutputProfile.trim() || "normal",
    "profiles.night.colorScheme": input.profileNightColorScheme,
    "profiles.night.brightnessPct": parseIntegerInput(input.profileNightBrightnessPct, 20, 1, 100),
    "profiles.night.outputProfile": input.profileNightOutputProfile.trim() || "night",
    "profiles.autoSwitch.source": input.profileAutoSwitchSource,
    "profiles.autoSwitch.dayStartLocal": input.profileDayStartLocal,
    "profiles.autoSwitch.nightStartLocal": input.profileNightStartLocal,
  };
}
