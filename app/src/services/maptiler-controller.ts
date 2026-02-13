import { Map as MapTilerMap, Marker as MapTilerMarker, config as maptilerConfig, type GeoJSONSource } from "@maptiler/sdk";
import type { TrackPoint } from "../core/types";
import { clampNumber } from "./data-utils";
import { offsetGeoPoint, type GeoPoint } from "./geo-nav";
import {
  buildMapTilerPanBounds,
  buildTrackGeoJson,
  getMapTilerAnchorPoint,
  mapTilerMinZoomForArea,
  maptilerIds,
  resolveMapTilerStyleUrl,
} from "./maptiler-helpers";

export type MapTilerKind = "map" | "satellite";

export interface MapTilerTrackViewportInput {
  map: MapTilerMap;
  kind: MapTilerKind;
  getTrackPoints: () => TrackPoint[];
  getAnchorPosition: () => GeoPoint | null;
  getBoatPosition: () => GeoPoint | null;
  showAnchorHelperCircle: boolean;
  anchorHelperRadiusM: number;
  moveMode: boolean;
  onPreviewAnchorMove: (lat: number, lon: number) => void;
  maxPanDistanceM: number;
  maxVisibleAreaM2: number;
}

export interface EnsureMapTilerViewInput {
  kind: MapTilerKind;
  getTrackPoints: () => TrackPoint[];
  getAnchorPosition: () => GeoPoint | null;
  getBoatPosition: () => GeoPoint | null;
  getShowAnchorHelperCircle: () => boolean;
  getAnchorHelperRadiusM: () => number;
  getMoveMode: () => boolean;
  onPreviewAnchorMove: (lat: number, lon: number) => void;
  existingMap: MapTilerMap | null;
  container: HTMLDivElement | null;
  apiKey: string;
  defaultCenter: [number, number];
  defaultZoom: number;
  styleMapRef: string;
  styleSatelliteRef: string;
  maxPanDistanceM: number;
  maxVisibleAreaM2: number;
  setStatusText: (text: string) => void;
}

const applyingViewportLimits = new WeakSet<MapTilerMap>();
const anchorMarkers = new WeakMap<MapTilerMap, MapTilerMarker>();
const boatMarkers = new WeakMap<MapTilerMap, MapTilerMarker>();
const anchorMoveStates = new WeakMap<MapTilerMap, { active: boolean; fixedPoint: { x: number; y: number } | null }>();
const lastViewportEnforcement = new WeakMap<MapTilerMap, {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  minZoom: number;
}>();

function hasMeaningfulBoundsChange(
  previous: { minLon: number; minLat: number; maxLon: number; maxLat: number; minZoom: number } | undefined,
  next: { minLon: number; minLat: number; maxLon: number; maxLat: number; minZoom: number },
): boolean {
  if (!previous) {
    return true;
  }
  return Math.abs(previous.minLon - next.minLon) > 0.0000001
    || Math.abs(previous.minLat - next.minLat) > 0.0000001
    || Math.abs(previous.maxLon - next.maxLon) > 0.0000001
    || Math.abs(previous.maxLat - next.maxLat) > 0.0000001
    || Math.abs(previous.minZoom - next.minZoom) > 0.001;
}

function runtimeViewportInput(map: MapTilerMap, input: EnsureMapTilerViewInput): MapTilerTrackViewportInput {
  return {
    map,
    kind: input.kind,
    getTrackPoints: input.getTrackPoints,
    getAnchorPosition: input.getAnchorPosition,
    getBoatPosition: input.getBoatPosition,
    showAnchorHelperCircle: input.getShowAnchorHelperCircle(),
    anchorHelperRadiusM: input.getAnchorHelperRadiusM(),
    moveMode: input.getMoveMode(),
    onPreviewAnchorMove: input.onPreviewAnchorMove,
    maxPanDistanceM: input.maxPanDistanceM,
    maxVisibleAreaM2: input.maxVisibleAreaM2,
  };
}

