<script lang="ts">
  import { Block, BlockTitle } from "konsta/svelte";

  export let gpsAgeText = "--";
  export let dataAgeText = "--";
  export let depthText = "--";
  export let windText = "--";
  export let statePillClass = "ok";
  export let statePillText = "BOOT";
  export let stateSourceText = "Source: --";
  export let currentLatText = "--";
  export let currentLonText = "--";
  export let currentSogText = "--";
  export let currentHeadingText = "--";
  export let pwaVersionText = "--";
  export let firmwareVersionText = "--";
  export let cloudVersionText = "--";
  export let trackStatusText = "No track yet";
</script>

<Block strong class="space-y-3">
  <BlockTitle>Summary</BlockTitle>
  <div class="row">
    <div class="kv">GPS age: <strong>{gpsAgeText}</strong></div>
    <div class="kv">Data age: <strong>{dataAgeText}</strong></div>
    <div class="kv">Depth: <strong>{depthText}</strong></div>
    <div class="kv">Wind: <strong>{windText}</strong></div>
  </div>
  <div style="margin-top:0.6rem">
    <span class={`pill ${statePillClass}`}>{statePillText}</span>
  </div>
  <div class="hint mono" style="margin-top:0.4rem">{stateSourceText}</div>
  <div class="row" style="margin-top:0.7rem">
    <div class="kv">Lat: <strong class="mono">{currentLatText}</strong></div>
    <div class="kv">Lon: <strong class="mono">{currentLonText}</strong></div>
    <div class="kv">SOG: <strong>{currentSogText}</strong></div>
    <div class="kv">Heading: <strong>{currentHeadingText}</strong></div>
  </div>
  <div class="row" style="margin-top:0.55rem">
    <div class="kv">PWA ver: <strong class="mono">{pwaVersionText}</strong></div>
    <div class="kv">FW ver: <strong class="mono">{firmwareVersionText}</strong></div>
    <div class="kv">Cloud ver: <strong class="mono">{cloudVersionText}</strong></div>
  </div>
  <div class="hint mono" style="margin-top:0.5rem">Track: {trackStatusText}</div>
</Block>
