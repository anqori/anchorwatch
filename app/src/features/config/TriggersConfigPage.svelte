<script lang="ts">
  import { Block, BlockTitle, Button as KonstaButton } from "konsta/svelte";

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
  export let onApply: () => void = () => {};
</script>

<Block strong class="space-y-3">
  <BlockTitle>Trigger Config</BlockTitle>
  <div class="hint">Phase 7 scaffold for key trigger thresholds and severities.</div>

  <div class="subcard">
    <div class="row">
      <label class="check"><input type="checkbox" bind:checked={triggerWindAboveEnabled}> wind_above enabled</label>
      <div><div class="hint field-label">thresholdKn</div><input type="number" bind:value={triggerWindAboveThresholdKn}></div>
      <div><div class="hint field-label">holdMs</div><input type="number" bind:value={triggerWindAboveHoldMs}></div>
      <div>
        <div class="hint field-label">severity</div>
        <select bind:value={triggerWindAboveSeverity}>
          <option value="warning">warning</option>
          <option value="alarm">alarm</option>
        </select>
      </div>
    </div>
  </div>

  <div class="subcard">
    <div class="row">
      <label class="check"><input type="checkbox" bind:checked={triggerOutsideAreaEnabled}> outside_area enabled</label>
      <div><div class="hint field-label">holdMs</div><input type="number" bind:value={triggerOutsideAreaHoldMs}></div>
      <div>
        <div class="hint field-label">severity</div>
        <select bind:value={triggerOutsideAreaSeverity}>
          <option value="warning">warning</option>
          <option value="alarm">alarm</option>
        </select>
      </div>
    </div>
  </div>

  <div class="subcard">
    <div class="row">
      <label class="check"><input type="checkbox" bind:checked={triggerGpsAgeEnabled}> gps_age enabled</label>
      <div><div class="hint field-label">maxAgeMs</div><input type="number" bind:value={triggerGpsAgeMaxMs}></div>
      <div><div class="hint field-label">holdMs</div><input type="number" bind:value={triggerGpsAgeHoldMs}></div>
      <div>
        <div class="hint field-label">severity</div>
        <select bind:value={triggerGpsAgeSeverity}>
          <option value="warning">warning</option>
          <option value="alarm">alarm</option>
        </select>
      </div>
    </div>
  </div>

  <div class="actions">
    <KonstaButton onClick={onApply}>Apply Trigger Config</KonstaButton>
  </div>
</Block>
