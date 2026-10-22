import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMissionEngine } from '../mission-engine.mjs';
import { executeMissionTask } from '../mission-task-executor.mjs';
import { createMissionWorker } from '../mission-worker.mjs';

test('worker processes only queued missions with fresh memory readiness and returns durable evidence', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'climate-chain-worker-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const engine = createMissionEngine({ storePath: path.join(directory, 'missions.json') });
  await engine.initialize();
  const mission = await engine.createMission({ title: 'Worker fixture', tasks: [{
    id: 'scenario', type: 'climate.emissions_scenario', title: 'Run scenario', input: { baselineTco2e: 20, reductionPercent: 10, years: 2 },
  }] });
  await engine.validateMission(mission.id);
  await engine.queueMission(mission.id);
  const worker = createMissionWorker({ engine, workerId: 'test-worker', pollIntervalMs: 100 });

  assert.equal((await worker.processOne()).status, 'idle', 'a queued mission without memory context is not claimable');
  await engine.attachMemoryContext(mission.id, {
    memoryIds: [], manifestSha256: 'c'.repeat(64), retrievedAt: new Date().toISOString(),
  });
  const result = await worker.processOne();
  assert.equal(result.status, 'mission_completed');
  const completed = await engine.getMission(mission.id);
  assert.equal(completed.tasks[0].evidence.memoryContextStatus, 'retrieval_completed_no_matching_memory');
  assert.equal(completed.tasks[0].output.classification, 'SIMULATION');
});

test('worker refreshes stale retrieval traces before claiming and validates process settings', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'climate-chain-worker-stale-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const engine = createMissionEngine({ storePath: path.join(directory, 'missions.json') });
  await engine.initialize();
  const mission = await engine.createMission({ title: 'Stale context fixture', tasks: [{
    id: 'scenario', type: 'climate.emissions_scenario', title: 'Run scenario', input: { baselineTco2e: 20, reductionPercent: 10, years: 2 },
  }] });
  await engine.validateMission(mission.id);
  await engine.queueMission(mission.id);
  await engine.attachMemoryContext(mission.id, {
    memoryIds: [], manifestSha256: 'd'.repeat(64), retrievedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
  });
  let refreshed = 0;
  const worker = createMissionWorker({ engine, workerId: 'test-worker', prepareMemoryContext: async (store, missionId) => {
    refreshed += 1;
    return store.attachMemoryContext(missionId, {
      memoryIds: ['fresh-memory'], manifestSha256: 'e'.repeat(64), retrievedAt: new Date().toISOString(),
    });
  } });
  assert.equal((await worker.processOne()).status, 'mission_completed');
  assert.equal(refreshed, 1);
  const completed = await engine.getMission(mission.id);
  assert.deepEqual(completed.tasks[0].evidence.relevantEngineeringMemories, ['fresh-memory']);
  assert.throws(() => createMissionWorker({ workerId: 'invalid worker id' }), /safe identifier/u);
  assert.throws(() => createMissionWorker({ pollIntervalMs: 10 }), /pollIntervalMs/u);
});

test('Vayu mission read uses a configured city center and persists only bounded privacy-limited samples', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'climate-chain-worker-vayu-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const measurements = Array.from({ length: 30 }, (_, index) => ({
    t: `2026-10-22T${String(index % 24).padStart(2, '0')}:00:00.000Z`, pm25: index, kind: index === 29 ? 'forecast' : 'observed',
  }));
  let query;
  const connectorRegistry = { read: async (connector, operation, options) => {
    assert.equal(connector, 'vayu');
    assert.equal(operation, 'today');
    query = options.query;
    return {
      data: {
        schemaVersion: 1, place: { id: 'private-place-id', name: 'Private building', kind: 'home', lat: 26.29, lng: 73.02 },
        asOf: '2026-10-22T00:00:00.000Z', mode: 'live', hours: measurements,
        windows: [{ kind: 'walk', start: '08:00', end: '10:00', meanPm25: 22, band: 'good', rationale: ['private route detail'] }],
        headline: 'Private location summary',
        prov: { mode: 'live', label: 'Nearby station', source: 'station', fetchedAt: '2026-10-22T00:00:00.000Z', asOf: '2026-10-22T00:00:00.000Z', ageMinutes: 0, stationId: 'private-station-id', stationName: 'Private station' },
      },
      provenance: { source: 'vayu', operation: 'today', schema: 'vayu-today', mode: 'live', connection: 'connected', url: 'https://vayu.example/v1/today', fetchedAt: '2026-10-22T00:00:00.000Z', attempts: 1 },
    };
  } };
  const engine = createMissionEngine({
    storePath: path.join(directory, 'missions.json'),
    taskExecutor: (type, input, options) => executeMissionTask(type, input, { ...options, connectorRegistry }),
  });
  await engine.initialize();
  const mission = await engine.createMission({ title: 'Vayu city air sample', tasks: [{
    id: 'vayu', type: 'climate.connector_snapshot', title: 'Read Vayu city sample', input: { connector: 'vayu', city: 'jodhpur' },
  }] });
  await engine.validateMission(mission.id);
  await engine.queueMission(mission.id);
  await engine.attachMemoryContext(mission.id, { memoryIds: [], manifestSha256: 'b'.repeat(64), retrievedAt: new Date().toISOString() });
  const worker = createMissionWorker({ engine, workerId: 'vayu-city-worker', connectorRegistry });
  const result = await worker.processOne();
  assert.equal(result.status, 'mission_completed');
  assert.deepEqual(query, { lat: 26.29, lng: 73.02 });
  const completed = await engine.getMission(mission.id);
  const output = completed.tasks[0].output;
  assert.equal(output.connector, 'vayu');
  assert.equal(output.sourceMode, 'live');
  assert.equal(output.data.city, 'jodhpur');
  assert.equal(output.data.measurements.length, 24);
  assert.equal(output.data.measurements[0].pm25, 6);
  assert.equal(output.data.measurements.at(-1).kind, 'forecast');
  const serialized = JSON.stringify(output);
  for (const privateValue of ['Private building', 'private-place-id', 'private-station-id', 'Private station', 'private route detail', '26.29', '73.02']) {
    assert.equal(serialized.includes(privateValue), false, `output must omit ${privateValue}`);
  }
  assert.ok(completed.tasks[0].evidence.validationResults.some((entry) => entry.passed && /omits coordinates/u.test(entry.check)));
});

test('connector failures remain failures and do not produce fabricated source evidence', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'climate-chain-worker-source-failure-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const engine = createMissionEngine({
    storePath: path.join(directory, 'missions.json'),
    taskExecutor: async () => { const error = new Error('fixture source disconnected'); error.code = 'network_error'; throw error; },
  });
  await engine.initialize();
  const mission = await engine.createMission({ title: 'Disconnected source', tasks: [{
    id: 'source', type: 'climate.connector_snapshot', title: 'Read aggregate source', input: { connector: 'clearsky' },
  }] });
  await engine.validateMission(mission.id);
  await engine.queueMission(mission.id);
  await engine.attachMemoryContext(mission.id, { memoryIds: [], manifestSha256: 'f'.repeat(64), retrievedAt: new Date().toISOString() });
  const worker = createMissionWorker({ engine, workerId: 'source-failure-worker' });
  const result = await worker.processOne();
  assert.equal(result.status, 'failed');
  const failed = await engine.getMission(mission.id);
  assert.equal(failed.tasks[0].failure.code, 'network_error');
  assert.equal(failed.tasks[0].evidence, null);
  assert.equal(failed.tasks[0].output, null);
});
