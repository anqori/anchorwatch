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
  export let anchorDistanceMinTimeMs = "20000";
  export let anchorDistanceSeverity: "WARNING" | "ALARM" = "ALARM";

  export let boatingAreaIsEnabled = true;
  export let boatingAreaMinTimeMs = "20000";
  export let boatingAreaSeverity: "WARNING" | "ALARM" = "ALARM";

  export let windStrengthIsEnabled = true;
  export let windStrengthMaxTwsKn = "30.0";
  export let windStrengthMinTimeMs = "20000";
  export let windStrengthSeverity: "WARNING" | "ALARM" = "WARNING";

  export let depthIsEnabled = false;
  export let depthMinDepthM = "2";
  export let depthMinTimeMs = "10000";
  export let depthSeverity: "WARNING" | "ALARM" = "ALARM";

  export let dataOutdatedIsEnabled = true;
  export let dataOutdatedMinAgeMs = "5000";
  export let dataOutdatedMinTimeMs = "5000";
  export let dataOutdatedSeverity: "WARNING" | "ALARM" = "WARNING";

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

  const DATA_AGE_OPTIONS = [
    { value: "5000", label: "5s" },
    { value: "10000", label: "10s" },
    { value: "20000", label: "20s" },
    { value: "30000", label: "30s" },
    { value: "60000", label: "1m" },
    { value: "120000", label: "2m" },
    { value: "300000", label: "5m" },
  ];

  const MAX_TWS_OPTIONS = [
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
    { value: "2.25", label: "2.25 m" },
    { value: "2.5", label: "2.50 m" },
    { value: "2.75", label: "2.75 m" },
    { value: "3", label: "3.00 m" },
    { value: "4", label: "4.00 m" },
    { value: "5", label: "5.00 m" },
    { value: "10", label: "10.00 m" },
    { value: "15", label: "15.00 m" },
  ];
</script>

<Navbar title="Alerts Config">
  {#snippet left()}
    <NavbarBackLink onclick={onBack} text="Settings" />
  {/snippet}
</Navbar>

<div class="space-y-3">
  <div class="hint">Device evaluates enabled alerts. Disabled alerts are not checked.</div>

  <List strong inset>
    <ListItem title="Anchor Distance Alarm" label>
      {#snippet after()}
        <Toggle component="div" checked={anchorDistanceIsEnabled} onChange={() => (anchorDistanceIsEnabled = !anchorDistanceIsEnabled)} />
      {/snippet}
    </ListItem>
    {#if anchorDistanceIsEnabled}
      <ListInput label="Allow time before alert" type="select" bind:value={anchorDistanceMinTimeMs} dropdown>
        {#each MIN_TIME_OPTIONS as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </ListInput>
      <ListInput label="Severity" type="select" bind:value={anchorDistanceSeverity} dropdown>
        <option value="WARNING">WARNING</option>
        <option value="ALARM">ALARM</option>
      </ListInput>
      <ListItem title="Max distance is fixed for now; map-based setup comes later." />
    {/if}
  </List>

  <List strong inset>
    <ListItem title="Boating Area Alarm" label>
      {#snippet after()}
        <Toggle component="div" checked={boatingAreaIsEnabled} onChange={() => (boatingAreaIsEnabled = !boatingAreaIsEnabled)} />
      {/snippet}
    </ListItem>
    {#if boatingAreaIsEnabled}
      <ListInput label="Allow time before alert" type="select" bind:value={boatingAreaMinTimeMs} dropdown>
        {#each MIN_TIME_OPTIONS as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </ListInput>
      <ListInput label="Severity" type="select" bind:value={boatingAreaSeverity} dropdown>
        <option value="WARNING">WARNING</option>
        <option value="ALARM">ALARM</option>
      </ListInput>
      <ListItem title="Polygon is fixed for now; drawing/editing comes later in map views." />
    {/if}
  </List>

  <List strong inset>
    <ListItem title="Wind Strength Alarm" label>
      {#snippet after()}
        <Toggle component="div" checked={windStrengthIsEnabled} onChange={() => (windStrengthIsEnabled = !windStrengthIsEnabled)} />
      {/snippet}
    </ListItem>
    {#if windStrengthIsEnabled}
      <ListInput label="Maximum TWS" type="select" bind:value={windStrengthMaxTwsKn} dropdown>
        {#each MAX_TWS_OPTIONS as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </ListInput>
      <ListInput label="Allow time before alert" type="select" bind:value={windStrengthMinTimeMs} dropdown>
        {#each MIN_TIME_OPTIONS as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </ListInput>
      <ListInput label="Severity" type="select" bind:value={windStrengthSeverity} dropdown>
        <option value="WARNING">WARNING</option>
        <option value="ALARM">ALARM</option>
      </ListInput>
    {/if}
  </List>

  <List strong inset>
    <ListItem title="Depth Alarm" label>
      {#snippet after()}
        <Toggle component="div" checked={depthIsEnabled} onChange={() => (depthIsEnabled = !depthIsEnabled)} />
      {/snippet}
    </ListItem>
    {#if depthIsEnabled}
      <ListInput label="Minimum depth" type="select" bind:value={depthMinDepthM} dropdown>
        {#each MIN_DEPTH_OPTIONS as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </ListInput>
      <ListInput label="Allow time before alert" type="select" bind:value={depthMinTimeMs} dropdown>
        {#each MIN_TIME_OPTIONS as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </ListInput>
      <ListInput label="Severity" type="select" bind:value={depthSeverity} dropdown>
        <option value="WARNING">WARNING</option>
        <option value="ALARM">ALARM</option>
      </ListInput>
    {/if}
  </List>

  <List strong inset>
    <ListItem title="Data Outdated Alarm" label>
      {#snippet after()}
        <Toggle component="div" checked={dataOutdatedIsEnabled} onChange={() => (dataOutdatedIsEnabled = !dataOutdatedIsEnabled)} />
      {/snippet}
    </ListItem>
    {#if dataOutdatedIsEnabled}
      <ListInput label="Maximum allowed data age" type="select" bind:value={dataOutdatedMinAgeMs} dropdown>
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