function getAnchorMoveState(map: MapTilerMap): { active: boolean; fixedPoint: { x: number; y: number } | null } {
  const existing = anchorMoveStates.get(map);
  if (existing) {
    return existing;
  }
  const nextState = { active: false, fixedPoint: null };
  anchorMoveStates.set(map, nextState);
  return nextState;
}

function resolveRenderAnchorPosition(input: MapTilerTrackViewportInput, anchorPosition: GeoPoint | null): GeoPoint | null {
  const moveState = getAnchorMoveState(input.map);
  if (!input.moveMode || !anchorPosition) {
    moveState.active = false;
    moveState.fixedPoint = null;
    return anchorPosition;
  }

  if (!moveState.active || !moveState.fixedPoint) {
    const projected = input.map.project([anchorPosition.lon, anchorPosition.lat]);
    moveState.active = true;
    moveState.fixedPoint = {
      x: projected.x,
      y: projected.y,
    };
    return anchorPosition;
  }

  const anchorLngLat = input.map.unproject([moveState.fixedPoint.x, moveState.fixedPoint.y]);
  if (!Number.isFinite(anchorLngLat.lat) || !Number.isFinite(anchorLngLat.lng)) {
    return anchorPosition;
  }

  const previewAnchor: GeoPoint = {
    lat: anchorLngLat.lat,
    lon: anchorLngLat.lng,
  };
  if (
    Math.abs(previewAnchor.lat - anchorPosition.lat) > 0.0000002
    || Math.abs(previewAnchor.lon - anchorPosition.lon) > 0.0000002
  ) {
    input.onPreviewAnchorMove(previewAnchor.lat, previewAnchor.lon);
  }
  return previewAnchor;
}

function helperIds(kind: MapTilerKind): { source: string; layer: string } {
  const prefix = kind === "map" ? "aw-map" : "aw-satellite";
  return {
    source: `${prefix}-anchor-helper-source`,
    layer: `${prefix}-anchor-helper-layer`,
  };
}

function ensureTrackLayers(map: MapTilerMap, kind: MapTilerKind, trackPoints: TrackPoint[]): void {
  const ids = maptilerIds(kind);
  if (!map.getSource(ids.source)) {
    map.addSource(ids.source, {
      type: "geojson",
      data: buildTrackGeoJson(trackPoints),
    });
  }
  if (!map.getLayer(ids.lineLayer)) {
    map.addLayer({
      id: ids.lineLayer,
      source: ids.source,
      type: "line",
      filter: ["==", ["get", "kind"], "track"],
      paint: {
        "line-color": "#16bf73",
        "line-width": 3,
        "line-opacity": 0.92,
      },
    });
  }
}

function updateTrackData(map: MapTilerMap, kind: MapTilerKind, trackPoints: TrackPoint[]): void {
  if (!map.isStyleLoaded()) {
    return;
  }
  ensureTrackLayers(map, kind, trackPoints);
  const source = map.getSource(maptilerIds(kind).source) as GeoJSONSource | undefined;
  if (source) {
    source.setData(buildTrackGeoJson(trackPoints));
  }
}

function createPinElement(kind: MapTilerKind, type: "anchor" | "boat"): HTMLDivElement {
  const element = document.createElement("div");
  element.className = `aw-map-pin ${type} ${kind === "map" ? "map" : "satellite"}`;
  const icon = document.createElement("span");
  icon.className = "material-symbols-rounded aw-map-pin-icon";
  icon.textContent = type === "anchor" ? "anchor" : "directions_boat";
  element.append(icon);
  return element;
}

function ensureAnchorMarker(map: MapTilerMap, kind: MapTilerKind, anchorPosition: GeoPoint | null): void {
  const existing = anchorMarkers.get(map);
  if (!anchorPosition) {
    if (existing) {
      existing.remove();
      anchorMarkers.delete(map);
    }
    return;
  }

  if (!existing) {
    const marker = new MapTilerMarker({
      element: createPinElement(kind, "anchor"),
      draggable: false,
      pitchAlignment: "map",
      rotationAlignment: "map",
    })
      .setLngLat([anchorPosition.lon, anchorPosition.lat])
      .addTo(map);
    anchorMarkers.set(map, marker);
    return;
  }

  const lngLat = existing.getLngLat();
  if (Math.abs(lngLat.lat - anchorPosition.lat) > 0.0000001 || Math.abs(lngLat.lng - anchorPosition.lon) > 0.0000001) {
    existing.setLngLat([anchorPosition.lon, anchorPosition.lat]);
  }
}

