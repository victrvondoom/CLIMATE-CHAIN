import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { analyzeTable, MissingColumnsError } from './analyze';

// Expected values are the assertions in tests/test_api.py of ClimateProof-AI-main, and the rules
// are those of analyze_dataframe in app/main.py.

const HEADER = 'timestamp,location,temperature_c,humidity_pct,pm25,source_id';

const SAMPLE_CSV = `timestamp,location,temperature_c,humidity_pct,pm25,source_id
2026-10-01T10:00:00Z,Skardu,18.5,42,12.1,sensor-01
2026-10-01T11:00:00Z,Skardu,19.0,40,13.0,sensor-01
2026-10-01T12:00:00Z,Skardu,21.0,38,14.0,sensor-01
2026-10-01T13:00:00Z,Skardu,20.0,39,15.0,sensor-01
2026-10-01T14:00:00Z,Skardu,19.5,40,65.0,sensor-01
`;

const run = (csv: string) => analyzeTable(parseCsv(csv), 'test.csv');

const row = (overrides: Partial<Record<'ts' | 'loc' | 't' | 'h' | 'pm' | 'src', string>> = {}): string => {
  const v = { ts: '2026-10-01T10:00:00Z', loc: 'Skardu', t: '18.5', h: '42', pm: '12', src: 'sensor-01', ...overrides };
  return `${v.ts},${v.loc},${v.t},${v.h},${v.pm},${v.src}`;
};

describe('analyzeTable (test_api.py sample)', () => {
  it('summarises the sample the way the API test expects', () => {
    const result = run(SAMPLE_CSV);
    expect(result.row_count).toBe(5);
    expect(result.missing_values.temperature_c).toBe(0);
    expect(result.invalid_timestamps).toBe(0);
    expect(result.numeric_summary.temperature_c.mean).toBe(19.6);
    expect(result.anomaly_counts.pm25).toBe(1);
    expect(result.domain_violations.humidity_pct).toBe(0);
    expect(result.domain_violations.pm25).toBe(0);
    expect(result.note).toContain('establishes fraud');
  });

  it('lists the columns in file order', () => {
    expect(run(SAMPLE_CSV).columns).toEqual(HEADER.split(','));
  });

  it('says so when no check raised a warning', () => {
    expect(run(SAMPLE_CSV).warnings).toEqual([
      'No parsing, domain, or duplicate-row warnings detected by these checks.',
    ]);
  });
});

describe('required columns', () => {
  it('names every missing required column, sorted', () => {
    const csv = 'timestamp,location,temperature_c\n2026-10-01T10:00:00Z,Skardu,18.5\n';
    expect(() => run(csv)).toThrow(MissingColumnsError);
    expect(() => run(csv)).toThrow('Missing required columns: humidity_pct, pm25, source_id');
  });
});

describe('domain ranges', () => {
  it('counts humidity outside 0 to 100', () => {
    const result = run(`${HEADER}\n${row({ h: '150' })}\n${row({ h: '-5' })}\n`);
    expect(result.domain_violations.humidity_pct).toBe(2);
  });

  it('counts a negative PM2.5', () => {
    expect(run(`${HEADER}\n${row({ pm: '-1' })}\n`).domain_violations.pm25).toBe(1);
  });
});

describe('numeric values', () => {
  it('counts an unparseable temperature as invalid, not as a number', () => {
    const result = run(`${HEADER}\n${row({ t: 'unknown' })}\n`);
    expect(result.invalid_numeric_values.temperature_c).toBe(1);
    expect(result.numeric_summary.temperature_c.count).toBe(0);
    expect(result.warnings).toContain('temperature_c: 1 value(s) are invalid, unparseable, or non-finite.');
  });

  it('counts an infinite value as invalid', () => {
    expect(run(`${HEADER}\n${row({ pm: 'inf' })}\n`).invalid_numeric_values.pm25).toBe(1);
  });

  it('treats NA and null as missing, not as invalid', () => {
    const result = run(`${HEADER}\n${row({ pm: 'NA' })}\n`);
    expect(result.missing_values.pm25).toBe(1);
    expect(result.invalid_numeric_values.pm25).toBe(0);
  });

  it('reports a column with no numbers as count 0 with no mean', () => {
    const result = run(`${HEADER}\n${row({ pm: 'x' })}\n`);
    expect(result.numeric_summary.pm25).toEqual({ count: 0, mean: null, min: null, max: null, std: null });
    expect(result.anomaly_counts.pm25).toBe(0);
  });

  it('uses the sample standard deviation (n minus 1), rounded to 4 places', () => {
    const csv = `${HEADER}\n${[1, 2, 3, 4, 5].map((v) => row({ pm: String(v) })).join('\n')}\n`;
    expect(run(csv).numeric_summary.pm25.std).toBe(1.5811);
  });
});

describe('timestamps', () => {
  it('counts an unparseable timestamp', () => {
    const result = run(`${HEADER}\n${row({ ts: 'not-a-date' })}\n`);
    expect(result.invalid_timestamps).toBe(1);
    expect(result.warnings).toContain('timestamp: 1 value(s) could not be parsed as timestamps.');
  });
});

describe('blank location and source_id', () => {
  it('counts an empty location and source_id as missing', () => {
    const result = run(`${HEADER}\n${row({ loc: '', src: '' })}\n`);
    expect(result.missing_values.location).toBe(1);
    expect(result.missing_values.source_id).toBe(1);
  });

  it('counts a whitespace-only location and source_id as missing', () => {
    const result = run(`${HEADER}\n${row({ loc: '   ', src: '   ' })}\n`);
    expect(result.missing_values.location).toBe(1);
    expect(result.missing_values.source_id).toBe(1);
  });
});

describe('duplicates', () => {
  it('counts a repeated row once as a duplicate and warns', () => {
    const result = run(`${HEADER}\n${row()}\n${row()}\n`);
    expect(result.duplicate_rows).toBe(1);
    expect(result.warnings).toContain('Found 1 duplicate row(s).');
  });
});

describe('IQR outlier signals', () => {
  it('flags the value that differs from the quartile when the IQR is zero', () => {
    const csv = `${HEADER}\n${[10, 10, 10, 10, 50].map((v) => row({ pm: String(v) })).join('\n')}\n`;
    expect(run(csv).anomaly_counts.pm25).toBe(1);
  });

  it('uses linear interpolation for the quartiles, so 100 is above the upper fence of 7', () => {
    const csv = `${HEADER}\n${[1, 2, 3, 4, 100].map((v) => row({ pm: String(v) })).join('\n')}\n`;
    expect(run(csv).anomaly_counts.pm25).toBe(1);
  });

  it('flags nothing in an evenly spread column', () => {
    const csv = `${HEADER}\n${[1, 2, 3, 4, 5].map((v) => row({ pm: String(v) })).join('\n')}\n`;
    expect(run(csv).anomaly_counts.pm25).toBe(0);
  });
});
