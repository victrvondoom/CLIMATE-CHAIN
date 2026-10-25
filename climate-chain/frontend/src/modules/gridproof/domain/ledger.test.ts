import { describe, expect, it } from 'vitest';
import { CertificateBook, allocateHour, decodeTokenId, tokenIdFor } from './ledger';

const DEVICE = { capacityW: 200_000 };
const NOW = 1_000; // the current hour: only hours before it may be certified

const reading = (hour: number, wh = 5_000, anomalyBps = 0) => ({ deviceId: 1, hour, wh, anomalyBps });

// Rules from WattCert contracts/contracts/GranularCertificate.sol (tokenIdFor, _checkReading,
// submitReadings, _retire, hourlyMatchBps, periodMatch).
describe('token id: one token per device-hour', () => {
  it('is deviceId shifted left 32 bits, OR the hour, as in the contract', () => {
    expect(tokenIdFor(1, 1_000_000)).toBe(4_295_967_296n);
    expect(tokenIdFor(4, 0)).toBe(17_179_869_184n);
    expect(decodeTokenId(tokenIdFor(3, 480_000))).toEqual({ deviceId: 3, hour: 480_000 });
  });
});

describe('mint once', () => {
  it('issues a certificate for a device-hour, then refuses a second one', () => {
    const book = new CertificateBook();
    expect(book.mint(reading(100), DEVICE, NOW)).toBe('issued');
    expect(() => book.mint(reading(100), DEVICE, NOW)).toThrow(/AlreadyRecorded/);
  });

  it('skips device-hours already on the book when a batch is sent again', () => {
    const book = new CertificateBook();
    book.submitBatch([reading(100), reading(101)], () => DEVICE, NOW);
    expect(book.submitBatch([reading(100), reading(101), reading(102)], () => DEVICE, NOW)).toEqual({
      issued: 1,
      quarantined: 0,
      skipped: 2,
    });
  });

  it('quarantines a reading at or above 7000 basis points and issues one below', () => {
    const book = new CertificateBook();
    expect(book.mint(reading(100, 5_000, 7_000), DEVICE, NOW)).toBe('quarantined');
    expect(book.mint(reading(101, 5_000, 6_999), DEVICE, NOW)).toBe('issued');
    expect(book.status(tokenIdFor(1, 100))).toBe('quarantined');
  });

  it('refuses a reading above the rated capacity of its device, and an hour not yet finished', () => {
    const book = new CertificateBook();
    expect(() => book.mint(reading(100, 200_001), DEVICE, NOW)).toThrow(/ExceedsCapacity/);
    expect(() => book.mint(reading(NOW), DEVICE, NOW)).toThrow(/FutureHour/);
  });
});

describe('retirement is by hour', () => {
  it('retires only issued certificates, no more than they hold, and credits the hour they were issued for', () => {
    const book = new CertificateBook();
    book.mint(reading(100, 1_000), DEVICE, NOW);
    book.retire(tokenIdFor(1, 100), 400, 'buyer');
    expect(book.matched('buyer', 100).matched).toBe(400);
    expect(book.matched('buyer', 101).matched).toBe(0);
    expect(book.balance(tokenIdFor(1, 100))).toBe(600);
    expect(() => book.retire(tokenIdFor(1, 100), 700, 'buyer')).toThrow(/insufficient/);
  });

  it('cannot retire a quarantined certificate, which is never minted', () => {
    const book = new CertificateBook();
    book.mint(reading(100, 1_000, 9_000), DEVICE, NOW);
    expect(() => book.retire(tokenIdFor(1, 100), 10, 'buyer')).toThrow(/not issued/);
  });

  it('reports the hourly match capped at 100 percent, and the period match capped per hour', () => {
    const book = new CertificateBook();
    book.mint(reading(100, 1_000), DEVICE, NOW);
    book.reportLoad('buyer', 100, 1_000);
    book.retire(tokenIdFor(1, 100), 400, 'buyer');
    expect(book.hourlyMatchBps('buyer', 100)).toBe(4_000);
    book.retire(tokenIdFor(1, 100), 600, 'buyer');
    expect(book.hourlyMatchBps('buyer', 100)).toBe(10_000);

    book.reportLoad('buyer', 101, 500);
    book.mint(reading(101, 1_000), DEVICE, NOW);
    book.retire(tokenIdFor(1, 101), 1_000, 'buyer');
    expect(book.hourlyMatchBps('buyer', 101)).toBe(10_000);
    expect(book.periodMatch('buyer', 100, 102)).toEqual({ totalLoadWh: 1_500, matchedCappedWh: 1_500 });
  });
});

describe('sharing one hour of supply between buyers', () => {
  it('splits a 100 Wh certificate in proportion to each buyer load, never more than its supply', () => {
    const shares = allocateHour([{ tokenId: 1n, wh: 100 }], { A: 60, B: 60 });
    expect(shares).toEqual([
      { tokenId: 1n, buyer: 'A', wh: 50 },
      { tokenId: 1n, buyer: 'B', wh: 50 },
    ]);
    expect(shares.reduce((s, x) => s + x.wh, 0)).toBe(100);
  });

  it('shares nothing when no buyer needs energy in that hour', () => {
    expect(allocateHour([{ tokenId: 1n, wh: 100 }], {})).toEqual([]);
    expect(allocateHour([{ tokenId: 1n, wh: 100 }], { A: 0 })).toEqual([]);
  });
});
