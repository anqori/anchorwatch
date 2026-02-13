<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { Map as MapTilerMap } from "@maptiler/sdk";
  import type { AnchorRuntimeState, ConfigSectionId, TrackPoint, ViewId, WifiScanNetwork, WifiSecurity } from "./core/types";
  import {
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
    TABBAR_LINK_COLORS,
    VIEW_TABS,
  } from "./core/constants";
  import { formatWifiSecurity } from "./services/data-utils";
  import { deriveBleStatusText } from "./connections/ble/ble-state";
  import {
    buildInternetSettingsStatusText,
    deriveAppConnectivityState,
    deriveLinkLedState,
    linkLedTitle,
  } from "./services/connectivity-derive";
  import { readAnchorStatus, readCurrentGpsPosition, readFirmwareVersionFromState, readOnboardingWifiStatus } from "./services/state-derive";
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
  import { isBleSupported } from "./connections/ble/ble-connection";
  import {
    applyAnchorConfig,
    applyProfilesConfig,
    applyTriggerConfig,
    connectToWifiNetwork,
    dropAnchorAtCurrentPosition,
    fetchTrackSnapshot,
    moveAnchorToPosition,
    raiseAnchor,
    scanWifiNetworks,
    selectBluetoothConnection,
    selectRelayConnection,
    searchForDeviceViaBluetooth,
    startDeviceRuntime,
    stopDeviceRuntime,
    useFakeMode,
  } from "./actions/device-actions";
  import { geoDeltaMeters, type GeoPoint } from "./services/geo-nav";
  import { appState, initAppStateEnvironment, logLine } from "./state/app-state.svelte";
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
  import ConnectionPage from "./features/config/ConnectionPage.svelte";
  import InfoVersionPage from "./features/config/InfoVersionPage.svelte";
  import AnchorConfigPage from "./features/config/AnchorConfigPage.svelte";
  import TriggersConfigPage from "./features/config/TriggersConfigPage.svelte";
  import ProfilesConfigPage from "./features/config/ProfilesConfigPage.svelte";
  import SatellitePage from "./features/map/SatellitePage.svelte";
  import MapPage from "./features/map/MapPage.svelte";
  import RadarPage from "./features/radar/RadarPage.svelte";

  const ble = appState.ble;
  const connection = appState.connection;
  const versions = appState.versions;
  const network = appState.network;
  const navigation = appState.navigation;
  const notifications = appState.notifications;
  const configDrafts = appState.configDrafts;

  let gpsAgeText = $state("--");
  let dataAgeText = $state("--");
  let depthText = $state("--");
  let windText = $state("--");
  let statePillText = $state("BOOT");
  let statePillClass = $state<"ok" | "warn" | "alarm">("ok");
  let stateSourceText = $state("Source: --");
  let connectionSelectionStatusText = $state("Not connected");
  let configuredWifiStatusText = $state("Connecting");
  let currentLatText = $state("--");
  let currentLonText = $state("--");
  let currentSogText = $state("--");
  let currentHeadingText = $state("--");
  let maptilerStatusText = $state("Map ready state pending.");
  let trackPoints = $state<TrackPoint[]>([]);
  let anchorState = $state<AnchorRuntimeState>("up");
  let anchorPosition = $state<GeoPoint | null>(null);
  let anchorPositionText = $state("--");
  let anchorDistanceText = $state("--");
  let anchorBearingText = $state("--");
  let anchorActionInFlight = $state(false);
  let anchorRiseSlideOpen = $state(false);
  let anchorRiseSlideValue = $state(0);
  let anchorMoveMode = $state(false);
  let anchorMoveInFlight = $state(false);
  let anchorMoveStartPosition = $state<GeoPoint | null>(null);
  let anchorMoveDraftPosition = $state<GeoPoint | null>(null);
  let anchorMoveHelperRadiusM = $state(0);

  let maptilerMapContainer = $state<HTMLDivElement | null>(null);
  let maptilerSatelliteContainer = $state<HTMLDivElement | null>(null);
  let maptilerMap = $state<MapTilerMap | null>(null);
  let maptilerSatellite = $state<MapTilerMap | null>(null);
  let internetWifiNetworks = $state<WifiScanNetwork[]>([]);
  let internetRescanTimer: ReturnType<typeof setTimeout> | null = null;
  let internetWasOpen = false;

  $effect(() => {
    gpsAgeText = appState.summary.gpsAgeText;
    dataAgeText = appState.summary.dataAgeText;
    depthText = appState.summary.depthText;
    windText = appState.summary.windText;
    statePillText = appState.summary.statePillText;
    statePillClass = appState.summary.statePillClass;
    stateSourceText = appState.summary.stateSourceText;
    currentLatText = appState.track.currentLatText;
    currentLonText = appState.track.currentLonText;
    currentSogText = appState.track.currentSogText;
    currentHeadingText = appState.track.currentHeadingText;
    maptilerStatusText = appState.maptilerStatusText;
    trackPoints = appState.track.points;
  });

  $effect(() => {
    navigation.isFullScreenVizView = navigation.activeView === "satellite" || navigation.activeView === "map" || navigation.activeView === "radar";
    navigation.isConfigView = navigation.activeView === "config";
  });

  $effect(() => {
    connection.bleStatusText = deriveBleStatusText(ble.connected, ble.authState);
    if (connection.mode === MODE_FAKE && connection.activeConnection === "fake" && connection.activeConnectionConnected) {
      connection.connectedDeviceName = "demo-device";
      return;
    }
    connection.connectedDeviceName = ble.connected ? (ble.deviceName.trim() || "device") : "";
  });

  $effect(() => {
    connection.appState = deriveAppConnectivityState(connection.hasConfiguredDevice, connection.activeConnectionConnected);
    connection.linkLedState = deriveLinkLedState(
      connection.hasConfiguredDevice,
      connection.activeConnectionConnected,
      connection.activeConnection,
    );
    connection.linkLedTitle = linkLedTitle(connection.linkLedState);

    if (!connection.activeConnectionConnected) {
      connectionSelectionStatusText = "Not connected";
      return;
    }
    if (connection.activeConnection === "fake") {
      connectionSelectionStatusText = "Connected to Fake data";
      return;
    }
    if (connection.activeConnection === "bluetooth") {
      connectionSelectionStatusText = "Connected via BT";
      return;
    }
    connectionSelectionStatusText = "Connected via Relay";
  });

  $effect(() => {
    if (!connection.activeConnectionConnected) {
      navigation.settingsDeviceStatusText = "No Device connected yet";
    } else if (connection.activeConnection === "fake") {
      navigation.settingsDeviceStatusText = "Connected to demo-device";
    } else if (connection.activeConnection === "cloud-relay") {
      navigation.settingsDeviceStatusText = "Connected via Relay";
    } else {
      navigation.settingsDeviceStatusText = `Connected to ${connection.connectedDeviceName}`;
    }
    network.settingsInternetStatusText = buildInternetSettingsStatusText({
      onboardingWifiConnected: network.onboardingWifiConnected,
      onboardingWifiSsid: network.onboardingWifiSsid,
      onboardingWifiErrorText: network.onboardingWifiErrorText,
      wifiSsid: network.wifiSsid,
      wifiScanInFlight: network.wifiScanInFlight,
      wifiScanErrorText: network.wifiScanErrorText,
    });
    navigation.configSectionsWithStatus = CONFIG_SECTIONS
      .map((section) => ({
      ...section,
      disabled: (!connection.hasConfiguredDevice && section.id !== "device")
        || (section.id === "internet" && !connection.activeConnectionConnected),
      status: section.id === "device"
        ? navigation.settingsDeviceStatusText
        : section.id === "internet"
          ? network.settingsInternetStatusText
          : section.id === "connection"
            ? connectionSelectionStatusText
          : undefined,
    }));
  });

  $effect(() => {
    const configuredSsid = network.wifiSsid.trim();
    const mergedNetworks = [...network.availableWifiNetworks];
    if (configuredSsid && !mergedNetworks.some((wifiNetwork) => wifiNetwork.ssid === configuredSsid)) {
      mergedNetworks.unshift({
        ssid: configuredSsid,
        security: network.wifiSecurity,
        rssi: null,
        channel: null,
        hidden: false,
      });
    }
    internetWifiNetworks = mergedNetworks;
  });

  $effect(() => {
    const wifiStatus = readOnboardingWifiStatus(appState.latestState);
    const currentGps = readCurrentGpsPosition(appState.latestState);
    const anchorStatus = readAnchorStatus(appState.latestState);
    anchorState = anchorStatus.state;
    anchorPosition = anchorStatus.position;
    const visibleAnchorPosition = getVisualAnchorPosition(anchorStatus.position);
    anchorPositionText = visibleAnchorPosition
      ? `${visibleAnchorPosition.lat.toFixed(5)}, ${visibleAnchorPosition.lon.toFixed(5)}`
      : "--";
    if (visibleAnchorPosition && currentGps) {
      const { distanceM, bearingDeg } = geoDeltaMeters(visibleAnchorPosition, currentGps);
      anchorDistanceText = `${distanceM.toFixed(1)} m`;
      anchorBearingText = `${bearingDeg.toFixed(0)} deg`;
    } else {
      anchorDistanceText = "--";
      anchorBearingText = "--";
    }
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
    network.selectedWifiNetwork = network.availableWifiNetworks.find((wifiNetwork) => wifiNetwork.ssid === network.selectedWifiSsid) ?? null;
    versions.firmware = readFirmwareVersionFromState(appState.latestState);
  });

  $effect(() => {
    if (!shouldShowAnchorActionButton() || anchorState !== "down" || anchorMoveMode) {
      anchorRiseSlideOpen = false;
      anchorRiseSlideValue = 0;
    }
  });

  $effect(() => {
    if (anchorMoveMode && !canShowAnchorMoveButton()) {
      resetAnchorMoveSession();
    }
  });

  $effect(() => {
    const configuredSsid = network.wifiSsid.trim();
    if (!configuredSsid) {
      configuredWifiStatusText = "Connecting";
      return;
    }
    if (network.onboardingWifiConnected && network.onboardingWifiSsid.trim() === configuredSsid) {
      configuredWifiStatusText = "Connected";
      return;
    }
    if (network.onboardingWifiErrorText.trim()) {
      configuredWifiStatusText = `Failed with ${network.onboardingWifiErrorText.trim()}`;
      return;
    }
    configuredWifiStatusText = "Connecting";
  });

  $effect(() => {
    const internetOpen = isInternetViewActive();
    if (internetOpen && !internetWasOpen) {
      if (!network.wifiCountry.trim()) {
        network.wifiCountry = "DE";
      }
      void runAction("scan wlan networks", scanWifiNetworks);
    }
    if (!internetOpen) {
      clearInternetRescanTimer();
    }
    internetWasOpen = internetOpen;
  });

  $effect(() => {
    const internetOpen = isInternetViewActive();
    const updatedAtMs = network.wifiScanUpdatedAtMs;
    if (!internetOpen || updatedAtMs <= 0) {
      return;
    }
    clearInternetRescanTimer();
    internetRescanTimer = setTimeout(() => {
      if (!isInternetViewActive()) {
        return;
      }
      void runAction("scan wlan networks", scanWifiNetworks);
    }, 10_000);
  });

  $effect(() => {
    if (maptilerMap) {
      updateMapTrackAndViewport({
        map: maptilerMap,
        kind: "map",
        getTrackPoints: () => trackPoints,
        getAnchorPosition: () => getVisualAnchorPosition(anchorPosition),
        showAnchorHelperCircle: anchorMoveMode,
        anchorHelperRadiusM: anchorMoveHelperRadiusM,
        moveMode: anchorMoveMode,
        onPreviewAnchorMove: previewAnchorMoveFromViewport,
        maxPanDistanceM: MAPTILER_MAX_PAN_DISTANCE_M,
        maxVisibleAreaM2: MAPTILER_MAX_VISIBLE_AREA_M2,
      });
    }
    if (maptilerSatellite) {
      updateMapTrackAndViewport({
        map: maptilerSatellite,
        kind: "satellite",
        getTrackPoints: () => trackPoints,
        getAnchorPosition: () => getVisualAnchorPosition(anchorPosition),
        showAnchorHelperCircle: anchorMoveMode,
        anchorHelperRadiusM: anchorMoveHelperRadiusM,
        moveMode: anchorMoveMode,
        onPreviewAnchorMove: previewAnchorMoveFromViewport,
        maxPanDistanceM: MAPTILER_MAX_PAN_DISTANCE_M,
        maxVisibleAreaM2: MAPTILER_MAX_VISIBLE_AREA_M2,
      });
    }
  });

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
      getAnchorPosition: () => getVisualAnchorPosition(anchorPosition),
      getShowAnchorHelperCircle: () => anchorMoveMode,
      getAnchorHelperRadiusM: () => anchorMoveHelperRadiusM,
      getMoveMode: () => anchorMoveMode,
      onPreviewAnchorMove: previewAnchorMoveFromViewport,
      apiKey: MAPTILER_API_KEY,
      defaultCenter: MAPTILER_DEFAULT_CENTER,
      defaultZoom: MAPTILER_DEFAULT_ZOOM,
      styleMapRef: MAPTILER_STYLE_MAP,
      styleSatelliteRef: MAPTILER_STYLE_SATELLITE,
      maxPanDistanceM: MAPTILER_MAX_PAN_DISTANCE_M,
      maxVisibleAreaM2: MAPTILER_MAX_VISIBLE_AREA_M2,
      setStatusText: (text) => {
        appState.maptilerStatusText = text;
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

  function isInternetViewActive(): boolean {
    return navigation.activeView === "config" && navigation.activeConfigView === "internet";
  }

  function clearInternetRescanTimer(): void {
    if (!internetRescanTimer) {
      return;
    }
    clearTimeout(internetRescanTimer);
    internetRescanTimer = null;
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
    if (!connection.hasConfiguredDevice && nextConfigView !== "device") {
      logLine(`settings section locked until setup complete: ${nextConfigView}`);
      return;
    }
    if (nextConfigView === "internet" && !connection.activeConnectionConnected) {
      logLine("settings section unavailable without active connection: internet");
      return;
    }
    applyOpenConfigSection(navigation, nextConfigView);
  }

  $effect(() => {
    if (navigation.activeView === "config" && navigation.activeConfigView === "internet" && !connection.activeConnectionConnected) {
      goToSettingsView();
    }
  });

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

  async function useFakeModeAndReturnHome(): Promise<void> {
    await useFakeMode();
    setView("summary");
  }

  async function registerServiceWorker(): Promise<void> {
    if (!("serviceWorker" in navigator)) {
      return;
    }
    try {
      if (import.meta.env.DEV) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
        if ("caches" in window) {
          const keys = await caches.keys();
          const appCacheKeys = keys.filter((key) => key.startsWith("anchorwatch-"));
          await Promise.all(appCacheKeys.map((key) => caches.delete(key)));
        }
        return;
      }
      await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    } catch (error) {
      logLine(`service worker registration failed: ${String(error)}`);
    }
  }

  async function runAction(name: string, action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      logLine(`${name} failed: ${String(error)}`);
    }
  }

  function openConfigFromStatusLed(): void {
    if (connection.linkLedState === "unconfigured") {
      openConfigView("device");
      return;
    }
    setView("config");
  }

  function isOperationalDataView(): boolean {
    return navigation.activeView === "summary"
      || navigation.activeView === "map"
      || navigation.activeView === "satellite"
      || navigation.activeView === "radar";
  }

  function shouldShowAnchorActionButton(): boolean {
    return isOperationalDataView() && connection.activeConnectionConnected && connection.hasConfiguredDevice;
  }

  function isAnchorMoveViewActive(): boolean {
    return navigation.activeView === "map" || navigation.activeView === "satellite" || navigation.activeView === "radar";
  }

  function canShowAnchorMoveButton(): boolean {
    return shouldShowAnchorActionButton() && isAnchorMoveViewActive() && Boolean(anchorPosition);
  }

  function getVisualAnchorPosition(liveAnchorPosition: GeoPoint | null = anchorPosition): GeoPoint | null {
    if (!anchorMoveMode) {
      return liveAnchorPosition;
    }
    return anchorMoveDraftPosition ?? liveAnchorPosition;
  }

  async function triggerAnchorRise(): Promise<void> {
    anchorActionInFlight = true;
    anchorRiseSlideOpen = false;
    anchorRiseSlideValue = 0;
    await runAction("anchor rise", raiseAnchor);
    anchorActionInFlight = false;
  }

  async function triggerAnchorDown(): Promise<void> {
    anchorActionInFlight = true;
    await runAction("anchor down", dropAnchorAtCurrentPosition);
    anchorActionInFlight = false;
  }

  function handleAnchorActionClick(): void {
    if (anchorActionInFlight || anchorMoveMode || anchorMoveInFlight) {
      return;
    }
    if (anchorState === "up") {
      void triggerAnchorDown();
      return;
    }
    if (anchorState === "auto-pending") {
      void triggerAnchorRise();
      return;
    }
    anchorRiseSlideOpen = !anchorRiseSlideOpen;
    anchorRiseSlideValue = 0;
  }

  function handleRiseSliderInput(event: Event): void {
    const input = event.currentTarget as HTMLInputElement | null;
    const value = input ? Number(input.value) : 0;
    anchorRiseSlideValue = Number.isFinite(value) ? value : 0;
    if (anchorRiseSlideValue >= 98) {
      void triggerAnchorRise();
    }
  }

  function startAnchorMove(): void {
    if (!canShowAnchorMoveButton() || !anchorPosition) {
      return;
    }
    const currentGps = readCurrentGpsPosition(appState.latestState);
    anchorMoveMode = true;
    anchorMoveStartPosition = anchorPosition;
    anchorMoveDraftPosition = anchorPosition;
    anchorMoveHelperRadiusM = currentGps ? geoDeltaMeters(anchorPosition, currentGps).distanceM : 0;
    anchorRiseSlideOpen = false;
    anchorRiseSlideValue = 0;
  }

  function resetAnchorMoveSession(): void {
    anchorMoveMode = false;
    anchorMoveInFlight = false;
    anchorMoveStartPosition = null;
    anchorMoveDraftPosition = null;
    anchorMoveHelperRadiusM = 0;
  }

  function cancelAnchorMove(): void {
    resetAnchorMoveSession();
  }

  function previewAnchorMoveFromViewport(lat: number, lon: number): void {
    if (!anchorMoveMode) {
      return;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return;
    }
    if (
      anchorMoveDraftPosition
      && Math.abs(anchorMoveDraftPosition.lat - lat) < 0.0000002
      && Math.abs(anchorMoveDraftPosition.lon - lon) < 0.0000002
    ) {
      return;
    }
    anchorMoveDraftPosition = { lat, lon };
  }

  async function confirmAnchorMove(): Promise<void> {
    if (!anchorMoveMode || !anchorMoveDraftPosition || anchorMoveInFlight) {
      return;
    }
    const draft = anchorMoveDraftPosition;
    if (
      anchorMoveStartPosition
      && Math.abs(anchorMoveStartPosition.lat - draft.lat) < 0.0000002
      && Math.abs(anchorMoveStartPosition.lon - draft.lon) < 0.0000002
    ) {
      resetAnchorMoveSession();
      return;
    }
    anchorMoveInFlight = true;
    await runAction("move anchor", () => moveAnchorToPosition(draft.lat, draft.lon));
    resetAnchorMoveSession();
  }

  onMount(() => {
    initNavigationHistoryRoot(navigation);
    window.addEventListener("popstate", handlePopState);

    initNotificationStatus(notifications);
    initAppStateEnvironment(isBleSupported(), Boolean(MAPTILER_API_KEY));
    void registerServiceWorker();

    if (connection.mode === MODE_FAKE || !connection.hasConfiguredDevice) {
      setView("config");
      logLine("startup route: connection setup required");
    }

    logLine("app started (Svelte)");
    void runAction("start runtime", startDeviceRuntime);
  });

  onDestroy(() => {
    window.removeEventListener("popstate", handlePopState);
    clearInternetRescanTimer();
    destroyMapTilerView("map");
    destroyMapTilerView("satellite");
    void stopDeviceRuntime();
  });
