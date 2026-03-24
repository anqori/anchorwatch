import type { ConfigDraftsState } from "../core/types";
import type {
  AlarmConfigInput,
  AnchorSettingsInput,
  CloudCredentialsInput,
  ObstaclesConfigInput,
  ProfilesConfigInput,
  SystemConfigInput,
  WlanConfigInput,
} from "./config-patch-builders";

export function mapAnchorDraftToConfigInput(
  anchor: ConfigDraftsState["anchor"],
  version: number,
): AnchorSettingsInput {
  return {
    version,
    allowedRangeM: anchor.allowedRangeM,
  };
}

export function mapAlertDraftToConfigInput(
  alerts: ConfigDraftsState["alerts"],
  version: number,
): AlarmConfigInput {
  return {
    version,
    alerts: [
      alerts.anchor_distance,
      alerts.obstacle_close,
      alerts.wind_above,
      alerts.depth_below,
      alerts.data_outdated,
    ],
  };
}

export function mapObstaclesDraftToConfigInput(
  obstacles: ConfigDraftsState["obstacles"],
  version: number,
): ObstaclesConfigInput {
  return {
    version,
    items: obstacles.items,
  };
}

export function mapProfilesDraftToConfigInput(
  profiles: ConfigDraftsState["profiles"],
): ProfilesConfigInput {
  return {
    version: profiles.version ?? 0,
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

export function mapSystemDraftToConfigInput(
  system: ConfigDraftsState["system"],
  version: number,
): SystemConfigInput {
  return {
    version,
    runtimeMode: system.runtimeMode,
  };
}

export function mapWlanDraftToConfigInput(input: {
  version: number;
  ssid: string;
  passphrase: string;
  security: "open" | "wpa2" | "wpa3" | "unknown";
  country: string;
  hidden: boolean;
}): WlanConfigInput {
  return {
    version: input.version,
    ssid: input.ssid,
    passphrase: input.passphrase,
    security: input.security,
    country: input.country,
    hidden: input.hidden,
  };
}

export function mapCloudCredentialsToUpdateInput(
  version: number,
  boatId: string,
  cloudSecret: string,
): CloudCredentialsInput {
  return {
    version,
    boatId,
    cloudSecret,
  };
}
