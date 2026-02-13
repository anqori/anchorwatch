<script lang="ts">
  export let radarTargetX = 110;
  export let radarTargetY = 110;
  export let radarDistanceText = "--";
  export let radarBearingText = "--";
  export let currentHeadingText = "--";
</script>

<section class="viz-screen radar-screen">
  <svg class="radar-fill" viewBox="0 0 220 220" role="img" aria-label="Radar plot">
    <circle cx="110" cy="110" r="104" class="radar-ring outer" />
    <circle cx="110" cy="110" r="78" class="radar-ring" />
    <circle cx="110" cy="110" r="52" class="radar-ring" />
    <circle cx="110" cy="110" r="26" class="radar-ring" />
    <line x1="110" y1="6" x2="110" y2="214" class="radar-axis" />
    <line x1="6" y1="110" x2="214" y2="110" class="radar-axis" />
    <line x1="110" y1="110" x2={radarTargetX} y2={radarTargetY} class="radar-vector" />
    <circle cx="110" cy="110" r="4" class="radar-center" />
    <circle cx={radarTargetX} cy={radarTargetY} r="6" class="radar-target" />
  </svg>
  <div class="viz-overlay">Distance {radarDistanceText} · Bearing {radarBearingText} · Heading {currentHeadingText}</div>
</section>
