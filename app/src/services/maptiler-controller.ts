import { Map as MapTilerMap, config as maptilerConfig, type GeoJSONSource } from "@maptiler/sdk";
import type { TrackPoint } from "../core/types";
import { clampNumber } from "./data-utils";
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
  maxPanDistanceM: number;
  maxVisibleAreaM2: number;
}

export interface EnsureMapTilerViewInput {
  kind: MapTilerKind;
  getTrackPoints: () => TrackPoint[];
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

function enforceViewportLimits(
  map: MapTilerMap,
  trackPoints: TrackPoint[],
  maxPanDistanceM: number,
  maxVisibleAreaM2: number,
): void {
  if (applyingViewportLimits.has(map)) {
    return;
  }

  applyingViewportLimits.add(map);
  try {
    const anchorPoint = getMapTilerAnchorPoint(trackPoints);
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
  updateTrackData(input.map, input.kind, trackPoints);
  enforceViewportLimits(input.map, trackPoints, input.maxPanDistanceM, input.maxVisibleAreaM2);
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
      maxPanDistanceM: input.maxPanDistanceM,
      maxVisibleAreaM2: input.maxVisibleAreaM2,
    });
  });
  map.on("resize", () => {
    updateMapTrackAndViewport({
      map,
      kind: input.kind,
      getTrackPoints: input.getTrackPoints,
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
  map.remove();
  applyingViewportLimits.delete(map);
  return null;
}
