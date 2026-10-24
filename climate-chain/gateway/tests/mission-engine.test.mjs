import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMissionEngine, MissionEngineError } from '../mission-engine.mjs';

const temporaryDirectories = new Set();

async function createStore(t, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'climate-chain-mission-engine-'));
  temporaryDirectories.add(dir);
  t.after(async () => {
    temporaryDirectories.delete(dir);
    await rm(dir, { recursive: true, force: true });
  });
  const storePath = path.join(dir, 'missions.json');
  const engine = createMissionEngine({ storePath, ...options });
  await engine.initialize();
  return { engine, storePath, dir };
}

afterEach(async () => {
  // t.after normally owns cleanup; this also protects temp directories if a
  // test aborts before registering its local cleanup callback.
  for (const dir of temporaryDirectories) await rm(dir, { recursive: true, force: true });
  temporaryDirectories.clear();
});

function basicMission(overrides = {}) {
  return {
    title: 'Local climate evidence workflow',
    description: 'A bounded, deterministic fixture mission.',
    tasks: [{
      id: 'scenario', type: 'climate.emissions_scenario', title: 'Compare pathway',
      input: { baselineTco2e: 100, reductionPercent: 40, years: 5 },
    }],
    ...overrides,
  };
}

async function queued(engine, definition = basicMission(), opts = {}) {
  const mission = await engine.createMission(definition, opts);
  await engine.validateMission(mission.id);
  await engine.queueMission(mission.id);
  return mission.id;
}

test('durable DAG execution stores evidence, provenance, timeline, and survives a new engine instance', async (t) => {
  const { engine, storePath } = await createStore(t);
  const missionId = await queued(engine, {
    title: 'Summarize source observations and report',
    memoryReferences: ['decision:keep-units-scoped'],
    tasks: [
      {
        id: 'observations', type: 'climate.observation_summary', title: 'Summarize observations',
        input: { observations: [
          { metric: 'pm25', value: 20, unit: 'ug/m3', observedAt: '2026-10-20T08:00:00Z', sourceId: 'fixture:monitor-1', sourceStatus: 'test_fixture', geography: 'Ward 4' },
          { metric: 'pm25', value: 40, unit: 'ug/m3', observedAt: '2026-10-21T08:00:00Z', sourceId: 'fixture:monitor-1', sourceStatus: 'test_fixture', geography: 'Ward 4' },
          { metric: 'pm25', value: 1, unit: 'mg/m3', observedAt: '2026-10-21T08:00:00Z', sourceId: 'fixture:monitor-2', sourceStatus: 'test_fixture' },
        ] },
      },
      {
        id: 'report', type: 'report.render', title: 'Render report', dependsOn: ['observations'],
        input: { title: 'Observation results', sections: [{ heading: 'Grouped values', body: { $ref: { taskId: 'observations', path: '/summaries' } } }] },
      },
    ],
  });

  const run = await engine.runMission(missionId, { workerId: 'qa-worker' });
  assert.equal(run.status, 'mission_completed');
  assert.equal(run.mission.status, 'COMPLETED');
  assert.equal(run.mission.tasks[0].output.summaries.length, 2, 'incompatible units remain separate');
  assert.equal(run.mission.tasks[0].output.summaries[0].mean, 30);
  assert.deepEqual(run.mission.tasks[0].output.summaries[0].sourceStatuses, ['test_fixture']);
  assert.match(run.mission.tasks[1].output.markdown, /Observation results/);
  const evidence = await engine.getExecutionEvidence(missionId, 'report');
  assert.deepEqual(evidence.inputReferences, ['task-output:observations']);
  assert.deepEqual(evidence.relevantEngineeringMemories, []);
  assert.deepEqual(evidence.declaredEngineeringMemoryReferences, ['decision:keep-units-scoped']);
  assert.equal(evidence.memoryContextStatus, 'declared_not_retrieved');
  assert.equal(evidence.validationResults.every((row) => row.passed), true);
  assert.match(evidence.outputArtifacts[0].id, /^sha256:[a-f\d]{64}$/);
  assert.match(evidence.uncertainty, /does not independently verify/);
  assert.ok((await engine.getEvents(missionId)).some((event) => event.type === 'mission.completed'));
  const observationEvidence = await engine.getExecutionEvidence(missionId, 'observations');
  assert.deepEqual(observationEvidence.inputReferences, ['source:fixture:monitor-1', 'source:fixture:monitor-2']);

  const restarted = createMissionEngine({ storePath });
  assert.equal((await restarted.getMission(missionId)).status, 'COMPLETED');
  assert.equal((await restarted.verifyIntegrity()).valid, true);
});

