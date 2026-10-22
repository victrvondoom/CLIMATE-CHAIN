import { describe, expect, it } from 'vitest';
import bundleDoc from '../fixtures/bundles-demo.json';
import { checkBundle } from './rehash';

// Each stored sha256 was computed by backend/app/evidence.py's canonical JSON (sort_keys, no spaces, UTF-8) and SHA-256.

const records = bundleDoc.records;

describe('evidence re-hash in the browser (core/evidence canonical JSON + SHA-256)', () => {
  it('recomputes the stored SHA-256 of every DEMO bundle', async () => {
    for (const r of records) {
      const check = await checkBundle(r);
      expect(check.ok, r.id).toBe(true);
      expect(check.computed).toBe(r.sha256);
    }
  });

  it('flags a bundle whose verified tonnes were edited after it was hashed', async () => {
    const r = records[0];
    const tampered = { ...r, payload: { ...(r.payload as Record<string, unknown>), verifiedTonnes: 99999 } };
    const check = await checkBundle(tampered);
    expect(check.ok).toBe(false);
    expect(check.computed).not.toBe(r.sha256);
  });

  it('is insensitive to key order, because the canonical form sorts keys', async () => {
    const r = records[1];
    const payload = r.payload as Record<string, unknown>;
    const reordered = Object.fromEntries(Object.entries(payload).reverse());
    const check = await checkBundle({ ...r, payload: reordered });
    expect(check.ok).toBe(true);
  });
});
