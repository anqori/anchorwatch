<script lang="ts">
  import type { TrackPoint } from "../../core/types";
  import { clampNumber } from "../../services/data-utils";
  import { geoDeltaMeters, offsetGeoPoint, type GeoPoint } from "../../services/geo-nav";

  const RANGE_OPTIONS_M = [50, 100, 150, 200, 250] as const;
  const RING_DISTANCE_OPTIONS_M = [5, 10, 20, 25, 50] as const;
  const VIEW_SIZE = 240;
  const VIEW_CENTER = VIEW_SIZE / 2;
  const VIEW_RADIUS = 108;

  interface Props {
    trackPoints?: TrackPoint[];
    anchorPosition?: GeoPoint | null;
    moveMode?: boolean;
    onPreviewAnchorMove?: (lat: number, lon: number) => void;
  }

  let {
    trackPoints = [],
    anchorPosition = null,
    moveMode = false,
    onPreviewAnchorMove = () => {},
  }: Props = $props();

  let rangeIndex = $state(1);
  let hostElement = $state<HTMLElement | null>(null);

  const pointerPositions = new Map<number, { x: number; y: number }>();
  let pinchStartDistance = 0;
  let pinchStartRangeIndex = 1;
  let directionMode = $state<"boat-up" | "north-up">("boat-up");
  let moveDragPointerId: number | null = null;
  let moveDragStartViewPoint: { x: number; y: number } | null = null;
  let moveDragStartAnchor: GeoPoint | null = null;

  const radarCenter = $derived.by<GeoPoint | null>(() => anchorPosition ?? null);
  const headingDeg = $derived.by<number>(() => {
    const latest = trackPoints[trackPoints.length - 1];
    if (!latest || !Number.isFinite(latest.headingDeg)) {
      return 0;
    }
    return (latest.headingDeg % 360 + 360) % 360;
  });

  const currentRangeM = $derived(RANGE_OPTIONS_M[rangeIndex]);

  const ringDistanceM = $derived.by<number>(() => {
    const targetSpacing = currentRangeM / 10;
    let winner: number = RING_DISTANCE_OPTIONS_M[0];
    let bestError = Number.POSITIVE_INFINITY;
    for (const option of RING_DISTANCE_OPTIONS_M) {
      const error = Math.abs(option - targetSpacing);
      if (error < bestError) {
        bestError = error;
        winner = option;
      }
    }
    return winner;
  });

  const ringCount = $derived(Math.max(1, Math.floor(currentRangeM / ringDistanceM)));

  const ringAnnotations = $derived.by<Array<{ radiusPx: number; label: string }>>(() => {
    const out: Array<{ radiusPx: number; label: string }> = [];
    for (let index = 1; index <= ringCount; index += 1) {
      const distanceM = index * ringDistanceM;
      out.push({
        radiusPx: (distanceM / currentRangeM) * VIEW_RADIUS,
        label: `${distanceM} m`,
      });
    }
    return out;
  });

  const projectedTrack = $derived.by<Array<{ x: number; y: number }>>(() => {
    if (!radarCenter) {
      return [];
    }
    const points: Array<{ x: number; y: number }> = [];
    const headingRad = (headingDeg * Math.PI) / 180;
    const cosHeading = Math.cos(headingRad);
    const sinHeading = Math.sin(headingRad);

    for (const point of trackPoints) {
      const delta = geoDeltaMeters(radarCenter, { lat: point.lat, lon: point.lon });
      let eastMeters = delta.eastMeters;
      let northMeters = delta.northMeters;

      if (directionMode === "boat-up") {
        const rotatedEast = eastMeters * cosHeading - northMeters * sinHeading;
        const rotatedNorth = eastMeters * sinHeading + northMeters * cosHeading;
        eastMeters = rotatedEast;
        northMeters = rotatedNorth;
      }

      const rawX = (eastMeters / currentRangeM) * VIEW_RADIUS;
      const rawY = (northMeters / currentRangeM) * VIEW_RADIUS;
      const rawDistancePx = Math.sqrt(rawX * rawX + rawY * rawY);
      const factor = rawDistancePx <= VIEW_RADIUS ? 1 : (VIEW_RADIUS / Math.max(rawDistancePx, 0.0001));
      points.push({
        x: VIEW_CENTER + (rawX * factor),
        y: VIEW_CENTER - (rawY * factor),
      });
    }
    return points;
  });

  const trackPolyline = $derived(projectedTrack.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" "));

  function toViewPoint(event: PointerEvent): { x: number; y: number } | null {
    if (!hostElement) {
      return null;
    }
    const rect = hostElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    const px = clampNumber(event.clientX - rect.left, 0, rect.width);
    const py = clampNumber(event.clientY - rect.top, 0, rect.height);
    return {
      x: (px / rect.width) * VIEW_SIZE,
      y: (py / rect.height) * VIEW_SIZE,
    };
  }

  function zoomIn(): void {
    rangeIndex = clampNumber(rangeIndex - 1, 0, RANGE_OPTIONS_M.length - 1);
  }

  function zoomOut(): void {
    rangeIndex = clampNumber(rangeIndex + 1, 0, RANGE_OPTIONS_M.length - 1);
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    if (event.deltaY < 0) {
      zoomIn();
      return;
    }
    zoomOut();
  }

  function pointerDistance(): number {
    const points = Array.from(pointerPositions.values());
    if (points.length < 2) {
      return 0;
    }
    const dx = points[0].x - points[1].x;
    const dy = points[0].y - points[1].y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function updatePinchZoom(): void {
    if (pointerPositions.size !== 2 || pinchStartDistance <= 0) {
      return;
    }
    const distance = pointerDistance();
    if (distance <= 0) {
      return;
    }
    const scale = distance / pinchStartDistance;
    let deltaSteps = 0;
    if (scale >= 1.12) {
      deltaSteps = Math.floor((scale - 1) / 0.16) + 1;
    } else if (scale <= 0.88) {
      deltaSteps = -(Math.floor((1 / Math.max(scale, 0.01) - 1) / 0.16) + 1);
    }
    rangeIndex = clampNumber(pinchStartRangeIndex - deltaSteps, 0, RANGE_OPTIONS_M.length - 1);
  }

  function onPointerDown(event: PointerEvent): void {
    pointerPositions.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointerPositions.size === 2) {
      pinchStartDistance = pointerDistance();
      pinchStartRangeIndex = rangeIndex;
      moveDragPointerId = null;
      return;
    }

    if (!moveMode || !anchorPosition || pointerPositions.size !== 1) {
      return;
    }

    const point = toViewPoint(event);
    if (!point) {
      return;
    }
    moveDragPointerId = event.pointerId;
    moveDragStartViewPoint = point;
    moveDragStartAnchor = anchorPosition;
  }

  function onPointerMove(event: PointerEvent): void {
    if (!pointerPositions.has(event.pointerId)) {
      return;
    }
    pointerPositions.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointerPositions.size === 2) {
      updatePinchZoom();
      return;
    }

    if (moveDragPointerId !== event.pointerId || !moveDragStartViewPoint || !moveDragStartAnchor) {
      return;
    }
    const point = toViewPoint(event);
    if (!point) {
      return;
    }

    const deltaX = point.x - moveDragStartViewPoint.x;
    const deltaY = point.y - moveDragStartViewPoint.y;
    const eastMetersDisplay = (deltaX / VIEW_RADIUS) * currentRangeM;
    const northMetersDisplay = (-deltaY / VIEW_RADIUS) * currentRangeM;

    let eastMeters = eastMetersDisplay;
    let northMeters = northMetersDisplay;
    if (directionMode === "boat-up") {
      const headingRad = (headingDeg * Math.PI) / 180;
      const cosHeading = Math.cos(headingRad);
      const sinHeading = Math.sin(headingRad);
      eastMeters = eastMetersDisplay * cosHeading + northMetersDisplay * sinHeading;
      northMeters = -eastMetersDisplay * sinHeading + northMetersDisplay * cosHeading;
    }

    const nextAnchor = offsetGeoPoint(moveDragStartAnchor, -northMeters, -eastMeters);
    onPreviewAnchorMove(nextAnchor.lat, nextAnchor.lon);
  }

  function toggleDirectionMode(): void {
    directionMode = directionMode === "boat-up" ? "north-up" : "boat-up";
  }

  function onPointerUp(event: PointerEvent): void {
    pointerPositions.delete(event.pointerId);
    if (pointerPositions.size < 2) {
      pinchStartDistance = 0;
    }
    if (moveDragPointerId === event.pointerId) {
      moveDragPointerId = null;
      moveDragStartViewPoint = null;
      moveDragStartAnchor = null;
    }
  }
