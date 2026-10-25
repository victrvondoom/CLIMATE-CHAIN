// Data Refinery — turns messy agency CSV/JSON exports into analysis-ready data.
//
// The bottleneck this removes: researchers lose hours per dataset reformatting
// timestamps, harmonizing units, deduplicating rows and chasing missing values
// by hand before any analysis can start. Everything here is deterministic and
// runs locally in the browser; no data leaves the machine.

export type RefineryIssueKind =
  | 'parse' | 'header' | 'timestamp' | 'unit' | 'duplicate' | 'missing' | 'outlier';

export interface RefineryIssue {
  kind: RefineryIssueKind;
  message: string;
  column?: string;
  row?: number;
}

export interface ColumnStat {
  column: string;
  count: number;
  missing: number;
  outliers: number;
  mean: number;
  min: number;
  max: number;
}

export interface UnitChange {
  column: string;
  from: string;
  to: string;
}

export interface RefineryResult {
  columns: string[];
  rows: string[][];
  inputRows: number;
  outputRows: number;
  issues: RefineryIssue[];
  stats: ColumnStat[];
  unitChanges: UnitChange[];
  removedDuplicates: number;
  interpolatedCells: number;
  flaggedOutliers: number;
  missingCells: number;
}

type ColumnKind =
  | 'datetime' | 'time-only' | 'temperature' | 'pressure' | 'pm25' | 'pm10'
  | 'no2' | 'so2' | 'o3' | 'wind' | 'precip' | 'humidity' | 'text';

interface ColumnPlan {
  original: string;
  canonical: string;
  kind: ColumnKind;
  unitFrom?: string;
}

const MISSING_TOKENS = new Set(['', 'na', 'n/a', 'nan', 'null', 'none', '-', '--', 'missing']);

// ---------------------------------------------------------------- CSV parsing

function detectDelimiter(sample: string): string {
  const firstLine = sample.split(/\r?\n/, 1)[0] ?? '';
  const counts: [string, number][] = [',', ';', '\t'].map((d) => [d, countOutsideQuotes(firstLine, d)]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

function countOutsideQuotes(line: string, needle: string): number {
  let count = 0;
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === needle && !quoted) count++;
  }
  return count;
}

