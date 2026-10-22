import { describe, expect, it } from 'vitest';
import { hourIndexOf } from './ledger';
import { CONSUMERS, GENERATORS, buildScenario } from './scenario';
import week from '../fixtures/taipower_week_2026-10-06.json';
import useFixture from '../fixtures/sample_use_kwh.json';
import certFixture from '../fixtures/sample_certificates.json';

// Ported from projects/hourmatch-master/src/scenario.mjs. The sample CSVs in public/samples are
// the demo's own exports, so the scenario must reproduce them hour by hour.

const scn = buildScenario(week);
const PLANT_ID: Record<string, number> = { 'Sunfield Solar (fictional)': 1, 'Strait Wind (fictional)': 2, 'Old Creek Hydro (fictional)': 3 };

describe('demo week', () => {
  it('covers 168 Taiwan-time hours, starting 2026-10-06 00:00', () => {
    expect(scn.n).toBe(168);
    expect(scn.hours[0].hour).toBe('2026-10-06T00:00+08:00');
    expect(scn.firstHour).toBe(hourIndexOf('2026-10-06T00:00+08:00'));
  });

  it('keeps the three fictional companies and the three fictional plants', () => {
    expect(CONSUMERS.map((c) => c.id)).toEqual(['NORTHBAY-FAB', 'HARBOR-OFFICE', 'CLOUDLINE-DC']);
    expect(GENERATORS.map((g) => g.name)).toEqual([
      'Sunfield Solar (fictional)',
      'Strait Wind (fictional)',
      'Old Creek Hydro (fictional)',
    ]);
  });
});

describe('one shared retirement state and transfer-once', () => {
  it('refuses the double sale of day-3 midday certificates, hour by hour', () => {
    const rejected = scn.log.filter((e) => e.type === 'double-sale-rejected');
    expect(rejected.map((e) => e.hour)).toEqual([
      '2026-10-08T11:00+08:00',
      '2026-10-08T12:00+08:00',
      '2026-10-08T13:00+08:00',
      '2026-10-08T14:00+08:00',
    ]);
    expect(rejected.every((e) => e.error === 'InsufficientBalance')).toBe(true);
    expect(scn.log.some((e) => e.type === 'double-sale-accepted')).toBe(false);
  });
});

describe('inherited sample data', () => {
  it('reproduces the sample use file for Northbay Fab kWh by kWh', () => {
    expect(useFixture.rows).toHaveLength(scn.n);
    useFixture.rows.forEach((row, i) => {
      expect(scn.hours[i].hour).toBe(`${row.hour.replace(' ', 'T')}+08:00`);
      expect(scn.consumption['NORTHBAY-FAB'][i]).toBe(row.kwh);
    });
  });

  it('reproduces the sample certificate file as the certificates Northbay Fab bought, plant by plant', () => {
    expect(certFixture.rows.length).toBeGreaterThan(0);
    for (const row of certFixture.rows) {
      const plant = PLANT_ID[row.plant];
      const i = scn.hours.findIndex((h) => h.hour === `${row.hour.replace(' ', 'T')}+08:00`);
      expect(plant).toBeDefined();
      expect(i).toBeGreaterThanOrEqual(0);
      expect(scn.bought['NORTHBAY-FAB'][plant][i]).toBe(row.kwh);
    }
    const nonZero = Object.values(scn.bought['NORTHBAY-FAB'])
      .flatMap((arr) => arr.filter((v) => v > 0)).length;
    expect(nonZero).toBe(certFixture.rows.length);
  });
});
