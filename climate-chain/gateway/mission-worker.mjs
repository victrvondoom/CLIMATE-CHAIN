// Local polling worker for the durable mission store. It claims only missions
// with a verified memory-readiness trace attached by the local gateway.

import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnectorRegistry } from './connectors/registry.mjs';
import { createMissionEngine } from './mission-engine.mjs';
import { executeMissionTask } from './mission-task-executor.mjs';
import { attachFreshMissionMemory, MissionMemoryReadinessError } from './mission-readiness.mjs';
import { readWorkerStatus, writeWorkerStatus } from './worker-status.mjs';

const WORKER_HEARTBEAT_INTERVAL_MS = 3000;

function writeEvent(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), component: 'mission-worker', event, ...fields })}\n`);
}

export function createMissionWorker({
  engine: suppliedEngine,
  connectorRegistry: suppliedConnectorRegistry,
  prepareMemoryContext = attachFreshMissionMemory,
  workerId = process.env.CLIMATE_CHAIN_WORKER_ID || `local-worker-${process.pid}`,
  pollIntervalMs = Number(process.env.CLIMATE_CHAIN_WORKER_POLL_MS || 750),
} = {}) {
  if (typeof workerId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/u.test(workerId)) {
    throw new TypeError('workerId must be a bounded safe identifier.');
  }
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 100 || pollIntervalMs > 30_000) {
    throw new TypeError('pollIntervalMs must be between 100 and 30000.');
  }
  const connectorRegistry = suppliedConnectorRegistry || createConnectorRegistry({ env: process.env });
  const engine = suppliedEngine || createMissionEngine({
    taskExecutor: (type, input, options) => executeMissionTask(type, input, { ...options, connectorRegistry }),
  });

  async function processOne() {
    const missions = await engine.listMissions();
    const pending = missions.find((mission) => mission.memoryRetrieval
      && ['QUEUED', 'RETRYING'].includes(mission.status)
      && mission.tasks.some((task) => ['READY', 'RETRYING'].includes(task.status)));
    if (!pending) return { status: 'idle' };
    const retrievedAt = Date.parse(pending.memoryRetrieval.retrievedAt);
    if (!Number.isFinite(retrievedAt) || Date.now() - retrievedAt > 5 * 60_000) {
      try { await prepareMemoryContext(engine, pending.id); }
      catch (error) {
        if (error instanceof MissionMemoryReadinessError) {
          return { status: 'memory_gate_failed', missionId: pending.id, code: error.code };
        }
        throw error;
      }
    }
    return engine.runMission(pending.id, { workerId, maxSteps: 100, requireMemoryContext: true });
  }

  async function run({ signal } = {}) {
    await engine.initialize();
    const recovery = await engine.recoverExpiredLeases();
    if (recovery.recovered > 0) writeEvent('worker.leases_recovered', { workerId, recovered: recovery.recovered });
    let restartCount = 0;
    try { restartCount = (await readWorkerStatus()).restartCount; }
    catch (error) { writeEvent('worker.status_read_failed', { workerId, code: error?.code || 'WORKER_STATUS_READ_FAILED' }); }
    const startedAt = new Date().toISOString();
    let statusWrite = Promise.resolve();
    const publish = (status, heartbeatAt = null) => {
      statusWrite = statusWrite.then(() => writeWorkerStatus({
        status, workerId, pid: process.pid, startedAt: status === 'running' ? startedAt : null,
        heartbeatAt, restartCount, backoffMs: null,
      })).catch((error) => {
        writeEvent('worker.status_write_failed', { workerId, code: error?.code || 'WORKER_STATUS_WRITE_FAILED' });
      });
      return statusWrite;
    };
    await publish('running', new Date().toISOString());
    const heartbeat = setInterval(() => { void publish('running', new Date().toISOString()); }, WORKER_HEARTBEAT_INTERVAL_MS);
    heartbeat.unref?.();
    writeEvent('worker.started', { workerId, pollIntervalMs });
    const gateLogAt = new Map();
    try {
      while (!signal?.aborted) {
        try {
          const result = await processOne();
          if (result.status === 'memory_gate_failed') {
            const key = `${result.missionId}:${result.code}`;
            if (Date.now() - (gateLogAt.get(key) || 0) >= 30_000) {
              gateLogAt.set(key, Date.now());
              writeEvent('worker.memory_gate_failed', { workerId, missionId: result.missionId, code: result.code });
            }
          } else if (!['idle', 'waiting_approval', 'retry_scheduled'].includes(result.status)) {
            writeEvent('worker.mission_result', { workerId, missionId: result.missionId, status: result.status });
          }
        } catch (error) {
          writeEvent('worker.iteration_failed', { workerId, code: error?.code || 'WORKER_ERROR' });
        }
        if (!signal?.aborted) {
          try { await delay(pollIntervalMs, undefined, { signal }); }
          catch (error) { if (error?.name !== 'AbortError') throw error; }
        }
      }
    } finally {
      clearInterval(heartbeat);
      await publish('stopped');
    }
    writeEvent('worker.stopped', { workerId });
  }

  return Object.freeze({ workerId, processOne, run });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const worker = createMissionWorker();
  const controller = new AbortController();
  if (typeof process.send === 'function') {
    process.on('message', (message) => {
      if (message && typeof message === 'object' && message.type === 'shutdown') controller.abort();
    });
  }
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  worker.run({ signal: controller.signal }).then(() => {
    if (process.connected) process.disconnect();
  }, (error) => {
    writeEvent('worker.failed', { workerId: worker.workerId, code: error?.code || 'WORKER_START_FAILED' });
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  });
}