function ensureBoatMarker(map: MapTilerMap, kind: MapTilerKind, boatPosition: GeoPoint | null): void {
  const existing = boatMarkers.get(map);

  if (!boatPosition) {
    if (existing) {
      existing.remove();
      boatMarkers.delete(map);
    }
    return;
  }

  if (!existing) {
    const marker = new MapTilerMarker({
      element: createPinElement(kind, "boat"),
      draggable: false,
      pitchAlignment: "map",
      rotationAlignment: "map",
    })
      .setLngLat([boatPosition.lon, boatPosition.lat])
      .addTo(map);
    boatMarkers.set(map, marker);
    return;
  }

  const lngLat = existing.getLngLat();
  if (Math.abs(lngLat.lat - boatPosition.lat) > 0.0000001 || Math.abs(lngLat.lng - boatPosition.lon) > 0.0000001) {
    existing.setLngLat([boatPosition.lon, boatPosition.lat]);
  }
}

function buildAnchorHelperGeoJson(anchorPosition: GeoPoint, radiusM: number): GeoJSON.FeatureCollection<GeoJSON.Geometry> {
  const points: Array<[number, number]> = [];
  const segments = 64;
  for (let index = 0; index <= segments; index += 1) {
    const angleRad = (index / segments) * Math.PI * 2;
    const east = Math.sin(angleRad) * radiusM;
    const north = Math.cos(angleRad) * radiusM;
    const point = offsetGeoPoint(anchorPosition, north, east);
    points.push([point.lon, point.lat]);
  }
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: points,
        },
        properties: {},
      },
    ],
  };
}

function ensureAnchorHelperLayer(
  map: MapTilerMap,
  kind: MapTilerKind,
  anchorPosition: GeoPoint | null,
  visible: boolean,
  radiusM: number,
): void {
  if (!map.isStyleLoaded()) {
    return;
  }
  const ids = helperIds(kind);
  if (!map.getSource(ids.source)) {
    map.addSource(ids.source, {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [],
      },
    });
  }
  if (!map.getLayer(ids.layer)) {
    map.addLayer({
      id: ids.layer,
      source: ids.source,
      type: "line",
      paint: {
        "line-color": "#f6d255",
        "line-width": 2,
        "line-opacity": 0.92,
      },
    });
  }

  const source = map.getSource(ids.source) as GeoJSONSource | undefined;
  if (!source) {
    return;
  }

  if (visible && anchorPosition && radiusM > 0.1) {
    source.setData(buildAnchorHelperGeoJson(anchorPosition, radiusM));
    return;
  }
  source.setData({
    type: "FeatureCollection",
    features: [],
  });
}

function enforceViewportLimits(
  map: MapTilerMap,
  trackPoints: TrackPoint[],
  anchorPosition: GeoPoint | null,
  maxPanDistanceM: number,
  maxVisibleAreaM2: number,
): void {
  if (applyingViewportLimits.has(map)) {
    return;
  }

  applyingViewportLimits.add(map);
  try {
    if (map.isMoving() || map.isZooming()) {
      return;
    }

    const anchorPoint = getMapTilerAnchorPoint(trackPoints, anchorPosition);
    const panBounds = buildMapTilerPanBounds(anchorPoint, maxPanDistanceM);
    const [[minLon, minLat], [maxLon, maxLat]] = panBounds;
    const center = map.getCenter();
    const clampedCenter: [number, number] = [
      clampNumber(center.lng, minLon, maxLon),
      clampNumber(center.lat, minLat, maxLat),
    ];

    const canvas = map.getCanvas();
    const minZoom = mapTilerMinZoomForArea(clampedCenter[1], canvas.clientWidth, canvas.clientHeight, maxVisibleAreaM2);

    const previous = lastViewportEnforcement.get(map);
    const next = { minLon, minLat, maxLon, maxLat, minZoom };
    if (hasMeaningfulBoundsChange(previous, next)) {
      map.setMaxBounds(panBounds);
      lastViewportEnforcement.set(map, next);
    }

    if (Math.abs(clampedCenter[0] - center.lng) > 0.0000001 || Math.abs(clampedCenter[1] - center.lat) > 0.0000001) {
      map.setCenter(clampedCenter);
    }

    if (Math.abs(map.getMinZoom() - minZoom) > 0.001) {
      map.setMinZoom(minZoom);
    }
    if (map.getZoom() < minZoom) {
      map.setZoom(minZoom);
    }
  } finally {
    applyingViewportLimits.delete(map);
  }
}

