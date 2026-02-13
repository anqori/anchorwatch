import type { ConfigDraftsState } from "../core/types";
import type {
  AnchorConfigInput,
  ProfilesConfigInput,
  TriggerConfigInput,
} from "./config-patch-builders";

export function mapAnchorDraftToConfigInput(anchor: ConfigDraftsState["anchor"]): AnchorConfigInput {
  return {
    anchorMode: anchor.mode,
    anchorOffsetDistanceM: anchor.offsetDistanceM,
    anchorOffsetAngleDeg: anchor.offsetAngleDeg,
    autoModeEnabled: anchor.autoModeEnabled,
    autoModeMinForwardSogKn: anchor.autoModeMinForwardSogKn,
    autoModeStallMaxSogKn: anchor.autoModeStallMaxSogKn,
    autoModeReverseMinSogKn: anchor.autoModeReverseMinSogKn,
    autoModeConfirmSeconds: anchor.autoModeConfirmSeconds,
    zoneType: anchor.zoneType,
    zoneRadiusM: anchor.zoneRadiusM,
    polygonPointsInput: anchor.polygonPointsInput,
    manualAnchorLat: anchor.manualAnchorLat,
    manualAnchorLon: anchor.manualAnchorLon,
  };
}

export function mapTriggerDraftToConfigInput(triggers: ConfigDraftsState["triggers"]): TriggerConfigInput {
  return {
    triggerWindAboveEnabled: triggers.windAboveEnabled,
    triggerWindAboveThresholdKn: triggers.windAboveThresholdKn,
    triggerWindAboveHoldMs: triggers.windAboveHoldMs,
    triggerWindAboveSeverity: triggers.windAboveSeverity,
    triggerOutsideAreaEnabled: triggers.outsideAreaEnabled,
    triggerOutsideAreaHoldMs: triggers.outsideAreaHoldMs,
    triggerOutsideAreaSeverity: triggers.outsideAreaSeverity,
    triggerGpsAgeEnabled: triggers.gpsAgeEnabled,
    triggerGpsAgeMaxMs: triggers.gpsAgeMaxMs,
    triggerGpsAgeHoldMs: triggers.gpsAgeHoldMs,
    triggerGpsAgeSeverity: triggers.gpsAgeSeverity,
  };
}

export function mapProfilesDraftToConfigInput(profiles: ConfigDraftsState["profiles"]): ProfilesConfigInput {
  return {
    profilesMode: profiles.mode,
    profileDayColorScheme: profiles.dayColorScheme,
    profileDayBrightnessPct: profiles.dayBrightnessPct,
    profileDayOutputProfile: profiles.dayOutputProfile,
    profileNightColorScheme: profiles.nightColorScheme,
    profileNightBrightnessPct: profiles.nightBrightnessPct,
    profileNightOutputProfile: profiles.nightOutputProfile,
    profileAutoSwitchSource: profiles.autoSwitchSource,
    profileDayStartLocal: profiles.dayStartLocal,
    profileNightStartLocal: profiles.nightStartLocal,
  };
}
