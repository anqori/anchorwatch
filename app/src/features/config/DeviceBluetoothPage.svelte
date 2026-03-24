<script lang="ts">
  import {
    Button as KonstaButton,
    List,
    ListItem,
    Navbar,
    NavbarBackLink,
  } from "konsta/svelte";

  export let appState: "UNCONFIGURED" | "CONFIGURED_BUT_UNCONNECTED" | "CONNECTED" = "UNCONFIGURED";
  export let bleSupported = false;
  export let bleStatusText = "disconnected";
  export let boatIdText = "--";
  export let secretStatusText = "not stored";
  export let connectedDeviceName = "";
  export let runtimeModeText = "Remote (relay only)";
  export let systemRuntimeMode: "LIVE" | "SIMULATION" = "LIVE";
  export let runtimeConfigDisabled = false;
  export let runtimeConfigDisabledReason = "Waiting for server config...";

  export let onBack: () => void = () => {};
  export let onSearchDevice: () => void = () => {};
  export let onOpenManualConnection: () => void = () => {};
  export let onSelectSystemRuntimeMode: (mode: "LIVE" | "SIMULATION") => void = () => {};
</script>

<Navbar title="Device / Boat">
  {#snippet left()}
    <NavbarBackLink onclick={onBack} text="Settings" />
  {/snippet}
</Navbar>

<div class="space-y-3">
  <List strong inset>
    <ListItem title="Connected Device" after={connectedDeviceName || "--"} />
    <ListItem title="Boat ID" after={boatIdText} />
    <ListItem title="Boat secret" after={secretStatusText} />
    <ListItem title="App state" after={appState} />
    <ListItem title="Runtime mode" after={runtimeModeText} />
    <ListItem title="BLE" after={bleStatusText} />
  </List>

  <div class="device-action-card" class:config-disabled={runtimeConfigDisabled}>
    <div class="runtime-mode-label">Server runtime</div>
    {#if runtimeConfigDisabled}
      <div class="hint">{runtimeConfigDisabledReason}</div>
    {/if}
    <div class="runtime-mode-toggle">
      <button
        type="button"
        class:active-mode={systemRuntimeMode === "LIVE"}
        disabled={runtimeConfigDisabled}
        onclick={() => onSelectSystemRuntimeMode("LIVE")}
      >
        LIVE
      </button>
      <button
        type="button"
        class:active-mode={systemRuntimeMode === "SIMULATION"}
        disabled={runtimeConfigDisabled}
        onclick={() => onSelectSystemRuntimeMode("SIMULATION")}
      >
        SIMULATION
      </button>
    </div>
  </div>

  <div class="device-action-card">
    <div class="actions">
      <KonstaButton onClick={onSearchDevice} disabled={!bleSupported}>Search for device locally</KonstaButton>
      <KonstaButton onClick={onOpenManualConnection}>Manual connection</KonstaButton>
    </div>
    {#if !bleSupported}
      <div class="hint onboarding-error">
        Bluetooth is not supported in this browser/app environment. Use a supported browser with Web Bluetooth.
      </div>
    {/if}
  </div>
</div>

<style>
  .device-action-card {
    border: 0;
    border-radius: 0.7rem;
    padding: 0.7rem;
    background: rgba(125, 125, 125, 0.08);
  }

  .device-action-card .actions {
    margin-top: 0;
  }

  .runtime-mode-label {
    font-size: 0.85rem;
    opacity: 0.7;
    margin-bottom: 0.55rem;
  }

  .runtime-mode-toggle {
    display: flex;
    gap: 0.6rem;
  }

  .runtime-mode-toggle button {
    appearance: none;
    border: 1px solid rgba(0, 0, 0, 0.18);
    background: rgba(255, 255, 255, 0.6);
    border-radius: 999px;
    padding: 0.6rem 1rem;
    font-weight: 600;
  }

  .runtime-mode-toggle button.active-mode {
    background: rgba(20, 110, 255, 0.14);
    border-color: rgba(20, 110, 255, 0.45);
  }

  .config-disabled {
    opacity: 0.45;
  }
</style>
