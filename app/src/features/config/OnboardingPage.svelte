<script lang="ts">
  import {
    Block,
    BlockTitle,
    Button as KonstaButton,
    List,
    ListInput,
    ListItem,
  } from "konsta/svelte";
  import type { WifiScanNetwork, WifiSecurity } from "../../core/types";

  export let onboardingStep = 1;
  export let onboardingStepLabel = "Step 1 of 3";
  export let onboardingStepTitle = "Connect via Bluetooth";

  export let installStatus = "";
  export let bleSupportedText = "--";
  export let modeIsFake = false;
  export let bleStatusText = "disconnected";
  export let boatIdText = "--";
  export let secretStatusText = "not stored";
  export let cloudStatusText = "not checked";
  export let pwaVersionText = "--";
  export let firmwareVersionText = "--";
  export let cloudVersionText = "--";
  export let bleConnected = false;

  export let wifiScanInFlight = false;
  export let wifiScanStatusText = "";
  export let wifiScanErrorText = "";
  export let availableWifiNetworks: WifiScanNetwork[] = [];
  export let selectedWifiSsid = "";
  export let wifiSsid = "";
  export let wifiSecurity: WifiSecurity = "wpa2";
  export let wifiPass = "";
  export let wifiCountry = "";
  export let selectedWifiNetwork: WifiScanNetwork | null = null;

  export let onboardingWifiConnected = false;
  export let onboardingWifiErrorText = "";
  export let onboardingWifiStateText = "Waiting for Wi-Fi status...";
  export let onboardingWifiSsid = "--";
  export let onboardingWifiRssiText = "--";

  export let relayBaseUrlInput = "";
  export let relayResult = "No request yet.";
  export let onboardingLogText = "";

  export let formatWifiSecurity: (security: WifiSecurity) => string = (security) => security;

  export let onSelectDeviceMode: () => void = () => {};
  export let onUseFakeMode: () => void = () => {};
  export let onConnectBle: () => void = () => {};
  export let onDisconnectBle: () => void = () => {};
  export let onContinueToWifiStep: () => void = () => {};
  export let onScanWifiNetworks: () => void = () => {};
  export let onSelectWifiNetwork: (network: WifiScanNetwork) => void = () => {};
  export let onApplyWifiAndContinue: () => void = () => {};
  export let onBackToBleStep: () => void = () => {};
  export let onBackToWifiSettingsStep: () => void = () => {};
  export let onGoToSummary: () => void = () => {};
  export let onRefreshStatus: () => void = () => {};
  export let onSaveRelayUrl: () => void = () => {};
  export let onProbeRelay: () => void = () => {};
  export let onVerifyCloud: () => void = () => {};
</script>

