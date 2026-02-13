<script lang="ts">
  import { Block, BlockTitle, Button as KonstaButton } from "konsta/svelte";

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
  export let onApply: () => void = () => {};
</script>

<Block strong class="space-y-3">
  <BlockTitle>Anchor Set Flow</BlockTitle>
  <div class="hint">Saves anchor + zone preferences to `config.patch` keys from protocol v1.</div>
  <div class="row">
    <div>
      <div class="hint field-label">Default set mode</div>
      <select bind:value={anchorMode}>
        <option value="current">current</option>
        <option value="offset">offset</option>
        <option value="auto">auto</option>
        <option value="manual">manual</option>
      </select>
    </div>
    <div>
      <div class="hint field-label">Zone type</div>
      <select bind:value={zoneType}>
        <option value="circle">circle</option>
        <option value="polygon">polygon</option>
      </select>
    </div>
    <div><div class="hint field-label">Offset distance (m)</div><input type="number" bind:value={anchorOffsetDistanceM}></div>
    <div><div class="hint field-label">Offset angle (deg)</div><input type="number" bind:value={anchorOffsetAngleDeg}></div>
  </div>

  <div class="hint" style="margin-top:0.7rem">Auto mode tuning</div>
  <div class="row">
    <label class="check">
      <input type="checkbox" bind:checked={autoModeEnabled}>
      Auto mode enabled
    </label>
    <div><div class="hint field-label">Min forward SOG (kn)</div><input type="number" bind:value={autoModeMinForwardSogKn}></div>
    <div><div class="hint field-label">Stall max SOG (kn)</div><input type="number" bind:value={autoModeStallMaxSogKn}></div>
    <div><div class="hint field-label">Reverse min SOG (kn)</div><input type="number" bind:value={autoModeReverseMinSogKn}></div>
    <div><div class="hint field-label">Confirm seconds</div><input type="number" bind:value={autoModeConfirmSeconds}></div>
  </div>

  {#if zoneType === "circle"}
    <div class="row" style="margin-top:0.7rem">
      <div><div class="hint field-label">Circle radius (m)</div><input type="number" bind:value={zoneRadiusM}></div>
    </div>
  {:else}
    <div class="hint" style="margin-top:0.7rem">Polygon points (`lat,lon` per line)</div>
    <textarea rows="5" bind:value={polygonPointsInput}></textarea>
  {/if}

  {#if anchorMode === "manual"}
    <div class="hint" style="margin-top:0.7rem">Manual drag/drop draft (runtime command id still pending in protocol docs)</div>
    <div class="row">
      <div><div class="hint field-label">Manual lat</div><input type="number" bind:value={manualAnchorLat}></div>
      <div><div class="hint field-label">Manual lon</div><input type="number" bind:value={manualAnchorLon}></div>
    </div>
  {/if}

  <div class="actions">
    <KonstaButton onClick={onApply}>Apply Anchor + Zone Config</KonstaButton>
  </div>
</Block>
