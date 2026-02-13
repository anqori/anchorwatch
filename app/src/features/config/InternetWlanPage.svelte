<script lang="ts">
  import { fade, fly } from "svelte/transition";
  import {
    List,
    ListInput,
    ListItem,
    Navbar,
    NavbarBackLink,
  } from "konsta/svelte";
  import type { WifiScanNetwork, WifiSecurity } from "../../core/types";

  export let wifiScanInFlight = false;
  export let wifiScanErrorText = "";
  export let availableWifiNetworks: WifiScanNetwork[] = [];
  export let configuredWifiSsid = "";
  export let configuredWifiPass = "";
  export let configuredWifiStatusText = "Connecting";
  export let formatWifiSecurity: (security: WifiSecurity) => string = (security) => security;

  export let onBack: () => void = () => {};
  export let onConnectWifiNetwork: (ssid: string, security: WifiSecurity, passphrase: string) => void = () => {};

  let sheetOpened = false;
  let modalSsid = "";
  let modalSecurity: WifiSecurity = "wpa2";
  let modalPassphrase = "";

  function openNetworkSheet(network: WifiScanNetwork): void {
    modalSsid = network.ssid;
    modalSecurity = network.security === "unknown" ? "wpa2" : network.security;
    modalPassphrase = network.ssid === configuredWifiSsid ? configuredWifiPass : "";
    sheetOpened = true;
  }

  function closeSheet(): void {
    sheetOpened = false;
  }

  function connectSelectedNetwork(): void {
    onConnectWifiNetwork(modalSsid.trim(), modalSecurity, modalPassphrase);
    sheetOpened = false;
  }
</script>

<Navbar title="Internet & WLAN">
  {#snippet left()}
    <NavbarBackLink onclick={onBack} text="Settings" />
  {/snippet}
</Navbar>

<div class="space-y-3">
  {#if wifiScanInFlight}
    <div class="internet-scan-indicator hint mono" aria-live="polite">
      <span class="internet-scan-spinner" aria-hidden="true"></span>
      <span>Scanning WLAN networks...</span>
    </div>
  {/if}
  {#if wifiScanErrorText}
    <div class="hint onboarding-error">{wifiScanErrorText}</div>
  {/if}

  <List strong inset class="wifi-network-list" aria-label="Available WLAN networks">
    {#if availableWifiNetworks.length === 0}
      <ListItem title="no networks found (yet)" subtitle={wifiScanInFlight ? "Scanning in progress..." : ""} />
    {:else}
      {#each availableWifiNetworks as network}
        {@const isConfigured = configuredWifiSsid.trim().length > 0 && network.ssid === configuredWifiSsid.trim()}
        <ListItem
          menuListItem
          menuListItemActive={isConfigured}
          title={network.ssid || "(Hidden network)"}
          subtitle={isConfigured ? configuredWifiStatusText : ""}
          after={isConfigured
            ? "Configured"
            : `${formatWifiSecurity(network.security)} · ${network.rssi === null ? "-- dBm" : `${network.rssi} dBm`}`}
          onClick={() => openNetworkSheet(network)}
        />
      {/each}
    {/if}
  </List>
</div>

{#if sheetOpened}
  <button
    type="button"
    class="internet-modal-backdrop"
    aria-label="Close WLAN connect modal"
    onclick={closeSheet}
    transition:fade={{ duration: 140 }}
  ></button>
  <div class="internet-modal-stage">
    <div
      class="internet-modal-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Connect WLAN"
      tabindex="-1"
      transition:fly={{ y: 26, duration: 220, opacity: 0 }}
    >
      <div class="internet-sheet-content">
        <div class="internet-sheet-header">Connect WLAN</div>
        <div class="internet-sheet-form">
          <List strong inset>
            <ListInput label="SSID" type="text" bind:value={modalSsid} readonly />
            <ListInput label="Security" type="select" bind:value={modalSecurity} dropdown>
              <option value="wpa2">wpa2</option>
              <option value="wpa3">wpa3</option>
              <option value="open">open</option>
            </ListInput>
            <ListInput
              label="Password / Passphrase"
              type="password"
              bind:value={modalPassphrase}
              placeholder={modalSecurity === "open" ? "No password required (open)" : "Passphrase"}
              disabled={modalSecurity === "open"}
            />
          </List>
        </div>
        <div class="internet-sheet-actions">
          <button type="button" class="internet-action-button" onclick={closeSheet}>Cancel</button>
          <button
            type="button"
            class="internet-action-button primary"
            onclick={connectSelectedNetwork}
            disabled={!modalSsid.trim()}
          >
            Connect
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .internet-scan-indicator {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }

  .internet-scan-spinner {
    width: 0.78rem;
    height: 0.78rem;
    border: 2px solid rgba(35, 35, 35, 0.28);
    border-top-color: rgba(35, 35, 35, 0.92);
    border-radius: 999px;
    animation: internet-spin 0.8s linear infinite;
  }

  @keyframes internet-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .internet-modal-backdrop {
    border: 0;
    margin: 0;
    padding: 0;
    position: fixed;
    inset: 0;
    background: rgba(8, 8, 8, 0.46);
    cursor: pointer;
    z-index: 80;
  }

  .internet-modal-panel {
    width: min(42rem, 100%);
    max-height: min(82vh, 38rem);
    border-radius: 1rem;
    background: var(--k-sheet-bg-color, #fff);
    box-shadow: 0 -0.3rem 1.3rem rgba(0, 0, 0, 0.28);
    overflow: hidden;
    pointer-events: auto;
  }

  .internet-modal-stage {
    position: fixed;
    left: 0;
    right: 0;
    top: 0;
    bottom: var(--am-tabbar-height);
    z-index: 90;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: max(0.85rem, env(safe-area-inset-top)) max(0.85rem, env(safe-area-inset-right)) 0 max(0.85rem, env(safe-area-inset-left));
    pointer-events: none;
  }

  .internet-sheet-content {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    max-height: inherit;
    padding: 0.85rem max(0.85rem, env(safe-area-inset-right)) calc(0.85rem + env(safe-area-inset-bottom)) max(0.85rem, env(safe-area-inset-left));
    gap: 0.55rem;
  }

  .internet-sheet-header {
    font-size: 0.92rem;
    font-weight: 600;
    padding: 0 0.2rem;
  }

  .internet-sheet-form {
    overflow-y: auto;
    min-height: 0;
  }

  .internet-sheet-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.55rem;
    border-top: 1px solid rgba(140, 140, 140, 0.22);
    padding-top: 0.7rem;
    background: var(--k-sheet-bg-color, #fff);
  }

  .internet-action-button {
    appearance: none;
    border: 1px solid rgba(70, 70, 70, 0.35);
    background: rgba(246, 246, 246, 0.92);
    color: rgba(22, 22, 22, 0.95);
    min-height: 2.4rem;
    border-radius: 0.6rem;
    font: inherit;
    font-weight: 600;
    padding: 0.45rem 0.85rem;
    cursor: pointer;
  }

  .internet-action-button.primary {
    border-color: #0a5ad1;
    background: #0a5ad1;
    color: #fff;
  }

  .internet-action-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
