// Incident building, ported from MethaneMend backend/app/ingestion/pipeline.py (build_incidents and
// _refresh_incident) for a fresh database: every observation is pending, clustered once, and
// each group is scored with priority-v1 against the provider's source persistence.

import { centroid, spreadM } from './geo';
import { clusterPoints, compareWithProvider, type ClusterParams, type PointRecord, type ProviderComparison } from './cluster';
import { scoreIncident, type Factor } from './priority';
import type { Observation } from './normalize';

export interface SourceSummary {
  sourceName: string;
  sector: string | null;
  plumeIds: string[];
  persistence: number | null;
}

export interface Incident {
  keys: string[]; // Carbon Mapper record ids
  sector: string | null;
  lon: number;
  lat: number;
  spreadM: number;
  detectionDateCount: number;
  primarySource: string | null;
  persistence: number | null;
  score: number;
  factors: Factor[];
}

export interface IncidentRun {
  incidents: Incident[];
  comparison: ProviderComparison;
  referenceTime: string;
}

// The provider may echo a query string onto the source name; keep only the identifier.
const sourceId = (name: string) => name.split('?')[0];

// The most frequent value; ties go to whichever appears first, as in Python's Counter.
function majority<T>(items: readonly T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  let best: T | undefined;
  let bestCount = 0;
  for (const [item, count] of counts) {
    if (count > bestCount) {
      best = item;
      bestCount = count;
    }
  }
  return best;
}

export function buildIncidents(
  observations: readonly Observation[],
  sources: readonly SourceSummary[],
  params: ClusterParams,
): IncidentRun {
  if (observations.length === 0) throw new Error('no observations to group');
  const sourceByPlume = new Map<string, string>();
  const persistenceByName = new Map<string, number | null>();
  for (const s of sources) {
    const name = sourceId(s.sourceName);
    persistenceByName.set(name, s.persistence);
    for (const pid of s.plumeIds) sourceByPlume.set(String(pid), name);
  }

  const byKey = new Map(observations.map((o) => [o.key, o]));
  const points: PointRecord[] = observations.map((o) => ({
    key: o.key,
    lon: o.lon,
    lat: o.lat,
    sector: o.sector,
    providerGroup: sourceByPlume.get(o.plumeId) ?? null,
  }));
  const groups = clusterPoints(points, params);
  const comparison = compareWithProvider(groups);

  const referenceTime = new Date(Math.max(...observations.map((o) => Date.parse(o.observedAt)))).toISOString();

  const incidents = groups.map((group): Incident => {
    const members = group.map((p) => byKey.get(p.key) as Observation);
    const pts = members.map((m) => ({ lon: m.lon, lat: m.lat }));
    const { lon, lat } = centroid(pts);
    const spread = spreadM(pts);
    const primarySource = majority(members.flatMap((m) => {
      const name = sourceByPlume.get(m.plumeId);
      return name ? [name] : [];
    })) ?? null;
    const persistence = primarySource ? (persistenceByName.get(primarySource) ?? null) : null;
    const { score, factors } = scoreIncident(
      members.map((m) => ({
        observedAt: m.observedAt,
        rateKgH: m.rateKgH,
        uncertaintyKgH: m.uncertaintyKgH,
        instrument: m.instrument,
      })),
      referenceTime,
      spread,
      persistence,
    );
    return {
      keys: members.map((m) => m.key),
      sector: majority(members.map((m) => m.sector)) ?? null,
      lon,
      lat,
      spreadM: spread,
      detectionDateCount: new Set(members.map((m) => m.observedAt.slice(0, 10))).size,
      primarySource,
      persistence,
      score,
      factors,
    };
  });

  return { incidents, comparison, referenceTime };
}
