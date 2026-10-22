// Spherical geometry, ported from PLUME backend/app/investigation/clustering.py.

export const EARTH_RADIUS_M = 6_371_008.8;

export interface LonLat {
  lon: number;
  lat: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

// Great-circle distance in metres.
export function haversineM(a: LonLat, b: LonLat): number {
  const p1 = rad(a.lat);
  const p2 = rad(b.lat);
  const dphi = p2 - p1;
  const dlmb = rad(b.lon - a.lon);
  const h = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dlmb / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Mean of unit vectors, so it is safe for small groups anywhere on the globe.
export function centroid(points: readonly LonLat[]): LonLat {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    const la = rad(p.lat);
    const lo = rad(p.lon);
    x += Math.cos(la) * Math.cos(lo);
    y += Math.cos(la) * Math.sin(lo);
    z += Math.sin(la);
  }
  const n = points.length;
  x /= n;
  y /= n;
  z /= n;
  return { lon: deg(Math.atan2(y, x)), lat: deg(Math.atan2(z, Math.hypot(x, y))) };
}

// Root-mean-square distance of members from the centroid, in metres.
export function spreadM(points: readonly LonLat[]): number {
  if (points.length < 2) return 0;
  const c = centroid(points);
  const sumSq = points.reduce((s, p) => s + haversineM(p, c) ** 2, 0);
  return Math.sqrt(sumSq / points.length);
}
