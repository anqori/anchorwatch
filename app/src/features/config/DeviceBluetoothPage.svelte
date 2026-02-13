<script lang="ts">
  import {
    Button as KonstaButton,
    List,
    ListItem,
    Navbar,
    NavbarBackLink,
  } from "konsta/svelte";

  export let isConfigured = false;
  export let appState: "UNCONFIGURED" | "CONFIGURED_BUT_UNCONNECTED" | "CONNECTED" = "UNCONFIGURED";
  export let bleSupported = false;
  export let bleStatusText = "disconnected";
  export let boatIdText = "--";
  export let secretStatusText = "not stored";
  export let connectedDeviceName = "";

  export let onBack: () => void = () => {};
  export let onSearchDevice: () => void = () => {};
  export let onUseDemoData: () => void = () => {};
</script>

<Navbar title="Device / Bluetooth">
  {#snippet left()}
    <NavbarBackLink onclick={onBack} text="Settings" />
  {/snippet}
</Navbar>

<div class="space-y-3">
  {#if !isConfigured}
    <div class="hint">
      you need to grant this application permissions to search for the device via bluetooth.
    </div>
    {#if !bleSupported}
      <div class="hint onboarding-error">
        Bluetooth is not supported in this browser/app environment. Use a supported browser with Web Bluetooth.
      </div>
    {/if}
    <div class="actions">
      <KonstaButton onClick={onSearchDevice} disabled={!bleSupported}>Search via Bluetooth</KonstaButton>
    </div>
  {:else}
    <List strong inset>
      <ListItem title="App state" after={appState} />
      <ListItem title="BLE" after={bleStatusText} />
      <ListItem title="Connected Device" after={connectedDeviceName || "--"} />
      <ListItem title="Boat ID" after={boatIdText} />
      <ListItem title="Boat secret" after={secretStatusText} />
    </List>
    <div class="actions">
      <KonstaButton onClick={onSearchDevice} disabled={!bleSupported}>
        Search for other Device via Bluetooth
      </KonstaButton>
    </div>
  {/if}

  <div class="device-corner-action">
    <button type="button" class="device-demo-button" onclick={onUseDemoData}>
      use demonstration data
    </button>
  </div>
</div>
