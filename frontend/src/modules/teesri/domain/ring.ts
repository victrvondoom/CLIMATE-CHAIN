// Port of the tripwire ring rule in src/teesri/tripwire.py, with the haversine from src/teesri/geo.py and
// the dirty-water test from src/teesri/extract.py (is_dirty). Pure: no React, no DOM.
//
// Fire when at least 3 different homes report dirty water within 72 h, and every pair of them is within
// 250 m. If they are all within 30 m of each other (one building, one tank) there is no area alarm: those
// homes get tank advice. A dirty report within 250 m of an open incident's centre joins that incident.

export const MIN_HOMES = 3;
export const RING_M = 250;
export const WINDOW_H = 72;
export const BUILDING_M = 30;

const EARTH_RADIUS_M = 6_371_000;
const M_PER_DEG = (EARTH_RADIUS_M * Math.PI) / 180;
const DIRTY_COLOURS: ReadonlySet<string> = new Set(['yellow', 'brown', 'black']);

export interface WaterFields {
  readonly colour: string | null;
  readonly smell: boolean | null;
  readonly illness: readonly string[];
}

export interface Report {
  readonly id: string;
  readonly homeId: string;
  readonly lat: number;
  readonly lon: number;
  // ISO timestamp.
  readonly ts: string;
  readonly fields: WaterFields;
  readonly incidentId: string | null;
}

export interface Incident {
  readonly id: string;
  readonly lat: number;
  readonly lon: number;
  readonly status: 'OPEN' | 'CLOSED_AT_TAP';
}

export type Decision = 'already' | 'clean' | 'join' | 'none' | 'tank' | 'incident';

export interface Stats {
  readonly lat: number;
  readonly lon: number;
  readonly homes: number;
  readonly spreadM: number;
  readonly spanH: number;
}

export interface Verdict {
  readonly decision: Decision;
  readonly members: readonly Report[];
  readonly stats: Stats | null;
  readonly incidentId: string | null;
}

// Python's round(): a tie goes to the even integer.
function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

export function isDirty(fields: WaterFields): boolean {
  return (fields.colour !== null && DIRTY_COLOURS.has(fields.colour)) || fields.smell === true || fields.illness.length > 0;
}

// Great-circle distance in metres.
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

// A point north and east of a base point, in metres (the source's test helper uses the same flat scale).
export function offsetPoint(baseLat: number, baseLon: number, northM: number, eastM: number): [number, number] {
  const lat = baseLat + northM / M_PER_DEG;
  const lon = baseLon + eastM / (M_PER_DEG * Math.cos((baseLat * Math.PI) / 180));
  return [lat, lon];
}

export function addHours(ts: string, hours: number): string {
  return new Date(Date.parse(ts) + hours * 3_600_000).toISOString();
}

function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  return haversineM(a.lat, a.lon, b.lat, b.lon);
}

// The trigger, plus each other home's latest report within 250 m of it. Then homes are dropped until every
// pair is within 250 m. The drop order: the home in the most too-far pairs, then the one farthest from the trigger.
export function findCluster(trigger: Report, others: readonly Report[]): Report[] {
  const latest = new Map<string, Report>();
  for (const report of others) {
    if (report.homeId === trigger.homeId || distanceM(report, trigger) > RING_M) continue;
    const kept = latest.get(report.homeId);
    if (kept === undefined || Date.parse(report.ts) > Date.parse(kept.ts)) latest.set(report.homeId, report);
  }
  const byHome = [...latest.values()].sort((a, b) => (a.homeId < b.homeId ? -1 : a.homeId > b.homeId ? 1 : 0));
  let members: Report[] = [trigger, ...byHome];
  for (;;) {
    let worst: { report: Report; far: number; dist: number } | null = null;
    for (const report of members.slice(1)) {
      const far = members.filter((other) => distanceM(report, other) > RING_M).length;
      const dist = distanceM(report, trigger);
      if (worst === null || far > worst.far || (far === worst.far && dist > worst.dist)) {
        worst = { report, far, dist };
      }
    }
    if (worst === null || worst.far === 0) return members;
    const drop = worst.report;
    members = members.filter((member) => member !== drop);
  }
}

export function stats(members: readonly Report[]): Stats {
  const times = members.map((report) => Date.parse(report.ts));
  let spread = 0;
  for (const a of members) {
    for (const b of members) {
      spread = Math.max(spread, distanceM(a, b));
    }
  }
  const spanH = (Math.max(...times) - Math.min(...times)) / 3_600_000;
  return {
    lat: members.reduce((sum, report) => sum + report.lat, 0) / members.length,
    lon: members.reduce((sum, report) => sum + report.lon, 0) / members.length,
    homes: members.length,
    spreadM: roundHalfEven(spread),
    spanH: roundHalfEven(spanH * 10) / 10,
  };
}

// The tripwire decision for one new report, given the reports around it and the open incidents.
export function decide(trigger: Report, reports: readonly Report[], incidents: readonly Incident[] = []): Verdict {
  const none = { members: [] as Report[], stats: null };
  if (trigger.incidentId !== null) return { decision: 'already', ...none, incidentId: trigger.incidentId };
  if (!isDirty(trigger.fields)) return { decision: 'clean', ...none, incidentId: null };

  const near = incidents.filter((incident) => incident.status !== 'CLOSED_AT_TAP' && distanceM(incident, trigger) <= RING_M);
  if (near.length > 0) {
    const nearest = near.reduce((a, b) => (distanceM(a, trigger) <= distanceM(b, trigger) ? a : b));
    return { decision: 'join', ...none, incidentId: nearest.id };
  }

  const now = Date.parse(trigger.ts);
  const since = now - WINDOW_H * 3_600_000;
  const others = reports.filter((report) => {
    const at = Date.parse(report.ts);
    return report.id !== trigger.id && at >= since && at <= now && report.incidentId === null && isDirty(report.fields);
  });
  const members = findCluster(trigger, others);
  if (members.length < MIN_HOMES) return { decision: 'none', members, stats: null, incidentId: null };
  const summary = stats(members);
  return { decision: summary.spreadM <= BUILDING_M ? 'tank' : 'incident', members, stats: summary, incidentId: null };
}
