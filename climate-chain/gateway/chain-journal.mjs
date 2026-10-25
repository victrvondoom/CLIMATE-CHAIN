// The chain journal: an append-only, hash-linked record of every transaction the in-process chain has mined.
//
// A serverless function cannot keep an EVM alive between requests, so the chain is rebuilt from this journal on
// a cold start. Each entry stores the signed raw transaction and the block timestamp it was mined with. Replaying
// the entries in order, with those timestamps, on a fresh chain that has the same funded accounts reproduces the
// same state, block hashes and receipts. The journal is tamper-evident twice over: every entry commits to the one
// before it, and every transaction carries its sender's signature, so nobody can add or alter a transaction
// without the sender's key.
//
// Concurrency: two serverless instances can race to mine the next transaction. Entry N is created with
// putIfAbsent, so exactly one wins and the loser is told to replay what it missed and retry.
import { createHash } from 'node:crypto';

export const JOURNAL_GENESIS = '0'.repeat(64);

export class JournalError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = 'JournalError';
    this.code = code;
    this.status = status;
  }
}

const pad = (seq) => String(seq).padStart(8, '0');

export function hashEntry({ seq, prevHash, timestamp, rawTx, label }) {
  return createHash('sha256').update(`climate-chain-journal-v1|${seq}|${prevHash}|${timestamp}|${rawTx}|${label}`).digest('hex');
}

function parseEntry(text, key) {
  let entry;
  try { entry = JSON.parse(text); } catch { throw new JournalError('journal_corrupt', `Journal entry ${key} is not valid JSON.`, 500); }
  const ok = entry && Number.isInteger(entry.seq) && entry.seq > 0 && /^[0-9a-f]{64}$/.test(entry.prevHash ?? '')
    && Number.isInteger(entry.timestamp) && entry.timestamp > 0 && /^0x[0-9a-fA-F]+$/.test(entry.rawTx ?? '')
    && typeof entry.label === 'string' && /^[0-9a-f]{64}$/.test(entry.hash ?? '');
  if (!ok) throw new JournalError('journal_corrupt', `Journal entry ${key} is malformed.`, 500);
  // An entry must sit in its own slot: copying one file over another is a rewrite, not a reorder.
  if (!key.endsWith(`/${pad(entry.seq)}.json`)) throw new JournalError('journal_tampered', `Journal entry ${key} holds entry ${entry.seq}.`, 500);
  return entry;
}

const EMPTY_HEAD = Object.freeze({ seq: 0, hash: JOURNAL_GENESIS, timestamp: 0 });
const FETCH_CONCURRENCY = 12;

/**
 * Checks sequence, links, hashes and timestamp order of `entries`, which must continue from `from` (the whole
 * journal when omitted). Returns the new head, or throws naming the first bad entry.
 */
export function verifyJournal(entries, from = EMPTY_HEAD) {
  let prevHash = from.hash;
  let prevTime = from.timestamp;
  entries.forEach((entry, index) => {
    if (entry.seq !== from.seq + index + 1) throw new JournalError('journal_gap', `Journal is missing entry ${from.seq + index + 1}.`, 500);
    if (entry.prevHash !== prevHash) throw new JournalError('journal_broken_link', `Journal entry ${entry.seq} does not follow entry ${entry.seq - 1}.`, 500);
    if (hashEntry(entry) !== entry.hash) throw new JournalError('journal_tampered', `Journal entry ${entry.seq} does not match its hash.`, 500);
    if (entry.timestamp < prevTime) throw new JournalError('journal_time_travel', `Journal entry ${entry.seq} is dated before the entry before it.`, 500);
    prevHash = entry.hash;
    prevTime = entry.timestamp;
  });
  return { seq: from.seq + entries.length, hash: prevHash, timestamp: prevTime };
}

/** `scope` separates independent chains in one store, e.g. the genesis fingerprint. */
export function createJournal({ storage, scope }) {
  if (!storage) throw new JournalError('journal_unconfigured', 'A journal needs a storage backend.', 500);
  const folder = `chain/${scope}/journal/`;
  const keyFor = (seq) => `${folder}${pad(seq)}.json`;

  // One listing call, then only the entries asked for. Storage round trips are the expensive part (a hosted
  // store answers in hundreds of milliseconds), so nothing already known is ever fetched again.
  async function slots() {
    const keys = (await storage.list(folder)).filter((key) => key.endsWith('.json'));
    return keys.map((key) => ({ key, seq: Number(/\/(\d{8})\.json$/.exec(key)?.[1] ?? NaN) }))
      .filter((slot) => Number.isInteger(slot.seq)).sort((a, b) => a.seq - b.seq);
  }

  async function fetchEntries(items) {
    const entries = new Array(items.length);
    let next = 0;
    const worker = async () => {
      for (let i = next++; i < items.length; i = next++) {
        const text = await storage.get(items[i].key);
        if (text === null) throw new JournalError('journal_gap', `Journal entry ${items[i].key} disappeared while it was being read.`, 503);
        entries[i] = parseEntry(text, items[i].key);
      }
    };
    await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, items.length) }, worker));
    return entries;
  }

  return {
    /** Every entry, verified. */
    async load() {
      const entries = await fetchEntries(await slots());
      return { entries, head: verifyJournal(entries) };
    },
    /**
     * Entries after `afterSeq`, verified as a continuation of `afterHash`. When nothing is new this is one
     * listing call and `head` is null: the caller keeps the head it has.
     */
    async since(afterSeq, afterHash, afterTimestamp = 0) {
      const all = await slots();
      const newest = all.length ? all[all.length - 1].seq : 0;
      if (newest < afterSeq) throw new JournalError('journal_diverged', 'The shared journal is shorter than this instance\'s copy. Rebuilding from the journal.', 409);
      if (newest === afterSeq) return { entries: [], head: null };
      const fresh = await fetchEntries(all.filter((slot) => slot.seq > afterSeq));
      if (fresh[0].prevHash !== afterHash) throw new JournalError('journal_diverged', 'The shared journal no longer matches this instance. Rebuilding from the journal.', 409);
      return { entries: fresh, head: verifyJournal(fresh, { seq: afterSeq, hash: afterHash, timestamp: afterTimestamp }) };
    },
    /** Appends entry head.seq + 1. Returns { ok: false, conflict: true } when another instance took that slot first. */
    async append(head, { timestamp, rawTx, label }) {
      const entry = { seq: head.seq + 1, prevHash: head.hash, timestamp, rawTx, label: String(label ?? 'tx').slice(0, 64) };
      entry.hash = hashEntry(entry);
      const created = await storage.putIfAbsent(keyFor(entry.seq), JSON.stringify(entry));
      return created ? { ok: true, entry, head: { seq: entry.seq, hash: entry.hash, timestamp } } : { ok: false, conflict: true };
    },
  };
}
