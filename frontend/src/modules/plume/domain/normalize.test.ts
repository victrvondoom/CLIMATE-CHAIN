import { describe, expect, it } from 'vitest';
import sample from '../fixtures/carbonmapper-permian-sample.json';
import { emissionFacts, normalizeBatch, type RawPlume } from './normalize';

const raw = sample.plumes as RawPlume[];

const base: RawPlume = {
  id: 'id-1',
  plume_id: 'plume-1',
  scene_timestamp: '2026-03-09T18:49:38.940Z',
  instrument: 'tan',
  sector: '1B2',
  gas: 'CH4',
  status: 'published',
  plume_quality: null,
  hide_emission: false,
  emission_auto: 1000,
  emission_uncertainty_auto: 200,
  geometry_json: { type: 'Point', coordinates: [-101.77, 31.84] },
};

// Ingestion rules from PLUME backend/app/providers/carbonmapper.py and ingestion/pipeline.py.
describe('Carbon Mapper record normalization', () => {
  it('drops a re-issued record with the same external id (the fixture has one)', () => {
    const { observations, dropped } = normalizeBatch(raw);
    expect(raw).toHaveLength(60);
    expect(observations).toHaveLength(59);
    expect(dropped).toEqual([
      { reason: 'same_id', id: '1ade4081-cb35-47e9-98a5-723b5cb57455', plumeId: 'emi20240812t213903p14030-F' },
    ]);
  });

  it('keeps a provider-hidden emission as unavailable instead of estimating it', () => {
    const hidden = raw.find((r) => r.hide_emission);
    expect(hidden).toBeDefined();
    const obs = normalizeBatch([hidden as RawPlume]).observations[0];
    expect(obs.rateKgH).toBeNull();
    expect(obs.uncertaintyKgH).toBeNull();
    expect(obs.flags).toContain('emission_hidden_by_provider');
  });

  it('treats a non-positive estimate as unavailable', () => {
    expect(emissionFacts({ ...base, emission_auto: 0 })).toMatchObject({ rateKgH: null, uncertaintyKgH: null });
    expect(emissionFacts({ ...base, emission_auto: 0 }).flags).toContain('non_positive_emission_estimate');
  });

  it('discards a negative uncertainty but keeps the estimate', () => {
    const f = emissionFacts({ ...base, emission_uncertainty_auto: -5 });
    expect(f.rateKgH).toBe(1000);
    expect(f.uncertaintyKgH).toBeNull();
    expect(f.flags).toEqual(expect.arrayContaining(['negative_uncertainty_discarded', 'uncertainty_unavailable']));
  });

  it('rejects non-methane, unpublished and out-of-range records with a reason', () => {
    const { observations, dropped } = normalizeBatch([
      { ...base, id: 'a', gas: 'CO2' },
      { ...base, id: 'b', status: 'draft' },
      { ...base, id: 'c', geometry_json: { type: 'Point', coordinates: [-200, 31] } },
    ]);
    expect(observations).toHaveLength(0);
    expect(dropped.map((d) => d.reason)).toEqual(['not_methane', 'not_published', 'invalid_coordinates']);
  });
});
