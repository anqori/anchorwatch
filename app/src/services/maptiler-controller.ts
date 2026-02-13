import { Map as MapTilerMap, Marker as MapTilerMarker, config as maptilerConfig, type GeoJSONSource } from "@maptiler/sdk";
import type { TrackPoint } from "../core/types";
import { clampNumber } from "./data-utils";
import type { GeoPoint } from "./geo-nav";
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
  onMoveAnchor: (lat: number, lon: number) => void;
  maxPanDistanceM: number;
  maxVisibleAreaM2: number;
}

export interface EnsureMapTilerViewInput {
  kind: MapTilerKind;
  getTrackPoints: () => TrackPoint[];
  getAnchorPosition: () => GeoPoint | null;
  onMoveAnchor: (lat: number, lon: number) => void;
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
        "line-color": kind === "map" ? "#5ce1ff" : "#ffd166",
        "line-width": 3,
        "line-opacity": 0.92,
      },
    });
  }
  if (!map.getLayer(ids.pointLayer)) {
    map.addLayer({
      id: ids.pointLayer,
      source: ids.source,
      type: "circle",
      filter: ["==", ["get", "kind"], "current"],
      paint: {
        "circle-radius": 6,
        "circle-color": "#ffffff",
        "circle-stroke-color": kind === "map" ? "#5ce1ff" : "#ffd166",
        "circle-stroke-width": 2,
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

function createAnchorElement(kind: MapTilerKind): HTMLDivElement {
  const element = document.createElement("div");
  element.className = "aw-anchor-marker";
  element.style.width = "16px";
  element.style.height = "16px";
  element.style.borderRadius = "999px";
  element.style.border = "2px solid #fff";
  element.style.boxSizing = "border-box";
  element.style.boxShadow = "0 0 0 2px rgba(0,0,0,0.24)";
  element.style.background = kind === "map" ? "#2f9dff" : "#f3b73f";
  return element;
}

function ensureAnchorMarker(
  map: MapTilerMap,
  kind: MapTilerKind,
  anchorPosition: GeoPoint | null,
  onMoveAnchor: (lat: number, lon: number) => void,
): void {
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
      element: createAnchorElement(kind),
      draggable: true,
      pitchAlignment: "map",
      rotationAlignment: "map",
    })
      .setLngLat([anchorPosition.lon, anchorPosition.lat])
      .addTo(map);
    marker.on("dragend", () => {
      const lngLat = marker.getLngLat();
      onMoveAnchor(lngLat.lat, lngLat.lng);
    });
    anchorMarkers.set(map, marker);
    return;
  }

  const lngLat = existing.getLngLat();
  if (Math.abs(lngLat.lat - anchorPosition.lat) > 0.0000001 || Math.abs(lngLat.lng - anchorPosition.lon) > 0.0000001) {
    existing.setLngLat([anchorPosition.lon, anchorPosition.lat]);
  }
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
    const anchorPoint = getMapTilerAnchorPoint(trackPoints, anchorPosition);
    const panBounds = buildMapTilerPanBounds(anchorPoint, maxPanDistanceM);
    const [[minLon, minLat], [maxLon, maxLat]] = panBounds;

    map.setMaxBounds(panBounds);

    const center = map.getCenter();
    const clampedCenter: [number, number] = [
      clampNumber(center.lng, minLon, maxLon),
      clampNumber(center.lat, minLat, maxLat),
    ];
    if (Math.abs(clampedCenter[0] - center.lng) > 0.0000001 || Math.abs(clampedCenter[1] - center.lat) > 0.0000001) {
      map.setCenter(clampedCenter);
    }

    const canvas = map.getCanvas();
    const minZoom = mapTilerMinZoomForArea(clampedCenter[1], canvas.clientWidth, canvas.clientHeight, maxVisibleAreaM2);
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
  const anchorPosition = input.getAnchorPosition();
  updateTrackData(input.map, input.kind, trackPoints);
  ensureAnchorMarker(input.map, input.kind, anchorPosition, input.onMoveAnchor);
  enforceViewportLimits(input.map, trackPoints, anchorPosition, input.maxPanDistanceM, input.maxVisibleAreaM2);
}

export function ensureMapTilerView(input: EnsureMapTilerViewInput): MapTilerMap | null {
  if (!input.apiKey) {
    input.setStatusText("MapTiler token missing. Set VITE_MAPTILER_API_KEY in .env and redeploy.");
    return input.existingMap;
  }

  if (input.existingMap) {
    input.existingMap.resize();
    updateMapTrackAndViewport({
      map: input.existingMap,
      kind: input.kind,
      getTrackPoints: input.getTrackPoints,
      getAnchorPosition: input.getAnchorPosition,
      onMoveAnchor: input.onMoveAnchor,
      maxPanDistanceM: input.maxPanDistanceM,
      maxVisibleAreaM2: input.maxVisibleAreaM2,
    });
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
    updateMapTrackAndViewport({
      map,
      kind: input.kind,
      getTrackPoints: input.getTrackPoints,
      getAnchorPosition: input.getAnchorPosition,
      onMoveAnchor: input.onMoveAnchor,
      maxPanDistanceM: input.maxPanDistanceM,
      maxVisibleAreaM2: input.maxVisibleAreaM2,
    });
    map.resize();
  });
  map.on("moveend", () => {
    updateMapTrackAndViewport({
      map,
      kind: input.kind,
      getTrackPoints: input.getTrackPoints,
      getAnchorPosition: input.getAnchorPosition,
      onMoveAnchor: input.onMoveAnchor,
      maxPanDistanceM: input.maxPanDistanceM,
      maxVisibleAreaM2: input.maxVisibleAreaM2,
    });
  });
  map.on("resize", () => {
    updateMapTrackAndViewport({
      map,
      kind: input.kind,
      getTrackPoints: input.getTrackPoints,
      getAnchorPosition: input.getAnchorPosition,
      onMoveAnchor: input.onMoveAnchor,
      maxPanDistanceM: input.maxPanDistanceM,
      maxVisibleAreaM2: input.maxVisibleAreaM2,
    });
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
  map.remove();
  applyingViewportLimits.delete(map);
  return null;
}
