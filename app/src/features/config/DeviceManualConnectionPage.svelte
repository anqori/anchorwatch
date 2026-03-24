<script lang="ts">
  import {
    Button as KonstaButton,
    List,
    ListInput,
    Navbar,
    NavbarBackLink,
  } from "konsta/svelte";

  export let boatIdText = "";
  export let bleConnected = false;
  export let boatAccessState = "";
  export let sessionState = "";
  export let onBack: () => void = () => {};
  export let onSave: (boatId: string, cloudSecret: string) => void = () => {};
  export let onAuthorizeSession: (boatId: string, bleConnectionPin: string) => void = () => {};
  export let onRotateBlePin: (newBleConnectionPin: string) => void = () => {};

  let draftBoatId = "";
  let draftCloudSecret = "";
  let draftBleConnectionPin = "";
  let draftNewBleConnectionPin = "";
  let initialized = false;

  $: if (!initialized) {
    draftBoatId = boatIdText === "--" ? "" : boatIdText.trim();
    initialized = true;
  }

  function saveManualConnection(): void {
    onSave(draftBoatId.trim(), draftCloudSecret.trim());
  }

  function authorizeSession(): void {
    onAuthorizeSession(draftBoatId.trim(), draftBleConnectionPin.trim());
  }

  function rotateBlePin(): void {
    onRotateBlePin(draftNewBleConnectionPin.trim());
  }
</script>

<Navbar title="Manual connection">
  {#snippet left()}
    <NavbarBackLink onclick={onBack} text="Device / Boat" />
  {/snippet}
</Navbar>

<div class="space-y-3">
  <div class="hint">Store `boat_id` and `cloud_secret` locally so this app can use the relay. Authorized BLE sessions also refresh the current cloud secret automatically.</div>

  <List strong inset>
    <ListInput label="boat_id" type="text" bind:value={draftBoatId} placeholder="boat_..." autocapitalize="none" autocomplete="off" />
    <ListInput label="cloud_secret" type="password" bind:value={draftCloudSecret} placeholder="secret_..." autocomplete="off" />
  </List>

  <div class="manual-connection-actions-card">
    <div class="actions">
      <KonstaButton onClick={onBack}>Cancel</KonstaButton>
      <KonstaButton onClick={saveManualConnection} disabled={!draftBoatId.trim() || !draftCloudSecret.trim()}>
        Save manual connection
      </KonstaButton>
    </div>
  </div>

  {#if bleConnected && boatAccessState !== "SETUP_REQUIRED" && sessionState !== "AUTHORIZED"}
    <div class="manual-connection-actions-card">
      <div class="section-title">Authorize BLE session</div>
      <div class="hint">Enter the current BLE connection pin to unlock runtime data and protected commands for this BLE session.</div>
      <List strong inset>
        <ListInput
          label="ble_connection_pin"
          type="password"
          bind:value={draftBleConnectionPin}
          placeholder="1234"
          autocomplete="off"
        />
      </List>
      <div class="actions">
        <KonstaButton onClick={authorizeSession} disabled={!draftBleConnectionPin.trim()}>
          Authorize current BLE session
        </KonstaButton>
      </div>
    </div>
  {/if}

  {#if bleConnected && boatAccessState !== "SETUP_REQUIRED" && sessionState === "AUTHORIZED"}
    <div class="manual-connection-actions-card">
      <div class="section-title">Rotate BLE connection pin</div>
      <div class="hint">This changes the local BLE control pin. Existing BLE sessions must reauthorize afterward.</div>
      <List strong inset>
        <ListInput
          label="new_ble_connection_pin"
          type="password"
          bind:value={draftNewBleConnectionPin}
          placeholder="new pin"
          autocomplete="off"
        />
      </List>
      <div class="actions">
        <KonstaButton onClick={rotateBlePin} disabled={!draftNewBleConnectionPin.trim()}>
          Update BLE connection pin
        </KonstaButton>
      </div>
    </div>
  {/if}
</div>

<style>
  .manual-connection-actions-card {
    border: 0;
    border-radius: 0.7rem;
    padding: 0.7rem;
    background: rgba(125, 125, 125, 0.08);
  }

  .manual-connection-actions-card .actions {
    margin-top: 0.7rem;
  }

  .section-title {
    font-size: 0.9rem;
    font-weight: 700;
    margin-bottom: 0.4rem;
  }
</style>
