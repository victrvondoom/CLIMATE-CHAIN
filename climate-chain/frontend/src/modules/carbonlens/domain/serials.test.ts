import { describe, expect, it } from 'vitest';
import ledger from '../fixtures/ledger.json';
import { auditSerials, type LedgerEntry } from './serials';

const entry = (over: Partial<LedgerEntry> & Pick<LedgerEntry, 'project_id'>): LedgerEntry => ({
  claimed: 100,
  verified: 100,
  issued: 100,
  serial_start: 1,
  serial_end: 100,
  ...over,
});

describe('serial uniqueness over ledger.json', () => {
  it('passes every recorded entry of the ledger fixture', () => {
    const audit = auditSerials(ledger.entries);
    expect(audit.unique).toBe(true);
    expect(audit.entries.every((e) => e.issues.length === 0)).toBe(true);
  });

  it('reproduces the contract allocation from the Hardhat test vectors', () => {
    // test/CarbonRegistry.test.js: (100,100) -> 1..100, (50,60) -> 101..150, (30,30) -> 151..180
    const audit = auditSerials([
      entry({ project_id: 'CL-001', claimed: 100, verified: 100, issued: 100, serial_start: 1, serial_end: 100 }),
      entry({ project_id: 'CL-002', claimed: 50, verified: 60, issued: 50, serial_start: 101, serial_end: 150 }),
      entry({ project_id: 'CL-001', claimed: 30, verified: 30, issued: 30, serial_start: 151, serial_end: 180 }),
    ]);
    expect(audit.unique).toBe(true);
  });

  it('flags a serial range that overlaps an earlier one', () => {
    const audit = auditSerials([
      entry({ project_id: 'CL-001' }),
      entry({ project_id: 'CL-002', claimed: 31, verified: 31, issued: 31, serial_start: 90, serial_end: 120 }),
    ]);
    expect(audit.unique).toBe(false);
    expect(audit.entries[1].issues.some((i) => i.includes('also issued to CL-001'))).toBe(true);
  });

  it('flags a range that does not continue from nextSerial without calling it a duplicate', () => {
    const audit = auditSerials([
      entry({ project_id: 'CL-001' }),
      entry({ project_id: 'CL-002', claimed: 10, verified: 10, issued: 10, serial_start: 105, serial_end: 114 }),
    ]);
    expect(audit.unique).toBe(true);
    expect(audit.entries[1].issues).toEqual(['range starts at 105, expected 101 from nextSerial']);
  });

  it('flags a range whose length does not match the issued count', () => {
    const audit = auditSerials([entry({ project_id: 'CL-001', serial_end: 99 })]);
    expect(audit.entries[0].issues.join(' ')).toContain('does not hold 100 credits');
  });

  it('flags issuance above min(claimed, verified)', () => {
    const audit = auditSerials([entry({ project_id: 'CL-001', claimed: 100, verified: 90, issued: 100 })]);
    expect(audit.entries[0].issues.join(' ')).toContain('not min(claimed, verified) = 90');
  });

  it('requires a zero range when nothing was issued, and skips it in the sequence', () => {
    const audit = auditSerials([
      entry({ project_id: 'CL-003', claimed: 20000, verified: 0, issued: 0, serial_start: 0, serial_end: 0 }),
      entry({ project_id: 'CL-004', serial_start: 1, serial_end: 100 }),
    ]);
    expect(audit.unique).toBe(true);
    expect(audit.entries[0].issues).toEqual([]);
    expect(audit.entries[1].issues).toEqual([]);
  });
});
