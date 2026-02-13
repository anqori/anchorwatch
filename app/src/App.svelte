<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { Map as MapTilerMap } from "@maptiler/sdk";
  import type {
    BleState,
    ConfigDraftsState,
    ConfigSectionId,
    ConnectionState,
    Envelope,
    InboundSource,
    JsonRecord,
    Mode,
    NavigationState,
    NetworkState,
    NotificationState,
    PillClass,
    TrackPoint,
    VersionState,
    ViewId,
    WifiScanNetwork,
    WifiSecurity,
  } from "./core/types";
  import {
    BLE_AUTH_UUID,
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
    dataViewToBytes,
    deepMerge,
    formatWifiSecurity,
    isObject,
    normalizePatch,
    parseWifiScanNetworks,
    safeParseJson,
  } from "./services/data-utils";
  import {
    clearPendingAcks as clearPendingAcksSession,
    consumeChunkedBleFrame,
    makeAckPromise as makeAckPromiseSession,
    resolvePendingAckFromPayload,
  } from "./services/ble-session";
  import {
    connectBleWithCharacteristics,
    disconnectBleDevice,
  } from "./services/ble-connection";
  import { deriveBleStatusText, resetBleConnectionState } from "./services/ble-state";
  import { handleBleEnvelope } from "./services/ble-envelope-handler";
  import { makeMsgId, writeCharacteristic, writeChunked } from "./services/ble-transport";
  import {
    fetchCloudBuildVersion,
    fetchCloudSnapshot,
    fetchCloudTrackSnapshot,
    probeCloudRelay,
    verifyCloudStateAuth,
  } from "./services/cloud-runtime";
  import { maskSecret, normalizeRelayBaseUrl } from "./services/local-storage";
  import {
    applyGoToSettings,
    applyOpenConfigSection,
    applyViewChange,
    initNavigationHistoryRoot,
    resolvePopNavigationAction,
  } from "./services/navigation-controller";
  import {
    initNotificationStatus,
    requestNotificationPermission,
    sendTestNotification,
  } from "./services/notification-controller";
  import {
    destroyMapTilerView as destroyMapTilerViewControlled,
    ensureMapTilerView as ensureMapTilerViewControlled,
    updateMapTrackAndViewport,
  } from "./services/maptiler-controller";
  import {
    deriveTelemetry,
    readFirmwareVersionFromState as readFirmwareVersionFromStateDerived,
    readOnboardingWifiStatus as readOnboardingWifiStatusDerived,
  } from "./services/state-derive";
  import {
    buildInternetSettingsStatusText as buildInternetSettingsStatusTextDerived,
    deriveAppConnectivityState as deriveAppConnectivityStateDerived,
    deriveLinkLedState as deriveLinkLedStateDerived,
    hasActiveCloudRelayConnection as hasActiveCloudRelayConnectionDerived,
    hasCloudCredentialsConfigured as hasCloudCredentialsConfiguredDerived,
    hasConfiguredDevice as hasConfiguredDeviceDerived,
    linkLedTitle as linkLedTitleDerived,
  } from "./services/connectivity-derive";
  import {
    deriveRadarProjection,
    deriveTrackSummary,
  } from "./services/track-derive";
  import { deriveFakeSummaryTick } from "./services/simulation-derive";
  import {
    ensurePhoneId as ensurePhoneIdStored,
    getBoatId as getBoatIdStored,
    getBoatSecret as getBoatSecretStored,
    getRelayBaseUrl as getRelayBaseUrlStored,
    hasConnectedViaBleOnce as hasConnectedViaBleOnceStored,
    loadMode as loadModeStored,
    markConnectedViaBleOnce as markConnectedViaBleOnceStored,
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
    mapAnchorDraftToConfigInput,
    mapProfilesDraftToConfigInput,
    mapTriggerDraftToConfigInput,
  } from "./services/config-draft-mappers";
  import { dispatchConfigPatch } from "./services/config-transport";
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
  let pollBusy = false;
  let lastTickMs = 0;
  let lastCloudPollMs = 0;
  let lastCloudHealthPollMs = 0;
  let lastBleMessageAtMs = 0;

  let latestState: JsonRecord = {};
  let latestStateSource: InboundSource | "--" = "--";
  let latestStateUpdatedAtMs = 0;

  let gpsAgeText = "--";
  let dataAgeText = "--";
  let depthText = "--";
  let windText = "--";

  let statePillText = "BOOT";
  let statePillClass: PillClass = "ok";
  let stateSourceText = "Source: --";

  let connection: ConnectionState = {
    mode: loadModeStored(),
    appState: "UNCONFIGURED",
    linkLedState: "unconfigured",
    linkLedTitle: "Unconfigured. Open device setup.",
    bleSupported: false,
    bleStatusText: "disconnected",
    boatIdText: "--",
    secretStatusText: "not stored",
    cloudStatusText: "not checked",
    relayResult: "No request yet.",
    connectedDeviceName: "",
    hasConfiguredDevice: false,
  };

  let versions: VersionState = {
    pwa: PWA_BUILD_VERSION,
    firmware: "--",
    cloud: "--",
  };

  let network: NetworkState = {
    relayBaseUrlInput: "",
    wifiSsid: "",
    wifiPass: "",
    wifiSecurity: "wpa2",
    wifiCountry: "",
    wifiScanRequestId: "",
    wifiScanInFlight: false,
    wifiScanStatusText: "Scan for available WLAN networks.",
    wifiScanErrorText: "",
    availableWifiNetworks: [],
    selectedWifiSsid: "",
    selectedWifiNetwork: null,
    onboardingWifiSsid: "--",
    onboardingWifiConnected: false,
    onboardingWifiRssiText: "--",
    onboardingWifiErrorText: "",
    onboardingWifiStateText: "Waiting for Wi-Fi status...",
    settingsInternetStatusText: "Internet not configured",
  };

  let navigation: NavigationState = {
    settingsDeviceStatusText: "No Device connected yet",
    configSectionsWithStatus: CONFIG_SECTIONS,
    activeView: "summary",
    activeConfigView: "settings",
    depth: 0,
    suppressedPopEvents: 0,
    isFullScreenVizView: false,
    isConfigView: false,
  };

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
  let radarTargetX = 110;
  let radarTargetY = 110;
  let radarDistanceText = "--";
  let radarBearingText = "--";

  let notifications: NotificationState = {
    permissionText: "not checked",
    statusText: "No notification checks yet.",
  };

  let configDrafts: ConfigDraftsState = {
    anchor: {
      mode: "offset",
      offsetDistanceM: "8.0",
      offsetAngleDeg: "210.0",
      autoModeEnabled: true,
      autoModeMinForwardSogKn: "0.8",
      autoModeStallMaxSogKn: "0.3",
      autoModeReverseMinSogKn: "0.4",
      autoModeConfirmSeconds: "20",
      zoneType: "circle",
      zoneRadiusM: "45.0",
      polygonPointsInput: "54.3201,10.1402\n54.3208,10.1413\n54.3198,10.1420",
      manualAnchorLat: "",
      manualAnchorLon: "",
    },
    triggers: {
      windAboveEnabled: true,
      windAboveThresholdKn: "30.0",
      windAboveHoldMs: "15000",
      windAboveSeverity: "warning",
      outsideAreaEnabled: true,
      outsideAreaHoldMs: "10000",
      outsideAreaSeverity: "alarm",
      gpsAgeEnabled: true,
      gpsAgeMaxMs: "5000",
      gpsAgeHoldMs: "5000",
      gpsAgeSeverity: "warning",
    },
    profiles: {
      mode: "auto",
      dayColorScheme: "full",
      dayBrightnessPct: "100",
      dayOutputProfile: "normal",
      nightColorScheme: "red",
      nightBrightnessPct: "20",
      nightOutputProfile: "night",
      autoSwitchSource: "time",
      dayStartLocal: "07:00",
      nightStartLocal: "21:30",
    },
  };

  let logLines: string[] = [];

  let tickInterval: ReturnType<typeof setInterval> | null = null;
  let wifiScanTimeout: ReturnType<typeof setTimeout> | null = null;

  $: navigation.isFullScreenVizView = navigation.activeView === "satellite" || navigation.activeView === "map" || navigation.activeView === "radar";
  $: navigation.isConfigView = navigation.activeView === "config";
  $: connection.connectedDeviceName = ble.connected ? (ble.device?.name?.trim() || "device") : "";
  $: {
    const relayConnected = hasActiveCloudRelayConnectionDerived({
      latestStateSource,
      latestStateUpdatedAtMs,
      cloudPollMs: CLOUD_POLL_MS,
    });
    connection.appState = deriveAppConnectivityStateDerived(connection.hasConfiguredDevice, ble.connected, relayConnected);
    connection.linkLedState = deriveLinkLedStateDerived(connection.hasConfiguredDevice, ble.connected, relayConnected);
    connection.linkLedTitle = linkLedTitleDerived(connection.linkLedState);
  }
  $: navigation.settingsDeviceStatusText = ble.connected ? `Connected to ${connection.connectedDeviceName}` : "No Device connected yet";
  $: network.settingsInternetStatusText = buildInternetSettingsStatusTextDerived({
    onboardingWifiConnected: network.onboardingWifiConnected,
    onboardingWifiSsid: network.onboardingWifiSsid,
    onboardingWifiErrorText: network.onboardingWifiErrorText,
    wifiSsid: network.wifiSsid,
    wifiScanInFlight: network.wifiScanInFlight,
    wifiScanErrorText: network.wifiScanErrorText,
    hasCloudCredentials: readCloudCredentials() !== null,
  });
  $: navigation.configSectionsWithStatus = CONFIG_SECTIONS.map((section) => ({
    ...section,
    status: section.id === "device"
      ? navigation.settingsDeviceStatusText
      : section.id === "internet"
        ? network.settingsInternetStatusText
        : undefined,
  }));

  $: {
    const wifiStatus = readOnboardingWifiStatus();
    network.onboardingWifiConnected = wifiStatus.connected;
    network.onboardingWifiSsid = wifiStatus.ssid || "--";
    network.onboardingWifiRssiText = wifiStatus.rssi === null ? "--" : `${wifiStatus.rssi} dBm`;
    network.onboardingWifiErrorText = wifiStatus.error;

    if (wifiStatus.connected) {
      network.onboardingWifiStateText = `Connected to ${network.onboardingWifiSsid}`;
    } else if (wifiStatus.error) {
      network.onboardingWifiStateText = `Not connected (${wifiStatus.error})`;
    } else {
      network.onboardingWifiStateText = "Connecting or waiting for Wi-Fi telemetry...";
    }
  }

  $: network.selectedWifiNetwork = network.availableWifiNetworks.find((wifiNetwork) => wifiNetwork.ssid === network.selectedWifiSsid) ?? null;
  $: versions.firmware = readFirmwareVersionFromState();

  function applyWifiScanNetworks(networks: WifiScanNetwork[]): void {
    network.availableWifiNetworks = networks;
    if (!networks.some((wifiNetwork) => wifiNetwork.ssid === network.selectedWifiSsid)) {
      network.selectedWifiSsid = "";
    }

    if (network.wifiSsid && !network.selectedWifiSsid) {
      const match = networks.find((wifiNetwork) => wifiNetwork.ssid === network.wifiSsid);
      if (match) {
        network.selectedWifiSsid = match.ssid;
      }
    }
  }

  function selectWifiNetwork(wifiNetwork: WifiScanNetwork): void {
    network.selectedWifiSsid = wifiNetwork.ssid;
    network.wifiSsid = wifiNetwork.ssid;
    if (wifiNetwork.security !== "unknown") {
      network.wifiSecurity = wifiNetwork.security;
    }
    if (wifiNetwork.security === "open") {
      network.wifiPass = "";
    }
    network.wifiScanErrorText = "";
  }

  function readOnboardingWifiStatus(): { connected: boolean; ssid: string; rssi: number | null; error: string } {
    return readOnboardingWifiStatusDerived(latestState);
  }

  function readFirmwareVersionFromState(): string {
    return readFirmwareVersionFromStateDerived(latestState);
  }

  function computeConfiguredDeviceState(): boolean {
    return hasConfiguredDeviceDerived(getBoatIdStored(), hasConnectedViaBleOnceStored());
  }

  function readCloudCredentialFields(): { base: string; boatId: string; boatSecret: string } {
    return {
      base: getRelayBaseUrlStored(),
      boatId: getBoatIdStored(),
      boatSecret: getBoatSecretStored(),
    };
  }

  function readCloudCredentials(): { base: string; boatId: string; boatSecret: string } | null {
    const credentials = readCloudCredentialFields();
    if (!hasCloudCredentialsConfiguredDerived(credentials.base, credentials.boatId, credentials.boatSecret)) {
      return null;
    }
    return credentials;
  }

  function prefillWifiSettingsFromCurrentState(): void {
    const wifiStatus = readOnboardingWifiStatus();
    if (wifiStatus.ssid) {
      network.wifiSsid = wifiStatus.ssid;
      network.selectedWifiSsid = wifiStatus.ssid;
    }
    if (!network.wifiCountry.trim()) {
      network.wifiCountry = "DE";
    }
    network.wifiScanErrorText = "";
    network.wifiScanStatusText = "Scan for available WLAN networks.";
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

  function ensureMapTilerView(kind: "map" | "satellite"): void {
    const nextMap = ensureMapTilerViewControlled({
      kind,
      existingMap: getMapTilerInstance(kind),
      container: kind === "map" ? maptilerMapContainer : maptilerSatelliteContainer,
      getTrackPoints: () => trackPoints,
      apiKey: MAPTILER_API_KEY,
      defaultCenter: MAPTILER_DEFAULT_CENTER,
      defaultZoom: MAPTILER_DEFAULT_ZOOM,
      styleMapRef: MAPTILER_STYLE_MAP,
      styleSatelliteRef: MAPTILER_STYLE_SATELLITE,
      maxPanDistanceM: MAPTILER_MAX_PAN_DISTANCE_M,
      maxVisibleAreaM2: MAPTILER_MAX_VISIBLE_AREA_M2,
      setStatusText: (text) => {
        maptilerStatusText = text;
      },
    });
    setMapTilerInstance(kind, nextMap);
  }

  function destroyMapTilerView(kind: "map" | "satellite"): void {
    if (kind === "map") {
      maptilerMap = destroyMapTilerViewControlled(maptilerMap);
      return;
    }
    maptilerSatellite = destroyMapTilerViewControlled(maptilerSatellite);
  }

  function updateTrackProjection(points: TrackPoint[]): void {
    const radarProjection = deriveRadarProjection(points);
    radarTargetX = radarProjection.targetX;
    radarTargetY = radarProjection.targetY;
    radarDistanceText = radarProjection.distanceText;
    radarBearingText = radarProjection.bearingText;

    if (maptilerMap) {
      updateMapTrackAndViewport({
        map: maptilerMap,
        kind: "map",
        getTrackPoints: () => trackPoints,
        maxPanDistanceM: MAPTILER_MAX_PAN_DISTANCE_M,
        maxVisibleAreaM2: MAPTILER_MAX_VISIBLE_AREA_M2,
      });
    }
    if (maptilerSatellite) {
      updateMapTrackAndViewport({
        map: maptilerSatellite,
        kind: "satellite",
        getTrackPoints: () => trackPoints,
        maxPanDistanceM: MAPTILER_MAX_PAN_DISTANCE_M,
        maxVisibleAreaM2: MAPTILER_MAX_VISIBLE_AREA_M2,
      });
    }

    const trackSummary = deriveTrackSummary(points);
    currentLatText = trackSummary.currentLatText;
    currentLonText = trackSummary.currentLonText;
    currentSogText = trackSummary.currentSogText;
    currentCogText = trackSummary.currentCogText;
    currentHeadingText = trackSummary.currentHeadingText;
    trackStatusText = trackSummary.statusText;
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

  function setBoatId(value: string): void {
    setBoatIdStored(value);
    refreshIdentityUi();
  }

  function setBoatSecret(secret: string): void {
    setBoatSecretStored(secret);
    refreshIdentityUi();
  }

  function refreshIdentityUi(): void {
    const boatId = getBoatIdStored();
    const boatSecret = getBoatSecretStored();
    connection.hasConfiguredDevice = computeConfiguredDeviceState();
    connection.boatIdText = boatId || "--";
    connection.secretStatusText = maskSecret(boatSecret);
    network.relayBaseUrlInput = getRelayBaseUrlStored();
  }

  function updateBleStatus(): void {
    connection.bleStatusText = deriveBleStatusText(ble.connected, ble.authState);
  }

  function applyMode(nextMode: Mode, persist = true): void {
    connection.mode = nextMode;
    if (persist) {
      setModeStored(nextMode);
    }
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
    const tick = deriveFakeSummaryTick(nowMs, bootMs);
    setTelemetry(tick.gpsAgeS, tick.dataAgeS, tick.depthM, tick.windKn);
    setSource("fake-simulator");
    appendTrackPoint(tick.trackPoint);
    setState(tick.stateText, tick.stateClass);
  }

  function buildEnvelope(msgType: string, payload: JsonRecord, requiresAck = true): Envelope {
    return {
      ver: PROTOCOL_VERSION,
      msgType,
      msgId: makeMsgId(),
      boatId: getBoatIdStored() || "boat_unknown",
      deviceId: ensurePhoneIdStored(),
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
    const ackPromise = requiresAck && envelope.msgId ? makeAckPromiseSession(ble.pendingAcks, envelope.msgId) : null;

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
    network.wifiScanInFlight = false;
    network.wifiScanErrorText = "";
    if (requestId) {
      network.wifiScanRequestId = requestId;
    }

    applyWifiScanNetworks(scannedNetworks);
    network.wifiScanStatusText = scannedNetworks.length > 0
      ? `Found ${scannedNetworks.length} WLAN network${scannedNetworks.length === 1 ? "" : "s"}.`
      : "No WLAN networks found. Try scanning again.";
    logLine(`onboarding.wifi.scan_result received (${scannedNetworks.length} networks)`);
  }

  function handleEnvelope(envelope: Envelope, sourceTag: InboundSource): void {
    handleBleEnvelope(envelope, sourceTag, {
      setBoatId,
      setBoatSecret,
      applyStatePatch,
      applyStateSnapshot,
      applyWifiScanResult,
      replaceTrackPoints,
      resolvePendingAck: (payload) => {
        resolvePendingAckFromPayload(ble.pendingAcks, payload);
      },
      markBleMessageSeen: () => {
        lastBleMessageAtMs = Date.now();
      },
      logLine,
    });
  }

  function handleChunkedBleFrame(bytes: Uint8Array): void {
    const frame = consumeChunkedBleFrame(
      ble.chunkAssemblies,
      bytes,
      (chunk) => decoder.decode(chunk),
      BLE_CHUNK_TIMEOUT_MS,
    );
    if (frame.kind !== "complete" || !frame.raw) {
      return;
    }
    const parsed = safeParseJson(frame.raw);
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
    const previousDevice = ble.device;
    const previousEventRx = ble.eventRx;
    if (previousEventRx) {
      previousEventRx.removeEventListener("characteristicvaluechanged", onBleNotification as EventListener);
    }
    if (previousDevice) {
      previousDevice.removeEventListener("gattserverdisconnected", onBleDisconnected as EventListener);
    }

    clearWifiScanTimeout();
    network.wifiScanInFlight = false;
    network.wifiScanStatusText = "BLE disconnected. Reconnect to scan WLAN networks.";
    resetBleConnectionState(ble);
    clearPendingAcksSession(ble.pendingAcks, "BLE disconnected");
    updateBleStatus();
    logLine("BLE disconnected");
  }

  async function connectBle(): Promise<void> {
    const {
      device,
      server,
      service,
      controlTx,
      eventRx,
      snapshot,
      auth,
    } = await connectBleWithCharacteristics({
      serviceUuid: BLE_SERVICE_UUID,
      controlTxUuid: BLE_CONTROL_TX_UUID,
      eventRxUuid: BLE_EVENT_RX_UUID,
      snapshotUuid: BLE_SNAPSHOT_UUID,
      authUuid: BLE_AUTH_UUID,
      onDisconnected: onBleDisconnected as EventListener,
      onNotification: onBleNotification as EventListener,
    });

    ble.device = device;
    ble.server = server;
    ble.service = service;
    ble.controlTx = controlTx;
    ble.eventRx = eventRx;
    ble.snapshot = snapshot;
    ble.auth = auth;
    ble.connected = true;
    ble.chunkAssemblies.clear();
    markConnectedViaBleOnceStored();
    connection.hasConfiguredDevice = computeConfiguredDeviceState();

    updateBleStatus();
    logLine(`BLE connected to ${device.name || "device"}`);
    await refreshAuthState();
    await readSnapshotFromBle();
  }

  async function disconnectBle(): Promise<void> {
    if (disconnectBleDevice(ble.device)) {
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
    network.wifiScanRequestId = requestId;
    network.wifiScanInFlight = true;
    network.wifiScanErrorText = "";
    network.wifiScanStatusText = "Scanning nearby WLAN networks...";

    wifiScanTimeout = setTimeout(() => {
      if (!network.wifiScanInFlight || network.wifiScanRequestId !== requestId) {
        return;
      }
      network.wifiScanInFlight = false;
      network.wifiScanErrorText = "No scan result received from device.";
      network.wifiScanStatusText = "WLAN scan timed out. Try scanning again.";
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
        network.wifiScanInFlight = false;
        network.wifiScanStatusText = `Found ${ackNetworks.length} WLAN network${ackNetworks.length === 1 ? "" : "s"}.`;
      }
    } catch (error) {
      clearWifiScanTimeout();
      network.wifiScanInFlight = false;
      network.wifiScanErrorText = String(error);
      network.wifiScanStatusText = "WLAN scan failed.";
      throw error;
    }
  }

  async function applyWiFiConfig(): Promise<void> {
    const ssid = network.wifiSsid.trim();
    const passphrase = network.wifiPass;
    const security = network.wifiSecurity === "unknown" ? "wpa2" : network.wifiSecurity;
    const country = network.wifiCountry.trim().toUpperCase();

    if (!ssid) {
      throw new Error("Wi-Fi SSID is required");
    }

    const patch: JsonRecord = {
      "network.wifi.ssid": ssid,
      "network.wifi.passphrase": passphrase,
      "network.wifi.security": security,
      "network.wifi.country": country || "DE",
      "network.wifi.hidden": network.selectedWifiNetwork?.hidden ?? false,
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
    network.selectedWifiSsid = "";
    network.wifiSsid = "";
    network.wifiScanErrorText = "";
  }

  function selectDeviceModeForSetup(): void {
    if (connection.mode === MODE_DEVICE) {
      return;
    }
    applyMode(MODE_DEVICE);
    logLine("device connection.mode selected for setup");
  }

  async function useFakeModeAndReturnHome(): Promise<void> {
    applyMode(MODE_FAKE);
    if (ble.connected) {
      await disconnectBle();
    }
    setView("summary");
    logLine("fake connection.mode selected; skipped BLE/cloud setup");
  }

  async function sendConfigPatch(patch: JsonRecord, reason: string): Promise<void> {
    const version = nextConfigVersionStored();
    const transport = await dispatchConfigPatch({
      patch,
      version,
      bleConnected: ble.connected,
      sendViaBle: async (nextVersion, nextPatch) => {
        await sendControlMessage("config.patch", { version: nextVersion, patch: nextPatch }, true);
      },
      cloudCredentials: readCloudCredentials(),
      protocolVersion: PROTOCOL_VERSION,
      deviceId: ensurePhoneIdStored(),
    });
    setConfigVersionStored(version);
    logLine(`config.patch sent via ${transport === "ble" ? "BLE" : "cloud"} (${reason}) version=${version}`);
  }

  async function applyAnchorConfig(): Promise<void> {
    const anchorInput = mapAnchorDraftToConfigInput(configDrafts.anchor);
    const patch = buildAnchorConfigPatch(anchorInput);

    await sendConfigPatch(patch, "anchor+zone");
    const manualLog = manualAnchorLogMessage(anchorInput);
    if (manualLog) {
      logLine(manualLog);
    }
  }

  async function applyTriggerConfig(): Promise<void> {
    const patch = buildTriggerConfigPatch(mapTriggerDraftToConfigInput(configDrafts.triggers));
    await sendConfigPatch(patch, "triggers");
  }

  async function applyProfilesConfig(): Promise<void> {
    const patch = buildProfilesConfigPatch(mapProfilesDraftToConfigInput(configDrafts.profiles));
    await sendConfigPatch(patch, "profiles");
  }

  async function fetchTrackSnapshot(): Promise<void> {
    const cloudCredentials = readCloudCredentials();
    if (!cloudCredentials) {
      throw new Error("Track fetch requires relay URL + boatId + boatSecret");
    }
    const snapshot = await fetchCloudTrackSnapshot(cloudCredentials, TRACK_SNAPSHOT_LIMIT);
    if (snapshot.status === 404) {
      trackStatusText = "No cloud track available yet.";
      logLine("track snapshot not found (404)");
      return;
    }
    replaceTrackPoints(snapshot.points);
    logLine(`track snapshot loaded (${snapshot.points.length} points)`);
  }

  function setView(nextView: ViewId): void {
    const transition = applyViewChange(navigation, nextView);
    if (transition.leftMapView) {
      destroyMapTilerView(transition.leftMapView);
    }
    if (transition.enteredMapView === "map") {
      requestAnimationFrame(() => ensureMapTilerView("map"));
    } else if (transition.enteredMapView === "satellite") {
      requestAnimationFrame(() => ensureMapTilerView("satellite"));
    }

    if ((nextView === "satellite" || nextView === "map" || nextView === "radar") && connection.mode === MODE_DEVICE && trackPoints.length < 3) {
      void runAction("track snapshot", fetchTrackSnapshot);
    }
  }

  function openConfigView(nextConfigView: ConfigSectionId): void {
    applyOpenConfigSection(navigation, nextConfigView);
    if (nextConfigView === "internet") {
      prefillWifiSettingsFromCurrentState();
    }
  }

  function goToSettingsView(syncHistory = true): void {
    applyGoToSettings(navigation, syncHistory);
  }

  function handlePopState(): void {
    const action = resolvePopNavigationAction(navigation);
    if (action === "to_settings") {
      goToSettingsView(false);
      return;
    }
    if (action === "to_summary") {
      const previousView = navigation.activeView;
      navigation.activeView = "summary";
      navigation.activeConfigView = "settings";
      if (previousView === "map") {
        destroyMapTilerView("map");
      } else if (previousView === "satellite") {
        destroyMapTilerView("satellite");
      }
    }
  }

  function applyCloudBuildVersion(buildVersion: string | null): void {
    if (buildVersion) {
      versions.cloud = buildVersion;
    }
  }

  async function refreshCloudVersion(base: string): Promise<void> {
    const now = Date.now();
    if (now - lastCloudHealthPollMs < CLOUD_HEALTH_POLL_MS) {
      return;
    }
    lastCloudHealthPollMs = now;

    try {
      const buildVersion = await fetchCloudBuildVersion(base);
      applyCloudBuildVersion(buildVersion);
    } catch {
      // Ignore cloud health parsing errors in background refresh path.
    }
  }

  async function probeRelay(): Promise<void> {
    const base = getRelayBaseUrlStored();
    if (!base) {
      connection.relayResult = "Set relay base URL first.";
      return;
    }

    try {
      const relayProbe = await probeCloudRelay(base);
      connection.relayResult = relayProbe.resultText;
      applyCloudBuildVersion(relayProbe.buildVersion);
    } catch (error) {
      connection.relayResult = `Relay probe failed: ${String(error)}`;
    }
  }

  async function verifyCloudAuth(): Promise<void> {
    const { base, boatId, boatSecret } = readCloudCredentialFields();

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

    const authVerify = await verifyCloudStateAuth({ base, boatId, boatSecret });
    if (authVerify.ok) {
      connection.cloudStatusText = `ok (${authVerify.status})`;
      logLine(`cloud auth verify ok (${authVerify.status})`);
      return;
    }
    connection.cloudStatusText = `failed (${authVerify.status})`;
    throw new Error(`cloud verify failed ${authVerify.status}: ${authVerify.errorText}`);
  }

  async function pollCloudState(nowMs: number): Promise<void> {
    if (nowMs - lastCloudPollMs < CLOUD_POLL_MS) {
      return;
    }
    lastCloudPollMs = nowMs;

    const cloudCredentials = readCloudCredentials();
    if (!cloudCredentials) {
      return;
    }
    const { base } = cloudCredentials;

    try {
      await refreshCloudVersion(base);
      const cloudSnapshot = await fetchCloudSnapshot(cloudCredentials);
      if (cloudSnapshot.status === 404 || cloudSnapshot.snapshot === null) {
        return;
      }
      applyStateSnapshot(cloudSnapshot.snapshot, "cloud/status.snapshot");
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
    connection.bleSupported = Boolean(navigator.bluetooth);
  }

  function initUiFromStorage(): void {
    refreshIdentityUi();
    network.wifiSecurity = "wpa2";
    network.relayBaseUrlInput = getRelayBaseUrlStored();
  }

  async function tick(): Promise<void> {
    const nowMs = performance.now();
    if (pollBusy || nowMs - lastTickMs < 1000) {
      return;
    }
    pollBusy = true;
    lastTickMs = nowMs;

    try {
      if (connection.mode === MODE_FAKE) {
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
    const normalized = normalizeRelayBaseUrl(network.relayBaseUrlInput);
    setRelayBaseUrlStored(normalized);
    network.relayBaseUrlInput = normalized;
    logLine(`relay base URL saved: ${normalized || "(empty)"}`);
  }

  function openConfigFromStatusLed(): void {
    if (connection.linkLedState === "unconfigured") {
      openConfigView("device");
      return;
    }
    setView("config");
  }

  onMount(() => {
    initNavigationHistoryRoot(navigation);
    window.addEventListener("popstate", handlePopState);
    initBleSupportLabel();
    initNotificationStatus(notifications);
    initUiFromStorage();
    void registerServiceWorker();
    updateBleStatus();
    applyMode(connection.mode, false);
    if (connection.mode === MODE_FAKE || !connection.hasConfiguredDevice) {
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
    clearPendingAcksSession(ble.pendingAcks, "App closed");
  });
</script>

<KonstaApp theme="material" safeAreas>
  <KonstaPage class="am-page">
    <main class="am-main" class:full-screen-view={navigation.isFullScreenVizView} class:config-view={navigation.isConfigView}>
  {#if navigation.activeView === "summary"}
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
      pwaVersionText={versions.pwa}
      firmwareVersionText={versions.firmware}
      cloudVersionText={versions.cloud}
      trackStatusText={trackStatusText}
    />
  {/if}

  {#if navigation.activeView === "config" && navigation.activeConfigView === "settings"}
    <SettingsHomePage
      configSections={navigation.configSectionsWithStatus}
      onOpenConfig={openConfigView}
    />
  {/if}

  {#if navigation.activeView === "config" && navigation.activeConfigView === "device"}
    <DeviceBluetoothPage
      isConfigured={connection.hasConfiguredDevice}
      appState={connection.appState}
      bleSupported={connection.bleSupported}
      bleStatusText={connection.bleStatusText}
      boatIdText={connection.boatIdText}
      secretStatusText={connection.secretStatusText}
      connectedDeviceName={connection.connectedDeviceName}
      onBack={() => goToSettingsView()}
      onSearchDevice={() => void runAction("search device via bluetooth", searchForDeviceViaBluetooth)}
      onUseDemoData={() => void runAction("use fake mode", useFakeModeAndReturnHome)}
    />
  {/if}

  {#if navigation.activeView === "config" && navigation.activeConfigView === "internet"}
    <InternetWlanPage
      bleConnected={ble.connected}
      wifiScanInFlight={network.wifiScanInFlight}
      wifiScanStatusText={network.wifiScanStatusText}
      bind:wifiScanErrorText={network.wifiScanErrorText}
      availableWifiNetworks={network.availableWifiNetworks}
      bind:selectedWifiSsid={network.selectedWifiSsid}
      bind:wifiSsid={network.wifiSsid}
      bind:wifiSecurity={network.wifiSecurity}
      bind:wifiPass={network.wifiPass}
      bind:wifiCountry={network.wifiCountry}
      selectedWifiNetwork={network.selectedWifiNetwork}
      onboardingWifiConnected={network.onboardingWifiConnected}
      onboardingWifiErrorText={network.onboardingWifiErrorText}
      onboardingWifiStateText={network.onboardingWifiStateText}
      onboardingWifiSsid={network.onboardingWifiSsid}
      onboardingWifiRssiText={network.onboardingWifiRssiText}
      bind:relayBaseUrlInput={network.relayBaseUrlInput}
      relayResult={connection.relayResult}
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

  {#if navigation.activeView === "config" && navigation.activeConfigView === "information"}
    <InfoVersionPage
      pwaVersionText={versions.pwa}
      firmwareVersionText={versions.firmware}
      cloudVersionText={versions.cloud}
      onBack={() => goToSettingsView()}
    />
  {/if}

  {#if navigation.activeView === "satellite"}
    <SatellitePage
      hasMapTilerKey={Boolean(MAPTILER_API_KEY)}
      maptilerStatusText={maptilerStatusText}
      trackStatusText={trackStatusText}
      bind:container={maptilerSatelliteContainer}
    />
  {/if}

  {#if navigation.activeView === "map"}
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

  {#if navigation.activeView === "radar"}
    <RadarPage
      radarTargetX={radarTargetX}
      radarTargetY={radarTargetY}
      radarDistanceText={radarDistanceText}
      radarBearingText={radarBearingText}
      currentHeadingText={currentHeadingText}
    />
  {/if}

  {#if navigation.activeView === "config" && navigation.activeConfigView === "anchor"}
    <AnchorConfigPage
      bind:anchorMode={configDrafts.anchor.mode}
      bind:anchorOffsetDistanceM={configDrafts.anchor.offsetDistanceM}
      bind:anchorOffsetAngleDeg={configDrafts.anchor.offsetAngleDeg}
      bind:autoModeEnabled={configDrafts.anchor.autoModeEnabled}
      bind:autoModeMinForwardSogKn={configDrafts.anchor.autoModeMinForwardSogKn}
      bind:autoModeStallMaxSogKn={configDrafts.anchor.autoModeStallMaxSogKn}
      bind:autoModeReverseMinSogKn={configDrafts.anchor.autoModeReverseMinSogKn}
      bind:autoModeConfirmSeconds={configDrafts.anchor.autoModeConfirmSeconds}
      bind:zoneType={configDrafts.anchor.zoneType}
      bind:zoneRadiusM={configDrafts.anchor.zoneRadiusM}
      bind:polygonPointsInput={configDrafts.anchor.polygonPointsInput}
      bind:manualAnchorLat={configDrafts.anchor.manualAnchorLat}
      bind:manualAnchorLon={configDrafts.anchor.manualAnchorLon}
      onBack={() => goToSettingsView()}
      onApply={() => void runAction("apply anchor config", applyAnchorConfig)}
    />
  {/if}

  {#if navigation.activeView === "config" && navigation.activeConfigView === "triggers"}
    <TriggersConfigPage
      bind:triggerWindAboveEnabled={configDrafts.triggers.windAboveEnabled}
      bind:triggerWindAboveThresholdKn={configDrafts.triggers.windAboveThresholdKn}
      bind:triggerWindAboveHoldMs={configDrafts.triggers.windAboveHoldMs}
      bind:triggerWindAboveSeverity={configDrafts.triggers.windAboveSeverity}
      bind:triggerOutsideAreaEnabled={configDrafts.triggers.outsideAreaEnabled}
      bind:triggerOutsideAreaHoldMs={configDrafts.triggers.outsideAreaHoldMs}
      bind:triggerOutsideAreaSeverity={configDrafts.triggers.outsideAreaSeverity}
      bind:triggerGpsAgeEnabled={configDrafts.triggers.gpsAgeEnabled}
      bind:triggerGpsAgeMaxMs={configDrafts.triggers.gpsAgeMaxMs}
      bind:triggerGpsAgeHoldMs={configDrafts.triggers.gpsAgeHoldMs}
      bind:triggerGpsAgeSeverity={configDrafts.triggers.gpsAgeSeverity}
      onBack={() => goToSettingsView()}
      onApply={() => void runAction("apply trigger config", applyTriggerConfig)}
    />
  {/if}

  {#if navigation.activeView === "config" && navigation.activeConfigView === "profiles"}
    <ProfilesConfigPage
      bind:profilesMode={configDrafts.profiles.mode}
      bind:profileAutoSwitchSource={configDrafts.profiles.autoSwitchSource}
      bind:profileDayStartLocal={configDrafts.profiles.dayStartLocal}
      bind:profileNightStartLocal={configDrafts.profiles.nightStartLocal}
      bind:profileDayColorScheme={configDrafts.profiles.dayColorScheme}
      bind:profileDayBrightnessPct={configDrafts.profiles.dayBrightnessPct}
      bind:profileDayOutputProfile={configDrafts.profiles.dayOutputProfile}
      bind:profileNightColorScheme={configDrafts.profiles.nightColorScheme}
      bind:profileNightBrightnessPct={configDrafts.profiles.nightBrightnessPct}
      bind:profileNightOutputProfile={configDrafts.profiles.nightOutputProfile}
      notificationPermissionText={notifications.permissionText}
      notificationStatusText={notifications.statusText}
      onBack={() => goToSettingsView()}
      onApply={() => void runAction("apply profile config", applyProfilesConfig)}
      onRequestPermission={() => void runAction("request notification permission", () => requestNotificationPermission(notifications))}
      onSendTestNotification={() => void runAction("send test notification", () => sendTestNotification(notifications))}
    />
  {/if}

    </main>
    {#if navigation.activeView !== "config"}
      <button
        type="button"
        class="app-state-led-button"
        onclick={openConfigFromStatusLed}
        aria-label={connection.linkLedTitle}
        title={connection.linkLedTitle}
      >
        <span class={`app-state-led-dot ${connection.linkLedState}`} aria-hidden="true"></span>
      </button>
    {/if}
    <Tabbar icons class="am-tabbar fixed bottom-0 left-0 right-0 z-40" aria-label="Anqori AnchorWatch sections">
      {#each VIEW_TABS as tab}
        <TabbarLink
          class="am-tab-link"
          active={navigation.activeView === tab.id}
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
