import test from 'node:test';
import assert from 'node:assert/strict';
import { JOURNAL_GENESIS, JournalError, createJournal, hashEntry, verifyJournal } from '../chain-journal.mjs';
import { createMemoryStorage } from '../storage.mjs';

const raw = (n) => `0x${n.toString(16).padStart(8, '0')}aa`;
const GENESIS = { seq: 0, hash: JOURNAL_GENESIS, timestamp: 0 };

async function fill(journal, count, start = 1_700_000_000) {
  let head = GENESIS;
  for (let i = 1; i <= count; i++) {
    const out = await journal.append(head, { timestamp: start + i * 3, rawTx: raw(i), label: `tx-${i}` });
    assert.equal(out.ok, true);
    head = out.head;
  }
  return head;
}

test('appended entries load back verified, in order, with a head that commits to all of them', async () => {
  const storage = createMemoryStorage();
  const journal = createJournal({ storage, scope: 'abc' });
  const head = await fill(journal, 5);
  const loaded = await journal.load();
  assert.equal(loaded.entries.length, 5);
  assert.deepEqual(loaded.entries.map((e) => e.seq), [1, 2, 3, 4, 5]);
  assert.deepEqual(loaded.head, { seq: 5, hash: head.hash, timestamp: head.timestamp });
  assert.equal(loaded.entries[0].prevHash, JOURNAL_GENESIS);
  assert.equal(loaded.entries[1].prevHash, loaded.entries[0].hash);
});

test('an empty journal is valid and starts at the genesis hash', async () => {
  const { entries, head } = await createJournal({ storage: createMemoryStorage(), scope: 'x' }).load();
  assert.deepEqual(entries, []);
  assert.deepEqual(head, GENESIS);
});

test('two instances racing for the same slot: exactly one wins, the loser is told to catch up', async () => {
  const storage = createMemoryStorage();
  const a = createJournal({ storage, scope: 's' });
  const b = createJournal({ storage, scope: 's' });
  const head = await fill(a, 2);
  const [first, second] = await Promise.all([
    a.append(head, { timestamp: 1_700_000_100, rawTx: raw(3), label: 'from-a' }),
    b.append(head, { timestamp: 1_700_000_101, rawTx: raw(4), label: 'from-b' }),
  ]);
  assert.equal([first, second].filter((r) => r.ok).length, 1);
  assert.equal([first, second].find((r) => !r.ok).conflict, true);
  const { entries } = await a.load();
  assert.equal(entries.length, 3);
  const caught = await b.since(2, head.hash, head.timestamp);
  assert.equal(caught.entries.length, 1);
  assert.equal(caught.head.seq, 3);
});

test('since() returns only what is new and refuses a head the shared journal no longer has', async () => {
  const storage = createMemoryStorage();
  const journal = createJournal({ storage, scope: 's' });
  const head = await fill(journal, 4);
  const idle = await journal.since(4, head.hash, head.timestamp);
  assert.equal(idle.entries.length, 0);
  assert.equal(idle.head, null, 'nothing new: the caller keeps its own head');
  const all = await journal.since(0, JOURNAL_GENESIS, 0);
  assert.equal(all.entries.length, 4);
  assert.equal(all.head.hash, head.hash);
  await assert.rejects(() => journal.since(3, 'f'.repeat(64), 0), (e) => e instanceof JournalError && e.code === 'journal_diverged' && e.status === 409);
  await assert.rejects(() => journal.since(9, head.hash, 0), (e) => e.code === 'journal_diverged', 'a journal shorter than the caller\'s copy is a divergence');
});

test('tampering is detected: edited transaction, forged link, deleted entry, reordered entries, backdated entry', async () => {
  const build = async () => {
    const storage = createMemoryStorage();
    const journal = createJournal({ storage, scope: 's' });
    await fill(journal, 4);
    return { storage, journal, key: (n) => `chain/s/journal/${String(n).padStart(8, '0')}.json` };
  };
  const edit = async (ctx, n, change) => ctx.storage.put(ctx.key(n), JSON.stringify(change(JSON.parse(await ctx.storage.get(ctx.key(n))))));

  let ctx = await build();
  await edit(ctx, 2, (e) => ({ ...e, rawTx: raw(99) }));
  await assert.rejects(() => ctx.journal.load(), (e) => e.code === 'journal_tampered');

  ctx = await build();
  await edit(ctx, 3, (e) => { const forged = { ...e, prevHash: 'a'.repeat(64) }; forged.hash = hashEntry(forged); return forged; });
  await assert.rejects(() => ctx.journal.load(), (e) => e.code === 'journal_broken_link');

  ctx = await build();
  const store = createMemoryStorage();
  for (const n of [1, 3, 4]) await store.put(ctx.key(n), await ctx.storage.get(ctx.key(n)));
  await assert.rejects(() => createJournal({ storage: store, scope: 's' }).load(), (e) => e.code === 'journal_gap');

  ctx = await build();
  const [one, two] = [await ctx.storage.get(ctx.key(1)), await ctx.storage.get(ctx.key(2))];
  await ctx.storage.put(ctx.key(1), two);
  await ctx.storage.put(ctx.key(2), one);
  await assert.rejects(() => ctx.journal.load(), (e) => e instanceof JournalError);

  ctx = await build();
  await edit(ctx, 3, (e) => { const early = { ...e, timestamp: 5 }; early.hash = hashEntry(early); return early; });
  await assert.rejects(() => ctx.journal.load(), (e) => ['journal_time_travel', 'journal_tampered', 'journal_broken_link'].includes(e.code));
});

test('verifyJournal pinpoints time travel when links and hashes are otherwise consistent', () => {
  const make = (seq, prevHash, timestamp) => { const e = { seq, prevHash, timestamp, rawTx: raw(seq), label: 'x' }; return { ...e, hash: hashEntry(e) }; };
  const one = make(1, JOURNAL_GENESIS, 2_000);
  const two = make(2, one.hash, 1_000);
  assert.throws(() => verifyJournal([one, two]), (e) => e.code === 'journal_time_travel');
  assert.deepEqual(verifyJournal([one, make(2, one.hash, 2_000)]).seq, 2);
});

test('malformed or corrupt entries fail loudly instead of being skipped', async () => {
  const storage = createMemoryStorage();
  await storage.put('chain/s/journal/00000001.json', '{not json');
  await assert.rejects(() => createJournal({ storage, scope: 's' }).load(), (e) => e.code === 'journal_corrupt');
  await storage.put('chain/s/journal/00000001.json', JSON.stringify({ seq: 1, rawTx: 'nope' }));
  await assert.rejects(() => createJournal({ storage, scope: 's' }).load(), (e) => e.code === 'journal_corrupt');
});

test('journals under different scopes never see each other', async () => {
  const storage = createMemoryStorage();
  await fill(createJournal({ storage, scope: 'one' }), 3);
  assert.equal((await createJournal({ storage, scope: 'two' }).load()).entries.length, 0);
  assert.equal((await createJournal({ storage, scope: 'one' }).load()).entries.length, 3);
});

test('labels are bounded so a hostile caller cannot bloat the shared journal', async () => {
  const journal = createJournal({ storage: createMemoryStorage(), scope: 's' });
  const out = await journal.append(GENESIS, { timestamp: 1_700_000_000, rawTx: raw(1), label: 'L'.repeat(5000) });
  assert.equal(out.entry.label.length, 64);
  assert.equal((await journal.load()).entries.length, 1);
});
