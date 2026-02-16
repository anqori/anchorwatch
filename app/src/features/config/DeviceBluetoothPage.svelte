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

  export let onBack: () => void = () => {};
  export let onSearchDevice: () => void = () => {};
  export let onOpenManualConnection: () => void = () => {};
  export let onUseDemoData: () => void = () => {};
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

  <div class="device-corner-action">
    <button type="button" class="device-demo-button" onclick={onUseDemoData}>
      use demonstration data
    </button>
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
</style>
