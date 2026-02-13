<script lang="ts">
  import type { TrackPoint } from "../../core/types";
  import { clampNumber } from "../../services/data-utils";
  import { geoDeltaMeters, offsetGeoPoint, type GeoPoint } from "../../services/geo-nav";

  const RANGE_OPTIONS_M = [50, 100, 200, 250] as const;
  const VIEW_SIZE = 240;
  const VIEW_CENTER = VIEW_SIZE / 2;
  const VIEW_RADIUS = 108;

  interface Props {
    trackPoints?: TrackPoint[];
    anchorPosition?: GeoPoint | null;
    currentHeadingText?: string;
    onMoveAnchor?: (lat: number, lon: number) => void;
  }

  let {
    trackPoints = [],
    anchorPosition = null,
    currentHeadingText = "--",
    onMoveAnchor = () => {},
  }: Props = $props();

  let rangeIndex = $state(1);
  let hostElement = $state<HTMLElement | null>(null);
  let pendingAnchorPosition = $state<GeoPoint | null>(null);

  const pointerPositions = new Map<number, { x: number; y: number }>();
  let pinchStartDistance = 0;
  let pinchStartRangeIndex = 1;
  let draggingAnchorPointerId: number | null = null;

  const currentPosition = $derived.by<GeoPoint | null>(() => {
    const latest = trackPoints[trackPoints.length - 1];
    if (!latest) {
      return null;
    }
    return { lat: latest.lat, lon: latest.lon };
  });

  const radarCenterPosition = $derived.by<GeoPoint | null>(() => {
    if (currentPosition) {
      return currentPosition;
    }
    if (anchorPosition) {
      return anchorPosition;
    }
    return null;
  });

  const effectiveAnchorPosition = $derived.by<GeoPoint | null>(() => pendingAnchorPosition || anchorPosition);
  const currentRangeM = $derived(RANGE_OPTIONS_M[rangeIndex]);
  const ringDistanceM = $derived(currentRangeM / 10);

  const projectedTrack = $derived.by<Array<{ x: number; y: number }>>(() => {
    if (!radarCenterPosition) {
      return [];
    }
    const points: Array<{ x: number; y: number }> = [];
    for (const point of trackPoints) {
      const delta = geoDeltaMeters(radarCenterPosition, { lat: point.lat, lon: point.lon });
      points.push(projectMetersToView(delta.eastMeters, delta.northMeters, currentRangeM));
    }
    return points;
  });

  const trackPolyline = $derived(projectedTrack.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" "));

  const anchorProjection = $derived.by<{
    x: number;
    y: number;
    displayDistanceM: number;
    offscreen: boolean;
  } | null>(() => {
    if (!radarCenterPosition || !effectiveAnchorPosition) {
      return null;
    }
    const delta = geoDeltaMeters(radarCenterPosition, effectiveAnchorPosition);
    const rawScale = VIEW_RADIUS / Math.max(1, currentRangeM);
    const rawX = delta.eastMeters * rawScale;
    const rawY = delta.northMeters * rawScale;
    const rawDistancePx = Math.sqrt(rawX * rawX + rawY * rawY);
    if (rawDistancePx <= VIEW_RADIUS) {
      return {
        x: VIEW_CENTER + rawX,
        y: VIEW_CENTER - rawY,
        displayDistanceM: delta.distanceM,
        offscreen: false,
      };
    }
    const factor = VIEW_RADIUS / Math.max(0.0001, rawDistancePx);
    return {
      x: VIEW_CENTER + (rawX * factor),
      y: VIEW_CENTER - (rawY * factor),
      displayDistanceM: delta.distanceM,
      offscreen: true,
    };
  });

  const ringAnnotations = $derived.by<Array<{ radiusPx: number; label: string }>>(() => {
    const out: Array<{ radiusPx: number; label: string }> = [];
    for (let i = 1; i <= 10; i += 1) {
      out.push({
        radiusPx: (i / 10) * VIEW_RADIUS,
        label: `${Math.round(i * ringDistanceM)} m`,
      });
    }
    return out;
  });

  const anchorDistanceText = $derived(anchorProjection ? `${anchorProjection.displayDistanceM.toFixed(1)} m` : "--");

  $effect(() => {
    if (!anchorPosition && !pendingAnchorPosition) {
      draggingAnchorPointerId = null;
      return;
    }
    if (anchorPosition && pendingAnchorPosition) {
      const same = Math.abs(anchorPosition.lat - pendingAnchorPosition.lat) < 0.0000001
        && Math.abs(anchorPosition.lon - pendingAnchorPosition.lon) < 0.0000001;
      if (same) {
        pendingAnchorPosition = null;
      }
    }
  });

  function projectMetersToView(eastMeters: number, northMeters: number, rangeM: number): { x: number; y: number } {
    const scale = VIEW_RADIUS / Math.max(1, rangeM);
    return {
      x: VIEW_CENTER + (eastMeters * scale),
      y: VIEW_CENTER - (northMeters * scale),
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
    if (draggingAnchorPointerId !== null || pointerPositions.size !== 2 || pinchStartDistance <= 0) {
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
    }
  }

  function onPointerMove(event: PointerEvent): void {
    if (!pointerPositions.has(event.pointerId)) {
      return;
    }
    pointerPositions.set(event.pointerId, { x: event.clientX, y: event.clientY });
    updatePinchZoom();
  }

  function onPointerUp(event: PointerEvent): void {
    pointerPositions.delete(event.pointerId);
    if (pointerPositions.size < 2) {
      pinchStartDistance = 0;
    }

    if (draggingAnchorPointerId !== event.pointerId) {
      return;
    }
    draggingAnchorPointerId = null;
    if (!pendingAnchorPosition) {
      return;
    }
    onMoveAnchor(pendingAnchorPosition.lat, pendingAnchorPosition.lon);
  }

  function mapClientPointToView(event: PointerEvent): { x: number; y: number } | null {
    if (!hostElement) {
      return null;
    }
    const rect = hostElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    const px = clampNumber(event.clientX - rect.left, 0, rect.width);
    const py = clampNumber(event.clientY - rect.top, 0, rect.height);
    const scaleX = VIEW_SIZE / rect.width;
    const scaleY = VIEW_SIZE / rect.height;
    return {
      x: px * scaleX,
      y: py * scaleY,
    };
  }

  function startAnchorDrag(event: PointerEvent): void {
    if (!radarCenterPosition || !effectiveAnchorPosition) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    draggingAnchorPointerId = event.pointerId;
    pendingAnchorPosition = effectiveAnchorPosition;
  }

  function tryStartAnchorDrag(event: PointerEvent): void {
    if (!anchorProjection) {
      return;
    }
    const mapped = mapClientPointToView(event);
    if (!mapped) {
      return;
    }
    const dx = mapped.x - anchorProjection.x;
    const dy = mapped.y - anchorProjection.y;
    if ((dx * dx) + (dy * dy) <= 120) {
      startAnchorDrag(event);
    }
  }

  function dragAnchor(event: PointerEvent): void {
    if (draggingAnchorPointerId !== event.pointerId || !radarCenterPosition) {
      return;
    }
    const mapped = mapClientPointToView(event);
    if (!mapped) {
      return;
    }

    const dx = mapped.x - VIEW_CENTER;
    const dy = VIEW_CENTER - mapped.y;
    const distancePx = Math.sqrt(dx * dx + dy * dy);
    const clampedDistancePx = Math.min(VIEW_RADIUS, distancePx);
    const factor = distancePx <= 0.0001 ? 0 : (clampedDistancePx / distancePx);
    const clampedDx = dx * factor;
    const clampedDy = dy * factor;

    const eastMeters = (clampedDx / VIEW_RADIUS) * currentRangeM;
    const northMeters = (clampedDy / VIEW_RADIUS) * currentRangeM;
    pendingAnchorPosition = offsetGeoPoint(radarCenterPosition, northMeters, eastMeters);
  }
</script>

<section
  class="viz-screen radar-screen"
  role="application"
  aria-label="Radar view"
  bind:this={hostElement}
  onwheel={onWheel}
  onpointerdown={(event) => {
    onPointerDown(event);
    tryStartAnchorDrag(event);
  }}
  onpointermove={(event) => {
    onPointerMove(event);
    dragAnchor(event);
  }}
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
      <circle cx={VIEW_CENTER} cy={VIEW_CENTER} r={ring.radiusPx} class={`radar-ring ${ring.radiusPx === VIEW_RADIUS ? "outer" : ""}`} />
      <text x={VIEW_CENTER + ring.radiusPx - 1} y={VIEW_CENTER - 3} class="radar-ring-label">{ring.label}</text>
    {/each}

    <line x1={VIEW_CENTER} y1={VIEW_CENTER - VIEW_RADIUS} x2={VIEW_CENTER} y2={VIEW_CENTER + VIEW_RADIUS} class="radar-axis" />
    <line x1={VIEW_CENTER - VIEW_RADIUS} y1={VIEW_CENTER} x2={VIEW_CENTER + VIEW_RADIUS} y2={VIEW_CENTER} class="radar-axis" />

    <g clip-path="url(#radarClip)">
      {#if projectedTrack.length >= 2}
        <polyline points={trackPolyline} class="radar-track-line" />
      {/if}
    </g>

    <circle cx={VIEW_CENTER} cy={VIEW_CENTER} r="4.2" class="radar-current" />

    {#if anchorProjection}
      <circle
        cx={anchorProjection.x}
        cy={anchorProjection.y}
        r="6.2"
        class={`radar-anchor ${anchorProjection.offscreen ? "offscreen" : ""}`}
      />
    {/if}
  </svg>

  <div class="radar-controls">
    <button type="button" class="radar-zoom-button" onclick={zoomIn} disabled={rangeIndex === 0} aria-label="Zoom in radar">+</button>
    <button type="button" class="radar-zoom-button" onclick={zoomOut} disabled={rangeIndex === RANGE_OPTIONS_M.length - 1} aria-label="Zoom out radar">-</button>
  </div>

  <div class="viz-overlay mono">
    Range {currentRangeM} m · Ring {ringDistanceM} m · Anchor {anchorDistanceText} · Heading {currentHeadingText}
  </div>
</section>
