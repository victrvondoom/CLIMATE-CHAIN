import { describe, expect, it } from 'vitest';
import candidates from '../fixtures/candidates.json';
import { capacities, clean, jaccard, screenScore } from './screen';

describe('name cleaning and helpers (pipeline/test_pipeline.py)', () => {
  it('normalises capacity units to MW', () => {
    expect(capacities('19.2 MWp Solar Power Project')).toEqual(new Set([19.2]));
    expect(capacities('500 kW rooftop solar')).toEqual(new Set([0.5]));
    expect(capacities('Wind farm')).toEqual(new Set());
  });

  it('removes generic words before matching', () => {
    expect(clean('Wind Power Project in Karnataka, India')).toBe('wind karnataka');
  });

  it('computes Jaccard over words, and 0 when a side is empty', () => {
    expect(jaccard('azure power', 'azure power india')).toBeCloseTo(2 / 3, 12);
    expect(jaccard('', 'x')).toBe(0);
  });

  it('lowers the pre-score by more than 0.3 when capacities conflict', () => {
    const base = { name_sim: 0.95, dev_sim: 0.5, loc_sim: 0.5, same_type: true, same_scope: true, capacity_conflict: false };
    expect(screenScore(base)).toBeGreaterThan(screenScore({ ...base, capacity_conflict: true }) + 0.3);
  });
});

describe('screen_score over the candidate slice (pipeline/screen.py)', () => {
  it('recomputes the stored screen_score for every candidate', () => {
    expect(candidates.candidates).toHaveLength(200);
    for (const c of candidates.candidates) {
      expect(screenScore(c), `${c.a}~${c.b}`).toBe(c.screen_score);
    }
  });
});
