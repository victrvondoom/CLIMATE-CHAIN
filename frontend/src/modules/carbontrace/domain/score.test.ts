import { describe, expect, it } from 'vitest';
import scenarioDoc from '../fixtures/scenarios-demo.json';
import { assess, type Satellite } from './score';

// Expected outcomes come from backend/tests/test_scoring.py. Exact numbers come from the source's assess() run (fixture golden).

const scenarios = scenarioDoc.scenarios;
const byId = (id: string) => scenarios.find((s) => s.id === id)!;
const run = (id: string) => {
  const s = byId(id);
  return assess({ areaHa: s.geometry.areaHa, cells: s.geometry.cells }, s.satellite, s.request.claimedTonnes);
};

describe('verifier score and claim trimming (backend/app/scoring.py)', () => {
  it('reproduces the source golden assessment for every preset scenario', () => {
    for (const s of scenarios) {
      const a = run(s.id);
      expect(a.score, s.id).toBe(s.golden.score);
      expect(a.approved, s.id).toBe(s.golden.approved);
      expect(a.verifiedTonnes, s.id).toBe(s.golden.verifiedTonnes);
      expect(a.capsApplied, s.id).toEqual(s.golden.capsApplied);
      expect(a.checks.map((c) => [c.id, c.status]), s.id).toEqual(s.golden.checks.map((c) => [c.id, c.status]));
      expect(a.capacityTonnes, s.id).toBeCloseTo(s.golden.capacityTonnes, 2);
      expect(a.components.vegetation, s.id).toBeCloseTo(s.golden.components.vegetation, 4);
      expect(a.components.confidence, s.id).toBeCloseTo(s.golden.components.confidence, 4);
      expect(a.metrics.canopy_fraction, s.id).toBeCloseTo(s.golden.metrics.canopy_fraction, 4);
      expect(a.metrics.median_ndvi, s.id).toBeCloseTo(s.golden.metrics.median_ndvi, 4);
      expect(a.metrics.max_monthly_drop, s.id).toBeCloseTo(s.golden.metrics.max_monthly_drop, 4);
    }
  });

  it('approves the genuine forests and rejects the fake desert and fake city', () => {
    for (const id of ['legit-wayanad', 'legit-oregon']) {
      const a = run(id);
      expect(a.approved).toBe(true);
      expect(a.verifiedTonnes).toBe(byId(id).request.claimedTonnes);
    }
    for (const id of ['fake-desert', 'fake-city']) {
      const a = run(id);
      expect(a.approved).toBe(false);
      expect(a.verifiedTonnes).toBe(0);
      expect(a.capsApplied).toContain('non_forest_biome');
    }
  });

  it('trims an inflated claim to the land capacity, rounded down, and does not reject it', () => {
    const a = run('inflated-claim');
    const claimed = byId('inflated-claim').request.claimedTonnes;
    expect(a.approved).toBe(true);
    expect(a.verifiedTonnes).toBeGreaterThan(0);
    expect(a.verifiedTonnes).toBeLessThan(claimed);
    expect(a.verifiedTonnes).toBe(Math.floor(a.capacityTonnes));
  });

  it('applies the clearing hard cap: score at most 40 and a failed clearing check', () => {
    const a = run('cleared-forest');
    expect(a.capsApplied).toContain('clearing_detected');
    expect(a.score).toBeLessThanOrEqual(40);
    expect(a.checks.find((c) => c.id === 'clearing')?.status).toBe('fail');
    expect(a.approved).toBe(false);
  });

  it('rejects a huge overclaim outright instead of trimming it', () => {
    const s = byId('legit-wayanad');
    const a = assess({ areaHa: 81, cells: s.geometry.cells }, s.satellite, 1_000_000);
    expect(a.capsApplied).toContain('implausible_claim');
    expect(a.approved).toBe(false);
    expect(a.verifiedTonnes).toBe(0);
  });

  it('never approves low-confidence evidence', () => {
    const s = byId('legit-wayanad');
    const sat: Satellite = { ...s.satellite, lowConfidence: true };
    const a = assess({ areaHa: s.geometry.areaHa, cells: s.geometry.cells }, sat, 300);
    expect(a.approved).toBe(false);
    expect(a.capsApplied).toContain('low_confidence_evidence');
    expect(a.score).toBeLessThanOrEqual(69);
  });

  it('rejects a site with no usable observations', () => {
    const s = byId('legit-wayanad');
    const cloudy = { ...s.satellite, observations: s.satellite.observations.map((o) => ({ ...o, validFraction: 0.1 })) };
    const a = assess({ areaHa: s.geometry.areaHa, cells: s.geometry.cells }, cloudy, 500);
    expect(a.approved).toBe(false);
    expect(a.capsApplied).toContain('no_observations');
    expect(a.verifiedTonnes).toBe(0);
  });

  it('is deterministic and keeps the score between 0 and 100', () => {
    for (const s of scenarios) {
      const a = run(s.id);
      expect(run(s.id)).toEqual(a);
      expect(a.score).toBeGreaterThanOrEqual(0);
      expect(a.score).toBeLessThanOrEqual(100);
    }
  });
});
