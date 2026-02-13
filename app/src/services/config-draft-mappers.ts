import type { ConfigDraftsState } from "../core/types";
import type {
  AlertConfigInput,
  AnchorConfigInput,
  ProfilesConfigInput,
} from "./config-patch-builders";

export function mapAnchorDraftToConfigInput(anchor: ConfigDraftsState["anchor"]): AnchorConfigInput {
  return {
    autoModeMinForwardSogKn: anchor.autoModeMinForwardSogKn,
    autoModeStallMaxSogKn: anchor.autoModeStallMaxSogKn,
    autoModeReverseMinSogKn: anchor.autoModeReverseMinSogKn,
    autoModeConfirmSeconds: anchor.autoModeConfirmSeconds,
  };
}

export function mapAlertDraftToConfigInput(alerts: ConfigDraftsState["alerts"]): AlertConfigInput {
  return {
    alerts: [
      alerts.anchor_distance,
      alerts.boating_area,
      alerts.wind_strength,
      alerts.depth,
      alerts.data_outdated,
    ],
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