test('emissions scenarios are explicitly labeled simulations with stated assumptions', async (t) => {
  const { engine } = await createStore(t);
  const missionId = await queued(engine);
  const run = await engine.runMission(missionId);
  const output = run.mission.tasks[0].output;
  assert.equal(output.classification, 'SIMULATION');
  assert.equal(output.estimatedAvoidedTco2e, 100);
  assert.equal(output.estimatedScenarioTotalTco2e, 400);
  assert.match(run.mission.tasks[0].evidence.uncertainty, /not a forecast or measured result/);
});

test('mission connector allowlist rejects individual and unreviewed source payloads', async (t) => {
  const { engine } = await createStore(t);
  await assert.rejects(() => engine.createMission({
    title: 'Unreviewed connector request',
    tasks: [{ id: 'source', type: 'climate.connector_snapshot', input: { connector: 'teesri' } }],
  }), { code: 'INVALID_TASK_INPUT' });
  await assert.rejects(() => engine.createMission({
    title: 'Connector query injection',
    tasks: [{ id: 'source', type: 'climate.connector_snapshot', input: { connector: 'clearsky', url: 'http://127.0.0.1/private' } }],
  }), { code: 'INVALID_TASK_INPUT' });
  await assert.rejects(() => engine.createMission({
    title: 'Vayu arbitrary coordinates',
    tasks: [{ id: 'source', type: 'climate.connector_snapshot', input: { connector: 'vayu', city: 'jodhpur', lat: 19.1, lng: 72.8 } }],
  }), { code: 'INVALID_TASK_INPUT' });
  await assert.rejects(() => engine.createMission({
    title: 'Vayu unsupported city',
    tasks: [{ id: 'source', type: 'climate.connector_snapshot', input: { connector: 'vayu', city: 'unknown' } }],
  }), { code: 'INVALID_TASK_INPUT' });
  const configuredCity = await engine.createMission({
    title: 'Vayu configured city',
    tasks: [{ id: 'source', type: 'climate.connector_snapshot', input: { connector: 'vayu', city: 'jodhpur' } }],
  });
  assert.equal(configuredCity.tasks[0].input.city, 'jodhpur');
});

test('retrieved memory identifiers and the verified manifest are attached to execution evidence without treating them as trusted instructions', async (t) => {
  const { engine } = await createStore(t);
  const missionId = await queued(engine, basicMission());
  const digest = 'a'.repeat(64);
  await engine.attachMemoryContext(missionId, { memoryIds: ['mem-climate-1'], manifestSha256: digest, retrievedAt: new Date().toISOString() });
  const completed = await engine.runMission(missionId);
  assert.equal(completed.status, 'mission_completed');
  const evidence = await engine.getExecutionEvidence(missionId, 'scenario');
  assert.deepEqual(evidence.relevantEngineeringMemories, ['mem-climate-1']);
  assert.equal(evidence.memoryManifestSha256, digest);
  assert.equal(evidence.memoryContextStatus, 'retrieved_not_interpreted_by_deterministic_task');
  assert.match(evidence.memoryRetrievedAt, /^\d{4}-\d\d-\d\dT/);
  assert.ok((await engine.getEvents(missionId)).some((event) => event.type === 'mission.memory_context_retrieved'));
});

