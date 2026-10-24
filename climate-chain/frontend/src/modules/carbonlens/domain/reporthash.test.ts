import { describe, expect, it } from 'vitest';
import { hashValue } from '../../../core/evidence';
import ledger from '../fixtures/ledger.json';
import results from '../fixtures/results.json';
import { checkReportHashes, compareWithLedger, pythonJson, reportHash, type Report } from './reporthash';

const reports: Report[] = results.projects;

describe('pythonJson (canonical text as ml/verifier.py writes it)', () => {
  it('sorts keys, uses compact separators, and keeps .0 on float fields', () => {
    // json.dumps({"params": {"stock_t_per_ha": 550.0}, "b": [2, 3.5], "a": None}, sort_keys=True, separators=(",", ":"))
    expect(pythonJson({ params: { stock_t_per_ha: 550 }, b: [2, 3.5], a: null })).toBe(
      '{"a":null,"b":[2,3.5],"params":{"stock_t_per_ha":550.0}}',
    );
  });

  it('escapes non-ASCII characters the way json.dumps does by default', () => {
    expect(pythonJson({ name: 'Café' })).toBe('{"name":"Caf\\u00e9"}');
  });
});

describe('report hash', () => {
  it('reproduces the report_hash stored by ml/verifier.py for every project', async () => {
    const checks = await checkReportHashes(reports);
    expect(checks.map((c) => c.project_id)).toEqual(['CL-001', 'CL-002', 'CL-003', 'CL-004', 'CL-005']);
    expect(checks.every((c) => c.matches)).toBe(true);
  });

  it('changes when any field of the report changes', async () => {
    const tampered = { ...reports[0], verified_credits: Number(reports[0].verified_credits) + 1 };
    expect(await reportHash(tampered)).not.toBe(reports[0].report_hash);
  });

  it('documents why the shared hashValue cannot reproduce these hashes', async () => {
    // JSON.parse drops the ".0" that Python writes for integer-valued floats (params.seq_rate_t_per_ha_yr 8.0),
    // so the core canonicalJson text differs and the digest does not match the stored hash.
    const body = Object.fromEntries(Object.entries(reports[0]).filter(([key]) => key !== 'report_hash'));
    expect(await hashValue(body)).not.toBe(String(reports[0].report_hash).slice(2));
  });

  it('matches each ledger entry to the recomputed hash of its project report', async () => {
    const checks = await checkReportHashes(reports);
    const rows = compareWithLedger(ledger.entries, checks);
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.same)).toBe(true);
  });
});
