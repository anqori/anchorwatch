<script lang="ts">
  import {
    List,
    ListInput,
    Navbar,
    NavbarBackLink,
  } from "konsta/svelte";

  export let allowedRangeM = "35";
  export let disabled = false;
  export let disabledReason = "Waiting for server config...";
  export let onBack: () => void = () => {};
</script>

<Navbar title="Anchor Settings">
  {#snippet left()}
    <NavbarBackLink onclick={onBack} text="Settings" />
  {/snippet}
</Navbar>

<div class="space-y-3">
  {#if disabled}
    <div class="hint">{disabledReason}</div>
  {/if}
  <div class:config-disabled={disabled}>
  <List strong inset>
    <ListInput
      label="Allowed range (m)"
      type="number"
      bind:value={allowedRangeM}
      placeholder="35"
    />
  </List>
  </div>
</div>

<style>
  .config-disabled {
    opacity: 0.45;
    pointer-events: none;
  }
</style>
