// Small atomic status record shared by the local worker, its supervisor, and
// the gateway health endpoint. It contains process metadata only, no mission
// or memory content.

import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

const WRITABLE_STATES = new Set(['starting', 'running', 'restarting', 'stopping', 'stopped']);
const WORKER_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/u;

export class WorkerStatusError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WorkerStatusError';
    this.code = code;
  }
}

export function getWorkerStatusPath(env = process.env) {
  const base = env.LOCALAPPDATA || env.XDG_DATA_HOME || path.join(env.HOME || process.cwd(), '.local', 'share');
  return path.resolve(env.CLIMATE_CHAIN_WORKER_STATUS_PATH || path.join(base, 'ClimateChain', 'Worker', 'worker-status.json'));
}

function validateRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record) || record.schemaVersion !== 1
      || !WRITABLE_STATES.has(record.status)
      || (record.workerId !== null && (typeof record.workerId !== 'string' || !WORKER_ID_RE.test(record.workerId)))
      || (record.pid !== null && (!Number.isSafeInteger(record.pid) || record.pid < 1))
      || (record.startedAt !== null && (typeof record.startedAt !== 'string' || !Number.isFinite(Date.parse(record.startedAt))))
      || (record.heartbeatAt !== null && (typeof record.heartbeatAt !== 'string' || !Number.isFinite(Date.parse(record.heartbeatAt))))
      || !Number.isSafeInteger(record.restartCount) || record.restartCount < 0
      || (record.backoffMs !== null && (!Number.isSafeInteger(record.backoffMs) || record.backoffMs < 0))
      || typeof record.updatedAt !== 'string' || !Number.isFinite(Date.parse(record.updatedAt))) {
    throw new WorkerStatusError('WORKER_STATUS_CORRUPT', 'Worker status record failed structural validation.');
  }
  return record;
}

export async function writeWorkerStatus(fields, { env = process.env, filePath, now = () => Date.now() } = {}) {
  const record = validateRecord({
    schemaVersion: 1,
    status: fields.status,
    workerId: fields.workerId ?? null,
    pid: fields.pid ?? null,
    startedAt: fields.startedAt ?? null,
    heartbeatAt: fields.heartbeatAt ?? null,
    restartCount: fields.restartCount ?? 0,
    backoffMs: fields.backoffMs ?? null,
    updatedAt: new Date(now()).toISOString(),
  });
  const destination = path.resolve(filePath || getWorkerStatusPath(env));
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(record), 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, destination);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw new WorkerStatusError('WORKER_STATUS_WRITE_FAILED', `Worker status could not be written (${error?.code || 'filesystem_error'}).`);
  }
  return record;
}

export async function readWorkerStatus({ env = process.env, filePath, now = () => Date.now(), staleAfterMs = 15_000 } = {}) {
  if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs < 1000 || staleAfterMs > 300_000) {
    throw new TypeError('staleAfterMs must be between 1000 and 300000.');
  }
  let text;
  try { text = await readFile(path.resolve(filePath || getWorkerStatusPath(env)), 'utf8'); }
  catch (error) {
    if (error?.code === 'ENOENT') return { status: 'unknown', available: false, workerId: null, pid: null, restartCount: 0, backoffMs: null, startedAt: null, lastHeartbeatAt: null, ageMs: null, errorCode: null };
    throw new WorkerStatusError('WORKER_STATUS_READ_FAILED', `Worker status could not be read (${error?.code || 'filesystem_error'}).`);
  }

  let record;
  try { record = validateRecord(JSON.parse(text)); }
  catch (error) {
    if (error instanceof WorkerStatusError) throw error;
    throw new WorkerStatusError('WORKER_STATUS_CORRUPT', 'Worker status record is malformed JSON.');
  }
  const freshnessAt = record.status === 'running' ? record.heartbeatAt : record.updatedAt;
  const ageMs = Math.max(0, now() - Date.parse(freshnessAt));
  // A scheduled restart can intentionally wait up to 30 seconds. Keep that
  // actionable state visible through its backoff and a full startup grace.
  const staleAfterForRecord = record.status === 'restarting'
    ? staleAfterMs + (record.backoffMs ?? 0)
    : staleAfterMs;
  const status = ageMs > staleAfterForRecord && ['running', 'starting', 'restarting'].includes(record.status) ? 'stale' : record.status;
  return {
    status,
    available: status === 'running',
    workerId: record.workerId,
    pid: record.pid,
    restartCount: record.restartCount,
    backoffMs: record.backoffMs,
    startedAt: record.startedAt,
    lastHeartbeatAt: record.heartbeatAt,
    ageMs,
    errorCode: status === 'stale' ? 'WORKER_HEARTBEAT_STALE' : null,
  };
}
