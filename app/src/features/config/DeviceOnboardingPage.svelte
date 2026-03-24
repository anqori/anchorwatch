<script lang="ts">
  import {
    Button as KonstaButton,
    List,
    ListInput,
    Navbar,
    NavbarBackLink,
  } from "konsta/svelte";

  export let boatIdText = "";
  export let onBack: () => void = () => {};
  export let onActivateBoat: (factorySetupPin: string, bleConnectionPin: string) => void = () => {};

  let draftBleConnectionPin = "";
  let draftFactorySetupPin = "";

  function activateBoat(): void {
    onActivateBoat(draftFactorySetupPin.trim(), draftBleConnectionPin.trim());
  }
</script>

<Navbar title="Initial onboarding">
  {#snippet left()}
    <NavbarBackLink onclick={onBack} text="Device / Boat" />
  {/snippet}
</Navbar>

<div class="space-y-3">
  <div class="hint">This device still needs its first local BLE setup. Confirm the shared factory setup PIN, then choose the new per-boat `ble_connection_pin`. Cloud setup happens later.</div>

  <div class="hint">Detected boat_id: <strong>{boatIdText}</strong></div>

  <List strong inset>
    <ListInput
      label="factory_setup_pin"
      type="password"
      bind:value={draftFactorySetupPin}
      placeholder="123456"
      autocomplete="off"
    />
    <ListInput label="ble_connection_pin" type="password" bind:value={draftBleConnectionPin} placeholder="1234" autocomplete="off" />
  </List>

  <div class="onboarding-actions-card">
    <div class="actions">
      <KonstaButton onClick={onBack}>Back</KonstaButton>
      <KonstaButton
        onClick={activateBoat}
        disabled={!draftFactorySetupPin.trim() || !draftBleConnectionPin.trim()}
      >
        Complete BLE onboarding
      </KonstaButton>
    </div>
  </div>
</div>

<style>
  .onboarding-actions-card {
    border: 0;
    border-radius: 0.7rem;
    padding: 0.7rem;
    background: rgba(125, 125, 125, 0.08);
  }

  .onboarding-actions-card .actions {
    margin-top: 0.7rem;
  }
</style>
