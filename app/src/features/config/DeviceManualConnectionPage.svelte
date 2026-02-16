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
  export let onSave: (boatId: string, boatSecret: string) => void = () => {};

  let draftBoatId = "";
  let draftBoatSecret = "";
  let initialized = false;

  $: if (!initialized) {
    draftBoatId = boatIdText === "--" ? "" : boatIdText.trim();
    initialized = true;
  }

  function saveManualConnection(): void {
    onSave(draftBoatId.trim(), draftBoatSecret.trim());
  }
</script>

<Navbar title="Manual connection">
  {#snippet left()}
    <NavbarBackLink onclick={onBack} text="Device / Boat" />
  {/snippet}
</Navbar>

<div class="space-y-3">
  <div class="hint">Enter `boat_id` and `boat_secret` to connect without local Bluetooth discovery.</div>

  <List strong inset>
    <ListInput label="boat_id" type="text" bind:value={draftBoatId} placeholder="boat_..." autocapitalize="none" autocomplete="off" />
    <ListInput label="boat_secret" type="password" bind:value={draftBoatSecret} placeholder="secret_..." autocomplete="off" />
  </List>

  <div class="manual-connection-actions-card">
    <div class="actions">
      <KonstaButton onClick={onBack}>Cancel</KonstaButton>
      <KonstaButton onClick={saveManualConnection} disabled={!draftBoatId.trim() || !draftBoatSecret.trim()}>
        Save manual connection
      </KonstaButton>
    </div>
  </div>
</div>

<style>
  .manual-connection-actions-card {
    border: 0;
    border-radius: 0.7rem;
    padding: 0.7rem;
    background: rgba(125, 125, 125, 0.08);
  }

  .manual-connection-actions-card .actions {
    margin-top: 0;
  }
</style>
