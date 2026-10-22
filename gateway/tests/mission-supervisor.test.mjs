import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMissionSupervisor } from '../mission-supervisor.mjs';
import { readWorkerStatus } from '../worker-status.mjs';

test('supervisor restarts a crashed worker with backoff and stops its replacement on shutdown', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'climate-chain-supervisor-'));
  const countPath = path.join(directory, 'starts.txt');
  const scriptPath = path.join(directory, 'worker-fixture.mjs');
  const statusPath = path.join(directory, 'worker-status.json');
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const script = `
    import { readFile, writeFile } from 'node:fs/promises';
    let count = 0;
    try { count = Number((await readFile(${JSON.stringify(countPath)}, 'utf8')).trim()); } catch {}
    count += 1;
    await writeFile(${JSON.stringify(countPath)}, String(count));
    if (count === 1) process.exit(17);
    process.on('message', (message) => { if (message?.type === 'shutdown') process.exit(0); });
    setInterval(() => {}, 1000);
  `;
  await writeFile(scriptPath, script);

  const controller = new AbortController();
  t.after(() => controller.abort());
  const events = [];
  const supervisor = createMissionSupervisor({
    spawnWorker: () => spawn(process.execPath, [scriptPath], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], detached: true }),
    workerStatusPath: statusPath,
    minRestartDelayMs: 10,
    maxRestartDelayMs: 20,
    healthyWindowMs: 1000,
    shutdownGraceMs: 500,
    log: (event, fields) => {
      events.push({ event, fields });
      if (event === 'worker.started' && fields.restart === 1) setTimeout(() => controller.abort(), 30);
    },
  });
  const result = await supervisor.run({ signal: controller.signal });
  assert.equal(result.status, 'stopped');
  assert.ok(events.filter((entry) => entry.event === 'worker.started').length >= 2);
  assert.ok(events.some((entry) => entry.event === 'worker.restart_scheduled' && entry.fields.exitCode === 17));
  assert.equal((await readFile(countPath, 'utf8')).trim(), '2');
  assert.equal((await readWorkerStatus({ filePath: statusPath })).status, 'stopped');
});

test('supervisor rejects invalid restart bounds', () => {
  assert.throws(() => createMissionSupervisor({ minRestartDelayMs: 100, maxRestartDelayMs: 10 }), /must not be less/u);
  assert.throws(() => createMissionSupervisor({ shutdownGraceMs: 0 }), /outside the supported range/u);
});
