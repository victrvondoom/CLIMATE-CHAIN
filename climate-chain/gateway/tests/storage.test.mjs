import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageError, checkKey, createBlobStorage, createFileStorage, createMemoryStorage, createStorage } from '../storage.mjs';

// A faithful in-memory stand-in for the parts of @vercel/blob the gateway uses: overwrite protection,
// get() returning a stream (or null when missing), and prefix listing with pagination.
function fakeBlob({ pageSize = 2 } = {}) {
  const files = new Map();
  let clock = 1_000;
  const blob = {
    calls: [],
    async put(pathname, body, options) {
      blob.calls.push({ op: 'put', pathname, options });
      if (files.has(pathname) && !options.allowOverwrite) throw Object.assign(new Error('This blob already exists'), { name: 'BlobError' });
      files.set(pathname, { body, uploadedAt: new Date(clock += 1_000).toISOString() });
      return { url: `https://store.example/${pathname}`, pathname };
    },
    async get(pathname, options) {
      blob.calls.push({ op: 'get', pathname, options });
      const file = files.get(pathname);
      if (!file) return null;
      return { statusCode: 200, stream: new Response(file.body).body, headers: new Headers(), blob: { pathname } };
    },
    async list({ prefix, cursor }) {
      const all = [...files.keys()].filter((name) => name.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const slice = all.slice(start, start + pageSize);
      const next = start + pageSize;
      return { blobs: slice.map((pathname) => ({ pathname })), hasMore: next < all.length, cursor: String(next) };
    },
  };
  return { blob, files };
}

async function exerciseBackend(storage) {
  assert.equal(await storage.get('evidence/ev-1.json'), null);
  await storage.put('evidence/ev-1.json', '{"a":1}');
  assert.equal(await storage.get('evidence/ev-1.json'), '{"a":1}');
  await storage.put('evidence/ev-1.json', '{"a":2}');
  assert.equal(await storage.get('evidence/ev-1.json'), '{"a":2}', 'put overwrites');
  assert.equal(await storage.putIfAbsent('journal/000001.json', 'first'), true);
  assert.equal(await storage.putIfAbsent('journal/000001.json', 'second'), false, 'a taken key is never overwritten');
  assert.equal(await storage.get('journal/000001.json'), 'first');
  for (const n of [2, 3, 4]) await storage.put(`journal/00000${n}.json`, String(n));
  await storage.put('claims/cl-1.json', '{}');
  assert.deepEqual(await storage.list('journal/'), ['journal/000001.json', 'journal/000002.json', 'journal/000003.json', 'journal/000004.json']);
  assert.deepEqual(await storage.list('claims/'), ['claims/cl-1.json']);
  assert.deepEqual(await storage.list('nothing/'), []);
}

test('every backend honours the same contract, including create-if-absent', async () => {
  await exerciseBackend(createMemoryStorage());
  const dir = await mkdtemp(join(tmpdir(), 'cc-storage-'));
  try { await exerciseBackend(createFileStorage(dir)); } finally { await rm(dir, { recursive: true, force: true }); }
  const { blob } = fakeBlob();
  await exerciseBackend(createBlobStorage({ token: 't', blob }));
});

test('blob storage is private by default, lists across pages and always reads the origin copy', async () => {
  const { blob, files } = fakeBlob({ pageSize: 2 });
  const storage = createBlobStorage({ token: 't', blob, root: 'unit' });
  for (let i = 1; i <= 5; i++) await storage.put(`journal/${i}.json`, String(i));
  assert.equal((await storage.list('journal/')).length, 5);
  assert.ok(files.has('unit/journal/3.json'), 'keys live under the configured root');
  assert.equal(await storage.get('journal/3.json'), '3');
  const put = blob.calls.find((c) => c.op === 'put');
  assert.equal(put.options.access, 'private', 'evidence is readable only through the gateway');
  assert.equal(put.options.addRandomSuffix, false, 'pathnames must be predictable');
  const read = blob.calls.find((c) => c.op === 'get');
  assert.equal(read.options.useCache, false, 'a value another instance just wrote is never served stale');
  assert.equal(read.options.access, 'private');
  assert.throws(() => createBlobStorage({ token: 't', blob, access: 'open' }), (e) => e.code === 'blob_unconfigured');
});

test('blob storage reports a failing store as a visible 503 instead of pretending data is missing', async () => {
  const broken = { put: async () => { throw new Error('boom'); }, get: async () => { throw new Error('network down'); }, list: async () => { throw new Error('boom'); } };
  const storage = createBlobStorage({ token: 't', blob: broken });
  await assert.rejects(() => storage.get('a/b'), (e) => e.code === 'store_unreadable' && e.status === 503);
  await assert.rejects(() => storage.put('a/b', 'x'), (e) => e.code === 'store_unwritable');
  await assert.rejects(() => storage.putIfAbsent('a/b', 'x'), (e) => e.code === 'store_unwritable');
  await assert.rejects(() => storage.list('a/'), (e) => e.code === 'store_unreadable');
});

test('keys cannot escape the storage root', async () => {
  for (const key of ['../secret', 'a/../../b', '/etc/passwd', 'a//b', '', 'a/b c', 'a\\b', 'x'.repeat(201)]) {
    assert.throws(() => checkKey(key), (e) => e instanceof StorageError && e.code === 'invalid_storage_key', JSON.stringify(key));
  }
  assert.equal(checkKey('sessions/31337-ab12.json'), 'sessions/31337-ab12.json');
  const dir = await mkdtemp(join(tmpdir(), 'cc-storage-'));
  try { await assert.rejects(() => createFileStorage(dir).put('../escape.txt', 'x'), (e) => e.code === 'invalid_storage_key'); } finally { await rm(dir, { recursive: true, force: true }); }
});

test('file storage lets only one of many concurrent creators win a key', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cc-storage-'));
  try {
    const storage = createFileStorage(dir);
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => storage.putIfAbsent('journal/000001.json', `writer-${i}`)));
    assert.equal(results.filter(Boolean).length, 1);
    const winner = results.indexOf(true);
    assert.equal(await storage.get('journal/000001.json'), `writer-${winner}`);
    const { readdir } = await import('node:fs/promises');
    assert.deepEqual(await readdir(join(dir, 'journal')), ['000001.json'], 'losers and winners leave no temporary files behind');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('createStorage prefers Blob when a token exists and falls back to files when the SDK is unusable', async () => {
  const { blob } = fakeBlob();
  const shared = await createStorage({ env: { BLOB_READ_WRITE_TOKEN: 'tok' }, importBlob: async () => blob, fileRoot: '/unused' });
  assert.equal(shared.kind, 'blob');
  const dir = await mkdtemp(join(tmpdir(), 'cc-storage-'));
  try {
    const noToken = await createStorage({ env: {}, fileRoot: dir });
    assert.equal(noToken.kind, 'file');
    const brokenSdk = await createStorage({ env: { BLOB_READ_WRITE_TOKEN: 'tok' }, importBlob: async () => { throw new Error('cannot find package'); }, fileRoot: dir });
    assert.equal(brokenSdk.kind, 'file');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
