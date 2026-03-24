<script lang="ts">
  import {
    List,
    ListInput,
    ListItem,
    Navbar,
    NavbarBackLink,
    Toggle,
  } from "konsta/svelte";

  export let anchorDistanceIsEnabled = true;
  export let anchorDistanceMaxDistanceM = "35";
  export let anchorDistanceMinTimeMs = "20000";
  export let anchorDistanceSeverity: "WARNING" | "ALARM" = "ALARM";

  export let obstacleCloseIsEnabled = true;
  export let obstacleCloseMinDistanceM = "10";
  export let obstacleCloseMinTimeMs = "10000";
  export let obstacleCloseSeverity: "WARNING" | "ALARM" = "ALARM";

  export let windAboveIsEnabled = true;
  export let windAboveMaxWindKn = "30";
  export let windAboveMinTimeMs = "20000";
  export let windAboveSeverity: "WARNING" | "ALARM" = "WARNING";

  export let depthBelowIsEnabled = false;
  export let depthBelowMinDepthM = "2";
  export let depthBelowMinTimeMs = "10000";
  export let depthBelowSeverity: "WARNING" | "ALARM" = "ALARM";

  export let dataOutdatedIsEnabled = true;
  export let dataOutdatedMaxAgeMs = "5000";
  export let dataOutdatedMinTimeMs = "5000";
  export let dataOutdatedSeverity: "WARNING" | "ALARM" = "WARNING";

  export let disabled = false;
  export let disabledReason = "Waiting for server config...";
  export let onBack: () => void = () => {};

  const MIN_TIME_OPTIONS = [
    { value: "5000", label: "5s" },
    { value: "10000", label: "10s" },
    { value: "20000", label: "20s" },
    { value: "30000", label: "30s" },
    { value: "60000", label: "1m" },
    { value: "120000", label: "2m" },
    { value: "300000", label: "5m" },
  ];

  const DATA_AGE_OPTIONS = MIN_TIME_OPTIONS;
  const MAX_WIND_OPTIONS = [
    { value: "10", label: "10 knots" },
    { value: "15", label: "15 knots" },
    { value: "20", label: "20 knots" },
    { value: "25", label: "25 knots" },
    { value: "30", label: "30 knots" },
    { value: "35", label: "35 knots" },
  ];
  const MIN_DEPTH_OPTIONS = [
    { value: "1", label: "1.00 m" },
    { value: "1.25", label: "1.25 m" },
    { value: "1.5", label: "1.50 m" },
    { value: "1.75", label: "1.75 m" },
    { value: "2", label: "2.00 m" },
    { value: "2.5", label: "2.50 m" },
    { value: "3", label: "3.00 m" },
    { value: "4", label: "4.00 m" },
  ];
  const MIN_DISTANCE_OPTIONS = [
    { value: "5", label: "5 m" },
    { value: "10", label: "10 m" },
    { value: "15", label: "15 m" },
    { value: "20", label: "20 m" },
    { value: "25", label: "25 m" },
    { value: "35", label: "35 m" },
    { value: "50", label: "50 m" },
  ];
</script>

