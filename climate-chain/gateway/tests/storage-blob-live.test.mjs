// Runs the storage and chain-journal contract against a REAL Vercel Blob store. Skipped unless a token is present:
//   vercel env pull .env.production.local --environment production   (then export BLOB_READ_WRITE_TOKEN)
// Everything is written under a throwaway root and deleted afterwards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createBlobStorage } from '../storage.mjs';
import { createJournal } from '../chain-journal.mjs';

const token = process.env.BLOB_READ_WRITE_TOKEN;
const skip = !token && 'set BLOB_READ_WRITE_TOKEN to a private store token to run against real Vercel Blob';

test('real private Blob store: read-your-write, create-if-absent, listing and a verified journal', { skip, timeout: 120_000 }, async () => {
  const blob = await import('@vercel/blob');
  const root = `ci-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const storage = createBlobStorage({ token, blob, root, access: process.env.CLIMATE_CHAIN_BLOB_ACCESS || 'private' });
  try {
    assert.equal(await storage.get('evidence/ev-missing.json'), null, 'a missing key reads as null, not an error');
    await storage.put('evidence/ev-1.json', '{"v":1}');
    assert.equal(await storage.get('evidence/ev-1.json'), '{"v":1}');
    await storage.put('evidence/ev-1.json', '{"v":2}');
    assert.equal(await storage.get('evidence/ev-1.json'), '{"v":2}', 'an overwrite is visible immediately, never a cached older copy');
    assert.equal(await storage.putIfAbsent('journal/a.json', 'first'), true);
    assert.equal(await storage.putIfAbsent('journal/a.json', 'second'), false, 'a taken key reports false, not an exception');
    assert.equal(await storage.get('journal/a.json'), 'first');
    const racers = await Promise.all(Array.from({ length: 6 }, (_, i) => storage.putIfAbsent('journal/race.json', `writer-${i}`)));
    assert.equal(racers.filter(Boolean).length, 1, 'exactly one of six concurrent creators wins');
    assert.deepEqual((await storage.list('evidence/')), ['evidence/ev-1.json']);

    const journal = createJournal({ storage, scope: 'live' });
    let head = { seq: 0, hash: '0'.repeat(64), timestamp: 0 };
    for (let i = 1; i <= 3; i += 1) {
      const out = await journal.append(head, { timestamp: 1_800_000_000 + i, rawTx: `0x${i.toString(16).padStart(4, '0')}`, label: `live-${i}` });
      assert.equal(out.ok, true);
      head = out.head;
    }
    assert.equal((await createJournal({ storage, scope: 'live' }).append({ seq: 2, hash: 'f'.repeat(64), timestamp: 1 }, { timestamp: 1_800_000_009, rawTx: '0x99', label: 'late' })).conflict, true, 'a stale writer is refused');
    const loaded = await journal.load();
    assert.equal(loaded.entries.length, 3);
    assert.equal(loaded.head.hash, head.hash);
  } finally {
    const names = await storage.list('').catch(() => []);
    if (names.length) await blob.del(names.map((name) => `${root}/${name}`), { token });
  }
});
