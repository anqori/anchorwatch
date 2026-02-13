import type {
  AnchorMode,
  AutoSwitchSource,
  ColorScheme,
  JsonRecord,
  ProfileMode,
  Severity,
  ZoneType,
} from "../core/types";
import {
  parseIntegerInput,
  parseNumberInput,
  parsePolygonPoints,
  toFiniteNumber,
} from "./data-utils";

export interface AnchorConfigInput {
  anchorMode: AnchorMode;
  anchorOffsetDistanceM: string;
  anchorOffsetAngleDeg: string;
  autoModeEnabled: boolean;
  autoModeMinForwardSogKn: string;
  autoModeStallMaxSogKn: string;
  autoModeReverseMinSogKn: string;
  autoModeConfirmSeconds: string;
  zoneType: ZoneType;
  zoneRadiusM: string;
  polygonPointsInput: string;
  manualAnchorLat: string;
  manualAnchorLon: string;
}

export interface TriggerConfigInput {
  triggerWindAboveEnabled: boolean;
  triggerWindAboveThresholdKn: string;
  triggerWindAboveHoldMs: string;
  triggerWindAboveSeverity: Severity;
  triggerOutsideAreaEnabled: boolean;
  triggerOutsideAreaHoldMs: string;
  triggerOutsideAreaSeverity: Severity;
  triggerGpsAgeEnabled: boolean;
  triggerGpsAgeMaxMs: string;
  triggerGpsAgeHoldMs: string;
  triggerGpsAgeSeverity: Severity;
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
  const patch: JsonRecord = {
    "anchor.defaultSetMode": input.anchorMode,
    "anchor.offset.distanceM": parseNumberInput(input.anchorOffsetDistanceM, 8, 0, 2000),
    "anchor.offset.angleDeg": parseNumberInput(input.anchorOffsetAngleDeg, 210, 0, 359.99),
    "anchor.autoMode.enabled": input.autoModeEnabled,
    "anchor.autoMode.minForwardSogKn": parseNumberInput(input.autoModeMinForwardSogKn, 0.8, 0, 20),
    "anchor.autoMode.stallMaxSogKn": parseNumberInput(input.autoModeStallMaxSogKn, 0.3, 0, 20),
    "anchor.autoMode.reverseMinSogKn": parseNumberInput(input.autoModeReverseMinSogKn, 0.4, 0, 20),
    "anchor.autoMode.confirmSeconds": parseIntegerInput(input.autoModeConfirmSeconds, 20, 1, 300),
    "zone.type": input.zoneType,
  };

  if (input.zoneType === "circle") {
    patch["zone.circle.radiusM"] = parseNumberInput(input.zoneRadiusM, 45, 1, 3000);
  } else {
    const points = parsePolygonPoints(input.polygonPointsInput);
    if (points.length < 3) {
      throw new Error("Polygon mode requires at least 3 points (lat,lon per line)");
    }
    patch["zone.polygon.points"] = points;
  }

  return patch;
}

export function manualAnchorLogMessage(input: AnchorConfigInput): string | null {
  if (input.anchorMode !== "manual") {
    return null;
  }

  const manualLat = toFiniteNumber(input.manualAnchorLat);
  const manualLon = toFiniteNumber(input.manualAnchorLon);
  if (manualLat !== null && manualLon !== null) {
    return `manual anchor draft captured at lat=${manualLat.toFixed(5)}, lon=${manualLon.toFixed(5)} (runtime command id pending)`;
  }
  return "manual mode selected; runtime drag/drop command not yet wired in protocol scaffold";
}

export function buildTriggerConfigPatch(input: TriggerConfigInput): JsonRecord {
  return {
    "triggers.wind_above.enabled": input.triggerWindAboveEnabled,
    "triggers.wind_above.thresholdKn": parseNumberInput(input.triggerWindAboveThresholdKn, 30, 0, 150),
    "triggers.wind_above.holdMs": parseIntegerInput(input.triggerWindAboveHoldMs, 15000, 0, 600000),
    "triggers.wind_above.severity": input.triggerWindAboveSeverity,
    "triggers.outside_area.enabled": input.triggerOutsideAreaEnabled,
    "triggers.outside_area.holdMs": parseIntegerInput(input.triggerOutsideAreaHoldMs, 10000, 0, 600000),
    "triggers.outside_area.severity": input.triggerOutsideAreaSeverity,
    "triggers.gps_age.enabled": input.triggerGpsAgeEnabled,
    "triggers.gps_age.maxAgeMs": parseIntegerInput(input.triggerGpsAgeMaxMs, 5000, 0, 600000),
    "triggers.gps_age.holdMs": parseIntegerInput(input.triggerGpsAgeHoldMs, 5000, 0, 600000),
    "triggers.gps_age.severity": input.triggerGpsAgeSeverity,
  };
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
