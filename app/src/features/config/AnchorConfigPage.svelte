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

  export let anchorMode: "current" | "offset" | "auto" | "manual" = "offset";
  export let anchorOffsetDistanceM = "8.0";
  export let anchorOffsetAngleDeg = "210.0";
  export let autoModeEnabled = true;
  export let autoModeMinForwardSogKn = "0.8";
  export let autoModeStallMaxSogKn = "0.3";
  export let autoModeReverseMinSogKn = "0.4";
  export let autoModeConfirmSeconds = "20";
  export let zoneType: "circle" | "polygon" = "circle";
  export let zoneRadiusM = "45.0";
  export let polygonPointsInput = "";
  export let manualAnchorLat = "";
  export let manualAnchorLon = "";
  export let onBack: () => void = () => {};
  export let onApply: () => void = () => {};
</script>

<Navbar title="Anchor Set Flow">
  {#snippet left()}
    <NavbarBackLink onclick={onBack} text="Settings" />
  {/snippet}
</Navbar>

<div class="space-y-3">
  <div class="hint">Saves anchor + zone preferences to `config.patch` keys from protocol v1.</div>

  <List strong inset>
    <ListInput label="Default set mode" type="select" bind:value={anchorMode} dropdown>
      <option value="current">current</option>
      <option value="offset">offset</option>
      <option value="auto">auto</option>
      <option value="manual">manual</option>
    </ListInput>

    <ListInput label="Zone type" type="select" bind:value={zoneType} dropdown>
      <option value="circle">circle</option>
      <option value="polygon">polygon</option>
    </ListInput>

    <ListInput label="Offset distance (m)" type="number" bind:value={anchorOffsetDistanceM} />
    <ListInput label="Offset angle (deg)" type="number" bind:value={anchorOffsetAngleDeg} />
  </List>

  <BlockTitle>Auto Mode</BlockTitle>
  <List strong inset>
    <ListItem title="Auto mode enabled" label>
      {#snippet after()}
        <Toggle component="div" checked={autoModeEnabled} onChange={() => (autoModeEnabled = !autoModeEnabled)} />
      {/snippet}
    </ListItem>
    <ListInput label="Min forward SOG (kn)" type="number" bind:value={autoModeMinForwardSogKn} />
    <ListInput label="Stall max SOG (kn)" type="number" bind:value={autoModeStallMaxSogKn} />
    <ListInput label="Reverse min SOG (kn)" type="number" bind:value={autoModeReverseMinSogKn} />
    <ListInput label="Confirm seconds" type="number" bind:value={autoModeConfirmSeconds} />
  </List>

  {#if zoneType === "circle"}
    <BlockTitle>Circle Zone</BlockTitle>
    <List strong inset>
      <ListInput label="Circle radius (m)" type="number" bind:value={zoneRadiusM} />
    </List>
  {:else}
    <BlockTitle>Polygon Zone</BlockTitle>
    <List strong inset>
      <ListInput
        label="Polygon points"
        type="textarea"
        placeholder="lat,lon per line"
        bind:value={polygonPointsInput}
        inputClass="!h-28 resize-none"
      />
    </List>
  {/if}

  {#if anchorMode === "manual"}
    <BlockTitle>Manual Anchor</BlockTitle>
    <div class="hint">Manual drag/drop draft (runtime command id still pending in protocol docs)</div>
    <List strong inset>
      <ListInput label="Manual lat" type="number" bind:value={manualAnchorLat} />
      <ListInput label="Manual lon" type="number" bind:value={manualAnchorLon} />
    </List>
  {/if}

  <div class="actions">
    <KonstaButton onClick={onApply}>Apply Anchor + Zone Config</KonstaButton>
  </div>
</div>