<Block strong class="space-y-3">
  <BlockTitle>Onboarding Wizard</BlockTitle>
  <div class="wizard-progress">
    <div class={`wizard-step ${onboardingStep === 1 ? "active" : onboardingStep > 1 ? "done" : ""}`}>1. Bluetooth</div>
    <div class={`wizard-step ${onboardingStep === 2 ? "active" : onboardingStep > 2 ? "done" : ""}`}>2. WLAN Settings</div>
    <div class={`wizard-step ${onboardingStep === 3 ? "active" : ""}`}>3. Connection Status</div>
  </div>
  <div class="hint" style="margin-top:0.7rem">{onboardingStepLabel}: {onboardingStepTitle}</div>

  {#if onboardingStep === 1}
    <div class="hint" style="margin-top:0.8rem">{installStatus}</div>
    <div class="hint" style="margin-top:0.35rem">BLE support: <strong>{bleSupportedText}</strong></div>
    <div class="hint" style="margin-top:0.35rem">Mode: <strong>{modeIsFake ? "Fake mode" : "Device mode"}</strong></div>
    <div class="row" style="margin-top:0.8rem">
      <div class="kv">BLE: <strong>{bleStatusText}</strong></div>
      <div class="kv">Boat ID: <strong class="mono">{boatIdText}</strong></div>
      <div class="kv">Boat secret: <strong>{secretStatusText}</strong></div>
      <div class="kv">Cloud verify: <strong>{cloudStatusText}</strong></div>
    </div>
    <div class="row" style="margin-top:0.55rem">
      <div class="kv">PWA ver: <strong class="mono">{pwaVersionText}</strong></div>
      <div class="kv">FW ver: <strong class="mono">{firmwareVersionText}</strong></div>
      <div class="kv">Cloud ver: <strong class="mono">{cloudVersionText}</strong></div>
    </div>
    <div class="hint" style="margin-top:0.8rem">
      Connect to the device via BLE, then continue to WLAN settings.
    </div>
    <div class="actions" style="margin-top:0.8rem">
      <KonstaButton clear onClick={onSelectDeviceMode} disabled={!modeIsFake}>Switch to Device Mode</KonstaButton>
      <KonstaButton clear onClick={onUseFakeMode}>Use Fake Mode (Skip Setup)</KonstaButton>
    </div>
    <div class="actions" style="margin-top:0.55rem">
      {#if !bleConnected}
        <KonstaButton onClick={onConnectBle}>Connect via Bluetooth</KonstaButton>
      {/if}
      {#if bleConnected}
        <KonstaButton outline onClick={onDisconnectBle}>Disconnect</KonstaButton>
        <KonstaButton onClick={onContinueToWifiStep}>Continue</KonstaButton>
      {/if}
    </div>
  {/if}

  {#if onboardingStep === 2}
    <div class="hint" style="margin-top:0.8rem">
      Scan nearby WLAN networks, select one, then enter the password.
    </div>
    <div class="actions" style="margin-top:0.7rem">
      <KonstaButton onClick={onScanWifiNetworks} disabled={!bleConnected || wifiScanInFlight}>
        {wifiScanInFlight ? "Scanning..." : "Scan WLAN Networks"}
      </KonstaButton>
      <KonstaButton
        clear
        onClick={() => {
          selectedWifiSsid = "";
          wifiSsid = "";
          wifiScanErrorText = "";
        }}
      >
        Use Hidden / Manual SSID
      </KonstaButton>
    </div>
    <div class="hint mono" style="margin-top:0.45rem">{wifiScanStatusText}</div>
    {#if wifiScanErrorText}
      <div class="hint onboarding-error" style="margin-top:0.4rem">{wifiScanErrorText}</div>
    {/if}

    {#if availableWifiNetworks.length > 0}
      <List strong inset class="wifi-network-list" aria-label="Available WLAN networks">
        {#each availableWifiNetworks as network}
          <ListItem
            menuListItem
            menuListItemActive={selectedWifiSsid === network.ssid}
            title={network.ssid}
            after={`${formatWifiSecurity(network.security)} · ${network.rssi === null ? "-- dBm" : `${network.rssi} dBm`}`}
            onClick={() => onSelectWifiNetwork(network)}
          />
        {/each}
      </List>
    {:else}
      <div class="subcard" style="margin-top:0.7rem">
        <div class="hint">No scanned networks listed yet.</div>
      </div>
    {/if}

    <div class="subcard" style="margin-top:0.7rem">
      <div class="hint">Selected WLAN</div>
      <List strong inset style="margin-top:0.6rem">
        <ListInput label="SSID" type="text" bind:value={wifiSsid} placeholder="SSID" />
        <ListInput label="Security" type="select" bind:value={wifiSecurity} dropdown>
          <option value="wpa2">wpa2</option>
          <option value="wpa3">wpa3</option>
          <option value="open">open</option>
        </ListInput>
        <ListInput
          label="Passphrase"
          type="password"
          bind:value={wifiPass}
          placeholder={wifiSecurity === "open" ? "No password required (open)" : "Passphrase"}
          disabled={wifiSecurity === "open"}
        />
        <ListInput label="Country" type="text" bind:value={wifiCountry} maxlength={2} placeholder="DE" />
      </List>
      {#if selectedWifiNetwork}
        <div class="hint mono" style="margin-top:0.55rem">
          Selected: {selectedWifiNetwork.ssid} · {formatWifiSecurity(selectedWifiNetwork.security)} · {selectedWifiNetwork.rssi === null ? "-- dBm" : `${selectedWifiNetwork.rssi} dBm`}
        </div>
      {/if}
    </div>
    <div class="actions">
      <KonstaButton clear onClick={onBackToBleStep}>Back</KonstaButton>
      <KonstaButton onClick={onApplyWifiAndContinue} disabled={!wifiSsid.trim()}>
        Apply WLAN Settings
      </KonstaButton>
    </div>
  {/if}

  {#if onboardingStep === 3}
    <div class="subcard" style="margin-top:0.8rem">
      <div class="hint">WLAN apply request sent. Status below auto-updates from `system.wifi.*` telemetry.</div>
      <div style="margin-top:0.6rem">
        <span class={`pill ${onboardingWifiConnected ? "ok" : onboardingWifiErrorText ? "alarm" : "warn"}`}>{onboardingWifiStateText}</span>
      </div>
      <div class="row" style="margin-top:0.7rem">
        <div class="kv">SSID: <strong>{onboardingWifiSsid}</strong></div>
        <div class="kv">Connected: <strong>{onboardingWifiConnected ? "yes" : "no"}</strong></div>
        <div class="kv">RSSI: <strong>{onboardingWifiRssiText}</strong></div>
        <div class="kv">Cloud verify: <strong>{cloudStatusText}</strong></div>
      </div>
      <div class="row" style="margin-top:0.55rem">
        <div class="kv">PWA ver: <strong class="mono">{pwaVersionText}</strong></div>
        <div class="kv">FW ver: <strong class="mono">{firmwareVersionText}</strong></div>
        <div class="kv">Cloud ver: <strong class="mono">{cloudVersionText}</strong></div>
      </div>
      {#if onboardingWifiErrorText}
        <div class="hint onboarding-error" style="margin-top:0.7rem">Potential error: {onboardingWifiErrorText}</div>
      {/if}
      <div class="actions" style="margin-top:0.8rem">
        <KonstaButton clear onClick={onBackToWifiSettingsStep}>Back to WLAN Settings</KonstaButton>
        <KonstaButton onClick={onGoToSummary}>Go to Summary</KonstaButton>
        <KonstaButton onClick={onRefreshStatus} disabled={!bleConnected}>Refresh Status</KonstaButton>
      </div>

      <div class="hint" style="margin-top:0.9rem">Optional: relay URL for cloud checks</div>
      <List strong inset style="margin-top:0.6rem">
        <ListInput
          label="Relay URL"
          type="url"
          bind:value={relayBaseUrlInput}
          placeholder="https://aw-cloud.anqori.com"
        />
      </List>
      <div class="actions">
        <KonstaButton clear onClick={onSaveRelayUrl}>Save Relay URL</KonstaButton>
        <KonstaButton clear onClick={onProbeRelay}>Ping Relay</KonstaButton>
        <KonstaButton onClick={onVerifyCloud}>Verify Cloud</KonstaButton>
      </div>
      <div class="hint" style="margin-top:0.4rem">{relayResult}</div>
    </div>
  {/if}

  <div class="hint" style="margin-top:0.8rem">Onboarding log</div>
  <pre>{onboardingLogText}</pre>
</Block>
