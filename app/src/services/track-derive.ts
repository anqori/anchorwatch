import type { TrackPoint } from "../core/types";
import { clampNumber } from "./data-utils";
import { geoDeltaMeters } from "./geo-nav";

export interface RadarProjection {
  targetX: number;
  targetY: number;
  distanceText: string;
  bearingText: string;
}

export interface TrackSummary {
  currentLatText: string;
  currentLonText: string;
  currentSogText: string;
  currentCogText: string;
  currentHeadingText: string;
  statusText: string;
}

export function deriveRadarProjection(points: TrackPoint[]): RadarProjection {
  if (points.length < 2) {
    return {
      targetX: 110,
      targetY: 110,
      distanceText: "--",
      bearingText: "--",
    };
  }

  const anchor = points[0];
  const current = points[points.length - 1];
  const { distanceM, bearingDeg } = geoDeltaMeters(
    { lat: anchor.lat, lon: anchor.lon },
    { lat: current.lat, lon: current.lon },
  );
  const displayRadius = 92;
  const scale = clampNumber(distanceM / 80, 0, 1);
  const radius = scale * displayRadius;
  const radians = bearingDeg * Math.PI / 180;

  return {
    targetX: 110 + Math.sin(radians) * radius,
    targetY: 110 - Math.cos(radians) * radius,
    distanceText: `${distanceM.toFixed(1)} m`,
    bearingText: `${bearingDeg.toFixed(0)} deg`,
  };
}

export function deriveTrackSummary(points: TrackPoint[]): TrackSummary {
  const current = points.length > 0 ? points[points.length - 1] : null;
  if (!current) {
    return {
      currentLatText: "--",
      currentLonText: "--",
      currentSogText: "--",
      currentCogText: "--",
      currentHeadingText: "--",
      statusText: "No track yet",
    };
  }

  return {
    currentLatText: current.lat.toFixed(5),
    currentLonText: current.lon.toFixed(5),
    currentSogText: `${current.sogKn.toFixed(2)} kn`,
    currentCogText: `${current.cogDeg.toFixed(0)} deg`,
    currentHeadingText: `${current.headingDeg.toFixed(0)} deg`,
    statusText: `${points.length} points loaded`,
  };
}
