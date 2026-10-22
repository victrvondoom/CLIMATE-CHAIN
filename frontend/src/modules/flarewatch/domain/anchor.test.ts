import { describe, expect, it } from 'vitest';
import { hashValue } from '../../../core/evidence';
import { DAY_FILES, INDEX } from '../data';
import { checkAnchor, reconcileAnchor } from './anchor';

const anchored = (day: string) => INDEX.days.find((x) => x.day === day)?.sha256 ?? '';

// The anchor is the SHA-256 of the file bytes (web/app.js sha256OfUrl, pipeline/common.mjs sha256).
describe('write-once SHA-256 of each night', () => {
  it('hashes each day file to the digest the project anchored for it', async () => {
    for (const d of DAY_FILES) {
      expect(anchored(d.day)).toMatch(/^[0-9a-f]{64}$/);
      const result = await checkAnchor(d.raw, anchored(d.day));
      expect(result.match).toBe(true);
      expect(result.computed).toBe(anchored(d.day));
    }
  });

  it('fails when one byte of the file changes', async () => {
    const d = DAY_FILES[0];
    expect((await checkAnchor(`${d.raw} `, anchored(d.day))).match).toBe(false);
  });

  it('is not the canonical-JSON hash, so the check must use the raw bytes', async () => {
    const d = DAY_FILES[0];
    expect(await hashValue(JSON.parse(d.raw))).not.toBe(anchored(d.day));
  });

  it('records an anchor once, reports it unchanged, and reports a later mismatch', () => {
    expect(reconcileAnchor(null, 'abc')).toBe('record');
    expect(reconcileAnchor('abc', 'abc')).toBe('unchanged');
    expect(reconcileAnchor('abc', 'def')).toBe('mismatch');
  });
});
