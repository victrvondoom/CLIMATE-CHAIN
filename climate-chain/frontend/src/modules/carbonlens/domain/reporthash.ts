import { sha256Hex } from '../../../core/evidence';

// ml/verifier.py hashes the report dict, without report_hash, as
// json.dumps(report, sort_keys=True, separators=(",", ":")) and stores "0x" + sha256.
// Python writes a float with integer value as "8.0", while JSON.parse and JSON.stringify
// give "8", so core/evidence hashValue cannot reproduce these hashes. The paths below are
// the report fields that verifier.py builds as floats.
const FLOAT_FIELDS = new Set([
  'forest_frac',
  'overclaim_ratio',
  'measured.baseline_forest_pct',
  'measured.current_forest_pct',
  'measured.current_forest_ci95_pct',
  'measured.verified_forest_ha',
  'measured.forest_loss_ha',
  'params.seq_rate_t_per_ha_yr',
  'params.stock_t_per_ha',
  'params.overclaim_flag',
  'params.pixel_ha',
]);

export type Report = Record<string, unknown>;

function asciiString(text: string): string {
  return JSON.stringify(text).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

// Canonical text as Python's json.dumps(sort_keys=True, separators=(",", ":")) writes it.
// Exponent forms are not handled: no value in the report is below 1e-4 or above 1e16.
export function pythonJson(value: unknown, path = ''): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`cannot canonicalise ${value} at ${path}`);
    return FLOAT_FIELDS.has(path) && Number.isInteger(value) ? `${value}.0` : String(value);
  }
  if (typeof value === 'string') return asciiString(value);
  if (Array.isArray(value)) return `[${value.map((item) => pythonJson(item, path)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const parts = Object.keys(record)
    .sort()
    .map((key) => `${asciiString(key)}:${pythonJson(record[key], path ? `${path}.${key}` : key)}`);
  return `{${parts.join(',')}}`;
}

export function bodyOf(report: Report): Report {
  return Object.fromEntries(Object.entries(report).filter(([key]) => key !== 'report_hash'));
}

export async function reportHash(report: Report): Promise<string> {
  return `0x${await sha256Hex(pythonJson(bodyOf(report)))}`;
}

export interface HashCheck {
  project_id: string;
  stored: string;
  recomputed: string;
  matches: boolean;
}

export async function checkReportHashes(reports: readonly Report[]): Promise<HashCheck[]> {
  return Promise.all(
    reports.map(async (report) => {
      const recomputed = await reportHash(report);
      const stored = String(report.report_hash);
      return { project_id: String(report.project_id), stored, recomputed, matches: recomputed === stored };
    }),
  );
}

export interface LedgerHashRow {
  project_id: string;
  ledger_hash: string;
  recomputed: string | null;
  same: boolean;
}

// The ledger records the report hash that was anchored on chain. Each row says whether that
// anchored hash equals the hash recomputed from the report of the same project.
export function compareWithLedger(
  entries: readonly { project_id: string; report_hash: string }[],
  checks: readonly HashCheck[],
): LedgerHashRow[] {
  return entries.map((entry) => {
    const check = checks.find((c) => c.project_id === entry.project_id);
    const recomputed = check ? check.recomputed : null;
    return { project_id: entry.project_id, ledger_hash: entry.report_hash, recomputed, same: recomputed === entry.report_hash };
  });
}
