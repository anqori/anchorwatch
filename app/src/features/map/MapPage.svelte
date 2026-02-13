<script lang="ts">
  export let hasMapTilerKey = false;
  export let maptilerStatusText = "Map not ready.";
  export let container: HTMLDivElement | null = null;
</script>

<section class="viz-screen map-screen">
  {#if hasMapTilerKey}
    <div class="maptiler-host" bind:this={container} aria-label="Map view"></div>
  {:else}
    <div class="maptiler-missing">{maptilerStatusText}</div>
  {/if}
</section>
