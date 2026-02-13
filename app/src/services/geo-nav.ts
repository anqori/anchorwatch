export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface GeoDeltaMeters {
  northMeters: number;
  eastMeters: number;
  distanceM: number;
  bearingDeg: number;
}

const METERS_PER_LAT = 111_320;

export function geoDeltaMeters(from: GeoPoint, to: GeoPoint): GeoDeltaMeters {
  const meanLatRad = ((from.lat + to.lat) / 2) * Math.PI / 180;
  const metersPerLon = Math.max(1, METERS_PER_LAT * Math.cos(meanLatRad));
  const northMeters = (to.lat - from.lat) * METERS_PER_LAT;
  const eastMeters = (to.lon - from.lon) * metersPerLon;
  const distanceM = Math.sqrt(northMeters * northMeters + eastMeters * eastMeters);
  const bearingDeg = (Math.atan2(eastMeters, northMeters) * 180 / Math.PI + 360) % 360;
  return {
    northMeters,
    eastMeters,
    distanceM,
    bearingDeg,
  };
}

export function offsetGeoPoint(base: GeoPoint, northMeters: number, eastMeters: number): GeoPoint {
  const lat = base.lat + (northMeters / METERS_PER_LAT);
  const metersPerLon = Math.max(1, METERS_PER_LAT * Math.cos((base.lat * Math.PI) / 180));
  const lon = base.lon + (eastMeters / metersPerLon);
  return { lat, lon };
}
