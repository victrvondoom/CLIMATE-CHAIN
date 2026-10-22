import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { analyzeTable } from './analyze';
import {
  MAX_UPLOAD_BYTES,
  buildIntegrityReport,
  checkContent,
  checkUpload,
  hashesMatch,
  normalizeExpectedHash,
} from './integrity';

// Messages and limits are those in app/main.py: .csv only (415), 5 MiB (413), 64 hex characters
// for an expected hash (422), and the integrity report fields (report_version 1.0).

const SAMPLE_CSV = `timestamp,location,temperature_c,humidity_pct,pm25,source_id
2026-10-01T10:00:00Z,Skardu,18.5,42,12.1,sensor-01
2026-10-01T11:00:00Z,Skardu,19.0,40,13.0,sensor-01
`;

const HASH = 'a'.repeat(64);

describe('upload checks (app/main.py)', () => {
  it('uses a 5 MiB limit', () => {
    expect(MAX_UPLOAD_BYTES).toBe(5 * 1024 * 1024);
  });

  it('refuses a file that is not a .csv', () => {
    expect(checkUpload('sample.txt', 5)).toBe('Only .csv files are supported.');
  });

  it('accepts a .csv name in any case', () => {
    expect(checkUpload('SAMPLE.CSV', 5)).toBeNull();
  });

  it('refuses a file over 5 MiB', () => {
    expect(checkUpload('large.csv', 5 * 1024 * 1024 + 1)).toBe('File exceeds the 5 MiB upload limit.');
    expect(checkUpload('edge.csv', 5 * 1024 * 1024)).toBeNull();
  });

  it('refuses a file that holds only whitespace', () => {
    expect(checkContent(' \n\t ')).toBe('Uploaded CSV is empty.');
    expect(checkContent('a,b\n')).toBeNull();
  });
});

describe('expected SHA-256 (verify-csv)', () => {
  it('accepts 64 hex characters and ignores case and surrounding spaces', () => {
    expect(normalizeExpectedHash(`  ${HASH.toUpperCase()}  `)).toEqual({ ok: true, hash: HASH });
  });

  it('refuses anything that is not 64 hex characters', () => {
    expect(normalizeExpectedHash('not-a-valid-hash')).toEqual({
      ok: false,
      message: 'Expected SHA-256 must contain exactly 64 hexadecimal characters.',
    });
    expect(normalizeExpectedHash('g'.repeat(64)).ok).toBe(false);
  });

  it('says whether the file bytes match the expected hash', () => {
    expect(hashesMatch(HASH, HASH)).toBe(true);
    expect(hashesMatch(HASH, 'b'.repeat(64))).toBe(false);
  });
});

describe('integrity report (integrity-report)', () => {
  const analysis = analyzeTable(parseCsv(SAMPLE_CSV), 'sample.csv');
  const report = buildIntegrityReport({ filename: 'sample.csv', sha256: HASH, analysis });

  it('has the version, dataset and quality fields the API returns', () => {
    expect(report.report_version).toBe('1.0');
    expect(report.dataset).toEqual({ sha256: HASH, row_count: 2, columns: analysis.columns });
    expect(report.quality.invalid_timestamps).toBe(0);
    expect(report.quality.missing_values).toEqual(analysis.missing_values);
  });

  it('never claims verification without an expected hash', () => {
    expect(report.integrity.verification_status).toBe('not_verified');
    expect(report.integrity.fingerprint_algorithm).toBe('SHA-256');
  });

  it('lists the three limitations', () => {
    expect(report.limitations).toHaveLength(3);
    expect(report.limitations).toContain('Statistical outliers are not proof of fraud.');
  });
});
