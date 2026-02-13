<script lang="ts">
  import { BlockTitle, List, ListItem } from "konsta/svelte";
  import type { AlertRuntimeEntry } from "../../core/types";

  export let currentLatText = "--";
  export let currentLonText = "--";
  export let currentSogText = "--";
  export let currentHeadingText = "--";
  export let anchorPositionText = "--";
  export let anchorDistanceText = "--";
  export let anchorBearingText = "--";
  export let activeAlerts: AlertRuntimeEntry[] = [];

  function alertRowClass(alert: AlertRuntimeEntry): string {
    return alert.severity === "ALARM" ? "summary-alert-row alarm" : "summary-alert-row warning";
  }
</script>

<div class="space-y-3">
  <BlockTitle>Boat Data</BlockTitle>
  <List strong inset>
    <ListItem title="Location" after={`${currentLatText}, ${currentLonText}`} />
    <ListItem title="SOG" after={currentSogText} />
    <ListItem title="Heading" after={currentHeadingText} />
  </List>

  <BlockTitle>Anchor Data</BlockTitle>
  <List strong inset>
    <ListItem title="Position" after={anchorPositionText} />
    <ListItem title="Distance" after={anchorDistanceText} />
    <ListItem title="Bearing" after={anchorBearingText} />
  </List>

  <BlockTitle>Alerts</BlockTitle>
  <List strong inset>
    {#if activeAlerts.length === 0}
      <ListItem title="No active alerts." />
    {:else}
      {#each activeAlerts as alert}
        <ListItem
          class={alertRowClass(alert)}
          title={alert.label}
          subtitle={`${alert.state} · ${alert.severity}`}
        />
      {/each}
    {/if}
  </List>
</div>

<style>
  :global(.summary-alert-row.alarm .item-title),
  :global(.summary-alert-row.alarm .item-subtitle) {
    color: #dc2626;
  }

  :global(.summary-alert-row.warning .item-title),
  :global(.summary-alert-row.warning .item-subtitle) {
    color: #ca8a04;
  }
</style>
