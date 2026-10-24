// Ports of packages/core/src/provenance.ts (ageMinutes), packages/core/src/timeline.ts (unusableMin),
// packages/data/src/station.ts (haversineKm, nearest), packages/data/src/freshStation.ts (newest hour,
// nearest fresh station) and apps/api/src/stationsRoute.ts (six-hour drop). Pure TypeScript.

export interface Point {
  readonly lat: number;
  readonly lng: number;
}

export interface MonitorHour {
  /** Start of the hour, ISO 8601 UTC. The hour ends one hour later. */
  readonly hourStart: string;
  readonly pm25: number | null;
  readonly pm10: number | null;
}

export interface Monitor extends Point {
  readonly id: string;
  readonly name: string;
  readonly hours: readonly MonitorHour[];
}

export const HOUR_MS = 3_600_000;

/** A monitor reading older than six hours, or from the future, is dropped (safety rule I3). */
export const MONITOR_MAX_AGE_MINUTES = 6 * 60;

/** Advice is never given from a reading older than three hours (trust.json unusableMin, timeline I3). */
export const ADVICE_MAX_AGE_MINUTES = 180;

export type ReadingState = 'current' | 'old_no_advice' | 'dropped';

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance between two points, in kilometres. */
export function haversineKm(a: Point, b: Point): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Whole minutes from the observation to the moment asked about. Never negative. */
export function ageMinutes(observedAt: string, asOf: string): number {
  return Math.max(0, Math.round((Date.parse(asOf) - Date.parse(observedAt)) / 60_000));
}

/**
 * How a reading of this age may be used. `diffMinutes` is the unrounded age, so a reading
 * from the future (negative) is dropped rather than shown as fresh.
 */
export function readingState(diffMinutes: number): ReadingState {
  if (!Number.isFinite(diffMinutes) || diffMinutes < 0 || diffMinutes > MONITOR_MAX_AGE_MINUTES) {
    return 'dropped';
  }
  return diffMinutes > ADVICE_MAX_AGE_MINUTES ? 'old_no_advice' : 'current';
}

export interface FreshMonitor {
  readonly monitor: Monitor;
  readonly distanceKm: number;
  /** The end of the newest hour that carries a PM2.5 value. */
  readonly observedAt: string;
  readonly ageMinutes: number;
  readonly state: ReadingState;
}

const hourEndMs = (hour: MonitorHour): number => Date.parse(hour.hourStart) + HOUR_MS;

/** Only hours that had ended by asOf count (rule I1: no look-ahead). */
function endedHours(hours: readonly MonitorHour[], asMs: number): MonitorHour[] {
  return hours.filter((hour) => hourEndMs(hour) <= asMs);
}

export interface NewestReading {
  /** The end of the newest hour that carries a PM2.5 value and had ended by asOf. */
  readonly observedAt: string;
  readonly ageMinutes: number;
  readonly state: ReadingState;
}

/**
 * The newest PM2.5 reading one monitor has at asOf, and how usable it is. A dropped reading is
 * still returned, so the page can say why. `undefined` when the monitor has no PM2.5 value yet.
 */
export function newestReading(monitor: Monitor, asOf: string): NewestReading | undefined {
  const asMs = Date.parse(asOf);
  const newest = endedHours(monitor.hours, asMs)
    .filter((hour) => hour.pm25 !== null && Number.isFinite(hour.pm25))
    .reduce<number | undefined>(
      (latest, hour) => (latest === undefined || hourEndMs(hour) > latest ? hourEndMs(hour) : latest),
      undefined,
    );
  if (newest === undefined) return undefined;
  const diff = (asMs - newest) / 60_000;
  return {
    observedAt: new Date(newest).toISOString(),
    ageMinutes: Math.max(0, Math.round(diff)),
    state: readingState(diff),
  };
}

/**
 * The nearest monitor whose newest PM2.5 hour is not dropped. Monitors are tried nearest first.
 * A monitor with no PM2.5 is never chosen, and with none fresh the answer is `undefined`, so the
 * caller says there is no recent monitor rather than showing a stale one as current.
 */
export function nearestFreshMonitor(
  point: Point,
  monitors: readonly Monitor[],
  asOf: string,
): FreshMonitor | undefined {
  const ranked = monitors
    .map((monitor) => ({ monitor, distanceKm: haversineKm(point, monitor) }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
  for (const candidate of ranked) {
    const reading = newestReading(candidate.monitor, asOf);
    if (reading === undefined || reading.state === 'dropped') continue;
    return { monitor: candidate.monitor, distanceKm: candidate.distanceKm, ...reading };
  }
  return undefined;
}

/**
 * The hourly values that ended in the last 24 hours, in time order. Hours that ended before that
 * are left out, so an old reading cannot fill a gap in today's window.
 */
export function window24h(
  hours: readonly MonitorHour[],
  asOf: string,
): { pm25: (number | null)[]; pm10: (number | null)[] } {
  const asMs = Date.parse(asOf);
  const inWindow = endedHours(hours, asMs)
    .filter((hour) => hourEndMs(hour) > asMs - 24 * HOUR_MS)
    .sort((a, b) => Date.parse(a.hourStart) - Date.parse(b.hourStart));
  return {
    pm25: inWindow.map((hour) => hour.pm25),
    pm10: inWindow.map((hour) => hour.pm10),
  };
}