test('background-worker claims require an attached readiness trace', async (t) => {
  const { engine } = await createStore(t);
  const missionId = await queued(engine);
  assert.equal((await engine.runMission(missionId, { workerId: 'background-worker', requireMemoryContext: true })).status, 'idle');
  assert.equal((await engine.getMission(missionId)).status, 'QUEUED');
  await engine.attachMemoryContext(missionId, { memoryIds: [], manifestSha256: 'b'.repeat(64), retrievedAt: new Date().toISOString() });
  const result = await engine.runMission(missionId, { workerId: 'background-worker', requireMemoryContext: true });
  assert.equal(result.status, 'mission_completed');
});

test('approval gate blocks work until an identified human approves and records the decision', async (t) => {
  const { engine } = await createStore(t);
  const missionId = await queued(engine, basicMission({ tasks: [{
    id: 'scenario', type: 'climate.emissions_scenario', requiresApproval: true,
    input: { baselineTco2e: 2, reductionPercent: 50, years: 2 },
  }] }));
  const held = await engine.runMission(missionId);
  assert.equal(held.status, 'waiting_approval');
  assert.equal(held.mission.status, 'WAITING_APPROVAL');
  assert.equal(held.mission.tasks[0].attempts, 0);
  await assert.rejects(() => engine.approveTask(missionId, 'scenario', { approvedBy: 'operator-1', decision: 'maybe' }), { code: 'INVALID_APPROVAL' });
  await engine.approveTask(missionId, 'scenario', { approvedBy: 'operator-1', comment: 'Reviewed assumptions.' });
  const completed = await engine.runMission(missionId);
  assert.equal(completed.status, 'mission_completed');
  assert.deepEqual(completed.mission.tasks[0].evidence.approval, {
    decision: 'approve', approvedBy: 'operator-1', comment: 'Reviewed assumptions.', decidedAt: completed.mission.tasks[0].evidence.approval.decidedAt,
  });
});