export function updateMapTrackAndViewport(input: MapTilerTrackViewportInput): void {
  const trackPoints = input.getTrackPoints();
  const liveAnchorPosition = input.getAnchorPosition();
  const boatPosition = input.getBoatPosition();
  const anchorPosition = resolveRenderAnchorPosition(input, liveAnchorPosition);
  updateTrackData(input.map, input.kind, trackPoints);
  ensureAnchorMarker(input.map, input.kind, anchorPosition);
  ensureBoatMarker(input.map, input.kind, boatPosition);
  ensureAnchorHelperLayer(
    input.map,
    input.kind,
    anchorPosition,
    input.showAnchorHelperCircle,
    input.anchorHelperRadiusM,
  );
  enforceViewportLimits(input.map, trackPoints, anchorPosition, input.maxPanDistanceM, input.maxVisibleAreaM2);
}

export function ensureMapTilerView(input: EnsureMapTilerViewInput): MapTilerMap | null {
  if (!input.apiKey) {
    input.setStatusText("MapTiler token missing. Set VITE_MAPTILER_API_KEY in .env and redeploy.");
    return input.existingMap;
  }

  if (input.existingMap) {
    input.existingMap.resize();
    updateMapTrackAndViewport(runtimeViewportInput(input.existingMap, input));
    return input.existingMap;
  }

  if (!input.container) {
    return null;
  }

  const latestPoint = input.getTrackPoints()[input.getTrackPoints().length - 1];
  const center: [number, number] = latestPoint
    ? [latestPoint.lon, latestPoint.lat]
    : input.defaultCenter;

  maptilerConfig.apiKey = input.apiKey;
  const styleRef = input.kind === "map" ? input.styleMapRef : input.styleSatelliteRef;
  const style = resolveMapTilerStyleUrl(styleRef, input.apiKey);
  const map = new MapTilerMap({
    container: input.container,
    style,
    center,
    zoom: input.defaultZoom,
  });

  input.setStatusText("Loading map tiles...");
  map.on("load", () => {
    input.setStatusText("Map loaded.");
    updateMapTrackAndViewport(runtimeViewportInput(map, input));
    map.resize();
  });
  map.on("move", () => {
    updateMapTrackAndViewport(runtimeViewportInput(map, input));
  });
  map.on("moveend", () => {
    updateMapTrackAndViewport(runtimeViewportInput(map, input));
  });
  map.on("resize", () => {
    updateMapTrackAndViewport(runtimeViewportInput(map, input));
  });
  map.on("error", (event) => {
    const errorText = event.error instanceof Error ? event.error.message : "unknown map error";
    input.setStatusText(`Map error: ${errorText}`);
  });

  return map;
}

export function destroyMapTilerView(map: MapTilerMap | null): null {
  if (!map) {
    return null;
  }
  const marker = anchorMarkers.get(map);
  if (marker) {
    marker.remove();
    anchorMarkers.delete(map);
  }
  const boatMarker = boatMarkers.get(map);
  if (boatMarker) {
    boatMarker.remove();
    boatMarkers.delete(map);
  }
  map.remove();
  applyingViewportLimits.delete(map);
  anchorMoveStates.delete(map);
  lastViewportEnforcement.delete(map);
  return null;
}
