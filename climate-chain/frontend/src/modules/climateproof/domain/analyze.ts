// Port of analyze_dataframe in ClimateProof-AI-main/app/main.py. Pure TypeScript. The column names,
// domain ranges, IQR rule, warning texts and note are the source's own.

import type { ParsedCsv } from './csv';

export const REQUIRED_COLUMNS = [
  'timestamp',
  'location',
  'temperature_c',
  'humidity_pct',
  'pm25',
  'source_id',
] as const;

export const NUMERIC_COLUMNS = ['temperature_c', 'humidity_pct', 'pm25'] as const;

interface Range {
  readonly min: number | null;
  readonly max: number | null;
}

/** Only the constraints the source calls broadly applicable. Temperature has none. */
export const DOMAIN_RANGES: Readonly<Record<string, Range>> = {
  humidity_pct: { min: 0, max: 100 },
  pm25: { min: 0, max: null },
};

export const ANALYSIS_NOTE =
  'Domain violations indicate configured constraint failures. IQR flags indicate statistical outliers only; ' +
  'neither establishes fraud, causation, or a regulatory violation.';

const CLEAN_WARNING = 'No parsing, domain, or duplicate-row warnings detected by these checks.';

export interface NumericSummary {
  readonly count: number;
  readonly mean: number | null;
  readonly min: number | null;
  readonly max: number | null;
  readonly std: number | null;
}

export interface Analysis {
  readonly filename: string;
  readonly row_count: number;
  readonly columns: string[];
  readonly missing_values: Record<string, number>;
  readonly duplicate_rows: number;
  readonly invalid_timestamps: number;
  readonly invalid_numeric_values: Record<string, number>;
  readonly domain_violations: Record<string, number>;
  readonly numeric_summary: Record<string, NumericSummary>;
  readonly anomaly_counts: Record<string, number>;
  readonly warnings: string[];
  readonly note: string;
}

export class MissingColumnsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingColumnsError';
  }
}

/** Python's round(x, 4), for the summary figures. */
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

const WHITESPACE_ONLY = /^\s*$/;
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** A typed number, or null when the text is not a finite number. */
function parseNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!DECIMAL.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** pandas' default quantile: linear interpolation between the two nearest ranks. */
function quantile(sorted: readonly number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (position - low) * (sorted[high] - sorted[low]);
}

/** Outside 1.5 times the IQR; when the IQR is zero, any value that is not the quartile. */
function outlierCount(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  if (iqr === 0) return values.filter((value) => value !== q1).length;
  const low = q1 - 1.5 * iqr;
  const high = q3 + 1.5 * iqr;
  return values.filter((value) => value < low || value > high).length;
}

function summarise(values: readonly number[]): NumericSummary {
  if (values.length === 0) return { count: 0, mean: null, min: null, max: null, std: null };
  const n = values.length;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const std = n > 1 ? Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1)) : 0;
  const min = values.reduce((low, value) => Math.min(low, value));
  const max = values.reduce((high, value) => Math.max(high, value));
  return { count: n, mean: round4(mean), min: round4(min), max: round4(max), std: round4(std) };
}

/** Validates and profiles a parsed CSV. Throws MissingColumnsError if a required column is absent. */
export function analyzeTable(table: ParsedCsv, filename: string): Analysis {
  const present = new Set(table.header);
  const missing = REQUIRED_COLUMNS.filter((name) => !present.has(name)).sort();
  if (missing.length > 0) {
    throw new MissingColumnsError(`Missing required columns: ${missing.join(', ')}`);
  }

  const columns = table.header;
  const indexOf = (name: string): number => columns.indexOf(name);

  // location and source_id that are only spaces count as missing (the source's regex ^\s*$).
  const rows = table.rows.map((row) =>
    row.map((cell, col) => {
      const name = columns[col];
      if ((name === 'location' || name === 'source_id') && cell !== null && WHITESPACE_ONLY.test(cell)) {
        return null;
      }
      return cell;
    }),
  );

  const missing_values: Record<string, number> = {};
  columns.forEach((name, col) => {
    missing_values[name] = rows.filter((row) => row[col] === null).length;
  });

  const seen = new Set<string>();
  let duplicate_rows = 0;
  for (const row of rows) {
    const key = JSON.stringify(row);
    if (seen.has(key)) duplicate_rows++;
    else seen.add(key);
  }

  const timestampCol = indexOf('timestamp');
  const invalid_timestamps = rows.filter((row) => {
    const cell = row[timestampCol];
    return cell === null || Number.isNaN(Date.parse(cell));
  }).length;

  const invalid_numeric_values: Record<string, number> = {};
  const domain_violations: Record<string, number> = {};
  const numeric_summary: Record<string, NumericSummary> = {};
  const anomaly_counts: Record<string, number> = {};
  const warnings: string[] = [];

  for (const name of NUMERIC_COLUMNS) {
    const col = indexOf(name);
    let invalid = 0;
    const valid: number[] = [];
    for (const row of rows) {
      const cell = row[col];
      if (cell === null) continue;
      const value = parseNumber(cell);
      if (value === null) invalid++;
      else valid.push(value);
    }
    invalid_numeric_values[name] = invalid;

    const range = DOMAIN_RANGES[name];
    const violations = range
      ? valid.filter((value) => (range.min !== null && value < range.min) || (range.max !== null && value > range.max)).length
      : 0;
    domain_violations[name] = violations;

    numeric_summary[name] = summarise(valid);
    anomaly_counts[name] = outlierCount(valid);

    if (invalid > 0) {
      warnings.push(`${name}: ${invalid} value(s) are invalid, unparseable, or non-finite.`);
    }
    if (violations > 0) {
      warnings.push(`${name}: ${violations} value(s) violate the configured domain constraints.`);
    }
  }

  if (invalid_timestamps > 0) {
    warnings.push(`timestamp: ${invalid_timestamps} value(s) could not be parsed as timestamps.`);
  }
  if (duplicate_rows > 0) {
    warnings.push(`Found ${duplicate_rows} duplicate row(s).`);
  }
  if (warnings.length === 0) {
    warnings.push(CLEAN_WARNING);
  }

  return {
    filename,
    row_count: rows.length,
    columns: [...columns],
    missing_values,
    duplicate_rows,
    invalid_timestamps,
    invalid_numeric_values,
    domain_violations,
    numeric_summary,
    anomaly_counts,
    warnings,
    note: ANALYSIS_NOTE,
  };
}