test('idempotency returns the original mission and rejects payload reuse', async (t) => {
  const { engine } = await createStore(t);
  const first = await engine.createMission(basicMission(), { idempotencyKey: 'browser-request-123' });
  const duplicate = await engine.createMission(basicMission(), { idempotencyKey: 'browser-request-123' });
  assert.equal(duplicate.id, first.id);
  await assert.rejects(() => engine.createMission(basicMission({ title: 'Different request' }), { idempotencyKey: 'browser-request-123' }), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('dependency validation rejects cycles, undeclared references, unsafe task types, and path-like inputs', async (t) => {
  const { engine } = await createStore(t);
  await assert.rejects(() => engine.createMission(basicMission({ tasks: [
    { id: 'a', type: 'report.render', dependsOn: ['b'], input: { title: 'A', sections: [{ heading: 'x', body: 'x' }] } },
    { id: 'b', type: 'report.render', dependsOn: ['a'], input: { title: 'B', sections: [{ heading: 'x', body: 'x' }] } },
  ] })), { code: 'DEPENDENCY_CYCLE' });
  await assert.rejects(() => engine.createMission(basicMission({ tasks: [
    { id: 'report', type: 'report.render', input: { title: 'x', sections: [{ heading: 'x', body: { $ref: { taskId: 'scenario', path: '/x' } } }] } },
    { id: 'scenario', type: 'climate.emissions_scenario', input: { baselineTco2e: 1, reductionPercent: 10, years: 1 } },
  ] })), { code: 'INVALID_REFERENCE' });
  await assert.rejects(() => engine.createMission(basicMission({ tasks: [{ id: 'shell', type: 'shell.exec', input: { command: 'whoami' } }] })), { code: 'TASK_NOT_ALLOWED' });
  await assert.rejects(() => engine.createMission(basicMission({ tasks: [{ id: 'a', type: 'report.render', dependsOn: ['missing'], input: {} }] })), { code: 'INVALID_DEPENDENCY' });
});

test('worker leases recover an abandoned task and stale workers cannot overwrite the new attempt', async (t) => {
  let time = Date.now();
  const { engine } = await createStore(t, { now: () => time, leaseMs: 100 });
  const missionId = await queued(engine, basicMission({ tasks: [{
    id: 'scenario', type: 'climate.emissions_scenario', retry: { maxAttempts: 1, delayMs: 0 },
    input: { baselineTco2e: 100, reductionPercent: 40, years: 5 },
  }] }));
  const oldClaim = await engine.claimNext({ missionId, workerId: 'crashed-worker' });
  assert.equal(oldClaim.status, 'claimed');
  time += 101;
  assert.deepEqual(await engine.recoverExpiredLeases(), { recovered: 1 });
  const newClaim = await engine.claimNext({ missionId, workerId: 'replacement-worker' });
  assert.equal(newClaim.status, 'claimed');
  assert.notEqual(newClaim.leaseToken, oldClaim.leaseToken);
  assert.equal((await engine.executeClaim(oldClaim)).status, 'lease_lost');
  assert.equal((await engine.executeClaim(newClaim)).status, 'mission_completed');
});

test('expired worker lease exhausts bounded retries and exposes failure', async (t) => {
  let time = Date.now();
  const { engine } = await createStore(t, { now: () => time, leaseMs: 100 });
  const missionId = await queued(engine, basicMission({ tasks: [{
    id: 'scenario', type: 'climate.emissions_scenario', retry: { maxAttempts: 1, delayMs: 0 },
    input: { baselineTco2e: 1, reductionPercent: 20, years: 2 },
  }] }));
  await engine.claimNext({ missionId, workerId: 'worker-one' });
  time += 101;
  await engine.recoverExpiredLeases();
  await engine.claimNext({ missionId, workerId: 'worker-two' });
  time += 101;
  assert.deepEqual(await engine.recoverExpiredLeases(), { recovered: 1 });
  const mission = await engine.getMission(missionId);
  assert.equal(mission.status, 'FAILED');
  assert.equal(mission.tasks[0].failure.code, 'LEASE_EXPIRED');
  assert.equal(mission.tasks[0].attempts, 2);
});

test('execution failures use bounded automatic retries, then manual retry is traceable', async (t) => {
  let time = Date.now();
  const { engine } = await createStore(t, { now: () => time });
  const missionId = await queued(engine, basicMission({ tasks: [{
    id: 'scenario', type: 'climate.emissions_scenario', retry: { maxAttempts: 1, delayMs: 250 },
    input: { baselineTco2e: -1, reductionPercent: 20, years: 2 },
  }] }));
  assert.equal((await engine.runNext({ missionId })).status, 'retry_scheduled');
  time += 251;
  assert.equal((await engine.runNext({ missionId })).status, 'failed');
  assert.equal((await engine.getMission(missionId)).status, 'FAILED');
  const retried = await engine.retryTask(missionId, 'scenario', { actor: 'operator-2', reason: 'Review the input source.' });
  assert.equal(retried.status, 'QUEUED');
  assert.equal(retried.tasks[0].manualRetries, 1);
  assert.ok((await engine.getEvents(missionId)).some((event) => event.type === 'task.manual_retry'));
});

test('pause, resume, and cancel are durable and cancel invalidates outstanding worker lease', async (t) => {
  const { engine, storePath } = await createStore(t);
  const missionId = await queued(engine, basicMission({ tasks: [
    { id: 'first', type: 'climate.emissions_scenario', input: { baselineTco2e: 1, reductionPercent: 10, years: 2 } },
    { id: 'second', type: 'report.render', dependsOn: ['first'], input: { title: 'Follow-up', sections: [{ heading: 'Output', body: { $ref: { taskId: 'first', path: '/classification' } } }] } },
  ] }));
  assert.equal((await engine.runNext({ missionId, workerId: 'worker' })).status, 'task_completed');
  await engine.pauseMission(missionId);
  assert.equal((await createMissionEngine({ storePath }).getMission(missionId)).status, 'PAUSED');
  assert.equal((await engine.runNext({ missionId })).status, 'idle');
  await engine.resumeMission(missionId);
  assert.equal((await engine.runMission(missionId)).status, 'mission_completed');

  const secondId = await queued(engine);
  const claim = await engine.claimNext({ missionId: secondId, workerId: 'worker' });
  await engine.cancelMission(secondId, { actor: 'operator', reason: 'Stop requested.' });
  assert.equal((await engine.executeClaim(claim)).status, 'lease_lost');
  assert.equal((await engine.getMission(secondId)).status, 'CANCELLED');
  assert.ok((await engine.getEvents(secondId)).some((event) => event.type === 'mission.cancelled'));
});

test('rejecting an approval blocks dependent tasks and cannot be mistaken for success', async (t) => {
  const { engine } = await createStore(t);
  const missionId = await queued(engine, basicMission({ tasks: [
    { id: 'gate', type: 'climate.emissions_scenario', requiresApproval: true, input: { baselineTco2e: 1, reductionPercent: 10, years: 2 } },
    { id: 'report', type: 'report.render', dependsOn: ['gate'], input: { title: 'Report', sections: [{ heading: 'x', body: 'x' }] } },
  ] }));
  await engine.runMission(missionId);
  const rejected = await engine.approveTask(missionId, 'gate', { approvedBy: 'reviewer', decision: 'reject', comment: 'Evidence not sufficient.' });
  assert.equal(rejected.status, 'BLOCKED');
  assert.equal(rejected.tasks[0].status, 'FAILED');
  assert.equal(rejected.tasks[1].status, 'BLOCKED');
  assert.equal(rejected.tasks[0].failure.code, 'HUMAN_REJECTED');
});

test('concurrent engine instances serialize idempotent creation without losing updates', async (t) => {
  const { engine, storePath } = await createStore(t);
  const peer = createMissionEngine({ storePath });
  const [first, duplicate, independent] = await Promise.all([
    engine.createMission(basicMission(), { idempotencyKey: 'shared-key' }),
    peer.createMission(basicMission(), { idempotencyKey: 'shared-key' }),
    peer.createMission(basicMission({ title: 'Independent mission' })),
  ]);
  assert.equal(first.id, duplicate.id);
  assert.equal((await engine.listMissions()).length, 2);
  assert.ok((await engine.getMission(independent.id)).id);
});

test('corruption is detected and existing bytes are not replaced with an empty store', async (t) => {
  const { engine, storePath } = await createStore(t);
  await engine.createMission(basicMission());
  const goodBytes = await readFile(storePath, 'utf8');
  await writeFile(storePath, goodBytes.replace('Local climate evidence workflow', 'Corrupted climate evidence workflow'));
  const corruptedBytes = await readFile(storePath, 'utf8');
  const restarted = createMissionEngine({ storePath });
  assert.equal((await restarted.verifyIntegrity()).valid, false);
  await assert.rejects(() => restarted.createMission(basicMission()), (error) => error instanceof MissionEngineError && error.code === 'STORE_CORRUPT');
  assert.equal(await readFile(storePath, 'utf8'), corruptedBytes);
});

test('definition export/import verifies checksum and resets execution status', async (t) => {
  const { engine } = await createStore(t);
  const missionId = await queued(engine);
  const exportData = await engine.exportMission(missionId);
  const imported = await engine.importMission(exportData, { idempotencyKey: 'imported-definition' });
  assert.equal(imported.status, 'CREATED');
  assert.equal(imported.title, 'Local climate evidence workflow');
  await assert.rejects(() => engine.importMission({ ...exportData, checksum: '0'.repeat(64) }), { code: 'INVALID_EXPORT' });
});

test('task and mission state transitions reject invalid actions', async (t) => {
  const { engine } = await createStore(t);
  const mission = await engine.createMission(basicMission());
  await assert.rejects(() => engine.queueMission(mission.id), { code: 'INVALID_TRANSITION' });
  await assert.rejects(() => engine.cancelMission('missing-mission'), { code: 'MISSION_NOT_FOUND' });
  await engine.validateMission(mission.id);
  await engine.queueMission(mission.id);
  await engine.runMission(mission.id);
  await assert.rejects(() => engine.pauseMission(mission.id), { code: 'INVALID_TRANSITION' });
});

