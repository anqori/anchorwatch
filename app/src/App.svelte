<script lang="ts">
  import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
  import { onDestroy, onMount } from "svelte";
  import {
    Map as MapTilerMap,
    config as maptilerConfig,
    type GeoJSONSource,
  } from "@maptiler/sdk";
  import {
    App as KonstaApp,
    Button as KonstaButton,
    Icon,
    Page as KonstaPage,
    Tabbar,
    TabbarLink,
  } from "konsta/svelte";
  import SummaryPage from "./features/summary/SummaryPage.svelte";
  import SettingsHomePage from "./features/config/SettingsHomePage.svelte";
  import OnboardingPage from "./features/config/OnboardingPage.svelte";
  import AnchorConfigPage from "./features/config/AnchorConfigPage.svelte";
  import TriggersConfigPage from "./features/config/TriggersConfigPage.svelte";
  import ProfilesConfigPage from "./features/config/ProfilesConfigPage.svelte";
  import SatellitePage from "./features/map/SatellitePage.svelte";
  import MapPage from "./features/map/MapPage.svelte";
  import RadarPage from "./features/radar/RadarPage.svelte";

  type Mode = "fake" | "device";
  type InboundSource = "ble/eventRx" | "ble/snapshot" | "cloud/status.snapshot";
  type PillClass = "ok" | "warn" | "alarm";
  type ViewId = "summary" | "satellite" | "map" | "radar" | "config";
  type ConfigSectionId = "onboarding" | "anchor" | "triggers" | "profiles";
  type ConfigViewId = "settings" | ConfigSectionId;
  type OnboardingStep = 1 | 2 | 3;
  type AnchorMode = "current" | "offset" | "auto" | "manual";
  type ZoneType = "circle" | "polygon";
  type Severity = "warning" | "alarm";
  type ProfileMode = "manual" | "auto";
  type ColorScheme = "full" | "red" | "blue";
  type AutoSwitchSource = "time" | "sun";
  type WifiSecurity = "open" | "wpa2" | "wpa3" | "unknown";

  type JsonRecord = Record<string, unknown>;

  interface TrackPoint {
    ts: number;
    lat: number;
    lon: number;
    sogKn: number;
    cogDeg: number;
    headingDeg: number;
  }

  interface WifiScanNetwork {
    ssid: string;
    security: WifiSecurity;
    rssi: number | null;
    channel: number | null;
    hidden: boolean;
  }

  interface Envelope {
    ver?: string;
    msgType?: string;
    msgId?: string;
    boatId?: string;
    deviceId?: string;
    seq?: number;
    ts?: number;
    requiresAck?: boolean;
    payload?: JsonRecord;
  }

  interface PendingAck {
    resolve: (payload: JsonRecord) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }

  interface ChunkAssembly {
    partCount: number;
    parts: Array<string | null>;
    updatedAt: number;
  }

  interface BleState {
    device: BluetoothDevice | null;
    server: BluetoothRemoteGATTServer | null;
    service: BluetoothRemoteGATTService | null;
    controlTx: BluetoothRemoteGATTCharacteristic | null;
    eventRx: BluetoothRemoteGATTCharacteristic | null;
    snapshot: BluetoothRemoteGATTCharacteristic | null;
    auth: BluetoothRemoteGATTCharacteristic | null;
    connected: boolean;
    seq: number;
    pendingAcks: Map<string, PendingAck>;
    chunkAssemblies: Map<string, ChunkAssembly>;
    authState: JsonRecord | null;
  }

  const MODE_KEY = "anchorwatch.mode";
  const MODE_FAKE: Mode = "fake";
  const MODE_DEVICE: Mode = "device";
  const RELAY_BASE_URL_KEY = "anchorwatch.relay_base_url";
  const DEFAULT_RELAY_BASE_URL = (import.meta.env.VITE_RELAY_BASE_URL ?? "").trim();
  const PWA_BUILD_VERSION = (import.meta.env.VITE_BUILD_VERSION ?? "run-unknown").trim() || "run-unknown";
  const BOAT_ID_KEY = "anchorwatch.boat_id";
  const BOAT_SECRET_KEY = "anchorwatch.boat_secret";
  const WIFI_CFG_VERSION_KEY = "anchorwatch.wifi_cfg_version";
  const PHONE_ID_KEY = "anchorwatch.phone_id";

  const PROTOCOL_VERSION = "am.v1";
  const BLE_SERVICE_UUID = "9f2d0000-87aa-4f4a-a0ea-4d5d4f415354";
  const BLE_CONTROL_TX_UUID = "9f2d0001-87aa-4f4a-a0ea-4d5d4f415354";
  const BLE_EVENT_RX_UUID = "9f2d0002-87aa-4f4a-a0ea-4d5d4f415354";
  const BLE_SNAPSHOT_UUID = "9f2d0003-87aa-4f4a-a0ea-4d5d4f415354";
  const BLE_AUTH_UUID = "9f2d0004-87aa-4f4a-a0ea-4d5d4f415354";
  const BLE_CHUNK_MAX_PAYLOAD = 120;
  const BLE_CHUNK_TIMEOUT_MS = 2000;
  const WIFI_SCAN_TIMEOUT_MS = 10000;
  const BLE_LIVE_MAX_AGE_MS = 8000;
  const CLOUD_POLL_MS = 5000;
  const CLOUD_HEALTH_POLL_MS = 60000;
  const TRACK_MAX_POINTS = 320;
  const TRACK_SNAPSHOT_LIMIT = 240;
  const MAPTILER_API_KEY = (import.meta.env.VITE_MAPTILER_API_KEY ?? "").trim();
  const MAPTILER_STYLE_MAP = (import.meta.env.VITE_MAPTILER_STYLE_MAP ?? "streets-v2").trim();
  const MAPTILER_STYLE_SATELLITE = (import.meta.env.VITE_MAPTILER_STYLE_SATELLITE ?? "hybrid").trim();
  const MAPTILER_DEFAULT_CENTER: [number, number] = [10.1402, 54.3201];
  const MAPTILER_DEFAULT_ZOOM = 14;
  const MAPTILER_MAX_PAN_DISTANCE_M = 550;
  const MAPTILER_MAX_VISIBLE_AREA_M2 = 1_000_000;
  const MAPTILER_MAX_ZOOM = 22;
  const WEB_MERCATOR_EARTH_CIRCUMFERENCE_M = 40_075_016.68557849;
  const WEB_MERCATOR_TILE_SIZE = 256;

  const VIEW_TABS: Array<{ id: ViewId; label: string; icon: string }> = [
    { id: "summary", label: "Summary", icon: "home" },
    { id: "satellite", label: "Satellite", icon: "satellite_alt" },
    { id: "map", label: "Map", icon: "map" },
    { id: "radar", label: "Radar", icon: "radar" },
    { id: "config", label: "Config", icon: "settings" },
  ];

  const CONFIG_SECTIONS: Array<{ id: ConfigSectionId; label: string; icon: string }> = [
    { id: "onboarding", label: "Connection", icon: "bluetooth" },
    { id: "anchor", label: "Anchor", icon: "anchor" },
    { id: "triggers", label: "Triggers", icon: "warning" },
    { id: "profiles", label: "Profiles", icon: "tune" },
  ];

  const TABBAR_LINK_COLORS = {
    textMaterial: "text-md-light-on-surface-variant dark:text-md-dark-on-surface-variant",
    textActiveMaterial: "text-md-light-primary dark:text-md-dark-primary",
    iconBgMaterial: "",
    iconBgActiveMaterial: "",
  };

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const ble: BleState = {
    device: null,
    server: null,
    service: null,
    controlTx: null,
    eventRx: null,
    snapshot: null,
    auth: null,
    connected: false,
    seq: 1,
    pendingAcks: new Map(),
    chunkAssemblies: new Map(),
    authState: null,
  };

  let bootMs = performance.now();
  let mode: Mode = loadMode();
  let pollBusy = false;
  let lastTickMs = 0;
  let lastCloudPollMs = 0;
  let lastCloudHealthPollMs = 0;
  let lastBleMessageAtMs = 0;

  let latestState: JsonRecord = {};
  let latestStateSource = "--";
  let latestStateUpdatedAtMs = 0;

  let gpsAgeText = "--";
  let dataAgeText = "--";
  let depthText = "--";
  let windText = "--";

  let statePillText = "BOOT";
  let statePillClass: PillClass = "ok";
  let stateSourceText = "Source: --";

  let installStatus = "";
  let bleSupportedText = "--";
  let bleStatusText = "disconnected";
  let boatIdText = "--";
  let secretStatusText = "not stored";
  let cloudStatusText = "not checked";
  let relayResult = "No request yet.";
  let pwaVersionText = PWA_BUILD_VERSION;
  let firmwareVersionText = "--";
  let cloudVersionText = "--";

  let relayBaseUrlInput = "";
  let wifiSsid = "";
  let wifiPass = "";
  let wifiSecurity: WifiSecurity = "wpa2";
  let wifiCountry = "";
  let wifiScanRequestId = "";
  let wifiScanInFlight = false;
  let wifiScanStatusText = "Scan for available WLAN networks.";
  let wifiScanErrorText = "";
  let availableWifiNetworks: WifiScanNetwork[] = [];
  let selectedWifiSsid = "";
  let selectedWifiNetwork: WifiScanNetwork | null = null;
  let onboardingStep: OnboardingStep = 1;
  let onboardingWifiSsid = "--";
  let onboardingWifiConnected = false;
  let onboardingWifiRssiText = "--";
  let onboardingWifiErrorText = "";
  let onboardingWifiStateText = "Waiting for Wi-Fi status...";
  let activeView: ViewId = "summary";
  let activeConfigView: ConfigViewId = "settings";
  let navigationDepth = 0;
  let suppressedPopEvents = 0;
  let trackStatusText = "No track yet";
  let trackPoints: TrackPoint[] = [];
  let currentLatText = "--";
  let currentLonText = "--";
  let currentSogText = "--";
  let currentCogText = "--";
  let currentHeadingText = "--";
  let maptilerStatusText = MAPTILER_API_KEY ? "Map ready state pending." : "MapTiler token missing.";
  let maptilerMapContainer: HTMLDivElement | null = null;
  let maptilerSatelliteContainer: HTMLDivElement | null = null;
  let maptilerMap: MapTilerMap | null = null;
  let maptilerSatellite: MapTilerMap | null = null;
  let maptilerLimitsApplyingMap = false;
  let maptilerLimitsApplyingSatellite = false;
  let radarTargetX = 110;
  let radarTargetY = 110;
  let radarDistanceText = "--";
  let radarBearingText = "--";

  let notificationPermissionText = "not checked";
  let notificationStatusText = "No notification checks yet.";

  let anchorMode: AnchorMode = "offset";
  let anchorOffsetDistanceM = "8.0";
  let anchorOffsetAngleDeg = "210.0";
  let autoModeEnabled = true;
  let autoModeMinForwardSogKn = "0.8";
  let autoModeStallMaxSogKn = "0.3";
  let autoModeReverseMinSogKn = "0.4";
  let autoModeConfirmSeconds = "20";
  let zoneType: ZoneType = "circle";
  let zoneRadiusM = "45.0";
  let polygonPointsInput = "54.3201,10.1402\n54.3208,10.1413\n54.3198,10.1420";
  let manualAnchorLat = "";
  let manualAnchorLon = "";

  let triggerWindAboveEnabled = true;
  let triggerWindAboveThresholdKn = "30.0";
  let triggerWindAboveHoldMs = "15000";
  let triggerWindAboveSeverity: Severity = "warning";
  let triggerOutsideAreaEnabled = true;
  let triggerOutsideAreaHoldMs = "10000";
  let triggerOutsideAreaSeverity: Severity = "alarm";
  let triggerGpsAgeEnabled = true;
  let triggerGpsAgeMaxMs = "5000";
  let triggerGpsAgeHoldMs = "5000";
  let triggerGpsAgeSeverity: Severity = "warning";

  let profilesMode: ProfileMode = "auto";
  let profileDayColorScheme: ColorScheme = "full";
  let profileDayBrightnessPct = "100";
  let profileDayOutputProfile = "normal";
  let profileNightColorScheme: ColorScheme = "red";
  let profileNightBrightnessPct = "20";
  let profileNightOutputProfile = "night";
  let profileAutoSwitchSource: AutoSwitchSource = "time";
  let profileDayStartLocal = "07:00";
  let profileNightStartLocal = "21:30";

  let logLines: string[] = [];

  let tickInterval: ReturnType<typeof setInterval> | null = null;
  let wifiScanTimeout: ReturnType<typeof setTimeout> | null = null;

  $: onboardingLogText = logLines.join("\n");
  $: isFullScreenVizView = activeView === "satellite" || activeView === "map" || activeView === "radar";
  $: onboardingStepLabel = `Step ${onboardingStep} of 3`;
  $: onboardingStepTitle = onboardingStep === 1
    ? "Connect via Bluetooth"
    : onboardingStep === 2
      ? "Wi-Fi Settings"
      : "Wi-Fi Connection Status";

  $: {
    const wifiStatus = readOnboardingWifiStatus();
    onboardingWifiConnected = wifiStatus.connected;
    onboardingWifiSsid = wifiStatus.ssid || "--";
    onboardingWifiRssiText = wifiStatus.rssi === null ? "--" : `${wifiStatus.rssi} dBm`;
    onboardingWifiErrorText = wifiStatus.error;

    if (wifiStatus.connected) {
      onboardingWifiStateText = `Connected to ${onboardingWifiSsid}`;
    } else if (wifiStatus.error) {
      onboardingWifiStateText = `Not connected (${wifiStatus.error})`;
    } else {
      onboardingWifiStateText = "Connecting or waiting for Wi-Fi telemetry...";
    }
  }

  $: selectedWifiNetwork = availableWifiNetworks.find((network) => network.ssid === selectedWifiSsid) ?? null;
  $: firmwareVersionText = readFirmwareVersionFromState();

  function isObject(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function toFiniteNumber(value: unknown): number | null {
    const asNumber = Number(value);
    return Number.isFinite(asNumber) ? asNumber : null;
  }

  function clampNumber(value: number, minValue: number, maxValue: number): number {
    return Math.min(maxValue, Math.max(minValue, value));
  }

  function parseNumberInput(raw: string, fallback: number, minValue: number, maxValue: number): number {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return clampNumber(parsed, minValue, maxValue);
  }

  function parseIntegerInput(raw: string, fallback: number, minValue: number, maxValue: number): number {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return clampNumber(parsed, minValue, maxValue);
  }

  function normalizeWifiSecurity(value: unknown): WifiSecurity {
    const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (raw === "open") {
      return "open";
    }
    if (raw === "wpa3" || raw === "wpa3-psk" || raw === "wpa3_psk") {
      return "wpa3";
    }
    if (raw === "wpa2" || raw === "wpa2-psk" || raw === "wpa2_psk") {
      return "wpa2";
    }
    return "unknown";
  }

  function formatWifiSecurity(security: WifiSecurity): string {
    if (security === "open") {
      return "OPEN";
    }
    if (security === "wpa3") {
      return "WPA3";
    }
    if (security === "wpa2") {
      return "WPA2";
    }
    return "UNKNOWN";
  }

  function parseWifiScanNetworks(value: unknown): WifiScanNetwork[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const strongestBySsid = new Map<string, WifiScanNetwork>();
    for (const candidate of value) {
      if (!isObject(candidate)) {
        continue;
      }

      const ssid = typeof candidate.ssid === "string" ? candidate.ssid.trim() : "";
      if (!ssid) {
        continue;
      }

      const network: WifiScanNetwork = {
        ssid,
        security: normalizeWifiSecurity(candidate.security),
        rssi: toFiniteNumber(candidate.rssi),
        channel: toFiniteNumber(candidate.channel),
        hidden: candidate.hidden === true,
      };

      const existing = strongestBySsid.get(ssid);
      if (!existing) {
        strongestBySsid.set(ssid, network);
        continue;
      }

      const existingScore = existing.rssi ?? -999;
      const candidateScore = network.rssi ?? -999;
      if (candidateScore > existingScore) {
        strongestBySsid.set(ssid, network);
      }
    }

    return Array.from(strongestBySsid.values()).sort((a, b) => {
      const rssiA = a.rssi ?? -999;
      const rssiB = b.rssi ?? -999;
      if (rssiA !== rssiB) {
        return rssiB - rssiA;
      }
      return a.ssid.localeCompare(b.ssid);
    });
  }

  function applyWifiScanNetworks(networks: WifiScanNetwork[]): void {
    availableWifiNetworks = networks;
    if (!networks.some((network) => network.ssid === selectedWifiSsid)) {
      selectedWifiSsid = "";
    }

    if (wifiSsid && !selectedWifiSsid) {
      const match = networks.find((network) => network.ssid === wifiSsid);
      if (match) {
        selectedWifiSsid = match.ssid;
      }
    }
  }

  function selectWifiNetwork(network: WifiScanNetwork): void {
    selectedWifiSsid = network.ssid;
    wifiSsid = network.ssid;
    if (network.security !== "unknown") {
      wifiSecurity = network.security;
    }
    if (network.security === "open") {
      wifiPass = "";
    }
    wifiScanErrorText = "";
  }

  function readOnboardingWifiStatus(): { connected: boolean; ssid: string; rssi: number | null; error: string } {
    const system = isObject(latestState.system) ? latestState.system : {};
    const wifi = isObject(system.wifi) ? system.wifi : {};
    const connected = wifi.connected === true;
    const ssid = typeof wifi.ssid === "string" ? wifi.ssid.trim() : "";
    const rssi = toFiniteNumber(wifi.rssi);
    const rawError = typeof wifi.lastError === "string" ? wifi.lastError.trim() : "";
    const error = connected || rawError.toLowerCase() === "connecting" ? "" : rawError;
    return { connected, ssid, rssi, error };
  }

  function readFirmwareVersionFromState(): string {
    const system = isObject(latestState.system) ? latestState.system : {};
    const firmware = isObject(system.firmware) ? system.firmware : {};
    const version = typeof firmware.version === "string" ? firmware.version.trim() : "";
    return version || "--";
  }

  function prefillWifiSettingsFromCurrentState(): void {
    const wifiStatus = readOnboardingWifiStatus();
    if (wifiStatus.ssid) {
      wifiSsid = wifiStatus.ssid;
      selectedWifiSsid = wifiStatus.ssid;
    }
    if (!wifiCountry.trim()) {
      wifiCountry = "DE";
    }
    wifiScanErrorText = "";
    wifiScanStatusText = "Scan for available WLAN networks.";
  }

  function parsePolygonPoints(raw: string): Array<{ lat: number; lon: number }> {
    const lines = raw
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const points: Array<{ lat: number; lon: number }> = [];

    for (const line of lines) {
      const [rawLat, rawLon] = line.split(",").map((part) => part.trim());
      const lat = Number(rawLat);
      const lon = Number(rawLon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        throw new Error(`invalid polygon point: "${line}"`);
      }
      points.push({ lat, lon });
    }
    return points;
  }

  function nextConfigVersion(): number {
    const current = Number(loadStoredString(WIFI_CFG_VERSION_KEY, "0"));
    if (!Number.isInteger(current) || current < 0) {
      return 1;
    }
    return current + 1;
  }

  function setConfigVersion(version: number): void {
    saveStoredString(WIFI_CFG_VERSION_KEY, String(version));
  }

  function buildTrackGeoJson(points: TrackPoint[]): FeatureCollection<Geometry> {
    const coordinates: Position[] = points.map((point) => [point.lon, point.lat]);
    const features: Array<Feature<Geometry>> = [];

    if (coordinates.length >= 2) {
      features.push({
        type: "Feature",
        properties: { kind: "track" },
        geometry: {
          type: "LineString",
          coordinates,
        },
      });
    }

    if (coordinates.length >= 1) {
      features.push({
        type: "Feature",
        properties: { kind: "current" },
        geometry: {
          type: "Point",
          coordinates: coordinates[coordinates.length - 1],
        },
      });
    }

    return {
      type: "FeatureCollection",
      features,
    };
  }

  function maptilerIds(kind: "map" | "satellite"): { source: string; lineLayer: string; pointLayer: string } {
    const prefix = kind === "map" ? "aw-map" : "aw-satellite";
    return {
      source: `${prefix}-track-source`,
      lineLayer: `${prefix}-track-line`,
      pointLayer: `${prefix}-track-point`,
    };
  }

  function getMapTilerInstance(kind: "map" | "satellite"): MapTilerMap | null {
    return kind === "map" ? maptilerMap : maptilerSatellite;
  }

  function setMapTilerInstance(kind: "map" | "satellite", map: MapTilerMap | null): void {
    if (kind === "map") {
      maptilerMap = map;
      return;
    }
    maptilerSatellite = map;
  }

  function getMapTilerContainer(kind: "map" | "satellite"): HTMLDivElement | null {
    return kind === "map" ? maptilerMapContainer : maptilerSatelliteContainer;
  }

  function resolveMapTilerStyleUrl(styleRef: string): string {
    const trimmed = styleRef.trim();
    if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
      if (trimmed.includes("key=")) {
        return trimmed;
      }
      const joiner = trimmed.includes("?") ? "&" : "?";
      return `${trimmed}${joiner}key=${encodeURIComponent(MAPTILER_API_KEY)}`;
    }
    return `https://api.maptiler.com/maps/${encodeURIComponent(trimmed)}/style.json?key=${encodeURIComponent(MAPTILER_API_KEY)}`;
  }

  function getMapTilerAnchorPoint(): [number, number] {
    const latestPoint = trackPoints[trackPoints.length - 1];
    if (latestPoint) {
      return [latestPoint.lon, latestPoint.lat];
    }
    return MAPTILER_DEFAULT_CENTER;
  }

  function buildMapTilerPanBounds(anchorPoint: [number, number], radiusM: number): [[number, number], [number, number]] {
    const [anchorLon, anchorLat] = anchorPoint;
    const latDelta = radiusM / 111_320;
    const cosLat = Math.max(0.01, Math.cos((anchorLat * Math.PI) / 180));
    const lonDelta = radiusM / (111_320 * cosLat);
    return [
      [anchorLon - lonDelta, anchorLat - latDelta],
      [anchorLon + lonDelta, anchorLat + latDelta],
    ];
  }

  function mapTilerMinZoomForArea(latitudeDeg: number, widthPx: number, heightPx: number, maxAreaM2: number): number {
    const safeWidth = Math.max(1, widthPx);
    const safeHeight = Math.max(1, heightPx);
    const safeLatFactor = Math.max(0.01, Math.abs(Math.cos((latitudeDeg * Math.PI) / 180)));
    const maxMetersPerPixel = Math.sqrt(maxAreaM2 / (safeWidth * safeHeight));
    const denominator = WEB_MERCATOR_TILE_SIZE * Math.max(0.01, maxMetersPerPixel);
    const zoom = Math.log2((WEB_MERCATOR_EARTH_CIRCUMFERENCE_M * safeLatFactor) / denominator);
    return clampNumber(zoom, 0, MAPTILER_MAX_ZOOM);
  }

  function mapTilerLimitsFlag(kind: "map" | "satellite"): boolean {
    return kind === "map" ? maptilerLimitsApplyingMap : maptilerLimitsApplyingSatellite;
  }

  function setMapTilerLimitsFlag(kind: "map" | "satellite", value: boolean): void {
    if (kind === "map") {
      maptilerLimitsApplyingMap = value;
      return;
    }
    maptilerLimitsApplyingSatellite = value;
  }

  function enforceMapTilerViewportLimits(map: MapTilerMap, kind: "map" | "satellite"): void {
    if (mapTilerLimitsFlag(kind)) {
      return;
    }

    setMapTilerLimitsFlag(kind, true);
    try {
      const anchorPoint = getMapTilerAnchorPoint();
      const panBounds = buildMapTilerPanBounds(anchorPoint, MAPTILER_MAX_PAN_DISTANCE_M);
      const [[minLon, minLat], [maxLon, maxLat]] = panBounds;

      map.setMaxBounds(panBounds);

      const center = map.getCenter();
      const clampedCenter: [number, number] = [
        clampNumber(center.lng, minLon, maxLon),
        clampNumber(center.lat, minLat, maxLat),
      ];
      if (Math.abs(clampedCenter[0] - center.lng) > 0.0000001 || Math.abs(clampedCenter[1] - center.lat) > 0.0000001) {
        map.setCenter(clampedCenter);
      }

      const canvas = map.getCanvas();
      const minZoom = mapTilerMinZoomForArea(clampedCenter[1], canvas.clientWidth, canvas.clientHeight, MAPTILER_MAX_VISIBLE_AREA_M2);
      if (Math.abs(map.getMinZoom() - minZoom) > 0.001) {
        map.setMinZoom(minZoom);
      }
      if (map.getZoom() < minZoom) {
        map.setZoom(minZoom);
      }
    } finally {
      setMapTilerLimitsFlag(kind, false);
    }
  }

  function ensureMapTilerTrackLayers(map: MapTilerMap, kind: "map" | "satellite"): void {
    const ids = maptilerIds(kind);
    if (!map.getSource(ids.source)) {
      map.addSource(ids.source, {
        type: "geojson",
        data: buildTrackGeoJson(trackPoints),
      });
    }
    if (!map.getLayer(ids.lineLayer)) {
      map.addLayer({
        id: ids.lineLayer,
        source: ids.source,
        type: "line",
        filter: ["==", ["get", "kind"], "track"],
        paint: {
          "line-color": kind === "map" ? "#5ce1ff" : "#ffd166",
          "line-width": 3,
          "line-opacity": 0.92,
        },
      });
    }
    if (!map.getLayer(ids.pointLayer)) {
      map.addLayer({
        id: ids.pointLayer,
        source: ids.source,
        type: "circle",
        filter: ["==", ["get", "kind"], "current"],
        paint: {
          "circle-radius": 6,
          "circle-color": "#ffffff",
          "circle-stroke-color": kind === "map" ? "#5ce1ff" : "#ffd166",
          "circle-stroke-width": 2,
        },
      });
    }
  }

  function updateMapTilerTrackData(map: MapTilerMap, kind: "map" | "satellite"): void {
    if (!map.isStyleLoaded()) {
      return;
    }
    ensureMapTilerTrackLayers(map, kind);
    const source = map.getSource(maptilerIds(kind).source) as GeoJSONSource | undefined;
    if (source) {
      source.setData(buildTrackGeoJson(trackPoints));
    }
  }

  function ensureMapTilerView(kind: "map" | "satellite"): void {
    if (!MAPTILER_API_KEY) {
      maptilerStatusText = "MapTiler token missing. Set VITE_MAPTILER_API_KEY in .env and redeploy.";
      return;
    }

    const existing = getMapTilerInstance(kind);
    if (existing) {
      existing.resize();
      updateMapTilerTrackData(existing, kind);
      enforceMapTilerViewportLimits(existing, kind);
      return;
    }

    const container = getMapTilerContainer(kind);
    if (!container) {
      return;
    }

    const latestPoint = trackPoints[trackPoints.length - 1];
    const center: [number, number] = latestPoint
      ? [latestPoint.lon, latestPoint.lat]
      : MAPTILER_DEFAULT_CENTER;

    maptilerConfig.apiKey = MAPTILER_API_KEY;
    const styleRef = kind === "map" ? MAPTILER_STYLE_MAP : MAPTILER_STYLE_SATELLITE;
    const style = resolveMapTilerStyleUrl(styleRef);
    const map = new MapTilerMap({
      container,
      style,
      center,
      zoom: MAPTILER_DEFAULT_ZOOM,
    });

    maptilerStatusText = "Loading map tiles...";
    map.on("load", () => {
      maptilerStatusText = "Map loaded.";
      updateMapTilerTrackData(map, kind);
      enforceMapTilerViewportLimits(map, kind);
      map.resize();
    });
    map.on("moveend", () => {
      enforceMapTilerViewportLimits(map, kind);
    });
    map.on("resize", () => {
      enforceMapTilerViewportLimits(map, kind);
    });
    map.on("error", (event) => {
      const errorText = event.error instanceof Error ? event.error.message : "unknown map error";
      maptilerStatusText = `Map error: ${errorText}`;
    });

    setMapTilerInstance(kind, map);
  }

  function destroyMapTilerView(kind: "map" | "satellite"): void {
    const map = getMapTilerInstance(kind);
    if (!map) {
      return;
    }
    map.remove();
    setMapTilerInstance(kind, null);
  }

  function updateRadarFromTrack(points: TrackPoint[]): void {
    if (points.length < 2) {
      radarTargetX = 110;
      radarTargetY = 110;
      radarDistanceText = "--";
      radarBearingText = "--";
      return;
    }

    const anchor = points[0];
    const current = points[points.length - 1];
    const meanLatRad = ((anchor.lat + current.lat) / 2) * Math.PI / 180;
    const metersPerLat = 111_320;
    const metersPerLon = Math.max(1, 111_320 * Math.cos(meanLatRad));
    const northMeters = (current.lat - anchor.lat) * metersPerLat;
    const eastMeters = (current.lon - anchor.lon) * metersPerLon;
    const distanceM = Math.sqrt(northMeters * northMeters + eastMeters * eastMeters);
    const bearingDeg = (Math.atan2(eastMeters, northMeters) * 180 / Math.PI + 360) % 360;
    const displayRadius = 92;
    const scale = clampNumber(distanceM / 80, 0, 1);
    const radius = scale * displayRadius;
    const radians = bearingDeg * Math.PI / 180;

    radarTargetX = 110 + Math.sin(radians) * radius;
    radarTargetY = 110 - Math.cos(radians) * radius;
    radarDistanceText = `${distanceM.toFixed(1)} m`;
    radarBearingText = `${bearingDeg.toFixed(0)} deg`;
  }

  function updateTrackProjection(points: TrackPoint[]): void {
    updateRadarFromTrack(points);
    if (maptilerMap) {
      updateMapTilerTrackData(maptilerMap, "map");
      enforceMapTilerViewportLimits(maptilerMap, "map");
    }
    if (maptilerSatellite) {
      updateMapTilerTrackData(maptilerSatellite, "satellite");
      enforceMapTilerViewportLimits(maptilerSatellite, "satellite");
    }

    const current = points.length > 0 ? points[points.length - 1] : null;
    if (!current) {
      currentLatText = "--";
      currentLonText = "--";
      currentSogText = "--";
      currentCogText = "--";
      currentHeadingText = "--";
      trackStatusText = "No track yet";
      return;
    }

    currentLatText = current.lat.toFixed(5);
    currentLonText = current.lon.toFixed(5);
    currentSogText = `${current.sogKn.toFixed(2)} kn`;
    currentCogText = `${current.cogDeg.toFixed(0)} deg`;
    currentHeadingText = `${current.headingDeg.toFixed(0)} deg`;
    trackStatusText = `${points.length} points loaded`;
  }

  function appendTrackPoint(point: TrackPoint): void {
    const previous = trackPoints[trackPoints.length - 1];
    if (previous && Math.abs(previous.lat - point.lat) < 0.000001 && Math.abs(previous.lon - point.lon) < 0.000001) {
      return;
    }
    trackPoints = [...trackPoints, point].slice(-TRACK_MAX_POINTS);
    updateTrackProjection(trackPoints);
  }

  function replaceTrackPoints(points: TrackPoint[]): void {
    trackPoints = points.slice(-TRACK_MAX_POINTS);
    updateTrackProjection(trackPoints);
  }

  function logLine(message: string): void {
    const stamp = new Date().toISOString().slice(11, 19);
    const line = `${stamp} ${message}`;
    logLines = [...logLines, line].slice(-140);
  }

  function setState(text: string, klass: PillClass): void {
    statePillText = text;
    statePillClass = klass;
  }

  function setSource(text: string): void {
    stateSourceText = `Source: ${text}`;
  }

  function loadStoredString(key: string, fallback = ""): string {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function saveStoredString(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Ignore storage failures in constrained contexts.
    }
  }

  function loadMode(): Mode {
    const saved = loadStoredString(MODE_KEY, MODE_FAKE);
    return saved === MODE_DEVICE ? MODE_DEVICE : MODE_FAKE;
  }

  function getRelayBaseUrl(): string {
    return loadStoredString(RELAY_BASE_URL_KEY, DEFAULT_RELAY_BASE_URL).trim();
  }

  function normalizeRelayBaseUrl(raw: string): string {
    return raw.trim().replace(/\/+$/, "");
  }

  function getBoatId(): string {
    return loadStoredString(BOAT_ID_KEY);
  }

  function setBoatId(value: string): void {
    if (!value) {
      return;
    }
    saveStoredString(BOAT_ID_KEY, value);
    boatIdText = value;
  }

  function getBoatSecret(): string {
    return loadStoredString(BOAT_SECRET_KEY);
  }

  function setBoatSecret(secret: string): void {
    if (!secret) {
      return;
    }
    saveStoredString(BOAT_SECRET_KEY, secret);
    refreshIdentityUi();
  }

  function ensurePhoneId(): string {
    let phoneId = loadStoredString(PHONE_ID_KEY);
    if (!phoneId) {
      const rand = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      phoneId = `phone_${rand}`;
      saveStoredString(PHONE_ID_KEY, phoneId);
    }
    return phoneId;
  }

  function maskSecret(secret: string): string {
    if (!secret) {
      return "not stored";
    }
    if (secret.length <= 10) {
      return "stored";
    }
    return `stored (${secret.slice(0, 6)}...${secret.slice(-4)})`;
  }

  function refreshIdentityUi(): void {
    const boatId = getBoatId();
    const boatSecret = getBoatSecret();
    boatIdText = boatId || "--";
    secretStatusText = maskSecret(boatSecret);
    relayBaseUrlInput = getRelayBaseUrl();
  }

  function updateBleStatus(): void {
    if (!ble.connected) {
      bleStatusText = "disconnected";
      return;
    }
    const auth = ble.authState ?? {};
    const paired = auth.sessionPaired ? "paired" : "unpaired";
    const pairMode = auth.pairModeActive ? "pair-mode-on" : "pair-mode-off";
    bleStatusText = `connected (${paired}, ${pairMode})`;
  }

  function applyMode(nextMode: Mode, persist = true): void {
    mode = nextMode;
    if (persist) {
      saveStoredString(MODE_KEY, nextMode);
    }
  }

  function hasPersistedSetup(): boolean {
    const hasBoatId = getBoatId().trim().length > 0;
    const hasBoatSecret = getBoatSecret().trim().length > 0;
    const hasRelayBaseUrl = getRelayBaseUrl().length > 0;
    const configVersion = Number(loadStoredString(WIFI_CFG_VERSION_KEY, "0"));
    const hasSavedConfigVersion = Number.isInteger(configVersion) && configVersion > 0;
    return hasBoatId || hasBoatSecret || hasRelayBaseUrl || hasSavedConfigVersion;
  }

  function setTelemetry(gpsAgeS: number, dataAgeS: number, depthM: number, windKn: number): void {
    gpsAgeText = `${Math.max(0, Math.round(gpsAgeS))}s`;
    dataAgeText = `${Math.max(0, Math.round(dataAgeS))}s`;
    depthText = `${depthM.toFixed(1)} m`;
    windText = `${windKn.toFixed(1)} kn`;
  }

  function deepMerge(baseValue: unknown, patchValue: JsonRecord): JsonRecord {
    const base: JsonRecord = isObject(baseValue) ? { ...baseValue } : {};
    for (const [key, value] of Object.entries(patchValue)) {
      if (isObject(value) && isObject(base[key])) {
        base[key] = deepMerge(base[key], value);
      } else {
        base[key] = value;
      }
    }
    return base;
  }

  function assignPath(target: JsonRecord, path: string, value: unknown): boolean {
    const parts = path.split(".");
    if (parts.some((part) => !part)) {
      return false;
    }

    let cursor: JsonRecord = target;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const part = parts[i];
      if (!isObject(cursor[part])) {
        cursor[part] = {};
      }
      cursor = cursor[part] as JsonRecord;
    }

    const leaf = parts[parts.length - 1];
    cursor[leaf] = isObject(value) ? normalizePatch(value) : value;
    return true;
  }

  function normalizePatch(rawPatch: unknown): JsonRecord | null {
    if (!isObject(rawPatch)) {
      return null;
    }

    const out: JsonRecord = {};
    for (const [key, value] of Object.entries(rawPatch)) {
      if (key.includes(".")) {
        if (!assignPath(out, key, value)) {
          return null;
        }
        continue;
      }

      if (isObject(value)) {
        const nested = normalizePatch(value);
        if (!nested) {
          return null;
        }
        out[key] = nested;
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  function applyStateSnapshot(snapshot: unknown, source: InboundSource): void {
    if (!isObject(snapshot)) {
      return;
    }
    latestState = snapshot;
    latestStateSource = source;
    latestStateUpdatedAtMs = Date.now();
  }

  function applyStatePatch(rawPatch: unknown, source: InboundSource): void {
    const patch = normalizePatch(rawPatch);
    if (!patch) {
      return;
    }
    latestState = deepMerge(latestState, patch);
    latestStateSource = source;
    latestStateUpdatedAtMs = Date.now();
  }

  function renderTelemetryFromState(): void {
    const telemetry = isObject(latestState.telemetry) ? latestState.telemetry : {};
    const gps = isObject(telemetry.gps) ? telemetry.gps : {};
    const depth = isObject(telemetry.depth) ? telemetry.depth : {};
    const wind = isObject(telemetry.wind) ? telemetry.wind : {};
    const motion = isObject(telemetry.motion) ? telemetry.motion : {};

    const gpsAgeS = Number(gps.ageMs ?? 0) / 1000;
    const dataAgeS = Number(depth.ageMs ?? wind.ageMs ?? gps.ageMs ?? 0) / 1000;
    const depthM = Number(depth.meters ?? 0);
    const windKn = Number(wind.knots ?? 0);

    setTelemetry(gpsAgeS, dataAgeS, depthM, windKn);

    const lat = toFiniteNumber(gps.lat);
    const lon = toFiniteNumber(gps.lon);
    if (lat === null || lon === null) {
      return;
    }

    const sogKn = toFiniteNumber(gps.sogKn ?? motion.sogKn) ?? 0;
    const cogDeg = toFiniteNumber(gps.cogDeg ?? motion.cogDeg) ?? 0;
    const headingDeg = toFiniteNumber(gps.headingDeg ?? motion.headingDeg ?? cogDeg) ?? cogDeg;
    appendTrackPoint({
      ts: Date.now(),
      lat,
      lon,
      sogKn,
      cogDeg: (cogDeg + 360) % 360,
      headingDeg: (headingDeg + 360) % 360,
    });
  }

  function tickFakeSummary(nowMs: number): void {
    const ageMs = Math.floor(nowMs - bootMs);
    const depthM = 3.2 + Math.sin(ageMs / 9000) * 0.35;
    const windKn = 12.0 + Math.sin(ageMs / 5000) * 2.5;
    const ageS = Math.floor(ageMs / 1000);

    setTelemetry(ageS, ageS, depthM, windKn);
    setSource("fake-simulator");

    const t = ageMs / 1000;
    const lat = 54.3201 + Math.sin(t / 45) * 0.0007;
    const lon = 10.1402 + Math.cos(t / 60) * 0.0011;
    const sogKn = 0.4 + Math.abs(Math.sin(t / 10)) * 0.8;
    const cogDeg = (t * 16) % 360;
    const headingDeg = (cogDeg + Math.sin(t / 7) * 14 + 360) % 360;
    appendTrackPoint({
      ts: Date.now(),
      lat,
      lon,
      sogKn,
      cogDeg,
      headingDeg,
    });

    if (depthM < 2.0) {
      setState("FAKE: ALARM", "alarm");
      return;
    }
    if (windKn > 18.0) {
      setState("FAKE: WARNING", "warn");
      return;
    }
    setState("FAKE: MONITORING", "ok");
  }

  function extractAckError(payload: JsonRecord): string {
    const code = typeof payload.errorCode === "string" ? payload.errorCode : "ACK_FAILED";
    const detail = typeof payload.errorDetail === "string" ? payload.errorDetail : "command rejected";
    return `${code}: ${detail}`;
  }

  function resolvePendingAck(payload: JsonRecord): void {
    const ackForMsgId = typeof payload.ackForMsgId === "string" ? payload.ackForMsgId : "";
    if (!ackForMsgId) {
      return;
    }

    const pending = ble.pendingAcks.get(ackForMsgId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    ble.pendingAcks.delete(ackForMsgId);

    if (payload.status === "ok") {
      pending.resolve(payload);
      return;
    }

    pending.reject(new Error(extractAckError(payload)));
  }

  function clearPendingAcks(reason: string): void {
    for (const pending of ble.pendingAcks.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
    }
    ble.pendingAcks.clear();
  }

  function makeAckPromise(msgId: string, timeoutMs = 4500): Promise<JsonRecord> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ble.pendingAcks.delete(msgId);
        reject(new Error("ACK timeout"));
      }, timeoutMs);
      ble.pendingAcks.set(msgId, { resolve, reject, timeout });
    });
  }

  function makeMsgId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
    }
    return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 12)}`.slice(0, 24);
  }

  function fnv1a32(value: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
  }

  async function writeCharacteristic(
    characteristic: BluetoothRemoteGATTCharacteristic,
    bytes: Uint8Array,
  ): Promise<void> {
    const payload = new Uint8Array(bytes);
    const candidate = characteristic as BluetoothRemoteGATTCharacteristic & {
      writeValueWithoutResponse?: (value: BufferSource) => Promise<void>;
    };

    if (typeof candidate.writeValueWithoutResponse === "function") {
      await candidate.writeValueWithoutResponse(payload);
      return;
    }

    await characteristic.writeValue(payload);
  }

  async function writeChunked(
    characteristic: BluetoothRemoteGATTCharacteristic,
    msgId: string,
    jsonText: string,
  ): Promise<void> {
    const bytes = encoder.encode(jsonText);
    const partCount = Math.max(1, Math.ceil(bytes.length / BLE_CHUNK_MAX_PAYLOAD));
    const msgId32 = fnv1a32(msgId);

    for (let partIndex = 0; partIndex < partCount; partIndex += 1) {
      const offset = partIndex * BLE_CHUNK_MAX_PAYLOAD;
      const chunk = bytes.slice(offset, offset + BLE_CHUNK_MAX_PAYLOAD);
      const frame = new Uint8Array(6 + chunk.length);
      frame[0] = msgId32 & 0xff;
      frame[1] = (msgId32 >>> 8) & 0xff;
      frame[2] = (msgId32 >>> 16) & 0xff;
      frame[3] = (msgId32 >>> 24) & 0xff;
      frame[4] = partIndex & 0xff;
      frame[5] = partCount & 0xff;
      frame.set(chunk, 6);
      await writeCharacteristic(characteristic, frame);
    }
  }

  function buildEnvelope(msgType: string, payload: JsonRecord, requiresAck = true): Envelope {
    return {
      ver: PROTOCOL_VERSION,
      msgType,
      msgId: makeMsgId(),
      boatId: getBoatId() || "boat_unknown",
      deviceId: ensurePhoneId(),
      seq: ble.seq++,
      ts: Date.now(),
      requiresAck,
      payload,
    };
  }

  async function sendControlMessage(msgType: string, payload: JsonRecord, requiresAck = true): Promise<JsonRecord | null> {
    if (!ble.connected || !ble.controlTx) {
      throw new Error("BLE not connected");
    }

    const envelope = buildEnvelope(msgType, payload, requiresAck);
    const raw = JSON.stringify(envelope);
    const ackPromise = requiresAck && envelope.msgId ? makeAckPromise(envelope.msgId) : null;

    try {
      await writeChunked(ble.controlTx, envelope.msgId as string, raw);
      logLine(`tx ${msgType} msgId=${envelope.msgId}`);
      if (!ackPromise) {
        return null;
      }
      const ack = await ackPromise;
      logLine(`ack ok for ${msgType} msgId=${envelope.msgId}`);
      return ack;
    } catch (error) {
      if (envelope.msgId) {
        ble.pendingAcks.delete(envelope.msgId);
      }
      throw error;
    }
  }

  function dataViewToBytes(view: DataView): Uint8Array {
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
  }

  function safeParseJson(raw: string): JsonRecord | null {
    try {
      const parsed = JSON.parse(raw);
      return isObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  function toTrackPoint(value: unknown): TrackPoint | null {
    if (!isObject(value)) {
      return null;
    }

    const lat = toFiniteNumber(value.lat);
    const lon = toFiniteNumber(value.lon);
    if (lat === null || lon === null) {
      return null;
    }

    const ts = toFiniteNumber(value.ts) ?? Date.now();
    const sogKn = toFiniteNumber(value.sogKn) ?? 0;
    const cogDeg = toFiniteNumber(value.cogDeg) ?? 0;
    const headingDeg = toFiniteNumber(value.headingDeg) ?? cogDeg;

    return {
      ts,
      lat,
      lon,
      sogKn,
      cogDeg: (cogDeg + 360) % 360,
      headingDeg: (headingDeg + 360) % 360,
    };
  }

  function parseTrackSnapshot(payload: JsonRecord): TrackPoint[] {
    const rawPoints = payload.points;
    if (!Array.isArray(rawPoints)) {
      return [];
    }

    const out: TrackPoint[] = [];
    for (const point of rawPoints) {
      const parsed = toTrackPoint(point);
      if (parsed) {
        out.push(parsed);
      }
    }
    return out;
  }

  async function refreshAuthState(): Promise<void> {
    if (!ble.connected || !ble.auth) {
      ble.authState = null;
      updateBleStatus();
      return;
    }

    try {
      const value = await ble.auth.readValue();
      const raw = decoder.decode(dataViewToBytes(value));
      const parsed = safeParseJson(raw);
      ble.authState = parsed;
    } catch (error) {
      logLine(`auth read failed: ${String(error)}`);
      ble.authState = null;
    }
    updateBleStatus();
  }

  async function writeAuthAction(action: string): Promise<void> {
    if (!ble.connected || !ble.auth) {
      throw new Error("BLE auth characteristic unavailable");
    }
    await writeCharacteristic(ble.auth, encoder.encode(JSON.stringify({ action })));
    logLine(`auth action ${action}`);
    await refreshAuthState();
  }

  function clearWifiScanTimeout(): void {
    if (!wifiScanTimeout) {
      return;
    }
    clearTimeout(wifiScanTimeout);
    wifiScanTimeout = null;
  }

  function applyWifiScanResult(payload: JsonRecord): void {
    const requestId = typeof payload.requestId === "string" ? payload.requestId : "";
    const scannedNetworks = parseWifiScanNetworks(payload.networks);

    clearWifiScanTimeout();
    wifiScanInFlight = false;
    wifiScanErrorText = "";
    if (requestId) {
      wifiScanRequestId = requestId;
    }

    applyWifiScanNetworks(scannedNetworks);
    wifiScanStatusText = scannedNetworks.length > 0
      ? `Found ${scannedNetworks.length} WLAN network${scannedNetworks.length === 1 ? "" : "s"}.`
      : "No WLAN networks found. Try scanning again.";
    logLine(`onboarding.wifi.scan_result received (${scannedNetworks.length} networks)`);
  }

  function handleEnvelope(envelope: Envelope, sourceTag: InboundSource): void {
    if (typeof envelope.boatId === "string" && envelope.boatId) {
      setBoatId(envelope.boatId);
    }

    const payload: JsonRecord = isObject(envelope.payload) ? envelope.payload : {};
    const msgType = envelope.msgType || "unknown";

    if (msgType === "command.ack") {
      resolvePendingAck(payload);
      return;
    }

    if (msgType === "status.patch") {
      applyStatePatch(payload.statePatch, sourceTag);
      lastBleMessageAtMs = Date.now();
      return;
    }

    if (msgType === "status.snapshot") {
      applyStateSnapshot(payload.snapshot, sourceTag);
      lastBleMessageAtMs = Date.now();
      return;
    }

    if (msgType === "onboarding.boat_secret") {
      if (typeof payload.boatId === "string") {
        setBoatId(payload.boatId);
      }
      if (typeof payload.boatSecret === "string" && payload.boatSecret) {
        setBoatSecret(payload.boatSecret);
        logLine("received onboarding.boat_secret and stored secret");
      } else {
        logLine("onboarding.boat_secret missing boatSecret");
      }
      return;
    }

    if (msgType === "onboarding.wifi.scan_result") {
      applyWifiScanResult(payload);
      return;
    }

    if (msgType === "track.snapshot") {
      const points = parseTrackSnapshot(payload);
      if (points.length > 0) {
        replaceTrackPoints(points);
        logLine(`track.snapshot received (${points.length} points)`);
      } else {
        logLine("track.snapshot received (no valid points)");
      }
      return;
    }

    logLine(`rx ${msgType} (${sourceTag})`);
  }

  function cleanupChunkAssemblies(): void {
    const now = Date.now();
    for (const [key, entry] of ble.chunkAssemblies.entries()) {
      if (now - entry.updatedAt > BLE_CHUNK_TIMEOUT_MS) {
        ble.chunkAssemblies.delete(key);
      }
    }
  }

  function handleChunkedBleFrame(bytes: Uint8Array): void {
    if (bytes.length < 6) {
      return;
    }

    const msgId32 = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
    const partIndex = bytes[4];
    const partCount = bytes[5];

    if (!partCount || partIndex >= partCount) {
      return;
    }

    const key = `${msgId32}:${partCount}`;
    let entry = ble.chunkAssemblies.get(key);
    if (!entry) {
      entry = {
        partCount,
        parts: Array.from({ length: partCount }, () => null),
        updatedAt: Date.now(),
      };
      ble.chunkAssemblies.set(key, entry);
    }

    entry.updatedAt = Date.now();
    entry.parts[partIndex] = decoder.decode(bytes.slice(6));

    if (entry.parts.some((part) => part === null)) {
      cleanupChunkAssemblies();
      return;
    }

    ble.chunkAssemblies.delete(key);
    const raw = entry.parts.join("");
    const parsed = safeParseJson(raw);
    if (!parsed) {
      logLine("rx parse failed for chunked frame");
      return;
    }
    handleEnvelope(parsed, "ble/eventRx");
  }

  function onBleNotification(event: Event): void {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic | null;
    const value = characteristic?.value;
    if (!value) {
      return;
    }

    const bytes = dataViewToBytes(value);
    if (!bytes.length) {
      return;
    }

    if (bytes[0] === 0x7b) {
      const parsed = safeParseJson(decoder.decode(bytes));
      if (!parsed) {
        logLine("rx json parse failed");
        return;
      }
      handleEnvelope(parsed, "ble/eventRx");
      return;
    }

    handleChunkedBleFrame(bytes);
  }

  function onBleDisconnected(): void {
    clearWifiScanTimeout();
    wifiScanInFlight = false;
    if (onboardingStep === 2) {
      wifiScanStatusText = "BLE disconnected. Reconnect to scan WLAN networks.";
    }
    ble.connected = false;
    ble.device = null;
    ble.server = null;
    ble.service = null;
    ble.controlTx = null;
    ble.eventRx = null;
    ble.snapshot = null;
    ble.auth = null;
    ble.authState = null;
    ble.chunkAssemblies.clear();
    clearPendingAcks("BLE disconnected");
    updateBleStatus();
    logLine("BLE disconnected");
  }

  async function connectBle(): Promise<void> {
    if (!navigator.bluetooth) {
      throw new Error("Web Bluetooth unavailable");
    }

    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [BLE_SERVICE_UUID] }],
      optionalServices: [BLE_SERVICE_UUID],
    });

    device.addEventListener("gattserverdisconnected", onBleDisconnected as EventListener);

    if (!device.gatt) {
      throw new Error("GATT unavailable on selected device");
    }

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(BLE_SERVICE_UUID);
    const controlTx = await service.getCharacteristic(BLE_CONTROL_TX_UUID);
    const eventRx = await service.getCharacteristic(BLE_EVENT_RX_UUID);
    const snapshot = await service.getCharacteristic(BLE_SNAPSHOT_UUID);
    const auth = await service.getCharacteristic(BLE_AUTH_UUID);

    await eventRx.startNotifications();
    eventRx.addEventListener("characteristicvaluechanged", onBleNotification);

    ble.device = device;
    ble.server = server;
    ble.service = service;
    ble.controlTx = controlTx;
    ble.eventRx = eventRx;
    ble.snapshot = snapshot;
    ble.auth = auth;
    ble.connected = true;
    ble.chunkAssemblies.clear();

    updateBleStatus();
    logLine(`BLE connected to ${device.name || "device"}`);
    await refreshAuthState();
    await readSnapshotFromBle();
  }

  async function disconnectBle(): Promise<void> {
    if (ble.device?.gatt?.connected) {
      ble.device.gatt.disconnect();
      return;
    }
    onBleDisconnected();
  }

  async function readSnapshotFromBle(): Promise<void> {
    if (!ble.connected || !ble.snapshot) {
      throw new Error("BLE snapshot characteristic unavailable");
    }
    const value = await ble.snapshot.readValue();
    const raw = decoder.decode(dataViewToBytes(value));
    const parsed = safeParseJson(raw);
    if (!parsed) {
      throw new Error("invalid snapshot JSON");
    }
    handleEnvelope(parsed, "ble/snapshot");
    logLine("status.snapshot read");
  }

  async function requestBoatSecret(): Promise<void> {
    await sendControlMessage("onboarding.request_secret", { reason: "initial_pairing" }, true);
  }

  async function scanWifiNetworks(): Promise<void> {
    if (!ble.connected) {
      throw new Error("Connect BLE before scanning WLAN networks");
    }

    clearWifiScanTimeout();

    const requestId = makeMsgId();
    wifiScanRequestId = requestId;
    wifiScanInFlight = true;
    wifiScanErrorText = "";
    wifiScanStatusText = "Scanning nearby WLAN networks...";

    wifiScanTimeout = setTimeout(() => {
      if (!wifiScanInFlight || wifiScanRequestId !== requestId) {
        return;
      }
      wifiScanInFlight = false;
      wifiScanErrorText = "No scan result received from device.";
      wifiScanStatusText = "WLAN scan timed out. Try scanning again.";
      logLine("onboarding.wifi.scan_result timeout");
    }, WIFI_SCAN_TIMEOUT_MS);

    try {
      const ack = await sendControlMessage("onboarding.wifi.scan", {
        requestId,
        maxResults: 20,
        includeHidden: false,
      }, true);

      const ackNetworks = parseWifiScanNetworks(ack?.networks);
      if (ackNetworks.length > 0) {
        applyWifiScanNetworks(ackNetworks);
        clearWifiScanTimeout();
        wifiScanInFlight = false;
        wifiScanStatusText = `Found ${ackNetworks.length} WLAN network${ackNetworks.length === 1 ? "" : "s"}.`;
      }
    } catch (error) {
      clearWifiScanTimeout();
      wifiScanInFlight = false;
      wifiScanErrorText = String(error);
      wifiScanStatusText = "WLAN scan failed.";
      throw error;
    }
  }

  async function applyWiFiConfig(): Promise<void> {
    const ssid = wifiSsid.trim();
    const passphrase = wifiPass;
    const security = wifiSecurity === "unknown" ? "wpa2" : wifiSecurity;
    const country = wifiCountry.trim().toUpperCase();

    if (!ssid) {
      throw new Error("Wi-Fi SSID is required");
    }

    const patch: JsonRecord = {
      "network.wifi.ssid": ssid,
      "network.wifi.passphrase": passphrase,
      "network.wifi.security": security,
      "network.wifi.country": country || "DE",
      "network.wifi.hidden": selectedWifiNetwork?.hidden ?? false,
    };

    await sendConfigPatch(patch, "wifi");
  }

  async function connectBleForOnboarding(): Promise<void> {
    selectDeviceModeForOnboarding();
    await connectBle();
  }

  function continueToWifiStep(): void {
    if (!ble.connected) {
      throw new Error("Connect BLE before continuing");
    }
    prefillWifiSettingsFromCurrentState();
    onboardingStep = 2;
    void runAction("scan wlan networks", scanWifiNetworks);
  }

  async function applyWifiAndContinue(): Promise<void> {
    await applyWiFiConfig();
    onboardingStep = 3;
  }

  function backToWifiSettingsStep(): void {
    onboardingStep = 2;
  }

  function goToSummaryFromOnboarding(): void {
    setView("summary");
  }

  function selectDeviceModeForOnboarding(): void {
    if (mode === MODE_DEVICE) {
      return;
    }
    applyMode(MODE_DEVICE);
    logLine("device mode selected for onboarding");
  }

  async function skipOnboardingWithFakeMode(): Promise<void> {
    applyMode(MODE_FAKE);
    if (ble.connected) {
      await disconnectBle();
    }
    onboardingStep = 1;
    setView("summary");
    logLine("fake mode selected; skipped BLE/cloud onboarding");
  }

  async function sendConfigPatch(patch: JsonRecord, reason: string): Promise<void> {
    const version = nextConfigVersion();

    if (ble.connected) {
      await sendControlMessage("config.patch", { version, patch }, true);
      setConfigVersion(version);
      logLine(`config.patch sent via BLE (${reason}) version=${version}`);
      return;
    }

    const base = getRelayBaseUrl();
    const boatId = getBoatId();
    const boatSecret = getBoatSecret();
    if (!base || !boatId || !boatSecret) {
      throw new Error("Need BLE connection or cloud credentials (relay URL + boatId + boatSecret)");
    }

    const res = await fetch(`${base}/v1/config`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${boatSecret}`,
        "content-type": "application/json",
        "X-AnchorWatch-Client": "app",
      },
      body: JSON.stringify({
        ver: PROTOCOL_VERSION,
        msgType: "config.patch",
        boatId,
        deviceId: ensurePhoneId(),
        ts: Date.now(),
        version,
        patch,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`cloud config.patch failed ${res.status}: ${text}`);
    }

    setConfigVersion(version);
    logLine(`config.patch sent via cloud (${reason}) version=${version}`);
  }

  async function applyAnchorConfig(): Promise<void> {
    const patch: JsonRecord = {
      "anchor.defaultSetMode": anchorMode,
      "anchor.offset.distanceM": parseNumberInput(anchorOffsetDistanceM, 8, 0, 2000),
      "anchor.offset.angleDeg": parseNumberInput(anchorOffsetAngleDeg, 210, 0, 359.99),
      "anchor.autoMode.enabled": autoModeEnabled,
      "anchor.autoMode.minForwardSogKn": parseNumberInput(autoModeMinForwardSogKn, 0.8, 0, 20),
      "anchor.autoMode.stallMaxSogKn": parseNumberInput(autoModeStallMaxSogKn, 0.3, 0, 20),
      "anchor.autoMode.reverseMinSogKn": parseNumberInput(autoModeReverseMinSogKn, 0.4, 0, 20),
      "anchor.autoMode.confirmSeconds": parseIntegerInput(autoModeConfirmSeconds, 20, 1, 300),
      "zone.type": zoneType,
    };

    if (zoneType === "circle") {
      patch["zone.circle.radiusM"] = parseNumberInput(zoneRadiusM, 45, 1, 3000);
    } else {
      const points = parsePolygonPoints(polygonPointsInput);
      if (points.length < 3) {
        throw new Error("Polygon mode requires at least 3 points (lat,lon per line)");
      }
      patch["zone.polygon.points"] = points;
    }

    await sendConfigPatch(patch, "anchor+zone");

    if (anchorMode === "manual") {
      const manualLat = toFiniteNumber(manualAnchorLat);
      const manualLon = toFiniteNumber(manualAnchorLon);
      if (manualLat !== null && manualLon !== null) {
        logLine(`manual anchor draft captured at lat=${manualLat.toFixed(5)}, lon=${manualLon.toFixed(5)} (runtime command id pending)`);
      } else {
        logLine("manual mode selected; runtime drag/drop command not yet wired in protocol scaffold");
      }
    }
  }

  async function applyTriggerConfig(): Promise<void> {
    const patch: JsonRecord = {
      "triggers.wind_above.enabled": triggerWindAboveEnabled,
      "triggers.wind_above.thresholdKn": parseNumberInput(triggerWindAboveThresholdKn, 30, 0, 150),
      "triggers.wind_above.holdMs": parseIntegerInput(triggerWindAboveHoldMs, 15000, 0, 600000),
      "triggers.wind_above.severity": triggerWindAboveSeverity,
      "triggers.outside_area.enabled": triggerOutsideAreaEnabled,
      "triggers.outside_area.holdMs": parseIntegerInput(triggerOutsideAreaHoldMs, 10000, 0, 600000),
      "triggers.outside_area.severity": triggerOutsideAreaSeverity,
      "triggers.gps_age.enabled": triggerGpsAgeEnabled,
      "triggers.gps_age.maxAgeMs": parseIntegerInput(triggerGpsAgeMaxMs, 5000, 0, 600000),
      "triggers.gps_age.holdMs": parseIntegerInput(triggerGpsAgeHoldMs, 5000, 0, 600000),
      "triggers.gps_age.severity": triggerGpsAgeSeverity,
    };
    await sendConfigPatch(patch, "triggers");
  }

  async function applyProfilesConfig(): Promise<void> {
    const patch: JsonRecord = {
      "profiles.mode": profilesMode,
      "profiles.day.colorScheme": profileDayColorScheme,
      "profiles.day.brightnessPct": parseIntegerInput(profileDayBrightnessPct, 100, 1, 100),
      "profiles.day.outputProfile": profileDayOutputProfile.trim() || "normal",
      "profiles.night.colorScheme": profileNightColorScheme,
      "profiles.night.brightnessPct": parseIntegerInput(profileNightBrightnessPct, 20, 1, 100),
      "profiles.night.outputProfile": profileNightOutputProfile.trim() || "night",
      "profiles.autoSwitch.source": profileAutoSwitchSource,
      "profiles.autoSwitch.dayStartLocal": profileDayStartLocal,
      "profiles.autoSwitch.nightStartLocal": profileNightStartLocal,
    };
    await sendConfigPatch(patch, "profiles");
  }

  async function fetchTrackSnapshot(): Promise<void> {
    const base = getRelayBaseUrl();
    const boatId = getBoatId();
    const boatSecret = getBoatSecret();
    if (!base || !boatId || !boatSecret) {
      throw new Error("Track fetch requires relay URL + boatId + boatSecret");
    }

    const url = `${base}/v1/tracks?boatId=${encodeURIComponent(boatId)}&limit=${TRACK_SNAPSHOT_LIMIT}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${boatSecret}`,
      },
    });

    if (res.status === 404) {
      trackStatusText = "No cloud track available yet.";
      logLine("track snapshot not found (404)");
      return;
    }
    if (!res.ok) {
      throw new Error(`track snapshot failed ${res.status}`);
    }

    const body = (await res.json()) as JsonRecord;
    const payload = isObject(body.payload) ? body.payload : body;
    const points = parseTrackSnapshot(payload);
    replaceTrackPoints(points);
    logLine(`track snapshot loaded (${points.length} points)`);
  }

  function navLevelFor(view: ViewId, configView: ConfigViewId): number {
    if (view === "summary") {
      return 0;
    }
    if (view === "config" && configView !== "settings") {
      return 2;
    }
    return 1;
  }

  function currentNavLevel(): number {
    return navLevelFor(activeView, activeConfigView);
  }

  function pushNavStep(): void {
    try {
      window.history.pushState({ anchorwatch: "nav-step" }, "", window.location.href);
      navigationDepth += 1;
    } catch {
      // Ignore history API failures in constrained contexts.
    }
  }

  function popNavSteps(steps: number): void {
    const count = Math.min(Math.max(steps, 0), navigationDepth);
    if (count <= 0) {
      return;
    }
    try {
      suppressedPopEvents += count;
      navigationDepth -= count;
      if (count === 1) {
        window.history.back();
      } else {
        window.history.go(-count);
      }
    } catch {
      suppressedPopEvents = Math.max(0, suppressedPopEvents - count);
      navigationDepth += count;
    }
  }

  function syncToNavLevel(targetLevel: number): void {
    const currentLevel = currentNavLevel();
    if (targetLevel > currentLevel) {
      for (let i = 0; i < targetLevel - currentLevel; i += 1) {
        pushNavStep();
      }
      return;
    }
    if (targetLevel < currentLevel) {
      popNavSteps(currentLevel - targetLevel);
    }
  }

  function setView(nextView: ViewId): void {
    const previousView = activeView;
    const targetLevel = nextView === "summary" ? 0 : 1;
    syncToNavLevel(targetLevel);

    if (nextView === "config") {
      activeConfigView = "settings";
      onboardingStep = 1;
    } else if (activeConfigView !== "settings") {
      activeConfigView = "settings";
    }

    activeView = nextView;

    if (previousView === "map" && nextView !== "map") {
      destroyMapTilerView("map");
    }
    if (previousView === "satellite" && nextView !== "satellite") {
      destroyMapTilerView("satellite");
    }
    if (nextView === "map") {
      requestAnimationFrame(() => ensureMapTilerView("map"));
    } else if (nextView === "satellite") {
      requestAnimationFrame(() => ensureMapTilerView("satellite"));
    }

    if ((nextView === "satellite" || nextView === "map" || nextView === "radar") && mode === MODE_DEVICE && trackPoints.length < 3) {
      void runAction("track snapshot", fetchTrackSnapshot);
    }
  }

  function openConfigView(nextConfigView: ConfigSectionId): void {
    syncToNavLevel(2);
    if (nextConfigView === "onboarding") {
      onboardingStep = 1;
    }
    activeView = "config";
    activeConfigView = nextConfigView;
  }

  function goToSettingsView(syncHistory = true): void {
    if (activeView !== "config" || activeConfigView === "settings") {
      return;
    }
    if (syncHistory) {
      syncToNavLevel(1);
    }
    activeView = "config";
    activeConfigView = "settings";
  }

  function handlePopState(): void {
    if (suppressedPopEvents > 0) {
      suppressedPopEvents -= 1;
      return;
    }

    if (navigationDepth > 0) {
      navigationDepth -= 1;
    }

    const level = currentNavLevel();
    if (level === 2) {
      goToSettingsView(false);
      return;
    }
    if (level === 1) {
      const previousView = activeView;
      activeView = "summary";
      activeConfigView = "settings";
      onboardingStep = 1;
      if (previousView === "map") {
        destroyMapTilerView("map");
      } else if (previousView === "satellite") {
        destroyMapTilerView("satellite");
      }
    }
  }

  function initNotificationStatus(): void {
    if (!("Notification" in window)) {
      notificationPermissionText = "unsupported";
      notificationStatusText = "Notification API not supported by this browser.";
      return;
    }

    notificationPermissionText = Notification.permission;
    notificationStatusText = Notification.permission === "granted"
      ? "Permission granted. Test notification is available."
      : "Permission not granted yet.";
  }

  async function requestNotificationPermission(): Promise<void> {
    if (!("Notification" in window)) {
      throw new Error("Notification API unavailable");
    }
    const permission = await Notification.requestPermission();
    notificationPermissionText = permission;
    notificationStatusText = permission === "granted"
      ? "Permission granted."
      : `Permission status: ${permission}`;
  }

  async function sendTestNotification(): Promise<void> {
    if (!("Notification" in window)) {
      throw new Error("Notification API unavailable");
    }
    if (Notification.permission !== "granted") {
      throw new Error("Notification permission is not granted");
    }

    const title = "Anqori AnchorWatch test alert";
    const body = "Notification path works in this browser session.";
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, {
        body,
        tag: `am-test-${Date.now()}`,
      });
    } else {
      // Fallback when no service worker registration is available.
      // eslint-disable-next-line no-new
      new Notification(title, { body });
    }
    notificationStatusText = `Test sent at ${new Date().toLocaleTimeString()}`;
  }

  function applyCloudHealthBody(raw: unknown): void {
    if (!isObject(raw)) {
      return;
    }
    const buildVersion = typeof raw.buildVersion === "string" ? raw.buildVersion.trim() : "";
    if (buildVersion) {
      cloudVersionText = buildVersion;
    }
  }

  async function refreshCloudVersion(base: string): Promise<void> {
    const now = Date.now();
    if (now - lastCloudHealthPollMs < CLOUD_HEALTH_POLL_MS) {
      return;
    }
    lastCloudHealthPollMs = now;

    try {
      const response = await fetch(`${base}/health`, { method: "GET" });
      if (!response.ok) {
        return;
      }
      const body = (await response.json()) as unknown;
      applyCloudHealthBody(body);
    } catch {
      // Ignore cloud health parsing errors in background refresh path.
    }
  }

  async function probeRelay(): Promise<void> {
    const base = getRelayBaseUrl();
    if (!base) {
      relayResult = "Set relay base URL first.";
      return;
    }

    try {
      const res = await fetch(`${base}/health`, { method: "GET" });
      const text = await res.text();
      relayResult = `${res.status} ${text}`;
      try {
        applyCloudHealthBody(JSON.parse(text) as unknown);
      } catch {
        // Ignore parse errors when health endpoint is not JSON.
      }
    } catch (error) {
      relayResult = `Relay probe failed: ${String(error)}`;
    }
  }

  async function verifyCloudAuth(): Promise<void> {
    const base = getRelayBaseUrl();
    const boatId = getBoatId();
    const boatSecret = getBoatSecret();

    if (!base) {
      throw new Error("Relay base URL missing");
    }
    if (!boatId) {
      throw new Error("Boat ID missing");
    }
    if (!boatSecret) {
      throw new Error("Boat secret missing");
    }

    await refreshCloudVersion(base);

    const url = `${base}/v1/state?boatId=${encodeURIComponent(boatId)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${boatSecret}`,
      },
    });

    if (res.status === 200 || res.status === 404) {
      cloudStatusText = `ok (${res.status})`;
      logLine(`cloud auth verify ok (${res.status})`);
      return;
    }

    const text = await res.text();
    cloudStatusText = `failed (${res.status})`;
    throw new Error(`cloud verify failed ${res.status}: ${text}`);
  }

  async function pollCloudState(nowMs: number): Promise<void> {
    if (nowMs - lastCloudPollMs < CLOUD_POLL_MS) {
      return;
    }
    lastCloudPollMs = nowMs;

    const base = getRelayBaseUrl();
    const boatId = getBoatId();
    const boatSecret = getBoatSecret();
    if (!base || !boatId || !boatSecret) {
      return;
    }

    try {
      await refreshCloudVersion(base);
      const url = `${base}/v1/state?boatId=${encodeURIComponent(boatId)}`;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          authorization: `Bearer ${boatSecret}`,
        },
      });

      if (res.status === 404) {
        return;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const body = (await res.json()) as JsonRecord;
      const payload = isObject(body.payload) ? body.payload : {};
      const snapshot = payload.snapshot ?? body.snapshot;
      applyStateSnapshot(snapshot, "cloud/status.snapshot");
    } catch (error) {
      logLine(`cloud poll failed: ${String(error)}`);
    }
  }

  async function tickDeviceSummary(nowMs: number): Promise<void> {
    const nowReal = Date.now();
    const bleFresh = ble.connected && (nowReal - lastBleMessageAtMs) <= BLE_LIVE_MAX_AGE_MS;

    if (bleFresh && Object.keys(latestState).length > 0) {
      renderTelemetryFromState();
      setSource(latestStateSource || "ble/live");
      setState("DEVICE: BLE LIVE", "ok");
      return;
    }

    await pollCloudState(nowReal);
    if (Object.keys(latestState).length > 0) {
      renderTelemetryFromState();
      setSource(latestStateSource || "cloud");
      setState(ble.connected ? "DEVICE: CLOUD FALLBACK" : "DEVICE: CLOUD", ble.connected ? "warn" : "ok");
      return;
    }

    const ageS = Math.floor((nowMs - bootMs) / 1000);
    setTelemetry(ageS, ageS, 0, 0);
    setSource("none");
    setState(ble.connected ? "DEVICE: WAITING DATA" : "DEVICE: NO LINK", "warn");
  }

  function initInstallStatus(): void {
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    installStatus = standalone
      ? "Installed app mode active."
      : "Browser mode. You can install this app from the browser menu.";
  }

  async function registerServiceWorker(): Promise<void> {
    if (!("serviceWorker" in navigator)) {
      return;
    }
    try {
      await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    } catch (error) {
      logLine(`service worker registration failed: ${String(error)}`);
    }
  }

  function initBleSupportLabel(): void {
    bleSupportedText = navigator.bluetooth ? "supported" : "not supported by this browser";
  }

  function initUiFromStorage(): void {
    refreshIdentityUi();
    wifiSecurity = "wpa2";
    relayBaseUrlInput = getRelayBaseUrl();
  }

  async function tick(): Promise<void> {
    const nowMs = performance.now();
    if (pollBusy || nowMs - lastTickMs < 1000) {
      return;
    }
    pollBusy = true;
    lastTickMs = nowMs;

    try {
      if (mode === MODE_FAKE) {
        tickFakeSummary(nowMs);
      } else {
        await tickDeviceSummary(nowMs);
      }
    } finally {
      pollBusy = false;
    }
  }

  async function runAction(name: string, action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      logLine(`${name} failed: ${String(error)}`);
    }
  }

  function saveRelayUrl(): void {
    const normalized = normalizeRelayBaseUrl(relayBaseUrlInput);
    saveStoredString(RELAY_BASE_URL_KEY, normalized);
    relayBaseUrlInput = normalized;
    logLine(`relay base URL saved: ${normalized || "(empty)"}`);
  }

  onMount(() => {
    try {
      window.history.replaceState({ anchorwatch: "root" }, "", window.location.href);
      navigationDepth = 0;
      suppressedPopEvents = 0;
    } catch {
      navigationDepth = 0;
      suppressedPopEvents = 0;
    }
    window.addEventListener("popstate", handlePopState);
    initInstallStatus();
    initBleSupportLabel();
    initNotificationStatus();
    initUiFromStorage();
    void registerServiceWorker();
    updateBleStatus();
    applyMode(mode, false);
    if (mode === MODE_FAKE || !hasPersistedSetup()) {
      setView("config");
      logLine("startup route: onboarding required");
    }
    setSource("--");
    logLine("app started (Svelte)");

    void tick();
    tickInterval = setInterval(() => {
      void tick();
    }, 250);
  });

  onDestroy(() => {
    window.removeEventListener("popstate", handlePopState);
    destroyMapTilerView("map");
    destroyMapTilerView("satellite");
    clearWifiScanTimeout();
    if (tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
    clearPendingAcks("App closed");
  });
</script>

<KonstaApp theme="material" safeAreas>
  <KonstaPage class="am-page">
    <main class="am-main" class:full-screen-view={isFullScreenVizView}>
  {#if activeView === "summary"}
    <SummaryPage
      gpsAgeText={gpsAgeText}
      dataAgeText={dataAgeText}
      depthText={depthText}
      windText={windText}
      statePillClass={statePillClass}
      statePillText={statePillText}
      stateSourceText={stateSourceText}
      currentLatText={currentLatText}
      currentLonText={currentLonText}
      currentSogText={currentSogText}
      currentHeadingText={currentHeadingText}
      pwaVersionText={pwaVersionText}
      firmwareVersionText={firmwareVersionText}
      cloudVersionText={cloudVersionText}
      trackStatusText={trackStatusText}
    />
  {/if}

  {#if activeView === "config" && activeConfigView === "settings"}
    <SettingsHomePage
      configSections={CONFIG_SECTIONS}
      onOpenConfig={(id) => openConfigView(id as ConfigSectionId)}
    />
  {/if}

  {#if activeView === "config" && activeConfigView !== "settings"}
    <div class="config-subpage-header">
      <KonstaButton clear onClick={() => goToSettingsView()}>&larr; Settings</KonstaButton>
    </div>
  {/if}

  {#if activeView === "config" && activeConfigView === "onboarding"}
    <OnboardingPage
      onboardingStep={onboardingStep}
      onboardingStepLabel={onboardingStepLabel}
      onboardingStepTitle={onboardingStepTitle}
      installStatus={installStatus}
      bleSupportedText={bleSupportedText}
      modeIsFake={mode === MODE_FAKE}
      bleStatusText={bleStatusText}
      boatIdText={boatIdText}
      secretStatusText={secretStatusText}
      cloudStatusText={cloudStatusText}
      pwaVersionText={pwaVersionText}
      firmwareVersionText={firmwareVersionText}
      cloudVersionText={cloudVersionText}
      bleConnected={ble.connected}
      wifiScanInFlight={wifiScanInFlight}
      wifiScanStatusText={wifiScanStatusText}
      bind:wifiScanErrorText
      availableWifiNetworks={availableWifiNetworks}
      bind:selectedWifiSsid
      bind:wifiSsid
      bind:wifiSecurity
      bind:wifiPass
      bind:wifiCountry
      selectedWifiNetwork={selectedWifiNetwork}
      onboardingWifiConnected={onboardingWifiConnected}
      onboardingWifiErrorText={onboardingWifiErrorText}
      onboardingWifiStateText={onboardingWifiStateText}
      onboardingWifiSsid={onboardingWifiSsid}
      onboardingWifiRssiText={onboardingWifiRssiText}
      bind:relayBaseUrlInput
      relayResult={relayResult}
      onboardingLogText={onboardingLogText}
      formatWifiSecurity={(security) => formatWifiSecurity(security as WifiSecurity)}
      onSelectDeviceMode={selectDeviceModeForOnboarding}
      onUseFakeMode={() => void runAction("use fake mode", skipOnboardingWithFakeMode)}
      onConnectBle={() => void runAction("ble connect", connectBleForOnboarding)}
      onDisconnectBle={() => void runAction("ble disconnect", disconnectBle)}
      onContinueToWifiStep={() => void runAction("continue to wlan settings", async () => continueToWifiStep())}
      onScanWifiNetworks={() => void runAction("scan wlan networks", scanWifiNetworks)}
      onSelectWifiNetwork={selectWifiNetwork}
      onApplyWifiAndContinue={() => void runAction("apply wlan settings", applyWifiAndContinue)}
      onBackToBleStep={() => { onboardingStep = 1; }}
      onBackToWifiSettingsStep={backToWifiSettingsStep}
      onGoToSummary={goToSummaryFromOnboarding}
      onRefreshStatus={() => void runAction("refresh status snapshot", readSnapshotFromBle)}
      onSaveRelayUrl={saveRelayUrl}
      onProbeRelay={() => void runAction("relay ping", probeRelay)}
      onVerifyCloud={() => void runAction("verify cloud", verifyCloudAuth)}
    />
  {/if}

  {#if activeView === "satellite"}
    <SatellitePage
      hasMapTilerKey={Boolean(MAPTILER_API_KEY)}
      maptilerStatusText={maptilerStatusText}
      trackStatusText={trackStatusText}
      bind:container={maptilerSatelliteContainer}
    />
  {/if}

  {#if activeView === "map"}
    <MapPage
      hasMapTilerKey={Boolean(MAPTILER_API_KEY)}
      maptilerStatusText={maptilerStatusText}
      currentLatText={currentLatText}
      currentLonText={currentLonText}
      currentSogText={currentSogText}
      currentCogText={currentCogText}
      bind:container={maptilerMapContainer}
    />
  {/if}

  {#if activeView === "radar"}
    <RadarPage
      radarTargetX={radarTargetX}
      radarTargetY={radarTargetY}
      radarDistanceText={radarDistanceText}
      radarBearingText={radarBearingText}
      currentHeadingText={currentHeadingText}
    />
  {/if}

  {#if activeView === "config" && activeConfigView === "anchor"}
    <AnchorConfigPage
      bind:anchorMode
      bind:anchorOffsetDistanceM
      bind:anchorOffsetAngleDeg
      bind:autoModeEnabled
      bind:autoModeMinForwardSogKn
      bind:autoModeStallMaxSogKn
      bind:autoModeReverseMinSogKn
      bind:autoModeConfirmSeconds
      bind:zoneType
      bind:zoneRadiusM
      bind:polygonPointsInput
      bind:manualAnchorLat
      bind:manualAnchorLon
      onApply={() => void runAction("apply anchor config", applyAnchorConfig)}
    />
  {/if}

  {#if activeView === "config" && activeConfigView === "triggers"}
    <TriggersConfigPage
      bind:triggerWindAboveEnabled
      bind:triggerWindAboveThresholdKn
      bind:triggerWindAboveHoldMs
      bind:triggerWindAboveSeverity
      bind:triggerOutsideAreaEnabled
      bind:triggerOutsideAreaHoldMs
      bind:triggerOutsideAreaSeverity
      bind:triggerGpsAgeEnabled
      bind:triggerGpsAgeMaxMs
      bind:triggerGpsAgeHoldMs
      bind:triggerGpsAgeSeverity
      onApply={() => void runAction("apply trigger config", applyTriggerConfig)}
    />
  {/if}

  {#if activeView === "config" && activeConfigView === "profiles"}
    <ProfilesConfigPage
      bind:profilesMode
      bind:profileAutoSwitchSource
      bind:profileDayStartLocal
      bind:profileNightStartLocal
      bind:profileDayColorScheme
      bind:profileDayBrightnessPct
      bind:profileDayOutputProfile
      bind:profileNightColorScheme
      bind:profileNightBrightnessPct
      bind:profileNightOutputProfile
      notificationPermissionText={notificationPermissionText}
      notificationStatusText={notificationStatusText}
      onApply={() => void runAction("apply profile config", applyProfilesConfig)}
      onRequestPermission={() => void runAction("request notification permission", requestNotificationPermission)}
      onSendTestNotification={() => void runAction("send test notification", sendTestNotification)}
    />
  {/if}

    </main>
    <Tabbar icons class="am-tabbar fixed bottom-0 left-0 right-0 z-40" aria-label="Anqori AnchorWatch sections">
      {#each VIEW_TABS as tab}
        <TabbarLink
          class="am-tab-link"
          active={activeView === tab.id}
          colors={TABBAR_LINK_COLORS}
          onclick={() => setView(tab.id)}
          linkProps={{ "aria-label": tab.label, title: tab.label }}
        >
          {#snippet icon()}
            <Icon>
              <span class="material-symbols-rounded am-tab-material-icon" aria-hidden="true">{tab.icon}</span>
            </Icon>
          {/snippet}
        </TabbarLink>
      {/each}
    </Tabbar>
  </KonstaPage>
</KonstaApp>
