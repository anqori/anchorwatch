import type { ConfigSectionId, Mode, ViewId } from "./types";

export const MODE_KEY = "anchorwatch.mode";
export const MODE_FAKE: Mode = "fake";
export const MODE_DEVICE: Mode = "device";
export const RELAY_BASE_URL_KEY = "anchorwatch.relay_base_url";
export const DEFAULT_RELAY_BASE_URL = (import.meta.env.VITE_RELAY_BASE_URL ?? "").trim();
export const PWA_BUILD_VERSION = (import.meta.env.VITE_BUILD_VERSION ?? "run-unknown").trim() || "run-unknown";
export const BOAT_ID_KEY = "anchorwatch.boat_id";
export const BOAT_SECRET_KEY = "anchorwatch.boat_secret";
export const BLE_CONNECTED_ONCE_KEY = "anchorwatch.ble_connected_once";
export const WIFI_CFG_VERSION_KEY = "anchorwatch.wifi_cfg_version";
export const PHONE_ID_KEY = "anchorwatch.phone_id";

export const PROTOCOL_VERSION = "am.v1";
export const BLE_SERVICE_UUID = "9f2d0000-87aa-4f4a-a0ea-4d5d4f415354";
export const BLE_CONTROL_TX_UUID = "9f2d0001-87aa-4f4a-a0ea-4d5d4f415354";
export const BLE_EVENT_RX_UUID = "9f2d0002-87aa-4f4a-a0ea-4d5d4f415354";
export const BLE_SNAPSHOT_UUID = "9f2d0003-87aa-4f4a-a0ea-4d5d4f415354";
export const BLE_AUTH_UUID = "9f2d0004-87aa-4f4a-a0ea-4d5d4f415354";
export const BLE_CHUNK_MAX_PAYLOAD = 120;
export const BLE_CHUNK_TIMEOUT_MS = 2000;
export const WIFI_SCAN_TIMEOUT_MS = 10000;
export const BLE_LIVE_MAX_AGE_MS = 8000;
export const CLOUD_POLL_MS = 5000;
export const CLOUD_HEALTH_POLL_MS = 60000;
export const TRACK_MAX_POINTS = 320;
export const TRACK_SNAPSHOT_LIMIT = 240;

export const MAPTILER_API_KEY = (import.meta.env.VITE_MAPTILER_API_KEY ?? "").trim();
export const MAPTILER_STYLE_MAP = (import.meta.env.VITE_MAPTILER_STYLE_MAP ?? "streets-v2").trim();
export const MAPTILER_STYLE_SATELLITE = (import.meta.env.VITE_MAPTILER_STYLE_SATELLITE ?? "hybrid").trim();
export const MAPTILER_DEFAULT_CENTER: [number, number] = [10.1402, 54.3201];
export const MAPTILER_DEFAULT_ZOOM = 14;
export const MAPTILER_MAX_PAN_DISTANCE_M = 550;
export const MAPTILER_MAX_VISIBLE_AREA_M2 = 1_000_000;
export const MAPTILER_MAX_ZOOM = 22;
export const WEB_MERCATOR_EARTH_CIRCUMFERENCE_M = 40_075_016.68557849;
export const WEB_MERCATOR_TILE_SIZE = 256;

export const VIEW_TABS: Array<{ id: ViewId; label: string; icon: string }> = [
  { id: "summary", label: "Summary", icon: "home" },
  { id: "satellite", label: "Satellite", icon: "satellite_alt" },
  { id: "map", label: "Map", icon: "map" },
  { id: "radar", label: "Radar", icon: "radar" },
  { id: "config", label: "Config", icon: "settings" },
];

export const CONFIG_SECTIONS: Array<{ id: ConfigSectionId; label: string; icon: string }> = [
  { id: "device", label: "Device / Bluetooth", icon: "bluetooth" },
  { id: "internet", label: "Internet & WLAN", icon: "wifi" },
  { id: "connection", label: "Connection", icon: "sensors" },
  { id: "anchor", label: "Anchor", icon: "anchor" },
  { id: "triggers", label: "Triggers", icon: "warning" },
  { id: "profiles", label: "Profiles", icon: "tune" },
  { id: "information", label: "Information / Version", icon: "info" },
];

export const TABBAR_LINK_COLORS = {
  textMaterial: "text-md-light-on-surface-variant dark:text-md-dark-on-surface-variant",
  textActiveMaterial: "text-md-light-primary dark:text-md-dark-primary",
  iconBgMaterial: "",
  iconBgActiveMaterial: "",
};