</script>
<KonstaApp theme="material" safeAreas>
  <KonstaPage class="am-page">
    <main class="am-main" class:full-screen-view={navigation.isFullScreenVizView} class:config-view={navigation.isConfigView}>
  {#if navigation.activeView === "summary"}
    <SummaryPage
      currentLatText={currentLatText}
      currentLonText={currentLonText}
      currentSogText={currentSogText}
      currentHeadingText={currentHeadingText}
      anchorPositionText={anchorPositionText}
      anchorDistanceText={anchorDistanceText}
      anchorBearingText={anchorBearingText}
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
      wifiScanInFlight={network.wifiScanInFlight}
      wifiScanErrorText={network.wifiScanErrorText}
      availableWifiNetworks={internetWifiNetworks}
      configuredWifiSsid={network.wifiSsid}
      configuredWifiPass={network.wifiPass}
      configuredWifiStatusText={configuredWifiStatusText}
      formatWifiSecurity={(security) => formatWifiSecurity(security as WifiSecurity)}
      onConnectWifiNetwork={(ssid, security, passphrase) => void runAction(
        "connect wlan network",
        () => connectToWifiNetwork(ssid, security as WifiSecurity, passphrase),
      )}
      onBack={() => goToSettingsView()}
    />
  {/if}

  {#if navigation.activeView === "config" && navigation.activeConfigView === "connection"}
    <ConnectionPage
      isConfigured={connection.hasConfiguredDevice}
      connectionStatusText={connectionSelectionStatusText}
      mode={connection.mode}
      activeConnection={connection.activeConnection}
      onSelectBluetooth={() => void runAction("switch connection to bluetooth", selectBluetoothConnection)}
      onSelectRelay={() => void runAction("switch connection to relay", selectRelayConnection)}
      onSelectFake={() => void runAction("switch connection to fake", useFakeMode)}
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
      bind:container={maptilerSatelliteContainer}
    />
  {/if}

  {#if navigation.activeView === "map"}
    <MapPage
      hasMapTilerKey={Boolean(MAPTILER_API_KEY)}
      maptilerStatusText={maptilerStatusText}
      bind:container={maptilerMapContainer}
    />
  {/if}

  {#if navigation.activeView === "radar"}
    <RadarPage
      trackPoints={trackPoints}
      anchorPosition={getVisualAnchorPosition(anchorPosition)}
      moveMode={anchorMoveMode}
      onPreviewAnchorMove={previewAnchorMoveFromViewport}
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
    {#if navigation.activeView === "map" || navigation.activeView === "satellite" || navigation.activeView === "radar"}
      <div class="shared-viz-overlay mono" aria-live="polite">
        <div>DIST {anchorDistanceText === "--" ? "--" : anchorDistanceText.replace(" ", "")}</div>
        <div>BEAR {anchorBearingText === "--" ? "--" : anchorBearingText.replace(" deg", "")}</div>
      </div>
    {/if}
    {#if shouldShowAnchorActionButton()}
      <div class="anchor-action-stack">
        {#if canShowAnchorMoveButton()}
          {#if anchorMoveMode}
            <div class="anchor-move-actions">
              <button
                type="button"
                class="anchor-move-button cancel"
                onclick={cancelAnchorMove}
                disabled={anchorMoveInFlight}
                aria-label="Cancel anchor move"
                title="Cancel anchor move"
              >
                <span class="material-symbols-rounded anchor-move-icon" aria-hidden="true">close</span>
              </button>
              <button
                type="button"
                class="anchor-move-button confirm"
                onclick={() => void confirmAnchorMove()}
                disabled={anchorMoveInFlight}
                aria-label="Confirm anchor move"
                title="Confirm anchor move"
              >
                <span class="material-symbols-rounded anchor-move-icon" aria-hidden="true">check</span>
              </button>
            </div>
          {:else}
            <button
              type="button"
              class="anchor-move-button start"
              onclick={startAnchorMove}
              disabled={anchorActionInFlight}
              aria-label="Start anchor move mode"
              title="Start anchor move mode"
            >
              <span class="material-symbols-rounded anchor-move-icon" aria-hidden="true">edit_location_alt</span>
            </button>
          {/if}
        {/if}
        {#if anchorRiseSlideOpen && anchorState === "down"}
          <div class="anchor-rise-slider-card">
            <div class="anchor-rise-slider-title">Slide to confirm anchor rise</div>
            <input
              class="anchor-rise-slider"
              type="range"
              min="0"
              max="100"
              step="1"
              value={anchorRiseSlideValue}
              oninput={handleRiseSliderInput}
              disabled={anchorActionInFlight}
              aria-label="Slide to confirm anchor rise"
            />
            <div class="anchor-rise-slider-hint mono">Anchor position: {anchorPositionText}</div>
          </div>
        {/if}
        <button
          type="button"
          class={`anchor-action-button ${anchorState === "up" ? "up" : "down"}`}
          onclick={handleAnchorActionClick}
          disabled={anchorActionInFlight || anchorMoveMode || anchorMoveInFlight}
          aria-label={anchorState === "up" ? "Drop anchor at current position" : "Raise anchor"}
          title={anchorState === "up" ? "Drop anchor at current position" : "Raise anchor"}
        >
          <span class={`anchor-action-icon-wrap ${anchorState === "up" ? "" : "striked"}`}>
            <span class="material-symbols-rounded anchor-action-icon" aria-hidden="true">anchor</span>
            {#if anchorState === "up"}
              <span class="material-symbols-rounded anchor-action-down-indicator" aria-hidden="true">south</span>
            {/if}
          </span>
        </button>
      </div>
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
