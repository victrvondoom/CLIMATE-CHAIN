import { describe, expect, it } from 'vitest';
import sample from '../fixtures/carbonmapper-permian-sample.json';
import { DEFAULT_CLUSTER_PARAMS } from './cluster';
import { buildIncidents, type SourceSummary } from './incidents';
import { normalizeBatch, type RawPlume } from './normalize';

const sources: SourceSummary[] = sample.sources.map((s) => ({
  sourceName: s.source_name,
  sector: s.sector,
  plumeIds: s.plume_ids,
  persistence: s.persistence,
}));

const { observations } = normalizeBatch(sample.plumes as RawPlume[]);
const result = buildIncidents(observations, sources, DEFAULT_CLUSTER_PARAMS);
const top = [...result.incidents].sort((a, b) => b.score - a.score)[0];

// Expected values come from running MethaneMend's clustering.py and scoring.py on the same 59 detections.
describe('incidents from the Carbon Mapper sample', () => {
  it('groups the 59 unique detections into the 7 provider source groups', () => {
    expect(result.incidents).toHaveLength(7);
    expect(result.comparison.compared).toBe(59);
    expect(result.comparison.ari).toBeCloseTo(1, 12);
    expect(result.comparison.identical).toBe(7);
  });

  it('ranks the 51-detection sector 1B2 incident first with score 84.42', () => {
    expect(top.keys).toHaveLength(51);
    expect(top.sector).toBe('1B2');
    expect(top.score).toBeCloseTo(84.42, 2);
    expect(top.primarySource).toBe('CH4_1B2_250m_-101.77227_31.84496');
    expect(top.persistence).toBeCloseTo(0.7777777777777778, 9);
    expect(top.spreadM).toBeCloseTo(48.34167798, 3);
  });

  it('reproduces each priority factor of the top incident', () => {
    const value = (name: string) => top.factors.find((f) => f.name === name)?.value;
    expect(value('magnitude')).toBeCloseTo(0.7241853476907986, 9);
    expect(value('recurrence')).toBe(1);
    expect(value('provider_persistence')).toBeCloseTo(0.7777777777777778, 9);
    expect(value('corroboration')).toBe(1);
    expect(value('recency')).toBe(1);
    expect(value('measurement_confidence')).toBeCloseTo(0.8139064190473695, 9);
    expect(value('localization')).toBeCloseTo(0.6777221467859816, 9);
  });

  it('gives the single-detection incidents no persistence and no spread', () => {
    const singles = result.incidents.filter((i) => i.keys.length === 1);
    expect(singles).toHaveLength(5);
    for (const s of singles) expect(s.spreadM).toBe(0);
  });
});
