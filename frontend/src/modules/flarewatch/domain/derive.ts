// Sites and persistent flares, ported from flarewatch METHOD.md (sections 3 to 5),
// pipeline/common.mjs (cluster, dayStats) and pipeline/derive.mjs (buildSites).
// Each detection is [latitude, longitude, frp, bright_ti4, acq_time, satellite, confidence],
// with every value kept as the original CSV string.

export const LINK_KM = 1.0; // section 4: single-linkage distance
export const MIN_NIGHTS = 3; // section 5: persistent flare
export const SPAN_DAYS = 7;

const EARTH_RADIUS_KM = 6371;
const DAY_MS = 86_400_000;

export interface DayFile {
  day: string;
  method: string;
  box: { latMin: number; latMax: number; lonMin: number; lonMax: number };
  columns: string[];
  detections: string[][];
}

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Point extends LatLon {
  day: string;
  frp: number;
  time: string;
  sat: string;
}

export interface Night {
  day: string;
  detections: number;
  maxFrp: number;
  meanFrp: number;
}

export interface Site {
  id: string;
  lat: number;
  lon: number;
  flare: boolean;
  nightsActive: number;
  detections: number;
  meanFrp: number;
  maxFrp: number;
  nights: Night[];
}

const round = (x: number, n: number) => Math.round(x * 10 ** n) / 10 ** n;

export function parseDay(raw: string): DayFile {
  return JSON.parse(raw) as DayFile;
}

// Great-circle distance in kilometres.
export function haversineKm(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Single linkage: two points are in one group when a chain of points, each within LINK_KM of
// the next, joins them. Each group is one site.
export function cluster<T extends LatLon>(points: readonly T[]): T[][] {
  const parent = points.map((_, i) => i);
  const find = (i: number): number => {
    let x = i;
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (haversineKm(points[i], points[j]) <= LINK_KM) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, T[]>();
  points.forEach((p, i) => {
    const root = find(i);
    const list = groups.get(root);
    if (list) list.push(p);
    else groups.set(root, [p]);
  });
  return [...groups.values()];
}

export function toPoints(day: DayFile): Point[] {
  return day.detections.map((d) => ({
    day: day.day,
    lat: Number(d[0]),
    lon: Number(d[1]),
    frp: Number(d[2]),
    time: d[4],
    sat: d[5],
  }));
}

// True when the site was detected on at least MIN_NIGHTS distinct nights within SPAN_DAYS days.
export function persistent(nights: readonly string[]): boolean {
  const t = nights.map((d) => Date.parse(`${d}T00:00:00Z`) / DAY_MS).sort((a, b) => a - b);
  for (let i = 0; i + MIN_NIGHTS - 1 < t.length; i++) {
    if (t[i + MIN_NIGHTS - 1] - t[i] <= SPAN_DAYS - 1) return true;
  }
  return false;
}

// The three numbers anchored next to each night's digest (METHOD.md section 3).
export function dayStats(day: DayFile): { flareSites: number; detections: number; totalFrpKw: number } {
  const pts = toPoints(day);
  return {
    flareSites: cluster(pts).length,
    detections: pts.length,
    totalFrpKw: Math.round(pts.reduce((s, p) => s + p.frp, 0) * 1000),
  };
}

// All sites across the given nights, most persistent first, then by nights active and mean FRP.
export function buildSites(days: readonly DayFile[]): Site[] {
  const sites = cluster(days.flatMap(toPoints)).map((pts): Site => {
    const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
    const lon = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
    const byNight = new Map<string, { day: string; detections: number; maxFrp: number; sumFrp: number }>();
    for (const p of pts) {
      const n = byNight.get(p.day) ?? { day: p.day, detections: 0, maxFrp: 0, sumFrp: 0 };
      n.detections++;
      n.maxFrp = Math.max(n.maxFrp, p.frp);
      n.sumFrp += p.frp;
      byNight.set(p.day, n);
    }
    const nights = [...byNight.values()]
      .sort((a, b) => (a.day < b.day ? -1 : 1))
      .map((n) => ({
        day: n.day,
        detections: n.detections,
        maxFrp: round(n.maxFrp, 2),
        meanFrp: round(n.sumFrp / n.detections, 2),
      }));
    const frps = pts.map((p) => p.frp);
    return {
      id: `${lat.toFixed(2)}N ${lon.toFixed(2)}E`,
      lat: round(lat, 4),
      lon: round(lon, 4),
      flare: persistent(nights.map((n) => n.day)),
      nightsActive: nights.length,
      detections: pts.length,
      meanFrp: round(frps.reduce((a, b) => a + b, 0) / frps.length, 2),
      maxFrp: round(Math.max(...frps), 2),
      nights,
    };
  });
  return sites.sort(
    (a, b) => Number(b.flare) - Number(a.flare) || b.nightsActive - a.nightsActive || b.meanFrp - a.meanFrp,
  );
}
