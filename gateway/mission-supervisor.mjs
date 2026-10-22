// Restart the local mission worker after an unexpected exit. The gateway and
// worker remain independent processes; no external broker or service is used.

import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeWorkerStatus } from './worker-status.mjs';

function logEvent(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), component: 'mission-supervisor', event, ...fields })}\n`);
}

function waitForExit(child) {
  return new Promise((resolveExit) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolveExit(result);
    };
    child.once('error', (error) => finish({ error }));
    child.once('exit', (code, signal) => finish({ code, signal }));
  });
}

function waitForSpawn(child) {
  return new Promise((resolveSpawn) => {
    child.once('spawn', () => resolveSpawn({ ok: true }));
    child.once('error', (error) => resolveSpawn({ ok: false, error }));
  });
}

export function createMissionSupervisor({
  spawnWorker,
  env = process.env,
  workerStatusPath,
  log = logEvent,
  minRestartDelayMs = 500,
  maxRestartDelayMs = 30_000,
  healthyWindowMs = 60_000,
  shutdownGraceMs = 5_000,
  now = () => Date.now(),
} = {}) {
  for (const [name, value, maximum] of [
    ['minRestartDelayMs', minRestartDelayMs, 120_000],
    ['maxRestartDelayMs', maxRestartDelayMs, 120_000],
    ['healthyWindowMs', healthyWindowMs, 3_600_000],
    ['shutdownGraceMs', shutdownGraceMs, 120_000],
  ]) {
    if (!Number.isInteger(value) || value < 1 || value > maximum) throw new TypeError(`${name} is outside the supported range.`);
  }
  if (maxRestartDelayMs < minRestartDelayMs) throw new TypeError('maxRestartDelayMs must not be less than minRestartDelayMs.');
  if ((spawnWorker !== undefined && typeof spawnWorker !== 'function') || typeof log !== 'function' || typeof now !== 'function') throw new TypeError('spawnWorker, log, and now must be functions.');

  const startWorker = spawnWorker || (() => spawn(process.execPath, [fileURLToPath(new URL('./mission-worker.mjs', import.meta.url))], {
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    env,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    detached: true,
  }));

  async function run({ signal } = {}) {
    let consecutiveRestarts = 0;
    let workerStartedAt = null;
    const workerIdFor = (pid = null) => env.CLIMATE_CHAIN_WORKER_ID || (pid ? `local-worker-${pid}` : null);
    const publishStatus = async (fields) => {
      try {
        await writeWorkerStatus({
          workerId: workerIdFor(fields.pid),
          restartCount: consecutiveRestarts,
          ...fields,
        }, { env, filePath: workerStatusPath });
      } catch (error) {
        log('worker.status_write_failed', { code: error?.code || 'WORKER_STATUS_WRITE_FAILED' });
      }
    };
    while (!signal?.aborted) {
      const startedAt = now();
      let child;
      workerStartedAt = new Date(startedAt).toISOString();
      await publishStatus({ status: 'starting', pid: null, startedAt: workerStartedAt, heartbeatAt: null, backoffMs: null });
      try {
        child = startWorker();
      } catch {
        child = null;
      }

      let backoffMs;
      if (child) {
        const spawned = await waitForSpawn(child);
        if (signal?.aborted) {
          if (spawned.ok) child.kill('SIGTERM');
          break;
        }
        if (!spawned.ok) {
          log('worker.spawn_failed', { restart: consecutiveRestarts });
          child = null;
        } else {
          log('worker.started', { pid: child.pid ?? null, restart: consecutiveRestarts });
        }
      }

      if (child) {
        const stopChild = () => {
          if (child.exitCode !== null || child.signalCode !== null) return;
          if (child.connected) child.send({ type: 'shutdown' }, () => {});
          else child.kill('SIGTERM');
          const timer = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
          }, shutdownGraceMs);
          timer.unref?.();
          child.once('exit', () => clearTimeout(timer));
        };
        signal?.addEventListener('abort', stopChild, { once: true });
        const result = await waitForExit(child);
        signal?.removeEventListener('abort', stopChild);
        if (signal?.aborted) break;

        if (now() - startedAt >= healthyWindowMs) consecutiveRestarts = 0;
        consecutiveRestarts += 1;
        backoffMs = Math.min(maxRestartDelayMs, minRestartDelayMs * (2 ** Math.min(consecutiveRestarts - 1, 20)));
        log('worker.restart_scheduled', {
          restart: consecutiveRestarts,
          backoffMs,
          exitCode: Number.isInteger(result.code) ? result.code : null,
          signal: result.signal || null,
          error: result.error ? 'spawn_error' : null,
        });
        await publishStatus({ status: 'restarting', pid: null, startedAt: null, heartbeatAt: null, backoffMs });
      } else {
        if (signal?.aborted) break;
        consecutiveRestarts += 1;
        backoffMs = Math.min(maxRestartDelayMs, minRestartDelayMs * (2 ** Math.min(consecutiveRestarts - 1, 20)));
        log('worker.restart_scheduled', { restart: consecutiveRestarts, backoffMs, exitCode: null, signal: null, error: 'spawn_error' });
        await publishStatus({ status: 'restarting', pid: null, startedAt: null, heartbeatAt: null, backoffMs });
      }

      try { await delay(backoffMs, undefined, { signal }); }
      catch (error) { if (error?.name !== 'AbortError') throw error; }
    }
    await publishStatus({ status: 'stopped', pid: null, startedAt: null, heartbeatAt: null, backoffMs: null });
    log('supervisor.stopped');
    return { status: 'stopped', consecutiveRestarts };
  }

  return Object.freeze({ run });
}

async function runLocalApplication() {
  const controller = new AbortController();
  let gateway;
  const shutdown = () => {
    if (!controller.signal.aborted) controller.abort();
    if (gateway && gateway.exitCode === null && gateway.signalCode === null) gateway.kill('SIGTERM');
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  const supervisor = createMissionSupervisor();
  const workerRun = supervisor.run({ signal: controller.signal });
  try {
    gateway = spawn(process.execPath, [fileURLToPath(new URL('./gateway.mjs', import.meta.url))], {
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      env: process.env,
      stdio: 'inherit',
      detached: true,
    });
  } catch (error) {
    shutdown();
    await workerRun;
    throw error;
  }

  const result = await waitForExit(gateway);
  shutdown();
  await workerRun;
  process.removeListener('SIGINT', shutdown);
  process.removeListener('SIGTERM', shutdown);
  if (result.error) {
    logEvent('gateway.spawn_failed', { code: 'GATEWAY_SPAWN_FAILED' });
    process.exitCode = 1;
  } else {
    process.exitCode = Number.isInteger(result.code) ? result.code : 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runLocalApplication().catch((error) => {
    logEvent('supervisor.failed', { code: error?.code || 'SUPERVISOR_FAILED' });
    process.exitCode = 1;
  });
}
