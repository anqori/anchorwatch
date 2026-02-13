<script lang="ts">
  import {
    Button as KonstaButton,
    List,
    ListItem,
    Navbar,
    NavbarBackLink,
  } from "konsta/svelte";

  export let isConfigured = false;
  export let connectionStatusText = "Not connected";
  export let mode: "fake" | "device" = "device";
  export let activeConnection: "fake" | "bluetooth" | "cloud-relay" = "cloud-relay";

  export let onBack: () => void = () => {};
  export let onSelectBluetooth: () => void = () => {};
  export let onSelectRelay: () => void = () => {};
  export let onSelectFake: () => void = () => {};
</script>

<Navbar title="Connection">
  {#snippet left()}
    <NavbarBackLink onclick={onBack} text="Settings" />
  {/snippet}
</Navbar>

<div class="space-y-3">
  <List strong inset>
    <ListItem title="Connection" after={connectionStatusText} />
  </List>

  {#if !isConfigured}
    <div class="hint onboarding-error">Device setup required before changing connection type.</div>
  {:else}
    <div class="actions">
      <KonstaButton onClick={onSelectBluetooth} disabled={mode === "device" && activeConnection === "bluetooth"}>
        Connected via BT
      </KonstaButton>
      <KonstaButton onClick={onSelectRelay} disabled={mode === "device" && activeConnection === "cloud-relay"}>
        Connected via Relay
      </KonstaButton>
      <KonstaButton onClick={onSelectFake} disabled={mode === "fake" && activeConnection === "fake"}>
        Connected to Fake data
      </KonstaButton>
    </div>
  {/if}
</div>
