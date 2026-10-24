import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendLedger,
  canonicalJson,
  createEvidence,
  hashValue,
  readLedger,
  sha256Hex,
  verifyEvidence,
} from './evidence';

const sample = (summary: string) => createEvidence({
  moduleId: 'flarewatch',
  kind: 'night-anchor',
  mode: 'DEMO',
  summary,
  payload: { day: '2026-10-15', detections: 3 },
});

describe('canonical hashing', () => {
  it('sorts keys so equal data produces the same text and digest', async () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(await hashValue({ b: 1, a: 2 })).toBe(await hashValue({ a: 2, b: 1 }));
  });

  it('matches the SHA-256 test vector for "abc"', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('evidence records', () => {
  it('creates a record whose digest verifies, and detects a changed payload', async () => {
    const record = await sample('night anchored');
    expect(record.id).toBeTruthy();
    expect(record.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await verifyEvidence(record)).toBe(true);
    expect(await verifyEvidence({ ...record, payload: { day: '2026-10-15', detections: 4 } })).toBe(false);
  });
});

describe('ledger storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns an empty ledger when storage is not available', () => {
    expect(readLedger()).toEqual([]);
  });

  it('keeps the newest record first', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const first = await sample('first');
    const second = await sample('second');
    expect(appendLedger(first)).toBe(true);
    expect(appendLedger(second)).toBe(true);
    expect(readLedger().map((record) => record.id)).toEqual([second.id, first.id]);
  });

  it('reports a failed write instead of throwing', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
    });
    expect(appendLedger(await sample('blocked'))).toBe(false);
  });

  it('treats corrupt stored JSON as an empty ledger', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{not json', setItem: () => {} });
    expect(readLedger()).toEqual([]);
  });
});
