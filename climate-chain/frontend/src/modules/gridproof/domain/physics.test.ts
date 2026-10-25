import { describe, expect, it } from 'vitest';
import series from '../fixtures/demo-hourly-series.json';
import { expectedWh, maxPlausibleWh, type Weather } from './physics';

const W = (ghi: number, temp: number, wind100: number): Weather => ({ ghi, temp, wind100 });
const quiet = W(0, 0, 0);

// Rules from WattCert oracle/gridproof/physics.py: performance ratio 0.82, cell temperature derate,
// 3 / 12 / 25 m/s wind curve at hub height, and the weather-error allowance for the upper bound.
describe('solar output bound', () => {
  it('scales irradiance by the 0.82 performance ratio and derates for cell temperature', () => {
    // Hour 0 is read from hour 1's weather: 200 kW x 1.0 x 0.82 x (1 - 0.004 x (55 - 25)) = 144,320 Wh
    const out = expectedWh('solar', 200_000, [quiet, W(1000, 25, 0), quiet]);
    expect(out[0]).toBeCloseTo(144_320, 6);
  });

  it('reads each hour from the weather stamped on the next hour, and the last hour as zero', () => {
    const out = expectedWh('solar', 200_000, [quiet, W(1000, 25, 0), quiet]);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
  });

  it('never exceeds rated capacity', () => {
    expect(expectedWh('solar', 200_000, [quiet, W(1400, -20, 0), quiet])[0]).toBe(200_000);
  });

  it('bounds the honest output with irradiance raised 1.6x plus 60 W/m2, capped at rated capacity', () => {
    expect(maxPlausibleWh('solar', 200_000, [quiet, W(1000, 25, 0), quiet])[0]).toBe(200_000);
  });
});

describe('wind output bound', () => {
  it('follows the cubic curve between cut-in and rated, with zero below cut-in and above cut-out', () => {
    // 12 m/s at 100 m is 11.64 m/s at hub height: ((11.64 - 3) / 9) ^ 3 = 0.884736 of 600 kW
    expect(expectedWh('wind', 600_000, [quiet, W(0, 0, 12), quiet])[0]).toBeCloseTo(530_841.6, 1);
    expect(expectedWh('wind', 600_000, [quiet, W(0, 0, 2), quiet])[0]).toBe(0);
    expect(expectedWh('wind', 600_000, [quiet, W(0, 0, 14), quiet])[0]).toBe(600_000);
    expect(expectedWh('wind', 600_000, [quiet, W(0, 0, 26), quiet])[0]).toBe(0);
  });

  it('bounds the honest output with wind raised 1.3x plus 0.7 m/s', () => {
    // maxPlausible for 4 m/s is the expected output for 4 x 1.3 + 0.7 = 5.9 m/s
    const upper = maxPlausibleWh('wind', 600_000, [quiet, W(0, 0, 4), quiet])[0];
    expect(upper).toBeCloseTo(expectedWh('wind', 600_000, [quiet, W(0, 0, 5.9), quiet])[0], 6);
  });
});

// Values from running WattCert's own physics.py on the same DEMO weather (scratch reference run).
describe('against the source physics on the DEMO series', () => {
  const wx = series.weather as Weather[];

  it('reproduces the expected and plausible output of the solar devices', () => {
    expect(Math.round(expectedWh('solar', 80_000, wx)[12])).toBe(42_383);
    expect(Math.round(maxPlausibleWh('solar', 80_000, wx)[12])).toBe(67_285);
    expect(Math.round(expectedWh('solar', 200_000, wx)[12])).toBe(105_958);
    expect(Math.round(maxPlausibleWh('solar', 200_000, wx)[12])).toBe(168_212);
  });

  it('gives zero expected output at night', () => {
    expect(expectedWh('solar', 80_000, wx)[3]).toBe(0);
    expect(maxPlausibleWh('solar', 80_000, wx)[3]).toBe(0);
  });
});
