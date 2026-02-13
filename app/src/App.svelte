<script lang="ts">
  import { onDestroy, onMount } from "svelte";
import {
    Map as MapTilerMap,
    config as maptilerConfig,
    type GeoJSONSource,
  } from "@maptiler/sdk";
  import type {
    AnchorMode,
    AutoSwitchSource,
    BleState,
    ColorScheme,
    ConfigSectionId,
    ConfigViewId,
    Envelope,
    InboundSource,
    JsonRecord,
    Mode,
    PillClass,
    ProfileMode,
    Severity,
    TrackPoint,
    ViewId,
    WifiScanNetwork,
    WifiSecurity,
    ZoneType,
  } from "./core/types";
  import {
    BLE_AUTH_UUID,
    BLE_CHUNK_MAX_PAYLOAD,
    BLE_CHUNK_TIMEOUT_MS,
    BLE_CONTROL_TX_UUID,
    BLE_EVENT_RX_UUID,
    BLE_LIVE_MAX_AGE_MS,
    BLE_SERVICE_UUID,
    BLE_SNAPSHOT_UUID,
    CLOUD_HEALTH_POLL_MS,
    CLOUD_POLL_MS,
    CONFIG_SECTIONS,
    MAPTILER_API_KEY,
    MAPTILER_DEFAULT_CENTER,
    MAPTILER_DEFAULT_ZOOM,
    MAPTILER_MAX_PAN_DISTANCE_M,
    MAPTILER_MAX_VISIBLE_AREA_M2,
    MAPTILER_STYLE_MAP,
    MAPTILER_STYLE_SATELLITE,
    MODE_DEVICE,
    MODE_FAKE,
    PROTOCOL_VERSION,
    PWA_BUILD_VERSION,
    TABBAR_LINK_COLORS,
    TRACK_MAX_POINTS,
    TRACK_SNAPSHOT_LIMIT,
    VIEW_TABS,
    WIFI_SCAN_TIMEOUT_MS,
  } from "./core/constants";
  import {
    clampNumber,
    dataViewToBytes,
    deepMerge,
    extractAckError,
    formatWifiSecurity,
    isObject,
    normalizePatch,
    parseTrackSnapshot,
    parseWifiScanNetworks,
    safeParseJson,
  } from "./services/data-utils";
  import { makeMsgId, writeCharacteristic, writeChunked } from "./services/ble-transport";
  import { maskSecret, normalizeRelayBaseUrl } from "./services/local-storage";
  import {
    buildMapTilerPanBounds,
    buildTrackGeoJson,
    getMapTilerAnchorPoint,
    mapTilerMinZoomForArea,
    maptilerIds,
    resolveMapTilerStyleUrl,
  } from "./services/maptiler-helpers";
  import {
    deriveTelemetry,
    readFirmwareVersionFromState as readFirmwareVersionFromStateDerived,
    readOnboardingWifiStatus as readOnboardingWifiStatusDerived,
  } from "./services/state-derive";
  import {
    ensurePhoneId as ensurePhoneIdStored,
    getBoatId as getBoatIdStored,
    getBoatSecret as getBoatSecretStored,
    getRelayBaseUrl as getRelayBaseUrlStored,
    hasPersistedSetup as hasPersistedSetupStored,
    loadMode as loadModeStored,
    nextConfigVersion as nextConfigVersionStored,
    setMode as setModeStored,
    setBoatId as setBoatIdStored,
    setBoatSecret as setBoatSecretStored,
    setConfigVersion as setConfigVersionStored,
    setRelayBaseUrl as setRelayBaseUrlStored,
  } from "./services/persistence-domain";
  import {
    buildAnchorConfigPatch,
    buildProfilesConfigPatch,
    buildTriggerConfigPatch,
    manualAnchorLogMessage,
  } from "./services/config-patch-builders";
  import {
    App as KonstaApp,
    Icon,
    Page as KonstaPage,
    Tabbar,
    TabbarLink,
  } from "konsta/svelte";
  import SummaryPage from "./features/summary/SummaryPage.svelte";
  import SettingsHomePage from "./features/config/SettingsHomePage.svelte";
  import DeviceBluetoothPage from "./features/config/DeviceBluetoothPage.svelte";
  import InternetWlanPage from "./features/config/InternetWlanPage.svelte";
  import InfoVersionPage from "./features/config/InfoVersionPage.svelte";
  import AnchorConfigPage from "./features/config/AnchorConfigPage.svelte";
  import TriggersConfigPage from "./features/config/TriggersConfigPage.svelte";
  import ProfilesConfigPage from "./features/config/ProfilesConfigPage.svelte";
  import SatellitePage from "./features/map/SatellitePage.svelte";
  import MapPage from "./features/map/MapPage.svelte";
  import RadarPage from "./features/radar/RadarPage.svelte";

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

  let bleSupported = false;
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
  let onboardingWifiSsid = "--";
  let onboardingWifiConnected = false;
  let onboardingWifiRssiText = "--";
  let onboardingWifiErrorText = "";
  let onboardingWifiStateText = "Waiting for Wi-Fi status...";
  let connectedDeviceName = "";
  let settingsDeviceStatusText = "No Device connected yet";
  let settingsInternetStatusText = "Internet not configured";
  let hasStoredDeviceCredentials = false;
  let configSectionsWithStatus = CONFIG_SECTIONS;
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

  $: isFullScreenVizView = activeView === "satellite" || activeView === "map" || activeView === "radar";
  $: isConfigView = activeView === "config";
  $: connectedDeviceName = ble.connected ? (ble.device?.name?.trim() || "device") : "";
  $: settingsDeviceStatusText = ble.connected ? `Connected to ${connectedDeviceName}` : "No Device connected yet";
  $: settingsInternetStatusText = buildInternetSettingsStatusText();
  $: configSectionsWithStatus = CONFIG_SECTIONS.map((section) => ({
    ...section,
    status: section.id === "device"
      ? settingsDeviceStatusText
      : section.id === "internet"
        ? settingsInternetStatusText
        : undefined,
  }));

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
    return readOnboardingWifiStatusDerived(latestState);
  }

  function readFirmwareVersionFromState(): string {
    return readFirmwareVersionFromStateDerived(latestState);
  }

  function hasCloudCredentialsConfigured(): boolean {
    return Boolean(getRelayBaseUrl() && getBoatId() && getBoatSecret());
  }

  function buildInternetSettingsStatusText(): string {
    const lastKnownSsid = onboardingWifiSsid !== "--" ? onboardingWifiSsid : wifiSsid.trim();
    if (onboardingWifiConnected && lastKnownSsid) {
      return `WLAN ${lastKnownSsid} connected`;
    }
    if (onboardingWifiErrorText) {
      return lastKnownSsid ? `WLAN ${lastKnownSsid} failed` : "WLAN connection failed";
    }
    if (wifiScanInFlight) {
      return "Scanning WLAN networks...";
    }
    if (wifiScanErrorText) {
      return "WLAN scan failed";
    }
    if (lastKnownSsid) {
      return `WLAN ${lastKnownSsid} pending`;
    }
    return hasCloudCredentialsConfigured() ? "Internet configured, WLAN pending" : "Internet not configured";
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

  function nextConfigVersion(): number {
    return nextConfigVersionStored();
  }

  function setConfigVersion(version: number): void {
    setConfigVersionStored(version);
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
      const anchorPoint = getMapTilerAnchorPoint(trackPoints);
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
    const style = resolveMapTilerStyleUrl(styleRef, MAPTILER_API_KEY);
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

  function loadMode(): Mode {
    return loadModeStored();
  }

  function getRelayBaseUrl(): string {
    return getRelayBaseUrlStored();
  }

  function getBoatId(): string {
    return getBoatIdStored();
  }

  function setBoatId(value: string): void {
    setBoatIdStored(value);
    refreshIdentityUi();
  }

  function getBoatSecret(): string {
    return getBoatSecretStored();
  }

  function setBoatSecret(secret: string): void {
    setBoatSecretStored(secret);
    refreshIdentityUi();
  }

  function ensurePhoneId(): string {
    return ensurePhoneIdStored();
  }

  function refreshIdentityUi(): void {
    const boatId = getBoatId();
    const boatSecret = getBoatSecret();
    hasStoredDeviceCredentials = Boolean(boatId && boatSecret);
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
      setModeStored(nextMode);
    }
  }

  function hasPersistedSetup(): boolean {
    return hasPersistedSetupStored();
  }

  function setTelemetry(gpsAgeS: number, dataAgeS: number, depthM: number, windKn: number): void {
    gpsAgeText = `${Math.max(0, Math.round(gpsAgeS))}s`;
    dataAgeText = `${Math.max(0, Math.round(dataAgeS))}s`;
    depthText = `${depthM.toFixed(1)} m`;
    windText = `${windKn.toFixed(1)} kn`;
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
    const telemetry = deriveTelemetry(latestState, Date.now());
    setTelemetry(telemetry.gpsAgeS, telemetry.dataAgeS, telemetry.depthM, telemetry.windKn);
    if (telemetry.trackPoint) {
      appendTrackPoint(telemetry.trackPoint);
    }
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
      await writeChunked(ble.controlTx, envelope.msgId as string, raw, encoder);
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
    wifiScanStatusText = "BLE disconnected. Reconnect to scan WLAN networks.";
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

  async function searchForDeviceViaBluetooth(): Promise<void> {
    selectDeviceModeForSetup();
    if (ble.connected) {
      await disconnectBle();
    }
    await connectBle();
  }

  async function applyWifiConfigFromInternetPage(): Promise<void> {
    await applyWiFiConfig();
    await readSnapshotFromBle();
  }

  function clearWifiSelectionForManualEntry(): void {
    selectedWifiSsid = "";
    wifiSsid = "";
    wifiScanErrorText = "";
  }

  function selectDeviceModeForSetup(): void {
    if (mode === MODE_DEVICE) {
      return;
    }
    applyMode(MODE_DEVICE);
    logLine("device mode selected for setup");
  }

  async function useFakeModeAndReturnHome(): Promise<void> {
    applyMode(MODE_FAKE);
    if (ble.connected) {
      await disconnectBle();
    }
    setView("summary");
    logLine("fake mode selected; skipped BLE/cloud setup");
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
    const patch = buildAnchorConfigPatch({
      anchorMode,
      anchorOffsetDistanceM,
      anchorOffsetAngleDeg,
      autoModeEnabled,
      autoModeMinForwardSogKn,
      autoModeStallMaxSogKn,
      autoModeReverseMinSogKn,
      autoModeConfirmSeconds,
      zoneType,
      zoneRadiusM,
      polygonPointsInput,
      manualAnchorLat,
      manualAnchorLon,
    });

    await sendConfigPatch(patch, "anchor+zone");
    const manualLog = manualAnchorLogMessage({
      anchorMode,
      anchorOffsetDistanceM,
      anchorOffsetAngleDeg,
      autoModeEnabled,
      autoModeMinForwardSogKn,
      autoModeStallMaxSogKn,
      autoModeReverseMinSogKn,
      autoModeConfirmSeconds,
      zoneType,
      zoneRadiusM,
      polygonPointsInput,
      manualAnchorLat,
      manualAnchorLon,
    });
    if (manualLog) {
      logLine(manualLog);
    }
  }

  async function applyTriggerConfig(): Promise<void> {
    const patch = buildTriggerConfigPatch({
      triggerWindAboveEnabled,
      triggerWindAboveThresholdKn,
      triggerWindAboveHoldMs,
      triggerWindAboveSeverity,
      triggerOutsideAreaEnabled,
      triggerOutsideAreaHoldMs,
      triggerOutsideAreaSeverity,
      triggerGpsAgeEnabled,
      triggerGpsAgeMaxMs,
      triggerGpsAgeHoldMs,
      triggerGpsAgeSeverity,
    });
    await sendConfigPatch(patch, "triggers");
  }

  async function applyProfilesConfig(): Promise<void> {
    const patch = buildProfilesConfigPatch({
      profilesMode,
      profileDayColorScheme,
      profileDayBrightnessPct,
      profileDayOutputProfile,
      profileNightColorScheme,
      profileNightBrightnessPct,
      profileNightOutputProfile,
      profileAutoSwitchSource,
      profileDayStartLocal,
      profileNightStartLocal,
    });
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
    if (nextConfigView === "internet") {
      prefillWifiSettingsFromCurrentState();
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
    bleSupported = Boolean(navigator.bluetooth);
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
    setRelayBaseUrlStored(normalized);
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
    initBleSupportLabel();
    initNotificationStatus();
    initUiFromStorage();
    void registerServiceWorker();
    updateBleStatus();
    applyMode(mode, false);
    if (mode === MODE_FAKE || !hasPersistedSetup()) {
      setView("config");
      logLine("startup route: connection setup required");
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
    <main class="am-main" class:full-screen-view={isFullScreenVizView} class:config-view={isConfigView}>
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
      configSections={configSectionsWithStatus}
      onOpenConfig={openConfigView}
    />
  {/if}

  {#if activeView === "config" && activeConfigView === "device"}
    <DeviceBluetoothPage
      isConfigured={hasStoredDeviceCredentials}
      bleSupported={bleSupported}
      bleStatusText={bleStatusText}
      boatIdText={boatIdText}
      secretStatusText={secretStatusText}
      connectedDeviceName={connectedDeviceName}
      onBack={() => goToSettingsView()}
      onSearchDevice={() => void runAction("search device via bluetooth", searchForDeviceViaBluetooth)}
      onUseDemoData={() => void runAction("use fake mode", useFakeModeAndReturnHome)}
    />
  {/if}

  {#if activeView === "config" && activeConfigView === "internet"}
    <InternetWlanPage
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
      formatWifiSecurity={(security) => formatWifiSecurity(security as WifiSecurity)}
      onScanWifiNetworks={() => void runAction("scan wlan networks", scanWifiNetworks)}
      onSelectWifiNetwork={selectWifiNetwork}
      onApplyWifiConfig={() => void runAction("apply wlan settings", applyWifiConfigFromInternetPage)}
      onClearSelectedNetwork={clearWifiSelectionForManualEntry}
      onRefreshStatus={() => void runAction("refresh status snapshot", readSnapshotFromBle)}
      onSaveRelayUrl={saveRelayUrl}
      onProbeRelay={() => void runAction("relay ping", probeRelay)}
      onVerifyCloud={() => void runAction("verify cloud", verifyCloudAuth)}
      onBack={() => goToSettingsView()}
    />
  {/if}

  {#if activeView === "config" && activeConfigView === "information"}
    <InfoVersionPage
      pwaVersionText={pwaVersionText}
      firmwareVersionText={firmwareVersionText}
      cloudVersionText={cloudVersionText}
      onBack={() => goToSettingsView()}
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
      onBack={() => goToSettingsView()}
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
      onBack={() => goToSettingsView()}
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
      onBack={() => goToSettingsView()}
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