<Navbar title="Alerts Config">
  {#snippet left()}
    <NavbarBackLink onclick={onBack} text="Settings" />
  {/snippet}
</Navbar>

<div class="space-y-3">
  <div class="hint">The server evaluates enabled alerts continuously. Obstacle geometry is configured separately in the Obstacles page.</div>
  {#if disabled}
    <div class="hint">{disabledReason}</div>
  {/if}

  <div class:config-disabled={disabled}>
  <List strong inset>
    <ListItem title="Anchor Distance" label>
      {#snippet after()}
        <Toggle component="div" checked={anchorDistanceIsEnabled} onChange={() => (anchorDistanceIsEnabled = !anchorDistanceIsEnabled)} />
      {/snippet}
    </ListItem>
    {#if anchorDistanceIsEnabled}
      <ListInput label="Max distance" type="select" bind:value={anchorDistanceMaxDistanceM} dropdown>
        {#each MIN_DISTANCE_OPTIONS as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </ListInput>
      <ListInput label="Allow time before alert" type="select" bind:value={anchorDistanceMinTimeMs} dropdown>
        {#each MIN_TIME_OPTIONS as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </ListInput>
      <ListInput label="Severity" type="select" bind:value={anchorDistanceSeverity} dropdown>
        <option value="WARNING">WARNING</option>
        <option value="ALARM">ALARM</option>
      </ListInput>
    {/if}
  </List>

  <List strong inset>
    <ListItem title="Obstacle Close" label>
      {#snippet after()}
        <Toggle component="div" checked={obstacleCloseIsEnabled} onChange={() => (obstacleCloseIsEnabled = !obstacleCloseIsEnabled)} />
      {/snippet}
    </ListItem>
    {#if obstacleCloseIsEnabled}
      <ListInput label="Minimum distance" type="select" bind:value={obstacleCloseMinDistanceM} dropdown>
        {#each MIN_DISTANCE_OPTIONS as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </ListInput>
      <ListInput label="Allow time before alert" type="select" bind:value={obstacleCloseMinTimeMs} dropdown>
        {#each MIN_TIME_OPTIONS as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </ListInput>
      <ListInput label="Severity" type="select" bind:value={obstacleCloseSeverity} dropdown>
        <option value="WARNING">WARNING</option>
        <option value="ALARM">ALARM</option>
      </ListInput>
    {/if}
  </List>

  <List strong inset>
    <ListItem title="Wind Above" label>
      {#snippet after()}
        <Toggle component="div" checked={windAboveIsEnabled} onChange={() => (windAboveIsEnabled = !windAboveIsEnabled)} />
      {/snippet}
    </ListItem>
    {#if windAboveIsEnabled}
      <ListInput label="Maximum wind" type="select" bind:value={windAboveMaxWindKn} dropdown>
        {#each MAX_WIND_OPTIONS as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </ListInput>
      <ListInput label="Allow time before alert" type="select" bind:value={windAboveMinTimeMs} dropdown>
        {#each MIN_TIME_OPTIONS as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </ListInput>
      <ListInput label="Severity" type="select" bind:value={windAboveSeverity} dropdown>
        <option value="WARNING">WARNING</option>
        <option value="ALARM">ALARM</option>
      </ListInput>
    {/if}
  </List>

  <List strong inset>
    <ListItem title="Depth Below" label>
      {#snippet after()}
        <Toggle component="div" checked={depthBelowIsEnabled} onChange={() => (depthBelowIsEnabled = !depthBelowIsEnabled)} />
      {/snippet}
    </ListItem>
    {#if depthBelowIsEnabled}
      <ListInput label="Minimum depth" type="select" bind:value={depthBelowMinDepthM} dropdown>
        {#each MIN_DEPTH_OPTIONS as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </ListInput>
      <ListInput label="Allow time before alert" type="select" bind:value={depthBelowMinTimeMs} dropdown>
        {#each MIN_TIME_OPTIONS as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </ListInput>
      <ListInput label="Severity" type="select" bind:value={depthBelowSeverity} dropdown>
        <option value="WARNING">WARNING</option>
        <option value="ALARM">ALARM</option>
      </ListInput>
    {/if}
  </List>

  <List strong inset>
    <ListItem title="Data Outdated" label>
      {#snippet after()}
        <Toggle component="div" checked={dataOutdatedIsEnabled} onChange={() => (dataOutdatedIsEnabled = !dataOutdatedIsEnabled)} />
      {/snippet}
    </ListItem>
    {#if dataOutdatedIsEnabled}
      <ListInput label="Maximum age" type="select" bind:value={dataOutdatedMaxAgeMs} dropdown>
        {#each DATA_AGE_OPTIONS as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </ListInput>
      <ListInput label="Allow time before alert" type="select" bind:value={dataOutdatedMinTimeMs} dropdown>
        {#each MIN_TIME_OPTIONS as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </ListInput>
      <ListInput label="Severity" type="select" bind:value={dataOutdatedSeverity} dropdown>
        <option value="WARNING">WARNING</option>
        <option value="ALARM">ALARM</option>
      </ListInput>
    {/if}
  </List>
  </div>
</div>

<style>
  .config-disabled {
    opacity: 0.45;
    pointer-events: none;
  }
</style>
