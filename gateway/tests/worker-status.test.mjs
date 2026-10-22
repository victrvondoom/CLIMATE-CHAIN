import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readWorkerStatus, WorkerStatusError, writeWorkerStatus } from '../worker-status.mjs';

async function temporaryStatus(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'climate-chain-worker-status-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return path.join(directory, 'worker-status.json');
}

test('missing worker status is an explicit unknown state', async (t) => {
  const filePath = await temporaryStatus(t);
  assert.deepEqual(await readWorkerStatus({ filePath }), {
    status: 'unknown', available: false, workerId: null, pid: null, restartCount: 0,
    backoffMs: null, startedAt: null, lastHeartbeatAt: null, ageMs: null, errorCode: null,
  });
});

test('atomic worker heartbeat is live while fresh and stale after its freshness bound', async (t) => {
  const filePath = await temporaryStatus(t);
  const time = Date.parse('2026-10-22T05:00:00.000Z');
  const stamp = new Date(time).toISOString();
  await writeWorkerStatus({
    status: 'running', workerId: 'worker-test', pid: process.pid, startedAt: stamp,
    heartbeatAt: stamp, restartCount: 2,
  }, { filePath, now: () => time });
  const live = await readWorkerStatus({ filePath, now: () => time + 900, staleAfterMs: 1000 });
  assert.equal(live.status, 'running');
  assert.equal(live.available, true);
  assert.equal(live.restartCount, 2);
  const stale = await readWorkerStatus({ filePath, now: () => time + 1001, staleAfterMs: 1000 });
  assert.equal(stale.status, 'stale');
  assert.equal(stale.available, false);
  assert.equal(stale.errorCode, 'WORKER_HEARTBEAT_STALE');
});

test('scheduled restart remains observable throughout the published backoff', async (t) => {
  const filePath = await temporaryStatus(t);
  const time = Date.parse('2026-10-22T05:00:00.000Z');
  await writeWorkerStatus({ status: 'restarting', restartCount: 3, backoffMs: 30_000 }, { filePath, now: () => time });
  const waiting = await readWorkerStatus({ filePath, now: () => time + 29_000, staleAfterMs: 15_000 });
  assert.equal(waiting.status, 'restarting');
  assert.equal(waiting.backoffMs, 30_000);
  const overdue = await readWorkerStatus({ filePath, now: () => time + 45_001, staleAfterMs: 15_000 });
  assert.equal(overdue.status, 'stale');
});

test('corrupt worker status fails visibly instead of becoming unknown', async (t) => {
  const filePath = await temporaryStatus(t);
  await writeFile(filePath, '{malformed');
  await assert.rejects(() => readWorkerStatus({ filePath }), (error) => {
    assert.ok(error instanceof WorkerStatusError);
    assert.equal(error.code, 'WORKER_STATUS_CORRUPT');
    return true;
  });
});
