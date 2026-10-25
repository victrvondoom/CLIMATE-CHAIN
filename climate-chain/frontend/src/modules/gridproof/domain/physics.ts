// What a device could physically have produced in an hour, given the weather. Ported from
// WattCert oracle/gridproof/physics.py. Weather is read on the grid cell; each reading hour
// uses the weather stamped at the next hour (the source shifts the series by one hour).

export type Kind = 'solar' | 'wind';

export interface Weather {
  ghi: number; // W/m2, mean over the preceding hour
  temp: number; // degrees C
  wind100: number; // m/s at 100 m
}

const SOLAR_PR = 0.82; // inverter, wiring and soiling losses
const SOLAR_TEMP_COEFF = -0.004; // per degree C above 25
const NOCT_RISE = 0.03; // degrees C of cell heating per W/m2

const CUT_IN = 3.0;
const RATED = 12.0;
const CUT_OUT = 25.0;
const HUB_SHEAR = 0.97; // 100 m wind to ~80 m hub

// How much better a device's local weather can be than the grid-cell forecast.
const GHI_UNCERTAINTY = { mul: 1.6, add: 60 };
const WIND_UNCERTAINTY = { mul: 1.3, add: 0.7 };

const clip = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function solarWh(capacityW: number, ghi: number, temp: number): number {
  const cellT = temp + NOCT_RISE * ghi;
  const derate = 1 + SOLAR_TEMP_COEFF * (cellT - 25);
  return clip(capacityW * (ghi / 1000) * SOLAR_PR * derate, 0, capacityW);
}

function windWh(capacityW: number, wind100: number): number {
  const v = wind100 * HUB_SHEAR;
  let frac: number;
  if (v < CUT_IN || v >= CUT_OUT) frac = 0;
  else if (v >= RATED) frac = 1;
  else frac = ((v - CUT_IN) / (RATED - CUT_IN)) ** 3;
  return frac * capacityW;
}

// Expected Wh for each hour, indexed by the hour's start. The last hour has no next weather and is 0.
export function expectedWh(kind: Kind, capacityW: number, weather: readonly Weather[]): number[] {
  return weather.map((_, i) => {
    const next = weather[i + 1];
    if (!next) return 0;
    return kind === 'solar' ? solarWh(capacityW, next.ghi, next.temp) : windWh(capacityW, next.wind100);
  });
}

// Upper bound on honest output, allowing for local weather error (clouds clearing, gusts).
export function maxPlausibleWh(kind: Kind, capacityW: number, weather: readonly Weather[]): number[] {
  const widened = weather.map((w): Weather =>
    kind === 'solar'
      ? { ...w, ghi: w.ghi > 0 ? w.ghi * GHI_UNCERTAINTY.mul + GHI_UNCERTAINTY.add : 0 }
      : { ...w, wind100: w.wind100 * WIND_UNCERTAINTY.mul + WIND_UNCERTAINTY.add },
  );
  return expectedWh(kind, capacityW, widened);
}
