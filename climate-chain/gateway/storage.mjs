// Key-value storage for the gateway's durable state: evidence bundles, claim documents, the Integrity Lab
// session and the chain journal. One small interface, three backends:
//   memory  tests and throwaway runs
//   file    the default; atomic writes under a data directory (local app, Render, /tmp on serverless)
//   blob    Vercel Blob, so state is shared by every serverless instance and survives cold starts
// Keys are relative, slash-separated, and may only use [A-Za-z0-9._-] segments so no key can escape its root.
import { link, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export class StorageError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.status = status;
  }
}

const SEGMENT = /^[A-Za-z0-9._-]{1,200}$/;

export function checkKey(key) {
  const parts = typeof key === 'string' ? key.split('/') : [];
  if (!parts.length || parts.some((part) => part === '.' || part === '..' || !SEGMENT.test(part))) {
    throw new StorageError('invalid_storage_key', 'Storage keys are relative paths of letters, digits, dots, dashes and underscores.', 400);
  }
  return key;
}

export function createMemoryStorage() {
  const map = new Map();
  return {
    kind: 'memory',
    async get(key) { return map.get(checkKey(key)) ?? null; },
    async put(key, text) { map.set(checkKey(key), String(text)); },
    async putIfAbsent(key, text) { checkKey(key); if (map.has(key)) return false; map.set(key, String(text)); return true; },
    async list(prefix = '') { return [...map.keys()].filter((key) => key.startsWith(prefix)).sort(); },
  };
}

export function createFileStorage(rootDir) {
  const target = (key) => join(rootDir, ...checkKey(key).split('/'));
  async function atomicWrite(file, text) {
    await mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    await writeFile(temporary, text, 'utf8');
    await rename(temporary, file);
  }
  return {
    kind: 'file',
    async get(key) {
      try { return await readFile(target(key), 'utf8'); }
      catch (error) {
        if (error?.code === 'ENOENT') return null;
        if (error instanceof StorageError) throw error;
        throw new StorageError('store_unreadable', 'The local data store could not be read.');
      }
    },
    async put(key, text) { await atomicWrite(target(key), String(text)); },
    // Created complete or not at all: the content is written to a temporary file first, then hard-linked into
    // place. link() is atomic and fails if the slot exists, so a reader never sees a half-written slot and a
    // crash cannot leave one behind.
    async putIfAbsent(key, text) {
      const file = target(key);
      await mkdir(dirname(file), { recursive: true });
      const temporary = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
      try {
        await writeFile(temporary, String(text), 'utf8');
        await link(temporary, file);
        return true;
      } catch (error) {
        if (error?.code === 'EEXIST') return false;
        throw new StorageError('store_unwritable', 'The local data store could not be written.', 503);
      } finally {
        await unlink(temporary).catch(() => {});
      }
    },
    async list(prefix = '') {
      const slash = prefix.lastIndexOf('/');
      const folder = slash >= 0 ? prefix.slice(0, slash) : '';
      const stem = prefix.slice(slash + 1);
      let names = [];
      try { names = await readdir(folder ? target(folder) : rootDir); } catch { return []; }
      return names.filter((name) => name.startsWith(stem) && !name.endsWith('.tmp')).map((name) => (folder ? `${folder}/${name}` : name)).sort();
    },
  };
}

// `blob` is the @vercel/blob module (or a test double). The store should be created private, so its contents
// (evidence bundles, claims, signed chain transactions) are readable only through this gateway. `access` must
// match the store's type.
export function createBlobStorage({ token, blob, root = 'climate-chain', access = 'private' }) {
  if (!token || !blob) throw new StorageError('blob_unconfigured', 'Blob storage needs a token and the @vercel/blob module.', 503);
  if (!['private', 'public'].includes(access)) throw new StorageError('blob_unconfigured', 'Blob access must be private or public.', 503);
  const path = (key) => `${root}/${checkKey(key)}`;
  const isExisting = (error) => /already exists|exists/i.test(`${error?.name ?? ''} ${error?.message ?? ''}`);
  const write = (key, text, allowOverwrite) => blob.put(path(key), String(text), {
    access, addRandomSuffix: false, allowOverwrite, contentType: 'application/json', token,
  });
  return {
    kind: 'blob',
    async get(key) {
      let result;
      // useCache: false reads the origin copy, so a value another instance just wrote is never served stale.
      try { result = await blob.get(path(key), { access, useCache: false, token }); }
      catch { throw new StorageError('store_unreadable', 'The shared data store could not be read.', 503); }
      if (!result || result.statusCode !== 200 || !result.stream) return null;
      try { return await new Response(result.stream).text(); }
      catch { throw new StorageError('store_unreadable', 'The shared data store could not be read.', 503); }
    },
    async put(key, text) {
      try { await write(key, text, true); }
      catch { throw new StorageError('store_unwritable', 'The shared data store rejected a write.', 503); }
    },
    async putIfAbsent(key, text) {
      try { await write(key, text, false); return true; }
      catch (error) {
        if (isExisting(error)) return false;
        throw new StorageError('store_unwritable', 'The shared data store rejected a write.', 503);
      }
    },
    async list(prefix = '') {
      const base = `${root}/`;
      const keys = [];
      let cursor;
      do {
        let page;
        try { page = await blob.list({ prefix: `${base}${prefix}`, limit: 1000, cursor, token }); }
        catch { throw new StorageError('store_unreadable', 'The shared data store could not be listed.', 503); }
        for (const item of page.blobs ?? []) keys.push(item.pathname.slice(base.length));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return keys.sort();
    },
  };
}

// Picks the strongest backend the environment allows. A Blob token wins so every serverless instance
// shares one store; otherwise state lives in files under `fileRoot`.
export async function createStorage({ env = process.env, fileRoot, importBlob = () => import('@vercel/blob') } = {}) {
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (token) {
    try { return createBlobStorage({ token, blob: await importBlob(), root: env.CLIMATE_CHAIN_BLOB_ROOT || 'climate-chain', access: env.CLIMATE_CHAIN_BLOB_ACCESS || 'private' }); }
    catch { /* the package is missing or the token is unusable: fall back to files */ }
  }
  return createFileStorage(fileRoot);
}
