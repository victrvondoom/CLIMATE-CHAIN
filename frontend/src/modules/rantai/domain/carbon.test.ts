import { describe, expect, it } from 'vitest';
import { analyzeEmissions, emissionLevel, regionalFactor, DASHBOARD_FACTOR_KG_PER_KWH } from './carbon';
import demo from '../fixtures/demo_energy.json';

// Rules ported from projects/rantai-3c-master/src/app/dashboard/page.tsx (handleDataUpload:
// value = consumption * 0.5 kg CO2/kWh, percentage = round(value / total * 100)),
// src/components/CarbonAnalysis.tsx (getEmissionLevel) and src/utils/oracle.ts (regional factors).

describe('dashboard carbon analysis', () => {
  it('uses the flat 0.5 kg CO2 per kWh factor of the dashboard', () => {
    expect(DASHBOARD_FACTOR_KG_PER_KWH).toBe(0.5);
  });

  it('sums the demo records to 1039.05 kg CO2 and gives each category its rounded share', () => {
    const result = analyzeEmissions(demo.records);
    expect(result.total).toBeCloseTo(1039.05, 6);
    const byCategory = Object.fromEntries(result.categories.map((c) => [c.category, c]));
    expect(byCategory['Office Lighting'].value).toBeCloseTo(60.25, 6);
    expect(byCategory['Data Center'].value).toBeCloseTo(445.35, 6);
    expect(byCategory['Office Lighting'].percentage).toBe(6);
    expect(byCategory['Air Conditioning'].percentage).toBe(22);
    expect(byCategory['Data Center'].percentage).toBe(43);
    expect(byCategory['Warehouse'].percentage).toBe(5);
  });

  it('rounds a share of exactly 12.5 percent half up to 13 (Math.round)', () => {
    // consumption 25 and 175 kWh become 12.5 and 87.5 kg, so category A is exactly 12.5 percent
    const result = analyzeEmissions([
      { id: 'a', category: 'A', consumption: 25, location: 'x' },
      { id: 'b', category: 'B', consumption: 175, location: 'x' },
    ]);
    expect(result.total).toBeCloseTo(100, 6);
    expect(result.categories[0].percentage).toBe(13);
  });

  it('gives every share 0 when the total is 0, and calls a missing category General', () => {
    const empty = analyzeEmissions([{ id: 'z', category: '', consumption: 0, location: 'x' }]);
    expect(empty.total).toBe(0);
    expect(empty.categories[0]).toMatchObject({ category: 'General', percentage: 0 });
  });
});

describe('intensity level (CarbonAnalysis getEmissionLevel)', () => {
  it('reads below 100 as Low, 100 up to 500 as Moderate, 500 up to 1000 as High, and 1000 or more as Very High', () => {
    expect(emissionLevel(99.9).level).toBe('Low');
    expect(emissionLevel(100).level).toBe('Moderate');
    expect(emissionLevel(499.9).level).toBe('Moderate');
    expect(emissionLevel(500).level).toBe('High');
    expect(emissionLevel(999.9).level).toBe('High');
    expect(emissionLevel(1000).level).toBe('Very High');
  });

  it('puts the demo total in Very High', () => {
    expect(emissionLevel(analyzeEmissions(demo.records).total).level).toBe('Very High');
  });
});

describe('regional emission factors (oracle fallback)', () => {
  it('looks regions up case-insensitively and defaults unknown regions to 0.85', () => {
    expect(regionalFactor('Java')).toBe(0.75);
    expect(regionalFactor('KALIMANTAN')).toBe(0.92);
    expect(regionalFactor('Jakarta')).toBe(0.85);
  });

  it('disagrees with the dashboard: the same demo records give 1558.575 kg under the Java factor', () => {
    const java = demo.records.reduce((sum, r) => sum + r.consumption * regionalFactor('java'), 0);
    expect(java).toBeCloseTo(1558.575, 6);
    expect(java).not.toBeCloseTo(analyzeEmissions(demo.records).total, 3);
  });
});
