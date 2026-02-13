import type { PillClass, TrackPoint } from "../core/types";

export interface FakeSummaryTick {
  gpsAgeS: number;
  dataAgeS: number;
  depthM: number;
  windKn: number;
  trackPoint: TrackPoint;
  stateText: string;
  stateClass: PillClass;
}

export function deriveFakeSummaryTick(nowMs: number, bootMs: number, nowTs = Date.now()): FakeSummaryTick {
  const ageMs = Math.floor(nowMs - bootMs);
  const depthM = 3.2 + Math.sin(ageMs / 9000) * 0.35;
  const windKn = 12.0 + Math.sin(ageMs / 5000) * 2.5;
  const ageS = Math.floor(ageMs / 1000);
  const t = ageMs / 1000;
  const lat = 54.3201 + Math.sin(t / 45) * 0.0007;
  const lon = 10.1402 + Math.cos(t / 60) * 0.0011;
  const sogKn = 0.4 + Math.abs(Math.sin(t / 10)) * 0.8;
  const cogDeg = (t * 16) % 360;
  const headingDeg = (cogDeg + Math.sin(t / 7) * 14 + 360) % 360;

  if (depthM < 2.0) {
    return {
      gpsAgeS: ageS,
      dataAgeS: ageS,
      depthM,
      windKn,
      trackPoint: {
        ts: nowTs,
        lat,
        lon,
        sogKn,
        cogDeg,
        headingDeg,
      },
      stateText: "FAKE: ALARM",
      stateClass: "alarm",
    };
  }

  if (windKn > 18.0) {
    return {
      gpsAgeS: ageS,
      dataAgeS: ageS,
      depthM,
      windKn,
      trackPoint: {
        ts: nowTs,
        lat,
        lon,
        sogKn,
        cogDeg,
        headingDeg,
      },
      stateText: "FAKE: WARNING",
      stateClass: "warn",
    };
  }

  return {
    gpsAgeS: ageS,
    dataAgeS: ageS,
    depthM,
    windKn,
    trackPoint: {
      ts: nowTs,
      lat,
      lon,
      sogKn,
      cogDeg,
      headingDeg,
    },
    stateText: "FAKE: MONITORING",
    stateClass: "ok",
  };
}
