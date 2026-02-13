<script lang="ts">
  import {
    List,
    ListInput,
    Navbar,
    NavbarBackLink,
  } from "konsta/svelte";

  export let autoModeMinForwardSogKn = "0.8";
  export let autoModeStallMaxSogKn = "0.3";
  export let autoModeReverseMinSogKn = "0.4";
  export let autoModeConfirmSeconds = "20";
  export let onBack: () => void = () => {};
</script>

<Navbar title="Anchor Automatic Placement">
  {#snippet left()}
    <NavbarBackLink onclick={onBack} text="Settings" />
  {/snippet}
</Navbar>

<div class="space-y-3">
  <List strong inset>
    <ListInput
      label="How this works"
      type="textarea"
      value="Automatic placement does not drop the anchor by itself. When the user triggers an anchor-down command in automatic placement mode, the device computes the drop position from boat movement using the parameters below."
      readonly
      inputClass="!h-28 resize-none"
    />
  </List>

  <List strong inset>
    <ListInput label="Min forward SOG (kn)" type="number" bind:value={autoModeMinForwardSogKn} />
    <ListInput label="Stall max SOG (kn)" type="number" bind:value={autoModeStallMaxSogKn} />
    <ListInput label="Reverse min SOG (kn)" type="number" bind:value={autoModeReverseMinSogKn} />
    <ListInput label="Confirm seconds" type="number" bind:value={autoModeConfirmSeconds} />
  </List>
</div>
