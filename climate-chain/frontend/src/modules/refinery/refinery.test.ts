import { describe, expect, it } from 'vitest';
import { parseCsv, refineCsv, sha256Hex, toCleanedCsv } from './refinery';

const MESSY_CSV = [
  'date,time,temperature_f,pm2.5,no2_ppb,wind_kmph,notes',
  '12/31/2023,09:00,32.0,55.1,20.5,12.4,cold snap',
  '12/31/2023,09:00,32.0,55.1,20.5,12.4,cold snap',
  '01/01/2024,10:30,33.8,60.0,NA,15.0,new year',
  '01/02/2024,11:00,35.06,72.3,25.0,NA,',
  '01/03/2024,12:00,-17.8,9999,18.0,10.0,sensor fault',
].join('\n');

describe('parseCsv', () => {
  it('handles quoted fields and embedded delimiters', () => {
    const rows = parseCsv('a,b\n"x,1",2');
    expect(rows).toEqual([['a', 'b'], ['x,1', '2']]);
  });

  it('detects semicolon delimiters', () => {
    const rows = parseCsv('a;b\n1;2');
    expect(rows).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('refineCsv', () => {
  it('normalizes dates, merges time columns and converts units', () => {
    const result = refineCsv(MESSY_CSV);
    expect(result.columns).toEqual(['timestamp', 'temperature_c', 'pm25_ugm3', 'no2_ugm3', 'wind_ms', 'notes']);
    // 12/31/2023 09:00 → ISO with merged time column.
    expect(result.rows[0][0]).toBe('2023-12-31T09:00:00');
    // 32 °F → 0 °C.
    expect(result.rows[0][1]).toBe('0');
    // 33.8 °F → 1 °C.
    expect(result.rows[1][1]).toBe('1');
    // NO2 20.5 ppb → 38.54 µg/m³ (×1.88).
    expect(result.rows[0][3]).toBe('38.54');
    // wind 12.4 km/h → 3.4444 m/s.
    expect(result.rows[0][4]).toBe('3.4444');
    expect(result.unitChanges).toContainEqual({ column: 'temperature_c', from: '°F', to: '°C' });
    expect(result.unitChanges).toContainEqual({ column: 'no2_ugm3', from: 'ppb', to: 'µg/m³' });
    expect(result.unitChanges).toContainEqual({ column: 'wind_ms', from: 'km/h', to: 'm/s' });
  });

  it('removes exact duplicate rows', () => {
    const result = refineCsv(MESSY_CSV);
    expect(result.removedDuplicates).toBe(1);
    expect(result.outputRows).toBe(4);
  });

  it('counts missing cells and interpolates interior numeric gaps', () => {
    const result = refineCsv(MESSY_CSV);
    expect(result.missingCells).toBe(3); // NA NO2 + NA wind + blank notes
    // NO2 gap (between 20.5 and 25.0) and wind gap (between 15.0 and 10.0)
    // are both interior and get linearly interpolated.
    expect(result.interpolatedCells).toBe(2);
  });

  it('flags outliers with IQR instead of deleting them', () => {
    const result = refineCsv(MESSY_CSV);
    expect(result.flaggedOutliers).toBeGreaterThan(0);
    const pm25Stats = result.stats.find((stat) => stat.column === 'pm25_ugm3');
    expect(pm25Stats?.outliers).toBe(1); // 9999 sensor fault
    // The outlier row survives: 4 rows out, including the flagged one.
    expect(result.rows[3][2]).toBe('9999');
  });

  it('detects day-first dates when the first component exceeds 12', () => {
    const result = refineCsv('date,value\n31/12/2023,1\n01/01/2024,2');
    expect(result.rows[0][0]).toBe('2023-12-31');
    expect(result.rows[1][0]).toBe('2024-01-01');
  });

  it('accepts JSON input and flattens it to a table', () => {
    const result = refineCsv('[{"date":"2024-01-01","pm2.5":40.2},{"date":"2024-01-02","pm2.5":41.5}]');
    expect(result.issues.some((issue) => issue.message.includes('JSON'))).toBe(true);
    expect(result.outputRows).toBe(2);
    expect(result.rows[0][0]).toBe('2024-01-01');
  });

  it('reports a clear issue for empty input', () => {
    const result = refineCsv('   ');
    expect(result.outputRows).toBe(0);
    expect(result.issues[0].message).toContain('Paste a CSV or JSON dataset');
  });

  it('never interpolates edge gaps', () => {
    const csv = 'date,value\n2024-01-01,NA\n2024-01-02,10\n2024-01-03,NA';
    const result = refineCsv(csv);
    expect(result.interpolatedCells).toBe(0);
    expect(result.rows[0][1]).toBe('');
    expect(result.rows[2][1]).toBe('');
  });
});

describe('toCleanedCsv', () => {
  it('round-trips the cleaned table as CSV', () => {
    const result = refineCsv(MESSY_CSV);
    const csv = toCleanedCsv(result);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('timestamp,temperature_c,pm25_ugm3,no2_ugm3,wind_ms,notes');
    expect(lines[1].startsWith('2023-12-31T09:00:00')).toBe(true);
  });
});

describe('sha256Hex', () => {
  it('produces the known SHA-256 digest', async () => {
    expect(await sha256Hex('a')).toBe('ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
  });
});