</script>

<section class="viz-screen radar-screen" role="application" aria-label="Radar view" bind:this={hostElement}>
  {#if anchorPosition}
    <div
      class="radar-fill-wrap"
      role="application"
      aria-label="Interactive radar plot"
      onwheel={onWheel}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
      onpointerleave={onPointerUp}
    >
      <svg class="radar-fill" viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`} role="img" aria-label="Radar plot">
        <defs>
          <clipPath id="radarClip">
            <circle cx={VIEW_CENTER} cy={VIEW_CENTER} r={VIEW_RADIUS} />
          </clipPath>
        </defs>

        {#each ringAnnotations as ring}
          <circle cx={VIEW_CENTER} cy={VIEW_CENTER} r={ring.radiusPx} class={`radar-ring ${ring.radiusPx >= VIEW_RADIUS ? "outer" : ""}`} />
          <text x={VIEW_CENTER + ring.radiusPx - 1} y={VIEW_CENTER - 3} class="radar-ring-label">{ring.label}</text>
        {/each}

        <line x1={VIEW_CENTER} y1={VIEW_CENTER - VIEW_RADIUS} x2={VIEW_CENTER} y2={VIEW_CENTER + VIEW_RADIUS} class="radar-axis" />
        <line x1={VIEW_CENTER - VIEW_RADIUS} y1={VIEW_CENTER} x2={VIEW_CENTER + VIEW_RADIUS} y2={VIEW_CENTER} class="radar-axis" />

        <g clip-path="url(#radarClip)">
          {#if projectedTrack.length >= 2}
            <polyline points={trackPolyline} class="radar-track-line" />
          {/if}
        </g>

        <circle cx={VIEW_CENTER} cy={VIEW_CENTER} r="5.4" class={`radar-anchor-center ${moveMode ? "move-mode" : ""}`} />
      </svg>
    </div>

    <div class="radar-controls">
      <button
        type="button"
        class="radar-zoom-button radar-direction-button"
        onclick={toggleDirectionMode}
        aria-label={directionMode === "boat-up" ? "Switch radar to north-up" : "Switch radar to boat-direction"}
      >
        {directionMode === "boat-up" ? "BOAT" : "NORTH"}
      </button>
      <button type="button" class="radar-zoom-button" onclick={zoomIn} disabled={rangeIndex === 0} aria-label="Zoom in radar">+</button>
      <button type="button" class="radar-zoom-button" onclick={zoomOut} disabled={rangeIndex === RANGE_OPTIONS_M.length - 1} aria-label="Zoom out radar">-</button>
    </div>
  {:else}
    <div class="maptiler-missing">Set anchor first to open radar view.</div>
  {/if}
</section>
