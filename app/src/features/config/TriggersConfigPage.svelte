<script lang="ts">
  import {
    BlockTitle,
    Button as KonstaButton,
    List,
    ListInput,
    ListItem,
    Navbar,
    NavbarBackLink,
    Toggle,
  } from "konsta/svelte";

  export let triggerWindAboveEnabled = true;
  export let triggerWindAboveThresholdKn = "30.0";
  export let triggerWindAboveHoldMs = "15000";
  export let triggerWindAboveSeverity: "warning" | "alarm" = "warning";
  export let triggerOutsideAreaEnabled = true;
  export let triggerOutsideAreaHoldMs = "10000";
  export let triggerOutsideAreaSeverity: "warning" | "alarm" = "alarm";
  export let triggerGpsAgeEnabled = true;
  export let triggerGpsAgeMaxMs = "5000";
  export let triggerGpsAgeHoldMs = "5000";
  export let triggerGpsAgeSeverity: "warning" | "alarm" = "warning";
  export let onBack: () => void = () => {};
  export let onApply: () => void = () => {};
</script>

<Navbar title="Trigger Config">
  {#snippet left()}
    <NavbarBackLink onclick={onBack} text="Settings" />
  {/snippet}
</Navbar>

<div class="space-y-3">
  <div class="hint">Phase 7 scaffold for key trigger thresholds and severities.</div>

  <BlockTitle>Wind Above</BlockTitle>
  <List strong inset>
    <ListItem title="Enabled" label>
      {#snippet after()}
        <Toggle component="div" checked={triggerWindAboveEnabled} onChange={() => (triggerWindAboveEnabled = !triggerWindAboveEnabled)} />
      {/snippet}
    </ListItem>
    <ListInput label="Threshold (kn)" type="number" bind:value={triggerWindAboveThresholdKn} />
    <ListInput label="Hold (ms)" type="number" bind:value={triggerWindAboveHoldMs} />
    <ListInput label="Severity" type="select" bind:value={triggerWindAboveSeverity} dropdown>
      <option value="warning">warning</option>
      <option value="alarm">alarm</option>
    </ListInput>
  </List>

  <BlockTitle>Outside Area</BlockTitle>
  <List strong inset>
    <ListItem title="Enabled" label>
      {#snippet after()}
        <Toggle component="div" checked={triggerOutsideAreaEnabled} onChange={() => (triggerOutsideAreaEnabled = !triggerOutsideAreaEnabled)} />
      {/snippet}
    </ListItem>
    <ListInput label="Hold (ms)" type="number" bind:value={triggerOutsideAreaHoldMs} />
    <ListInput label="Severity" type="select" bind:value={triggerOutsideAreaSeverity} dropdown>
      <option value="warning">warning</option>
      <option value="alarm">alarm</option>
    </ListInput>
  </List>

  <BlockTitle>GPS Age</BlockTitle>
  <List strong inset>
    <ListItem title="Enabled" label>
      {#snippet after()}
        <Toggle component="div" checked={triggerGpsAgeEnabled} onChange={() => (triggerGpsAgeEnabled = !triggerGpsAgeEnabled)} />
      {/snippet}
    </ListItem>
    <ListInput label="Max age (ms)" type="number" bind:value={triggerGpsAgeMaxMs} />
    <ListInput label="Hold (ms)" type="number" bind:value={triggerGpsAgeHoldMs} />
    <ListInput label="Severity" type="select" bind:value={triggerGpsAgeSeverity} dropdown>
      <option value="warning">warning</option>
      <option value="alarm">alarm</option>
    </ListInput>
  </List>

  <div class="actions">
    <KonstaButton onClick={onApply}>Apply Trigger Config</KonstaButton>
  </div>
</div>
