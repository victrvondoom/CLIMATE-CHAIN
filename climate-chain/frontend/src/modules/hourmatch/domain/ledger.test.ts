import { describe, expect, it } from 'vitest';
import { Ledger, LedgerError, certificateId, generatorOf, hourIndexOf, hourIso, hourOf } from './ledger';

// Rules ported from projects/hourmatch-master/src/ledger.mjs (a mirror of its Solidity registry).

function codeOf(action: () => unknown): string | 'ok' {
  try {
    action();
    return 'ok';
  } catch (error) {
    return error instanceof LedgerError ? error.code : 'unexpected';
  }
}

const FIRST = hourIndexOf('2026-10-06T00:00+08:00');

function ledgerWithPlant() {
  const ledger = new Ledger('operator');
  ledger.addIssuer('operator', 'issuer-a');
  ledger.addIssuer('operator', 'issuer-b');
  ledger.registerConsumer('operator', 'NORTHBAY-FAB', 'NORTHBAY-FAB');
  ledger.registerGenerator('issuer-a', 1, 'Sunfield Solar (fictional)', 'sunfield', 2021);
  ledger.issueBatch('issuer-a', 1, FIRST, [100, 200, 0]);
  return ledger;
}

describe('hour and certificate identifiers', () => {
  it('round-trips the Taiwan hour label and packs the plant into the high bits', () => {
    expect(hourIndexOf('2026-10-05T16:00:00Z')).toBe(FIRST);
    expect(hourIso(FIRST + 13n)).toBe('2026-10-06T13:00+08:00');
    const id = certificateId(2, FIRST + 5n);
    expect(generatorOf(id)).toBe(2);
    expect(hourOf(id)).toBe(FIRST + 5n);
  });
});

describe('issuance', () => {
  it('only the registered issuer of a plant can issue, and the plant owner holds the certificates', () => {
    const ledger = ledgerWithPlant();
    expect(ledger.balanceOf(certificateId(1, FIRST), 'sunfield')).toBe(100n);
    expect(codeOf(() => ledger.issueBatch('issuer-b', 1, FIRST + 3n, [5]))).toBe('NotGeneratorIssuer');
    expect(codeOf(() => ledger.issueBatch('nobody', 1, FIRST + 3n, [5]))).toBe('NotIssuer');
    expect(codeOf(() => ledger.issueBatch('issuer-a', 9, FIRST, [5]))).toBe('UnknownGenerator');
  });

  it('refuses to issue an hour twice, and a refused batch changes nothing', () => {
    const ledger = ledgerWithPlant();
    // FIRST+1 already holds 200 kWh, so this batch overlaps it and must be refused as a whole
    expect(codeOf(() => ledger.issueBatch('issuer-a', 1, FIRST + 1n, [7, 8]))).toBe('AlreadyIssued');
    expect(ledger.balanceOf(certificateId(1, FIRST + 2n), 'sunfield')).toBe(0n);
  });
});

describe('transfer once', () => {
  it('lets only the plant account move certificates, so a buyer cannot resell them', () => {
    const ledger = ledgerWithPlant();
    const id = certificateId(1, FIRST);
    ledger.transfer('sunfield', id, 'NORTHBAY-FAB', 60);
    expect(ledger.balanceOf(id, 'NORTHBAY-FAB')).toBe(60n);
    expect(codeOf(() => ledger.transfer('NORTHBAY-FAB', id, 'HARBOR-OFFICE', 10))).toBe('OnlyOneTransfer');
  });

  it('refuses a transfer larger than the balance', () => {
    const ledger = ledgerWithPlant();
    expect(codeOf(() => ledger.transfer('sunfield', certificateId(1, FIRST), 'NORTHBAY-FAB', 101))).toBe('InsufficientBalance');
  });
});

describe('retirement on one shared state', () => {
  it('lets only the consumer wallet retire, for the same hour, up to its unmatched use', () => {
    const ledger = ledgerWithPlant();
    ledger.recordConsumption('operator', 'NORTHBAY-FAB', FIRST, [120, 150, 0]);
    const id = certificateId(1, FIRST);
    const nextId = certificateId(1, FIRST + 1n);
    ledger.transfer('sunfield', id, 'NORTHBAY-FAB', 100);
    ledger.transfer('sunfield', nextId, 'NORTHBAY-FAB', 200);

    expect(codeOf(() => ledger.retire('HARBOR-OFFICE', id, 10, 'NORTHBAY-FAB', FIRST))).toBe('NotConsumerWallet');
    expect(codeOf(() => ledger.retire('NORTHBAY-FAB', id, 10, 'NORTHBAY-FAB', FIRST + 1n))).toBe('HourMismatch');
    expect(codeOf(() => ledger.retire('NORTHBAY-FAB', id, 110, 'NORTHBAY-FAB', FIRST))).toBe('InsufficientBalance');
    // balance 200 covers 160, but only 150 kWh of use is unmatched in that hour
    expect(codeOf(() => ledger.retire('NORTHBAY-FAB', nextId, 160, 'NORTHBAY-FAB', FIRST + 1n))).toBe('ExceedsUnmatchedConsumption');

    ledger.retire('NORTHBAY-FAB', id, 100, 'NORTHBAY-FAB', FIRST);
    expect(ledger.balanceOf(id, 'NORTHBAY-FAB')).toBe(0n);
    expect(ledger.hourly('NORTHBAY-FAB', FIRST, FIRST + 1n)).toEqual([{ hour: FIRST, consumed: 120n, matched: 100n }]);
    expect(codeOf(() => ledger.retire('NORTHBAY-FAB', id, 1, 'NORTHBAY-FAB', FIRST))).toBe('InsufficientBalance');
  });

  it('records each retirement as an event for the claim checker', () => {
    const ledger = ledgerWithPlant();
    ledger.recordConsumption('operator', 'NORTHBAY-FAB', FIRST, [120, 150, 0]);
    ledger.transfer('sunfield', certificateId(1, FIRST), 'NORTHBAY-FAB', 50);
    ledger.retire('NORTHBAY-FAB', certificateId(1, FIRST), 50, 'NORTHBAY-FAB', FIRST);
    const events = ledger.retirementsBy('NORTHBAY-FAB');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'Retired', consumer: 'NORTHBAY-FAB', kwh: 50n });
  });
});
