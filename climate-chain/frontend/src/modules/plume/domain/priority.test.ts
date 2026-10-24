import { describe, expect, it } from 'vitest';
import { WEIGHTS, scoreIncident, type ObservationFacts } from './priority';

const T0 = '2026-09-12T00:00:00Z';
const DAY = 86_400_000;

// n observations on n distinct dates, 30 days apart, ending at T0.
const facts = (n: number, rate: number | null = 1000, unc: number | null = 200, instruments = ['GAO']): ObservationFacts[] =>
  Array.from({ length: n }, (_, i) => ({
    observedAt: new Date(Date.parse(T0) - 30 * i * DAY).toISOString(),
    rateKgH: rate,
    uncertaintyKgH: unc,
    instrument: instruments[i % instruments.length],
  }));

const factor = (f: ReturnType<typeof scoreIncident>['factors'], name: string) => f.find((x) => x.name === name);

// Rules from PLUME backend/tests/test_investigation_units.py and SCIENTIFIC_METHODOLOGY.md section 5.
describe('priority-v1 score', () => {
  it('has weights that sum to 100', () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('is bounded to 0-100 and equals the sum of its factor contributions', () => {
    const { score, factors } = scoreIncident(facts(5, 1000, 200, ['GAO', 'emi', 'tan']), T0, 20, 1);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBeCloseTo(factors.reduce((a, f) => a + f.contribution, 0), 2);
    for (const f of factors) expect(f.value ?? 0).toBeLessThanOrEqual(1);
  });

  it('is reproducible for the same inputs', () => {
    expect(scoreIncident(facts(3), T0, 50, 0.5).score).toBe(scoreIncident(facts(3), T0, 50, 0.5).score);
  });

  it('does not infer persistence from a single detection date', () => {
    const { factors } = scoreIncident(facts(1), T0, 0, null);
    const rec = factor(factors, 'recurrence');
    expect(rec?.value).toBe(0);
    expect(rec?.evidence).toContain('persistence not inferred');
  });

  it('lowers the priority when evidence is missing', () => {
    const withRate = scoreIncident(facts(3), T0, 30, 0.8).score;
    const { score, factors } = scoreIncident(facts(3, null, null), T0, 30, 0.8);
    expect(score).toBeLessThan(withRate);
    expect(factor(factors, 'magnitude')?.value).toBeNull();
  });

  it('ranks more recurrence and higher magnitude above less', () => {
    expect(scoreIncident(facts(6), T0, 30, null).score).toBeGreaterThan(scoreIncident(facts(2), T0, 30, null).score);
    expect(scoreIncident(facts(3, 4000, 400), T0, 30, null).score).toBeGreaterThan(
      scoreIncident(facts(3, 100, 10), T0, 30, null).score,
    );
  });

  it('rejects an empty incident', () => {
    expect(() => scoreIncident([], T0, 0, null)).toThrow();
  });

  it('matches a hand-computed priority-v1 example (3 dates, 1000 kg/h with 200 kg/h uncertainty, 50 m spread)', () => {
    // magnitude: log10(1000/50)/log10(5000/50) = 0.65051 -> 19.515
    // recurrence: 3 dates -> 0.7 -> 14; persistence 0.5 -> 5; one instrument -> 0
    // recency: latest is the reference time -> 1 -> 10; uncertainty 200/1000 -> 0.8 -> 8
    // localization: 1 - 50/150 -> 0.66667 -> 6.667; total 63.18
    const { score, factors } = scoreIncident(facts(3), T0, 50, 0.5);
    expect(score).toBeCloseTo(63.18, 2);
    expect(factor(factors, 'magnitude')?.value).toBeCloseTo(0.650515, 5);
    expect(factor(factors, 'localization')?.value).toBeCloseTo(2 / 3, 5);
  });
});
