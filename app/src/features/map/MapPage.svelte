<script lang="ts">
  export let hasMapTilerKey = false;
  export let maptilerStatusText = "Map not ready.";
  export let currentLatText = "--";
  export let currentLonText = "--";
  export let currentSogText = "--";
  export let currentCogText = "--";
  export let container: HTMLDivElement | null = null;
</script>

<section class="viz-screen map-screen">
  {#if hasMapTilerKey}
    <div class="maptiler-host" bind:this={container} aria-label="Map view"></div>
  {:else}
    <div class="maptiler-missing">{maptilerStatusText}</div>
  {/if}
  <div class="viz-overlay mono">Lat {currentLatText} · Lon {currentLonText} · SOG {currentSogText} · COG {currentCogText}</div>
</section>
