import { describe, expect, it } from 'vitest';
import {
  aqi24h,
  bandFromAqi,
  bandFromConcentration,
  concentrationForAqi,
  subIndex,
} from './bands';

// Test vectors are the expected values in packages/core/src/bands.test.ts of the-vayu-project-main.

describe('CPCB sub-index (bands.test.ts vectors)', () => {
  it('interpolates inside a band: PM2.5 of 45 is AQI 75', () => {
    expect(subIndex('pm25', 45)).toBeCloseTo(75, 6);
  });

  it('is continuous at the breakpoints', () => {
    for (const [concentration, aqi] of [
      [30, 50],
      [60, 100],
      [90, 200],
      [120, 300],
      [250, 400],
    ] as const) {
      expect(subIndex('pm25', concentration)).toBeCloseTo(aqi, 6);
    }
  });

  it('caps at 500', () => {
    expect(subIndex('pm25', 900)).toBeCloseTo(500, 6);
  });

  it('uses the PM10 table for PM10', () => {
    expect(subIndex('pm10', 100)).toBeCloseTo(100, 6);
  });

  it('rejects negative and non-finite input', () => {
    expect(() => subIndex('pm25', -1)).toThrow(RangeError);
    expect(() => subIndex('pm25', Number.NaN)).toThrow(RangeError);
  });

  it('never decreases as the concentration rises (checked on a grid)', () => {
    let previous = -Infinity;
    for (let c = 0; c <= 700; c += 0.5) {
      const index = subIndex('pm25', c);
      expect(index).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = index;
    }
  });
});

describe('bands', () => {
  it('maps PM2.5 concentrations to the six bands', () => {
    expect(bandFromConcentration('pm25', 10)).toBe('good');
    expect(bandFromConcentration('pm25', 45)).toBe('satisfactory');
    expect(bandFromConcentration('pm25', 75)).toBe('moderate');
    expect(bandFromConcentration('pm25', 100)).toBe('poor');
    expect(bandFromConcentration('pm25', 200)).toBe('very_poor');
    expect(bandFromConcentration('pm25', 400)).toBe('severe');
  });

  it('maps AQI values to bands', () => {
    expect(bandFromAqi(50)).toBe('good');
    expect(bandFromAqi(51)).toBe('satisfactory');
    expect(bandFromAqi(212)).toBe('poor');
    expect(bandFromAqi(451)).toBe('severe');
  });
});

describe('24-hour AQI (exposure dial)', () => {
  const day = (value: number): number[] => Array.from({ length: 24 }, () => value);

  it('averages 24 hours and takes the worse pollutant', () => {
    const result = aqi24h(day(45), day(300));
    expect(result?.driver).toBe('pm10');
    expect(result?.aqi).toBeCloseTo(subIndex('pm10', 300), 6);
  });

  it('needs at least 16 valid hours (the CPCB rule)', () => {
    const fifteen = [...day(100).slice(0, 15), ...Array<null>(9).fill(null)];
    expect(aqi24h(fifteen, fifteen)).toBeNull();
    const sixteen = [...day(100).slice(0, 16), ...Array<null>(8).fill(null)];
    expect(aqi24h(sixteen, Array<null>(24).fill(null))?.driver).toBe('pm25');
  });
});

describe('concentrationForAqi', () => {
  it('is the inverse of subIndex across the whole scale', () => {
    for (const aqi of [0, 25, 50, 75, 100, 150, 200, 250, 300, 350, 400, 450, 500]) {
      expect(subIndex('pm25', concentrationForAqi('pm25', aqi))).toBeCloseTo(aqi, 6);
    }
  });

  it('says AQI 450 (the GRAP Stage IV order level) is 315 ug/m3 of PM2.5', () => {
    expect(concentrationForAqi('pm25', 450)).toBeCloseTo(315, 6);
  });

  it('refuses a value outside the scale rather than invent one', () => {
    expect(() => concentrationForAqi('pm25', -1)).toThrow(RangeError);
    expect(() => concentrationForAqi('pm25', 501)).toThrow(RangeError);
    expect(() => concentrationForAqi('pm25', Number.NaN)).toThrow(RangeError);
  });
});
