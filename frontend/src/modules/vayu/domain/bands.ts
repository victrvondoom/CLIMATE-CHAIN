// Port of packages/core/src/bands.ts from the-vayu-project-main. Pure TypeScript, no React or DOM.
// The breakpoint tables are copied from packages/contracts/rules/cpcb.json (CPCB National AQI, 24-hour means).

export type Pollutant = 'pm25' | 'pm10';

export type Band = 'good' | 'satisfactory' | 'moderate' | 'poor' | 'very_poor' | 'severe';

export const BAND_LABEL: Readonly<Record<Band, string>> = {
  good: 'Good',
  satisfactory: 'Satisfactory',
  moderate: 'Moderate',
  poor: 'Poor',
  very_poor: 'Very poor',
  severe: 'Severe',
};

interface Breakpoint {
  readonly bpLo: number;
  readonly bpHi: number;
  readonly iLo: number;
  readonly iHi: number;
  readonly band: Band;
}

// CPCB needs at least 16 valid hours per pollutant before a 24-hour AQI is given.
export const CPCB_MIN_VALID_HOURS = 16;

const TABLES: Readonly<Record<Pollutant, readonly Breakpoint[]>> = {
  pm25: [
    { bpLo: 0, bpHi: 30, iLo: 0, iHi: 50, band: 'good' },
    { bpLo: 30, bpHi: 60, iLo: 50, iHi: 100, band: 'satisfactory' },
    { bpLo: 60, bpHi: 90, iLo: 100, iHi: 200, band: 'moderate' },
    { bpLo: 90, bpHi: 120, iLo: 200, iHi: 300, band: 'poor' },
    { bpLo: 120, bpHi: 250, iLo: 300, iHi: 400, band: 'very_poor' },
    { bpLo: 250, bpHi: 380, iLo: 400, iHi: 500, band: 'severe' },
  ],
  pm10: [
    { bpLo: 0, bpHi: 50, iLo: 0, iHi: 50, band: 'good' },
    { bpLo: 50, bpHi: 100, iLo: 50, iHi: 100, band: 'satisfactory' },
    { bpLo: 100, bpHi: 250, iLo: 100, iHi: 200, band: 'moderate' },
    { bpLo: 250, bpHi: 350, iLo: 200, iHi: 300, band: 'poor' },
    { bpLo: 350, bpHi: 430, iLo: 300, iHi: 400, band: 'very_poor' },
    { bpLo: 430, bpHi: 510, iLo: 400, iHi: 500, band: 'severe' },
  ],
};

function breakpointRow(pollutant: Pollutant, concentration: number): Breakpoint {
  const table = TABLES[pollutant];
  const row = table.find((candidate) => concentration < candidate.bpHi) ?? table[table.length - 1];
  if (row === undefined) throw new Error(`No breakpoints configured for ${pollutant}`);
  return row;
}

/** The CPCB sub-index by linear interpolation, capped at the top of the scale. */
export function subIndex(pollutant: Pollutant, concentration: number): number {
  if (!Number.isFinite(concentration) || concentration < 0) {
    throw new RangeError(`Concentration must be a non-negative number, got ${concentration}`);
  }
  const row = breakpointRow(pollutant, concentration);
  const capped = Math.min(concentration, row.bpHi);
  return ((row.iHi - row.iLo) / (row.bpHi - row.bpLo)) * (capped - row.bpLo) + row.iLo;
}

/** The inverse of subIndex: the concentration at which the sub-index equals `aqi` (0 to 500). */
export function concentrationForAqi(pollutant: Pollutant, aqi: number): number {
  if (!Number.isFinite(aqi) || aqi < 0 || aqi > 500) {
    throw new RangeError(`AQI must be between 0 and 500, got ${aqi}`);
  }
  const table = TABLES[pollutant];
  const row = table.find((candidate) => aqi <= candidate.iHi) ?? table[table.length - 1];
  if (row === undefined) throw new Error(`No breakpoints configured for ${pollutant}`);
  return ((aqi - row.iLo) / (row.iHi - row.iLo)) * (row.bpHi - row.bpLo) + row.bpLo;
}

/** The colour band of one concentration. */
export function bandFromConcentration(pollutant: Pollutant, concentration: number): Band {
  return breakpointRow(pollutant, concentration).band;
}

export function bandFromAqi(aqi: number): Band {
  if (aqi <= 50) return 'good';
  if (aqi <= 100) return 'satisfactory';
  if (aqi <= 200) return 'moderate';
  if (aqi <= 300) return 'poor';
  if (aqi <= 400) return 'very_poor';
  return 'severe';
}

export interface Aqi24h {
  readonly aqi: number;
  readonly band: Band;
  readonly driver: Pollutant;
  readonly validHours: { readonly pm25: number; readonly pm10: number };
}

const present = (values: readonly (number | null)[]): number[] =>
  values.filter((value): value is number => value !== null && Number.isFinite(value));

const average = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * The 24-hour AQI from the hourly values. Each pollutant is averaged over its valid hours, and
 * needs at least `minValidHours` of them; with fewer the answer is `null` ("not enough data"),
 * never a guess. The worse of PM2.5 and PM10 is the driver.
 */
export function aqi24h(
  pm25: readonly (number | null)[],
  pm10: readonly (number | null)[],
  minValidHours: number = CPCB_MIN_VALID_HOURS,
): Aqi24h | null {
  const valid25 = present(pm25);
  const valid10 = present(pm10);
  const candidates: { driver: Pollutant; index: number }[] = [];
  if (valid25.length >= minValidHours) {
    candidates.push({ driver: 'pm25', index: subIndex('pm25', average(valid25)) });
  }
  if (valid10.length >= minValidHours) {
    candidates.push({ driver: 'pm10', index: subIndex('pm10', average(valid10)) });
  }
  const worst = candidates.reduce<(typeof candidates)[number] | undefined>(
    (top, candidate) => (top === undefined || candidate.index > top.index ? candidate : top),
    undefined,
  );
  if (worst === undefined) return null;
  return {
    aqi: worst.index,
    band: bandFromAqi(worst.index),
    driver: worst.driver,
    validHours: { pm25: valid25.length, pm10: valid10.length },
  };
}
