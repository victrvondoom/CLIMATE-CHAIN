// Port of the upload checks, the expected-hash check (verify-csv) and the integrity report
// (integrity-report) in ClimateProof-AI-main/app/main.py. Pure TypeScript. The SHA-256 digest itself
// is computed in the page, from the uploaded bytes, with WebCrypto.

import type { Analysis } from './analyze';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const CSV_ONLY_MESSAGE = 'Only .csv files are supported.';
const TOO_LARGE_MESSAGE = 'File exceeds the 5 MiB upload limit.';
const EMPTY_MESSAGE = 'Uploaded CSV is empty.';
const HASH_FORMAT_MESSAGE = 'Expected SHA-256 must contain exactly 64 hexadecimal characters.';

/** A file name and size check, done before the file is read. Returns the message, or null if it can go on. */
export function checkUpload(filename: string, size: number): string | null {
  if (!filename.toLowerCase().endsWith('.csv')) return CSV_ONLY_MESSAGE;
  if (size > MAX_UPLOAD_BYTES) return TOO_LARGE_MESSAGE;
  return null;
}

/** A file that is only whitespace is empty. Returns the message, or null. */
export function checkContent(text: string): string | null {
  return text.trim() === '' ? EMPTY_MESSAGE : null;
}

export type HashCheck = { readonly ok: true; readonly hash: string } | { readonly ok: false; readonly message: string };

/** An expected SHA-256 as 64 lower-case hex characters, or the reason it is refused. */
export function normalizeExpectedHash(raw: string): HashCheck {
  const hash = raw.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) return { ok: false, message: HASH_FORMAT_MESSAGE };
  return { ok: true, hash };
}

/** Whether the file's digest is the expected one. Both are compared in lower case. */
export function hashesMatch(expected: string, actual: string): boolean {
  return expected.trim().toLowerCase() === actual.trim().toLowerCase();
}

export interface IntegrityReport {
  readonly report_version: '1.0';
  readonly filename: string;
  readonly dataset: { readonly sha256: string; readonly row_count: number; readonly columns: string[] };
  readonly integrity: {
    readonly fingerprint_algorithm: 'SHA-256';
    readonly fingerprint_available: true;
    readonly verification_status: 'not_verified';
    readonly verification_note: string;
  };
  readonly quality: {
    readonly missing_values: Record<string, number>;
    readonly duplicate_rows: number;
    readonly invalid_timestamps: number;
    readonly invalid_numeric_values: Record<string, number>;
    readonly domain_violations: Record<string, number>;
    readonly numeric_summary: Analysis['numeric_summary'];
    readonly anomaly_counts: Record<string, number>;
  };
  readonly warnings: string[];
  readonly limitations: string[];
}

/** The integrity report. It never claims the file is verified, because no trusted hash was given. */
export function buildIntegrityReport(input: {
  readonly filename: string;
  readonly sha256: string;
  readonly analysis: Analysis;
}): IntegrityReport {
  const { analysis } = input;
  return {
    report_version: '1.0',
    filename: input.filename,
    dataset: { sha256: input.sha256, row_count: analysis.row_count, columns: analysis.columns },
    integrity: {
      fingerprint_algorithm: 'SHA-256',
      fingerprint_available: true,
      verification_status: 'not_verified',
      verification_note:
        'No trusted expected hash was provided. The fingerprint identifies these uploaded bytes but does not prove their origin or authenticity.',
    },
    quality: {
      missing_values: analysis.missing_values,
      duplicate_rows: analysis.duplicate_rows,
      invalid_timestamps: analysis.invalid_timestamps,
      invalid_numeric_values: analysis.invalid_numeric_values,
      domain_violations: analysis.domain_violations,
      numeric_summary: analysis.numeric_summary,
      anomaly_counts: analysis.anomaly_counts,
    },
    warnings: analysis.warnings,
    limitations: [
      'Statistical outliers are not proof of fraud.',
      'Domain violations depend on configured constraints.',
      'SHA-256 alone does not prove source authenticity.',
    ],
  };
}
