<script lang="ts">
  import {
    BlockTitle,
    Button as KonstaButton,
    List,
    ListInput,
    ListItem,
    Navbar,
    NavbarBackLink,
  } from "konsta/svelte";
  import type { WifiScanNetwork, WifiSecurity } from "../../core/types";

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
  export let cloudStatusText = "not checked";

  export let relayBaseUrlInput = "";
  export let relayResult = "No request yet.";

  export let formatWifiSecurity: (security: WifiSecurity) => string = (security) => security;

  export let onBack: () => void = () => {};
  export let onScanWifiNetworks: () => void = () => {};
  export let onSelectWifiNetwork: (network: WifiScanNetwork) => void = () => {};
  export let onApplyWifiConfig: () => void = () => {};
  export let onClearSelectedNetwork: () => void = () => {};
  export let onRefreshStatus: () => void = () => {};
  export let onSaveRelayUrl: () => void = () => {};
  export let onProbeRelay: () => void = () => {};
  export let onVerifyCloud: () => void = () => {};
</script>

<Navbar title="Internet & WLAN">
  {#snippet left()}
    <NavbarBackLink onclick={onBack} text="Settings" />
  {/snippet}
</Navbar>

<div class="space-y-3">
  <BlockTitle>WLAN Setup</BlockTitle>
  <div class="actions">
    <KonstaButton onClick={onScanWifiNetworks} disabled={!bleConnected || wifiScanInFlight}>
      {wifiScanInFlight ? "Scanning..." : "Scan WLAN Networks"}
    </KonstaButton>
    <KonstaButton clear onClick={onClearSelectedNetwork}>Use Hidden / Manual SSID</KonstaButton>
  </div>
  <div class="hint mono">{wifiScanStatusText}</div>
  {#if wifiScanErrorText}
    <div class="hint onboarding-error">{wifiScanErrorText}</div>
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
  {/if}

  <List strong inset>
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
    <div class="hint mono">
      Selected: {selectedWifiNetwork.ssid} · {formatWifiSecurity(selectedWifiNetwork.security)} · {selectedWifiNetwork.rssi === null ? "-- dBm" : `${selectedWifiNetwork.rssi} dBm`}
    </div>
  {/if}
  <div class="actions">
    <KonstaButton onClick={onApplyWifiConfig} disabled={!wifiSsid.trim()}>Apply WLAN Settings</KonstaButton>
  </div>

  <BlockTitle>Connection Status</BlockTitle>
  <List strong inset>
    <ListItem title="WLAN state" after={onboardingWifiStateText} />
    <ListItem title="SSID" after={onboardingWifiSsid} />
    <ListItem title="Connected" after={onboardingWifiConnected ? "yes" : "no"} />
    <ListItem title="RSSI" after={onboardingWifiRssiText} />
    <ListItem title="Cloud verify" after={cloudStatusText} />
  </List>
  {#if onboardingWifiErrorText}
    <div class="hint onboarding-error">Potential error: {onboardingWifiErrorText}</div>
  {/if}
  <div class="actions">
    <KonstaButton onClick={onRefreshStatus} disabled={!bleConnected}>Refresh Status</KonstaButton>
  </div>

  <BlockTitle>Cloud Relay (Optional)</BlockTitle>
  <List strong inset>
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
  <div class="hint">{relayResult}</div>
</div>
