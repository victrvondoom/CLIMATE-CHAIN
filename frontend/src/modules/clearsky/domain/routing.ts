// Port of backend/src/clearsky/domain/matching.py (route a field to a baler, respecting capacity) and
// backend/src/clearsky/domain/geo.py. Pure: no React, no DOM.
//
// A baler-day scores lower when it is nearer (w_dist per km), later (w_delay per day after the window
// opens) and when the baler already has a stop in the same village (w_cluster bonus). Among feasible
// baler-days, the lowest score wins; ties go to the lower baler id, then the earlier day.

import { addDays, daysBetween } from './risk';

export const SCORE_WEIGHTS = { dist: 1, delay: 2, cluster: 5 } as const;
export const SOWING_BUFFER_DAYS = 2;

const EARTH_RADIUS_KM = 6371.0088;

export interface Baler {
  readonly id: string;
  readonly lat: number;
  readonly lng: number;
  readonly acresPerDay: number;
  readonly radiusKm: number;
  readonly active: boolean;
}

export interface FieldSite {
  readonly acres: number;
  readonly lat: number;
  readonly lng: number;
  // ISO dates, YYYY-MM-DD.
  readonly harvestDate: string;
  readonly sowingDeadline: string;
}

// baler id -> day -> acres already booked that day.
export type Ledger = Readonly<Record<string, Readonly<Record<string, number>>>>;
// baler id -> days on which that baler already has a stop in the field's village.
export type ClusterDays = Readonly<Record<string, readonly string[]>>;

export interface Route {
  readonly balerId: string;
  readonly day: string;
  readonly score: number;
  readonly distKm: number;
  readonly cluster: boolean;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

// Flat-earth move, fine below ~50 km. Rounded to 6 decimals, as the source does.
export function offsetPoint(lat: number, lng: number, northKm: number, eastKm: number): [number, number] {
  const dlat = northKm / 110.574;
  const dlng = eastKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return [Math.round((lat + dlat) * 1e6) / 1e6, Math.round((lng + dlng) * 1e6) / 1e6];
}

// A field fits a day when the day has room for it. A field bigger than a whole day only fits an empty day.
export function fits(acres: number, capacity: number, booked: number): boolean {
  if (acres > capacity) return booked === 0;
  return capacity - booked >= acres;
}

export function balersInRange(field: FieldSite, balers: readonly Baler[]): [Baler, number][] {
  return balers.flatMap((baler) => {
    if (!baler.active) return [];
    const dist = haversineKm(field.lat, field.lng, baler.lat, baler.lng);
    return dist <= baler.radiusKm ? [[baler, dist] as [Baler, number]] : [];
  });
}

// Pickup can start the day after harvest (or tomorrow) and must end SOWING_BUFFER_DAYS before the sowing deadline.
export function bookingWindow(field: FieldSite, today: string): [string, string] {
  const afterHarvest = addDays(field.harvestDate, 1);
  const tomorrow = addDays(today, 1);
  const start = afterHarvest > tomorrow ? afterHarvest : tomorrow;
  const end = addDays(field.sowingDeadline, -SOWING_BUFFER_DAYS);
  return [start, end];
}

function compareRoutes(a: Route, b: Route): number {
  return a.score - b.score || (a.balerId < b.balerId ? -1 : a.balerId > b.balerId ? 1 : 0) || (a.day < b.day ? -1 : a.day > b.day ? 1 : 0);
}

// The best baler-day that has room for the field, or null when no baler can take it in the window.
export function routeToBaler(
  field: FieldSite,
  balers: readonly Baler[],
  ledger: Ledger,
  clusterDays: ClusterDays,
  today: string,
): Route | null {
  const [start, end] = bookingWindow(field, today);
  if (start > end) return null;
  let best: Route | null = null;
  for (const [baler, distKm] of balersInRange(field, balers)) {
    for (let day = start; day <= end; day = addDays(day, 1)) {
      const booked = ledger[baler.id]?.[day] ?? 0;
      if (!fits(field.acres, baler.acresPerDay, booked)) continue;
      const cluster = clusterDays[baler.id]?.includes(day) ?? false;
      const delay = daysBetween(start, day);
      const raw = SCORE_WEIGHTS.dist * distKm + SCORE_WEIGHTS.delay * delay - SCORE_WEIGHTS.cluster * (cluster ? 1 : 0);
      const candidate: Route = { balerId: baler.id, day, score: Math.round(raw * 1e4) / 1e4, distKm: Math.round(distKm * 100) / 100, cluster };
      if (best === null || compareRoutes(candidate, best) < 0) best = candidate;
    }
  }
  return best;
}
