// DBSCAN with the haversine metric, run per sector, ported from PLUME
// backend/app/investigation/clustering.py. Semantics follow scikit-learn: a point is a
// core point when at least min_samples points (itself included) lie within eps.

import { haversineM, type LonLat } from './geo';

export interface PointRecord extends LonLat {
  key: string;
  sector: string | null;
  providerGroup?: string | null;
}

export interface ClusterParams {
  epsM: number;
  minSamples: number;
}

export const DEFAULT_CLUSTER_PARAMS: ClusterParams = { epsM: 200, minSamples: 1 };

const UNASSIGNED = '_unassigned';
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// Returns -1 for noise, otherwise a cluster label numbered in discovery order.
function dbscan(points: readonly PointRecord[], { epsM, minSamples }: ClusterParams): number[] {
  const n = points.length;
  const neighbours = points.map((a) => {
    const out: number[] = [];
    for (let j = 0; j < n; j++) if (haversineM(a, points[j]) <= epsM) out.push(j);
    return out;
  });
  const isCore = neighbours.map((nb) => nb.length >= minSamples);
  const labels = new Array<number>(n).fill(-1);
  const visited = new Array<boolean>(n).fill(false);
  let next = 0;
  for (let i = 0; i < n; i++) {
    if (visited[i] || !isCore[i]) continue;
    const label = next++;
    visited[i] = true;
    labels[i] = label;
    const stack = [i];
    while (stack.length > 0) {
      const j = stack.pop() as number;
      for (const k of neighbours[j]) {
        if (labels[k] === -1) labels[k] = label;
        if (!visited[k] && isCore[k]) {
          visited[k] = true;
          stack.push(k);
        }
      }
    }
  }
  return labels;
}

// Groups are ordered by their smallest member key. Each sector is clustered on its own,
// so a landfill plume never merges with a nearby well pad. Noise points become singletons.
export function clusterPoints(points: readonly PointRecord[], params: ClusterParams): PointRecord[][] {
  const bySector = new Map<string, PointRecord[]>();
  for (const p of points) {
    const k = p.sector ?? UNASSIGNED;
    const list = bySector.get(k);
    if (list) list.push(p);
    else bySector.set(k, [p]);
  }

  const groups: PointRecord[][] = [];
  for (const sector of [...bySector.keys()].sort(cmp)) {
    const members = [...(bySector.get(sector) ?? [])].sort((a, b) => cmp(a.key, b.key));
    if (members.length === 1) {
      groups.push(members);
      continue;
    }
    const labels = dbscan(members, params);
    const clusters = new Map<number, PointRecord[]>();
    members.forEach((p, i) => {
      const label = labels[i];
      if (label < 0) {
        groups.push([p]);
        return;
      }
      const list = clusters.get(label);
      if (list) list.push(p);
      else clusters.set(label, [p]);
    });
    groups.push(...clusters.values());
  }
  return groups.sort((a, b) => cmp(minKey(a), minKey(b)));
}

const minKey = (group: readonly PointRecord[]) => group.reduce((m, p) => (cmp(p.key, m) < 0 ? p.key : m), group[0].key);

const comb2 = (x: number) => (x * (x - 1)) / 2;

// Adjusted Rand index between two labelings of the same items (1 = identical partitions).
export function adjustedRandIndex(truth: readonly string[], pred: readonly string[]): number {
  const n = truth.length;
  const cell = new Map<string, number>();
  const rows = new Map<string, number>();
  const cols = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const t = truth[i];
    const p = pred[i];
    cell.set(`${t}\u0000${p}`, (cell.get(`${t}\u0000${p}`) ?? 0) + 1);
    rows.set(t, (rows.get(t) ?? 0) + 1);
    cols.set(p, (cols.get(p) ?? 0) + 1);
  }
  const sumIJ = [...cell.values()].reduce((s, v) => s + comb2(v), 0);
  const sumA = [...rows.values()].reduce((s, v) => s + comb2(v), 0);
  const sumB = [...cols.values()].reduce((s, v) => s + comb2(v), 0);
  if ((rows.size === 1 && cols.size === 1) || (rows.size === n && cols.size === n)) return 1;
  const expected = (sumA * sumB) / comb2(n);
  const maxIndex = (sumA + sumB) / 2;
  const denom = maxIndex - expected;
  return denom === 0 ? 1 : (sumIJ - expected) / denom;
}

export interface ProviderComparison {
  compared: number;
  ari: number | null;
  ourGroups: number;
  providerGroups: number;
  identical: number;
}

function addToSet<K>(map: Map<K, Set<string>>, k: K, value: string) {
  const set = map.get(k) ?? new Set<string>();
  set.add(value);
  map.set(k, set);
}

// Agreement between our groups and the provider's own grouping, on the points the provider grouped.
export function compareWithProvider(groups: readonly PointRecord[][]): ProviderComparison {
  const ours: string[] = [];
  const theirs: string[] = [];
  const ourSets = new Map<number, Set<string>>();
  const theirSets = new Map<string, Set<string>>();
  groups.forEach((g, gi) => {
    for (const p of g) {
      if (!p.providerGroup) continue;
      ours.push(String(gi));
      theirs.push(p.providerGroup);
      addToSet(ourSets, gi, p.key);
      addToSet(theirSets, p.providerGroup, p.key);
    }
  });
  if (ours.length === 0) return { compared: 0, ari: null, ourGroups: 0, providerGroups: 0, identical: 0 };
  const setKey = (s: Set<string>) => [...s].sort(cmp).join('\u0000');
  const theirKeys = new Set([...theirSets.values()].map(setKey));
  const identical = [...ourSets.values()].filter((s) => theirKeys.has(setKey(s))).length;
  return {
    compared: ours.length,
    ari: ours.length > 1 ? adjustedRandIndex(theirs, ours) : null,
    ourGroups: ourSets.size,
    providerGroups: theirSets.size,
    identical,
  };
}
