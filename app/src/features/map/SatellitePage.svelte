<script lang="ts">
  export let hasMapTilerKey = false;
  export let maptilerStatusText = "Map not ready.";
  export let container: HTMLDivElement | null = null;
</script>

<section class="viz-screen satellite-screen">
  {#if hasMapTilerKey}
    <div class="maptiler-host" bind:this={container} aria-label="Satellite map view"></div>
  {:else}
    <div class="maptiler-missing">{maptilerStatusText}</div>
  {/if}
</section>