export function parseCsv(text: string, delimiter?: string): string[][] {
  const sep = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

// ------------------------------------------------------------- column mapping

const COLUMN_MATCHERS: { pattern: RegExp; kind: ColumnKind; canonical: string }[] = [
  { pattern: /(date.?time|timestamp|observed.?date|^date$)/i, kind: 'datetime', canonical: 'timestamp' },
  { pattern: /(pm2\.?5|pm_?2\.?5)/i, kind: 'pm25', canonical: 'pm25_ugm3' },
  { pattern: /pm_?10|pm10/i, kind: 'pm10', canonical: 'pm10_ugm3' },
  { pattern: /no2|nitrogen/i, kind: 'no2', canonical: 'no2_ugm3' },
  { pattern: /so2|sulphur|sulfur/i, kind: 'so2', canonical: 'so2_ugm3' },
  { pattern: /o3|ozone/i, kind: 'o3', canonical: 'o3_ugm3' },
  { pattern: /temp|tavg|tmin|tmax/i, kind: 'temperature', canonical: 'temperature_c' },
  { pattern: /pressure|\bslp\b/i, kind: 'pressure', canonical: 'pressure_hpa' },
  { pattern: /wind/i, kind: 'wind', canonical: 'wind_ms' },
  { pattern: /precip|rainfall|^pr\b/i, kind: 'precip', canonical: 'precip_mm' },
  { pattern: /humidity|\brh\b/i, kind: 'humidity', canonical: 'humidity_pct' },
  { pattern: /^time$|^hh:?mm/i, kind: 'time-only', canonical: 'time' },
];

const UNIT_HINTS: { pattern: RegExp; unit: string }[] = [
  { pattern: /°\s*f|\bfahrenheit|_f\b|\(f\)/i, unit: '°F' },
  { pattern: /kelvin|\bk\b(?![a-z])/i, unit: 'K' },
  { pattern: /kpa/i, unit: 'kPa' },
  { pattern: /atm/i, unit: 'atm' },
  { pattern: /inhg/i, unit: 'inHg' },
  { pattern: /mmhg/i, unit: 'mmHg' },
  { pattern: /ppb/i, unit: 'ppb' },
  { pattern: /ppt\b/i, unit: 'ppt' },
  { pattern: /ng\/m/i, unit: 'ng/m³' },
  { pattern: /mg\/m/i, unit: 'mg/m³' },
  { pattern: /km\/h|kph|kmph/i, unit: 'km/h' },
  { pattern: /mph/i, unit: 'mph' },
  { pattern: /knot/i, unit: 'knots' },
  { pattern: /inch|in\b(?![a-z])/i, unit: 'in' },
];

function detectUnitHint(header: string): string | undefined {
  return UNIT_HINTS.find((hint) => hint.pattern.test(header))?.unit;
}

const CONVERSIONS: Record<string, { to: string; factor: number; offset?: number }> = {
  // offset is expressed in input units: out = (value + offset) × factor.
  '°F': { to: '°C', factor: 5 / 9, offset: -32 },
  K: { to: '°C', factor: 1, offset: -273.15 },
  kPa: { to: 'hPa', factor: 10 },
  atm: { to: 'hPa', factor: 1013.25 },
  inHg: { to: 'hPa', factor: 33.8639 },
  mmHg: { to: 'hPa', factor: 1.33322 },
  'ng/m³': { to: 'µg/m³', factor: 1 / 1000 },
  'mg/m³': { to: 'µg/m³', factor: 1000 },
  ppt: { to: 'ppb', factor: 1 / 1000 },
  'km/h': { to: 'm/s', factor: 1 / 3.6 },
  mph: { to: 'm/s', factor: 1 / 2.236936 },
  knots: { to: 'm/s', factor: 0.514444 },
  in: { to: 'mm', factor: 25.4 },
};

// ppb → µg/m³ conversion factors at 25 °C (WHO convention).
const PPB_TO_UGM3: Partial<Record<ColumnKind, number>> = { no2: 1.88, so2: 2.62, o3: 1.96 };

const NUMERIC_KINDS = new Set(['temperature', 'pressure', 'pm25', 'pm10', 'no2', 'so2', 'o3', 'wind', 'precip', 'humidity']);

// ------------------------------------------------------------ value handling

function parseNumber(raw: string, delimiter: string): number | null {
  const cleaned = raw.trim().replace(delimiter === ',' ? /\s/g : /[ ,]/g, '').replace(/^\+/, '');
  if (cleaned === '' || !/^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function round(value: number): string {
  const rounded = Math.abs(value) >= 1000 ? Math.round(value * 100) / 100 : Math.round(value * 1e4) / 1e4;
  return String(rounded);
}

const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function validDate(y: number, m: number, d: number): boolean {
  return y >= 1000 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= MONTH_DAYS[m - 1];
}

// Returns [y, m, d] or [y, m, d, hh, mm, ss] or null. dayFirst is decided per column.
function parseDateCell(raw: string, dayFirst: boolean): number[] | null {
  const text = raw.trim();
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (match) {
    const y = +match[1]; const m = +match[2]; const d = +match[3];
    if (!validDate(y, m, d)) return null;
    if (match[4] === undefined) return [y, m, d];
    const hh = +match[4]; const mm = +match[5]; const ss = match[6] ? +match[6] : 0;
    if (hh < 24 && mm < 60 && ss < 60) return [y, m, d, hh, mm, ss];
    return null;
  }
  match = text.match(/^(\d{1,2})[/](\d{1,2})[/](\d{2,4})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (match) {
    const a = +match[1]; const b = +match[2];
    const day = dayFirst ? a : b;
    const month = dayFirst ? b : a;
    const year = match[3].length === 2 ? 2000 + +match[3] : +match[3];
    if (!validDate(year, month, day)) return null;
    if (match[4] === undefined) return [year, month, day];
    const hh = +match[4]; const mm = +match[5];
    if (hh < 24 && mm < 60) return [year, month, day, hh, mm, 0];
    return null;
  }
  return null;
}

function pad(value: number, size = 2): string {
  return String(value).padStart(size, '0');
}

function isoDate(parts: number[]): string {
  const date = pad(parts[0], 4) + '-' + pad(parts[1]) + '-' + pad(parts[2]);
  if (parts.length <= 3) return date;
  return date + 'T' + pad(parts[3]) + ':' + pad(parts[4]) + ':' + pad(parts[5]);
}

function parseTimeOnly(raw: string): number[] | null {
  const match = raw.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hh = +match[1];
  const mm = +match[2];
  return hh < 24 && mm < 60 ? [hh, mm] : null;
}

// ------------------------------------------------------------------- refinery

interface Table {
  columns: string[];
  rows: string[][];
}

function jsonToTable(text: string): Table | null {
  try {
    const parsed: unknown = JSON.parse(text);
    const records = Array.isArray(parsed) ? parsed : [parsed];
    if (records.length === 0 || typeof records[0] !== 'object' || records[0] === null) return null;
    const columns: string[] = [];
    for (const record of records) {
      for (const key of Object.keys(record as Record<string, unknown>)) {
        if (!columns.includes(key)) columns.push(key);
      }
    }
    const rows = records.map((record) => columns.map((column) => {
      const value = (record as Record<string, unknown>)[column];
      if (value === null || value === undefined) return '';
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
    }));
    return { columns, rows };
  } catch {
    return null;
  }
}

export function refineCsv(input: string): RefineryResult {
  const issues: RefineryIssue[] = [];
  const trimmed = input.trim();
  if (trimmed === '') {
    return emptyResult('Paste a CSV or JSON dataset to refine.');
  }

  const delimiter = detectDelimiter(trimmed);
  let table: Table | null = trimmed.startsWith('[') || trimmed.startsWith('{') ? jsonToTable(trimmed) : null;
  if (table) {
    issues.push({ kind: 'parse', message: 'Detected JSON input and flattened it into a table.' });
  } else {
    const parsed = parseCsv(trimmed, delimiter);
    if (parsed.length < 2) return emptyResult('Need a header row plus at least one data row.');
    table = { columns: parsed[0].map((cell) => cell.trim()), rows: parsed.slice(1) };
  }

  let columns = table.columns;
  let rows: (string | number)[][] = table.rows.map((row) => row.slice());
  const inputRows = rows.length;
  if (columns.some((cell) => cell === '')) {
    issues.push({ kind: 'header', message: 'Filled blank header cells with generated names.' });
    columns = columns.map((cell, index) => cell === '' ? 'column_' + (index + 1) : cell);
  }

  // Plan every column: canonical name, kind, unit conversion.
  const plans: ColumnPlan[] = columns.map((original) => {
    const matcher = COLUMN_MATCHERS.find((entry) => entry.pattern.test(original));
    if (!matcher) return { original, canonical: original, kind: 'text' as ColumnKind };
    // Wind direction is not a speed; leave it untouched.
    if (matcher.kind === 'wind' && /dir|bearing|deg/i.test(original)) {
      return { original, canonical: original, kind: 'text' as ColumnKind };
    }
    return { original, canonical: matcher.canonical, kind: matcher.kind, unitFrom: detectUnitHint(original) };
  });

  const unitChanges: UnitChange[] = [];
  const dateIndex = plans.findIndex((plan) => plan.kind === 'datetime');
  const timeIndex = plans.findIndex((plan) => plan.kind === 'time-only');
  let dayFirst = false;

  if (dateIndex >= 0) {
    // Decide day-first vs month-first from the column itself: any first
    // component above 12 proves day-first; any second above 12 disproves it.
    const samples = rows.slice(0, 500).map((row) => String(row[dateIndex] ?? ''));
    const firstAbove = samples.some((cell) => { const m = cell.match(/^(\d{1,2})[/]/); return m !== null && +m[1] > 12; });
    const secondAbove = samples.some((cell) => { const m = cell.match(/^(\d{1,2})[/](\d{1,2})[/]/); return m !== null && +m[2] > 12; });
    dayFirst = firstAbove && !secondAbove;
    let normalized = 0;
    for (const row of rows) {
      const parts = parseDateCell(String(row[dateIndex] ?? ''), dayFirst);
      if (parts) {
        if (timeIndex >= 0) {
          const time = parseTimeOnly(String(row[timeIndex] ?? ''));
          if (time) {
            // A separate time column wins over any time inside the date cell.
            parts[3] = time[0]; parts[4] = time[1]; parts[5] = 0;
          }
        }
        row[dateIndex] = isoDate(parts);
        normalized++;
      } else {
        row[dateIndex] = String(row[dateIndex] ?? '').trim();
        issues.push({ kind: 'timestamp', column: plans[dateIndex].original, message: 'Unrecognized date "' + row[dateIndex] + '" left as-is.' });
      }
    }
    if (normalized > 0) {
      issues.push({ kind: 'timestamp', message: 'Normalized ' + normalized + ' timestamp' + (normalized === 1 ? '' : 's') + ' to ISO 8601' + (timeIndex >= 0 ? ' (merged date + time columns)' : '') + '.' });
    }
  }

  // A time-only column merged into the timestamp is redundant: drop it.
  if (dateIndex >= 0 && timeIndex >= 0) {
    plans.splice(timeIndex, 1);
    rows = rows.map((row) => row.filter((_, index) => index !== timeIndex));
    issues.push({ kind: 'timestamp', message: 'Merged the time column into timestamp and dropped the redundant column.' });
  }

  // Missing values, unit conversion, numeric parsing.
  const numericColumns: { index: number; plan: ColumnPlan }[] = [];
  let missingCells = 0;
  rows = rows.map((row) => plans.map((plan, index) => {
    const raw = String(row[index] ?? '').trim();
    if (MISSING_TOKENS.has(raw.toLowerCase())) {
      missingCells++;
      return '' as string | number;
    }
    if (plan.kind === 'datetime' || plan.kind === 'time-only' || plan.kind === 'text') return raw;
    const value = parseNumber(raw, delimiter);
    if (value === null) return raw;
    let converted = value;
    let changed = false;
    const hint = plan.unitFrom;
    if (hint && CONVERSIONS[hint]) {
      const rule = CONVERSIONS[hint];
      converted = (converted + (rule.offset ?? 0)) * rule.factor;
      changed = true;
    }
    const ppbFactor = PPB_TO_UGM3[plan.kind];
    if (ppbFactor && (hint === 'ppb' || hint === 'ppt')) {
      converted *= ppbFactor;
      changed = true;
    }
    if (changed && !unitChanges.some((entry) => entry.column === plan.canonical)) {
      unitChanges.push({ column: plan.canonical, from: hint ?? 'raw', to: targetUnitFor(plan.kind) });
    }
    return converted;
  }));

  plans.forEach((plan, index) => {
    if (NUMERIC_KINDS.has(plan.kind)) numericColumns.push({ index, plan });
  });
  for (const change of unitChanges) {
    issues.push({ kind: 'unit', message: 'Harmonized ' + change.column + ': ' + change.from + ' → ' + change.to + '.' });
  }
  if (missingCells > 0) {
    issues.push({ kind: 'missing', message: 'Found ' + missingCells + ' missing cell' + (missingCells === 1 ? '' : 's') + ' (NA, null, blank).' });
  }

  // Linear interpolation of interior gaps in numeric columns. Gaps at the
  // edges stay missing — inventing data there would be speculation.
  let interpolatedCells = 0;
  for (const { index } of numericColumns) {
    for (let i = 0; i < rows.length; i++) {
      if (typeof rows[i][index] !== 'number') continue;
      let j = i + 1;
      while (j < rows.length && rows[j][index] === '') j++;
      if (j < rows.length && typeof rows[j][index] === 'number' && j > i + 1) {
        const start = rows[i][index] as number;
        const end = rows[j][index] as number;
        for (let k = i + 1; k < j; k++) {
          if (rows[k][index] === '') {
            const ratio = (k - i) / (j - i);
            rows[k][index] = Math.round((start + (end - start) * ratio) * 1e4) / 1e4;
            interpolatedCells++;
          }
        }
      }
      i = j - 1;
    }
  }
  if (interpolatedCells > 0) {
    issues.push({ kind: 'missing', message: 'Linearly interpolated ' + interpolatedCells + ' interior gap' + (interpolatedCells === 1 ? '' : 's') + ' in numeric columns (edge gaps stay missing).' });
  }

  // Duplicate rows: identical full rows are removed; conflicting rows that
  // share a timestamp are flagged instead of silently dropped.
  const duplicateCount = { removed: 0 };
  const seen = new Set<string>();
  const deduped: (string | number)[][] = [];
  const stampToKey = new Map<string, string>();
  const conflictingStamps = new Set<string>();
  rows.forEach((row) => {
    const key = row.join('\u0000');
    if (seen.has(key)) { duplicateCount.removed++; return; }
    seen.add(key);
    if (dateIndex >= 0) {
      const stamp = String(row[dateIndex]);
      if (stamp !== '') {
        const existing = stampToKey.get(stamp);
        if (existing !== undefined && existing !== key && !conflictingStamps.has(stamp)) {
          conflictingStamps.add(stamp);
          issues.push({ kind: 'duplicate', message: 'Conflicting rows share timestamp "' + stamp + '"; both kept for review.' });
        } else if (existing === undefined) {
          stampToKey.set(stamp, key);
        }
      }
    }
    deduped.push(row);
  });
  rows = deduped;
  if (duplicateCount.removed > 0) {
    issues.push({ kind: 'duplicate', message: 'Removed ' + duplicateCount.removed + ' duplicate row' + (duplicateCount.removed === 1 ? '' : 's') + '.' });
  }

  // Outlier flagging (IQR, 1.5×). Values are flagged, never deleted.
  const stats: ColumnStat[] = [];
  let flaggedOutliers = 0;
  for (const { index, plan } of numericColumns) {
    const values = rows.map((row) => row[index]).filter((cell): cell is number => typeof cell === 'number');
    if (values.length === 0) {
      stats.push({ column: plan.canonical, count: 0, missing: rows.length, outliers: 0, mean: NaN, min: NaN, max: NaN });
      continue;
    }
    const missing = rows.length - values.length;
    const sorted = [...values].sort((a, b) => a - b);
    const q = (p: number) => {
      const position = (sorted.length - 1) * p;
      const low = Math.floor(position);
      return sorted[low] + (sorted[Math.min(low + 1, sorted.length - 1)] - sorted[low]) * (position - low);
    };
    const iqr = q(0.75) - q(0.25);
    let outliers = 0;
    if (iqr > 0) {
      const low = q(0.25) - 1.5 * iqr;
      const high = q(0.75) + 1.5 * iqr;
      rows.forEach((row, rowIndex) => {
        if (typeof row[index] === 'number') {
          const value = row[index] as number;
          if (value < low || value > high) {
            outliers++;
            issues.push({ kind: 'outlier', column: plan.canonical, row: rowIndex, message: 'Outlier ' + value + ' in ' + plan.canonical + ' (row ' + (rowIndex + 1) + ') flagged for review — not removed.' });
          }
        }
      });
    }
    flaggedOutliers += outliers;
    const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
    stats.push({ column: plan.canonical, count: sorted.length, missing, outliers, mean, min: sorted[0], max: sorted[sorted.length - 1] });
  }

  const outputColumns = plans.map((plan) => plan.canonical);
  const outputRows = rows.map((row) => row.map((cell) => (typeof cell === 'number' ? round(cell) : String(cell))));
  return {
    columns: outputColumns,
    rows: outputRows,
    inputRows,
    outputRows: outputRows.length,
    issues,
    stats,
    unitChanges,
    removedDuplicates: duplicateCount.removed,
    interpolatedCells,
    flaggedOutliers,
    missingCells,
  };
}

function targetUnitFor(kind: ColumnKind): string {
  switch (kind) {
    case 'temperature': return '°C';
    case 'pressure': return 'hPa';
    case 'wind': return 'm/s';
    case 'precip': return 'mm';
    case 'pm25': case 'pm10': case 'no2': case 'so2': case 'o3': return 'µg/m³';
    default: return '';
  }
}

function emptyResult(message: string): RefineryResult {
  return {
    columns: [], rows: [], inputRows: 0, outputRows: 0,
    issues: [{ kind: 'parse', message }], stats: [], unitChanges: [],
    removedDuplicates: 0, interpolatedCells: 0, flaggedOutliers: 0, missingCells: 0,
  };
}

export function toCleanedCsv(result: RefineryResult): string {
  const lines = [result.columns.map(quoteCsv).join(',')];
  for (const row of result.rows) lines.push(row.map(quoteCsv).join(','));
  return lines.join('\n');
}

function quoteCsv(value: string): string {
  return /[",\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
