import { describe, expect, it } from 'vitest';
import { clusterPoints, adjustedRandIndex, compareWithProvider, type PointRecord } from './cluster';

const p = (key: string, lon: number, lat: number, sector: string | null = '1B2', providerGroup: string | null = null): PointRecord => ({
  key,
  lon,
  lat,
  sector,
  providerGroup,
});

const keysOf = (groups: PointRecord[][]) => groups.map((g) => g.map((x) => x.key).sort());

// Vectors from MethaneMend backend/tests/test_investigation_units.py.
describe('DBSCAN grouping (haversine, per sector)', () => {
  it('groups points within eps and splits the far one', () => {
    const pts = [p('a', -102, 32.0), p('b', -102, 32.0009), p('c', -102, 32.01)];
    expect(keysOf(clusterPoints(pts, { epsM: 200, minSamples: 1 }))).toEqual([['a', 'b'], ['c']]);
  });

  it('never merges points from different sectors', () => {
    const pts = [p('a', -102, 32.0, '1B2'), p('b', -102, 32.0001, '6A')];
    expect(clusterPoints(pts, { epsM: 500, minSamples: 1 })).toHaveLength(2);
  });

  it('gives the same groups whatever the input order', () => {
    const pts = Array.from({ length: 40 }, (_, i) => p(String(i), -102 + (i % 7) * 0.0005, 32 + Math.floor(i / 7) * 0.0005));
    const a = keysOf(clusterPoints(pts, { epsM: 200, minSamples: 1 }));
    const b = keysOf(clusterPoints([...pts].reverse(), { epsM: 200, minSamples: 1 }));
    expect(a).toEqual(b);
  });

  it('keeps noise points as single-observation groups when min_samples is above 1', () => {
    const pts = [p('a', -102, 32.0), p('b', -102, 32.0005), p('c', -101, 31.0)];
    expect(keysOf(clusterPoints(pts, { epsM: 200, minSamples: 2 }))).toEqual([['a', 'b'], ['c']]);
  });
});

describe('agreement with the provider grouping', () => {
  it('matches the adjusted Rand index from scikit-learn on the docs example', () => {
    // sklearn: adjusted_rand_score([0, 0, 1, 1], [0, 0, 1, 2]) = 4/7
    expect(adjustedRandIndex(['0', '0', '1', '1'], ['0', '0', '1', '2'])).toBeCloseTo(4 / 7, 12);
  });

  it('reports perfect agreement when every group equals the provider group', () => {
    const pts = [
      p('a', -102, 32.0, '1B2', 'S1'),
      p('b', -102, 32.0005, '1B2', 'S1'),
      p('c', -101, 31.0, '1B2', 'S2'),
    ];
    const cmp = compareWithProvider(clusterPoints(pts, { epsM: 200, minSamples: 1 }));
    expect(cmp.ari).toBeCloseTo(1, 12);
    expect(cmp.identical).toBe(2);
  });
});
