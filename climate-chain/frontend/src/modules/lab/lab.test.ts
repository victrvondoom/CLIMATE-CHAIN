import { describe, expect, it } from 'vitest';
import { CAUSAL_LINKS, MOLECULES, NEUTRAL_SCENARIO, PRESENT, earthSun, equilibriumWarming, forcing, massFractions, orbitContext, runScenario } from './physics';
import { ridgeFit, trainEnsoForecaster, trainWarmingTrend, type OniRow } from './ml';
import { parseVoiceCommand } from './voice';

describe('Earth-Sun geometry', () => {
  it('matches the published perihelion and aphelion distances', () => {
    expect(earthSun(new Date('2026-01-03T17:00:00Z')).au).toBeCloseTo(0.9833, 3);
    expect(earthSun(new Date('2026-07-06T20:00:00Z')).au).toBeCloseTo(1.0167, 3);
    expect(earthSun(new Date('2026-01-03T17:00:00Z')).irradiance).toBeGreaterThan(1400);
  });
  it('reports distance growing after perihelion and shrinking before it', () => {
    expect(earthSun(new Date('2026-03-01T00:00:00Z')).dailyDeltaKm).toBeGreaterThan(0);
    expect(earthSun(new Date('2026-10-01T00:00:00Z')).dailyDeltaKm).toBeLessThan(0);
  });
  it('shows orbital swing is not the anthropogenic forcing', () => {
    const ctx = orbitContext(forcing({ ...PRESENT }).total);
    expect(ctx.humanForcingWm2).toBeGreaterThan(2);
    expect(ctx.note).toMatch(/averages out/);
  });
});

describe('scenario physics', () => {
  it('doubling CO2 gives 3.7 W/m2 and the chosen sensitivity in warming', () => {
    const f = forcing({ co2: 556, ch4: 722, n2o: 270 });
    expect(f.co2).toBeCloseTo(3.708, 2);
    expect(equilibriumWarming(f.co2, 3)).toBeCloseTo(3, 1);
  });
  it('net-zero emissions warm less than business-as-usual and never claim observation', () => {
    const bau = runScenario(NEUTRAL_SCENARIO);
    const netZero = runScenario({ ...NEUTRAL_SCENARIO, fossilCo2ChangePct: -100, methaneChangePct: -50 });
    expect(netZero.warmingVsBauC).toBeLessThan(0);
    expect(netZero.warmingVsTodayC).toBeLessThan(bau.warmingVsTodayC);
    expect(netZero.gas.ch4).toBeLessThan(PRESENT.ch4);
    expect(netZero.label).toBe('SIMULATED');
  });
  it('an El Nino overlay adds warming and reduces crop yield', () => {
    const base = runScenario(NEUTRAL_SCENARIO);
    const nino = runScenario({ ...NEUTRAL_SCENARIO, elNinoOni: 2 });
    expect(nino.warmingVsTodayC - base.warmingVsTodayC).toBeCloseTo(0.16, 5);
    expect(nino.cropYieldChangePct.wheat).toBeLessThan(base.cropYieldChangePct.wheat);
  });
  it('splits CO2 into carbon and oxygen by mass', () => {
    const co2 = massFractions(MOLECULES[0]);
    expect(co2.fractions.C).toBeCloseTo(0.2729, 3);
    expect(co2.fractions.O).toBeCloseTo(0.7271, 3);
  });
  it('covers both causal directions with evidence', () => {
    expect(new Set(CAUSAL_LINKS.map((l) => l.direction))).toEqual(new Set(['human-to-climate', 'climate-to-human']));
    expect(CAUSAL_LINKS.every((l) => l.evidence.length > 3)).toBe(true);
  });
});

describe('forecasters', () => {
  it('ridgeFit recovers an exact line and rejects degenerate data', () => {
    const w = ridgeFit([[1, 0], [1, 1], [1, 2], [1, 3]], [2, 5, 8, 11], 1e-9);
    expect(w[0]).toBeCloseTo(2, 4);
    expect(w[1]).toBeCloseTo(3, 4);
    expect(() => ridgeFit([[1, 1], [1, 1]], [1, 2], 0)).toThrow(/Singular/);
  });
  it('ENSO forecaster is scored out-of-sample and beats persistence on a quasi-periodic series', () => {
    const rows: OniRow[] = Array.from({ length: 480 }, (_, t) => ({ year: 1985 + Math.floor(t / 12), month: (t % 12) + 1, oni: 1.3 * Math.sin((2 * Math.PI * t) / 46) + 0.1 * Math.sin(t * 1.7) }));
    const model = trainEnsoForecaster(rows);
    expect(model.horizons.map((h) => h.horizon)).toEqual([1, 3, 6]);
    expect(model.horizons[2].skillVsPersistence).toBeGreaterThan(0.3);
    expect(model.horizons.every((h) => h.testCount > 50 && Number.isFinite(h.rmse))).toBe(true);
    expect(model.forecast).toHaveLength(3);
    expect(() => trainEnsoForecaster(rows.slice(0, 100))).toThrow(/20 years/);
  });
  it('warming trend is backtested against a straight line and widens its interval', () => {
    const pts = Array.from({ length: 55 }, (_, i) => ({ year: 1970 + i, value: -0.1 + 0.012 * i + 0.0003 * i * i + Math.sin(i * 2.1) * 0.02 }));
    const trend = trainWarmingTrend(pts, 2050);
    expect(trend.backtestRmse).toBeLessThan(trend.linearBacktestRmse);
    const first = trend.projection[0];
    const last = trend.projection[trend.projection.length - 1];
    expect(last.high - last.low).toBeGreaterThan(first.high - first.low);
    expect(last.low).toBeLessThan(last.value);
    expect(() => trainWarmingTrend(pts.slice(0, 5), 2050)).toThrow(/12/);
  });
});

describe('voice commands', () => {
  it('parses navigation, scenario edits and presets', () => {
    expect(parseVoiceCommand('Show me the blockchain ledger')).toEqual({ type: 'goto', view: 'ledger' });
    expect(parseVoiceCommand('cut fossil emissions by 40 percent')).toEqual({ type: 'set', key: 'fossilCo2ChangePct', value: -40 });
    expect(parseVoiceCommand('reduce methane by fifty')).toEqual({ type: 'set', key: 'methaneChangePct', value: -50 });
    expect(parseVoiceCommand('set horizon to 500 years')).toEqual({ type: 'set', key: 'horizonYears', value: 80 });
    expect(parseVoiceCommand('run the El Niño scenario')).toEqual({ type: 'preset', id: 'el-nino' });
    expect(parseVoiceCommand('read the summary')).toEqual({ type: 'speak' });
    expect(parseVoiceCommand('cut co2 by 40 percent')).toEqual({ type: 'set', key: 'fossilCo2ChangePct', value: -40 });
    expect(parseVoiceCommand('reduce ch4 30')).toEqual({ type: 'set', key: 'methaneChangePct', value: -30 });
  });
  it('never executes unrecognised speech', () => {
    expect(parseVoiceCommand('order a pizza')).toEqual({ type: 'unknown', heard: 'order a pizza' });
    expect(parseVoiceCommand('   ')).toMatchObject({ type: 'unknown' });
  });
});
