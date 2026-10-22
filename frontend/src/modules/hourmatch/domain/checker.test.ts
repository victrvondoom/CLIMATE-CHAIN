import { describe, expect, it } from 'vitest';
import { checkClaim, pctText, type Claim } from './checker';
import { buildScenario } from './scenario';
import week from '../fixtures/taipower_week_2026-10-06.json';

// Ported from projects/hourmatch-master/tests/checker.test.mjs, on the same demo week
// (Taipower 2026-10-06, 7 days). Expected numbers are the source's own.

const scn = buildScenario(week);

function claim(overrides: Partial<Claim>): Claim {
  return {
    start_date: '2026-10-06',
    end_date: '2026-10-12',
    hour_from: 0,
    hour_to: 24,
    weekdays_only: false,
    claimed_pct: 100,
    standard: 'unspecified',
    re100: false,
    claim_year: 2026,
    consumer_id: '',
    ...overrides,
  };
}

describe('percentages', () => {
  it('rounds half up to one decimal, not floored', () => {
    expect(pctText(8193)).toBe('81.9%');
    expect(pctText(8196)).toBe('82.0%');
    expect(pctText(8303)).toBe('83.0%');
    expect(pctText(10000)).toBe('100.0%');
  });
});

describe('headline numbers', () => {
  it('shows 103% on paper and 83.0% hour by hour for Northbay Fab', () => {
    const r = checkClaim(scn, claim({ consumer_id: 'NORTHBAY-FAB' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.volumeBps).toBe(10300);
    expect(r.hourlyBps).toBe(8303);
    expect(r.verdict).toBe('NOT_SUPPORTED');
  });

  it('gives a SUPPORTED volume claim a rewrite on the volume basis, not the hourly number', () => {
    const r = checkClaim(scn, claim({ consumer_id: 'NORTHBAY-FAB', standard: 'volume' }));
    if (!r.ok) throw new Error('expected a checkable claim');
    expect(r.verdict).toBe('SUPPORTED');
    expect(r.rewrite).toMatch(/^Certificates bought for .* equal 103\.0% of its use in total\./);
    expect(r.rewrite).toMatch(/Matched hour by hour, the share is 83\.0%\./);
  });

  it('states the hourly share it was judged on for an hourly claim', () => {
    const r = checkClaim(scn, claim({ consumer_id: 'HARBOR-OFFICE', standard: 'hourly' }));
    if (!r.ok) throw new Error('expected a checkable claim');
    expect(r.hourlyBps).toBe(8193);
    expect(r.rewrite).toMatch(/^81\.9% of Harbor Office/);
    expect(r.reasons[0]).toContain('81.9%');
  });

  it('keeps every rewrite number within rounding of the share on the claim basis', () => {
    for (const consumer_id of ['NORTHBAY-FAB', 'HARBOR-OFFICE', 'CLOUDLINE-DC'])
      for (const standard of ['hourly', 'volume'] as const)
        for (const re100 of [false, true]) {
          const r = checkClaim(scn, claim({ consumer_id, standard, re100, claimed_pct: 50 }));
          if (!r.ok) throw new Error('expected a checkable claim');
          const shown = Math.round(Number(/(\d+\.\d)%/.exec(r.rewrite)![1]) * 100);
          const basisBps = r.re100
            ? standard === 'volume' ? r.re100.volumeBps : r.re100.hourlyBps
            : standard === 'volume' ? r.volumeBps : r.hourlyBps;
          expect(Math.abs(shown - basisBps), `${consumer_id} ${standard} ${re100}`).toBeLessThanOrEqual(5);
        }
  });
});

describe('RE100 plant age', () => {
  it('caps plants older than 15 years at 15% of use', () => {
    const r = checkClaim(scn, claim({ consumer_id: 'HARBOR-OFFICE', standard: 'volume', re100: true }));
    if (!r.ok || !r.re100) throw new Error('expected an RE100 check');
    expect(r.verdict).toBe('NOT_SUPPORTED');
    expect(r.re100.oldBoughtBps).toBeGreaterThan(1500);
    expect(r.re100.volumeBps).toBeLessThan(r.volumeBps);
    expect(r.reasons.some((x) => x.includes('Old Creek Hydro') && x.includes('15%'))).toBe(true);

    const nb = checkClaim(scn, claim({ consumer_id: 'NORTHBAY-FAB', standard: 'volume', re100: true }));
    if (!nb.ok || !nb.re100) throw new Error('expected an RE100 check');
    expect(nb.verdict).toBe('SUPPORTED');
    expect(nb.re100.volumeBps).toBe(nb.volumeBps);
  });
});

describe('claims that cannot be checked', () => {
  it('refuses an unknown company and an empty period', () => {
    expect(checkClaim(scn, claim({ consumer_id: 'ACME' })).ok).toBe(false);
    expect(
      checkClaim(scn, claim({ consumer_id: 'NORTHBAY-FAB', start_date: '2027-01-01', end_date: '2027-01-02' })).ok,
    ).toBe(false);
  });

  it('refuses a window whose end is not after its start', () => {
    const r = checkClaim(scn, claim({ consumer_id: 'NORTHBAY-FAB', hour_from: 9, hour_to: 9 }));
    expect(r.ok).toBe(false);
  });
});
