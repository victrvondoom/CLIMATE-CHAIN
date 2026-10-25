import { describe, expect, it } from 'vitest';
import series from '../fixtures/demo-hourly-series.json';
import { expectedWh, maxPlausibleWh, type Kind, type Weather } from './physics';
import { THRESHOLD, scoreSeries, type Hour } from './integrity';

// Rules from WattCert oracle/gridproof/integrity.py, physics part only (the IsolationForest part is
// not ported). The threshold matches GranularCertificate.anomalyThresholdBps = 7000.

function deviceHours(key: string): { kind: Kind; capacityW: number; hours: Hour[] } {
  const dev = series.devices.find((d) => d.key === key);
  if (!dev) throw new Error(`no device ${key}`);
  const kind = dev.kind as Kind;
  const wx = series.weather as Weather[];
  const exp = expectedWh(kind, dev.capacity_w, wx).map(Math.round);
  const mp = maxPlausibleWh(kind, dev.capacity_w, wx).map(Math.round);
  const rep = series.reported_wh[key as keyof typeof series.reported_wh];
  return {
    kind,
    capacityW: dev.capacity_w,
    hours: rep.map((r, i) => ({ expectedWh: exp[i], maxPlausibleWh: mp[i], reportedWh: r })),
  };
}

const flaggedIn = (key: string) => {
  const d = deviceHours(key);
  return scoreSeries(d.kind, d.capacityW, d.hours)
    .map((s, i) => (s.flagged ? i : -1))
    .filter((i) => i >= 0);
};

describe('plausibility rule', () => {
  it('quarantines at 70 percent (7000 basis points)', () => {
    expect(THRESHOLD).toBe(0.7);
  });

  it('flags a solar meter reporting 6 percent of capacity at night', () => {
    const [s] = scoreSeries('solar', 100_000, [{ expectedWh: 0, maxPlausibleWh: 0, reportedWh: 6_000 }]);
    expect(s.physics).toBeGreaterThanOrEqual(0.99);
    expect(s.reasons).toContain('Solar output reported at night');
  });

  it('explains a reading pinned at capacity in weak conditions', () => {
    const [s] = scoreSeries('wind', 100_000, [{ expectedWh: 50_000, maxPlausibleWh: 60_000, reportedWh: 97_000 }]);
    expect(s.reasons).toContain('Reading pinned at capacity in weak conditions');
  });

  it('gives a zero-output hour the source baseline score, not zero', () => {
    const [s] = scoreSeries('solar', 200_000, [{ expectedWh: 0, maxPlausibleWh: 0, reportedWh: 0 }]);
    expect(s.physics).toBeCloseTo(0.047426, 5);
  });
});

// Flagged hours and scores from the source's physics.py and integrity.py on the DEMO series.
describe('DEMO series: which readings the source rules flag', () => {
  it('flags only the over-reported Brixton hour 30', () => {
    expect(flaggedIn('brixton')).toEqual([30]);
    const d = deviceHours('brixton');
    const [s] = scoreSeries(d.kind, d.capacityW, d.hours).slice(30, 31);
    expect(s.physics).toBeCloseTo(1, 6);
    expect(s.reasons[0]).toMatch(/^Reported 2\.8x the expected output/);
  });

  it('flags Hackney hour 3 (solar at night) and hour 24 (replay of yesterday peak)', () => {
    expect(flaggedIn('hackney')).toEqual([3, 24]);
    const d = deviceHours('hackney');
    const scored = scoreSeries(d.kind, d.capacityW, d.hours);
    expect(scored[3].reasons).toContain('Solar output reported at night');
    expect(scored[24].reasons).toContain("Identical to yesterday's peak reading (possible replay)");
  });

  it('flags Estuary hour 40 and leaves the honest Kent wind farm unflagged', () => {
    expect(flaggedIn('estuary')).toEqual([40]);
    expect(flaggedIn('kent')).toEqual([]);
  });
});
