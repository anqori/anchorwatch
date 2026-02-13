<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { Map as MapTilerMap } from "@maptiler/sdk";
  import type { ConfigSectionId, TrackPoint, ViewId, WifiScanNetwork, WifiSecurity } from "./core/types";
  import {
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
    TABBAR_LINK_COLORS,
    VIEW_TABS,
  } from "./core/constants";
  import { formatWifiSecurity } from "./services/data-utils";
  import { deriveBleStatusText } from "./services/ble-state";
  import {
    buildInternetSettingsStatusText,
    deriveAppConnectivityState,
    deriveLinkLedState,
    hasActiveCloudRelayConnection,
    linkLedTitle,
  } from "./services/connectivity-derive";
  import { readFirmwareVersionFromState, readOnboardingWifiStatus } from "./services/state-derive";
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
  import { isBleSupported } from "./services/ble-connection";
  import {
    applyAnchorConfig,
    applyProfilesConfig,
    applyTriggerConfig,
    applyWifiConfigFromInternetPage,
    fetchTrackSnapshot,
    probeRelay,
    refreshStateSnapshot,
    saveRelayUrl,
    scanWifiNetworks,
    searchForDeviceViaBluetooth,
    startDeviceRuntime,
    stopDeviceRuntime,
    useFakeMode,
    verifyCloudAuth,
  } from "./actions/device-actions";
  import { appState, initAppStateEnvironment, logLine, readCloudCredentials } from "./state/app-state.svelte";
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
  let trackStatusText = $state("No track yet");
  let currentLatText = $state("--");
  let currentLonText = $state("--");
  let currentSogText = $state("--");
  let currentCogText = $state("--");
  let currentHeadingText = $state("--");
  let radarTargetX = $state(110);
  let radarTargetY = $state(110);
  let radarDistanceText = $state("--");
  let radarBearingText = $state("--");
  let maptilerStatusText = $state("Map ready state pending.");
  let trackPoints = $state<TrackPoint[]>([]);

  let maptilerMapContainer = $state<HTMLDivElement | null>(null);
  let maptilerSatelliteContainer = $state<HTMLDivElement | null>(null);
  let maptilerMap = $state<MapTilerMap | null>(null);
  let maptilerSatellite = $state<MapTilerMap | null>(null);

  $effect(() => {
    gpsAgeText = appState.summary.gpsAgeText;
    dataAgeText = appState.summary.dataAgeText;
    depthText = appState.summary.depthText;
    windText = appState.summary.windText;
    statePillText = appState.summary.statePillText;
    statePillClass = appState.summary.statePillClass;
    stateSourceText = appState.summary.stateSourceText;
    trackStatusText = appState.track.statusText;
    currentLatText = appState.track.currentLatText;
    currentLonText = appState.track.currentLonText;
    currentSogText = appState.track.currentSogText;
    currentCogText = appState.track.currentCogText;
    currentHeadingText = appState.track.currentHeadingText;
    radarTargetX = appState.track.radarTargetX;
    radarTargetY = appState.track.radarTargetY;
    radarDistanceText = appState.track.radarDistanceText;
    radarBearingText = appState.track.radarBearingText;
    maptilerStatusText = appState.maptilerStatusText;
    trackPoints = appState.track.points;
  });

  $effect(() => {
    navigation.isFullScreenVizView = navigation.activeView === "satellite" || navigation.activeView === "map" || navigation.activeView === "radar";
    navigation.isConfigView = navigation.activeView === "config";
  });

  $effect(() => {
    connection.bleStatusText = deriveBleStatusText(ble.connected, ble.authState);
    connection.connectedDeviceName = ble.connected ? (ble.deviceName.trim() || "device") : "";
  });

  $effect(() => {
    const relayConnected = hasActiveCloudRelayConnection({
      latestStateSource: appState.latestStateSource,
      latestStateUpdatedAtMs: appState.latestStateUpdatedAtMs,
      cloudPollMs: CLOUD_POLL_MS,
    });
    connection.appState = deriveAppConnectivityState(connection.hasConfiguredDevice, ble.connected, relayConnected);
    connection.linkLedState = deriveLinkLedState(connection.hasConfiguredDevice, ble.connected, relayConnected);
    connection.linkLedTitle = linkLedTitle(connection.linkLedState);
  });

  $effect(() => {
    navigation.settingsDeviceStatusText = ble.connected ? `Connected to ${connection.connectedDeviceName}` : "No Device connected yet";
    network.settingsInternetStatusText = buildInternetSettingsStatusText({
      onboardingWifiConnected: network.onboardingWifiConnected,
      onboardingWifiSsid: network.onboardingWifiSsid,
      onboardingWifiErrorText: network.onboardingWifiErrorText,
      wifiSsid: network.wifiSsid,
      wifiScanInFlight: network.wifiScanInFlight,
      wifiScanErrorText: network.wifiScanErrorText,
      hasCloudCredentials: readCloudCredentials() !== null,
    });
    navigation.configSectionsWithStatus = CONFIG_SECTIONS.map((section) => ({
      ...section,
      status: section.id === "device"
        ? navigation.settingsDeviceStatusText
        : section.id === "internet"
          ? network.settingsInternetStatusText
          : undefined,
    }));
  });

  $effect(() => {
    const wifiStatus = readOnboardingWifiStatus(appState.latestState);
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

  function clearWifiSelectionForManualEntry(): void {
    network.selectedWifiSsid = "";
    network.wifiSsid = "";
    network.wifiScanErrorText = "";
  }

  function prefillWifiSettingsFromCurrentState(): void {
    if (network.onboardingWifiSsid && network.onboardingWifiSsid !== "--") {
      network.wifiSsid = network.onboardingWifiSsid;
      network.selectedWifiSsid = network.onboardingWifiSsid;
    }
    if (!network.wifiCountry.trim()) {
      network.wifiCountry = "DE";
    }
    network.wifiScanErrorText = "";
    network.wifiScanStatusText = "Scan for available WLAN networks.";
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
      onRefreshStatus={() => void runAction("refresh status snapshot", refreshStateSnapshot)}
      onSaveRelayUrl={() => void runAction("save relay url", saveRelayUrl)}
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
