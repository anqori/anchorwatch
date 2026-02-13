import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import { MAPTILER_DEFAULT_CENTER, MAPTILER_MAX_ZOOM, WEB_MERCATOR_EARTH_CIRCUMFERENCE_M, WEB_MERCATOR_TILE_SIZE } from "../core/constants";
import type { TrackPoint } from "../core/types";
import { clampNumber } from "./data-utils";

export function buildTrackGeoJson(points: TrackPoint[]): FeatureCollection<Geometry> {
  const coordinates: Position[] = points.map((point) => [point.lon, point.lat]);
  const features: Array<Feature<Geometry>> = [];

  if (coordinates.length >= 2) {
    features.push({
      type: "Feature",
      properties: { kind: "track" },
      geometry: {
        type: "LineString",
        coordinates,
      },
    });
  }

  if (coordinates.length >= 1) {
    features.push({
      type: "Feature",
      properties: { kind: "current" },
      geometry: {
        type: "Point",
        coordinates: coordinates[coordinates.length - 1],
      },
    });
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

export function maptilerIds(kind: "map" | "satellite"): { source: string; lineLayer: string; pointLayer: string } {
  const prefix = kind === "map" ? "aw-map" : "aw-satellite";
  return {
    source: `${prefix}-track-source`,
    lineLayer: `${prefix}-track-line`,
    pointLayer: `${prefix}-track-point`,
  };
}

export function resolveMapTilerStyleUrl(styleRef: string, apiKey: string): string {
  const trimmed = styleRef.trim();
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
    if (trimmed.includes("key=")) {
      return trimmed;
    }
    const joiner = trimmed.includes("?") ? "&" : "?";
    return `${trimmed}${joiner}key=${encodeURIComponent(apiKey)}`;
  }
  return `https://api.maptiler.com/maps/${encodeURIComponent(trimmed)}/style.json?key=${encodeURIComponent(apiKey)}`;
}

export function getMapTilerAnchorPoint(trackPoints: TrackPoint[]): [number, number] {
  const latestPoint = trackPoints[trackPoints.length - 1];
  if (latestPoint) {
    return [latestPoint.lon, latestPoint.lat];
  }
  return MAPTILER_DEFAULT_CENTER;
}

export function buildMapTilerPanBounds(anchorPoint: [number, number], radiusM: number): [[number, number], [number, number]] {
  const [anchorLon, anchorLat] = anchorPoint;
  const latDelta = radiusM / 111_320;
  const cosLat = Math.max(0.01, Math.cos((anchorLat * Math.PI) / 180));
  const lonDelta = radiusM / (111_320 * cosLat);
  return [
    [anchorLon - lonDelta, anchorLat - latDelta],
    [anchorLon + lonDelta, anchorLat + latDelta],
  ];
}

export function mapTilerMinZoomForArea(latitudeDeg: number, widthPx: number, heightPx: number, maxAreaM2: number): number {
  const safeWidth = Math.max(1, widthPx);
  const safeHeight = Math.max(1, heightPx);
  const safeLatFactor = Math.max(0.01, Math.abs(Math.cos((latitudeDeg * Math.PI) / 180)));
  const maxMetersPerPixel = Math.sqrt(maxAreaM2 / (safeWidth * safeHeight));
  const denominator = WEB_MERCATOR_TILE_SIZE * Math.max(0.01, maxMetersPerPixel);
  const zoom = Math.log2((WEB_MERCATOR_EARTH_CIRCUMFERENCE_M * safeLatFactor) / denominator);
  return clampNumber(zoom, 0, MAPTILER_MAX_ZOOM);
}
