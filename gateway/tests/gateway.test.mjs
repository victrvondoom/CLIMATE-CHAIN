import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createGatewayServer } from '../gateway.mjs';
import { hashEvidence } from '../cascade.mjs';

const now = new Date();
const at = (minutesAgo) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
const oldJunkSnapUrl = process.env.JUNKSNAP_API_URL;
const oldVayuUrl = process.env.VAYU_API_URL;
const oldTeesriUrl = process.env.TEESRI_API_URL;
const oldClearSkyUrl = process.env.CLEARSKY_API_URL;
let upstream;
let gateway;
let baseUrl;
let forwardedWriteCount = 0;
let upstreamRequestCount = 0;

before(async () => {
  upstream = http.createServer((req, res) => {
    upstreamRequestCount += 1;
    if (!['GET', 'HEAD'].includes(req.method)) forwardedWriteCount += 1;
    res.setHeader('content-type', 'application/json');
    if (req.url === '/healthz' || req.url === '/v1/health') {
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (req.url === '/api/stats') {
      res.end(JSON.stringify({
        farmers: 10, fields: 12, acres_registered: 100, acres_booked: 80, acres_cleared: 30,
        tonnes_booked: 20, tonnes_delivered: 10, payouts_estimated_inr: 500, red_fields: 1,
        yellow_fields: 2, alerts_sent: 3, bookings: 5, bookings_done: 4, today: at(0), resident_id: 'private-fixture-only',
      }));
      return;
    }
    if (req.url.startsWith('/sites?')) {
      res.end(JSON.stringify({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [73.02, 26.29] },
          properties: {
            site_id: 'site_jdh_test', report_type: 'waste_dump', context: 'test_area',
            status: 'open', verification: 'unverified', report_count: 2, verified_count: 0,
            first_reported_at: at(45), last_reported_at: at(20),
          },
        }],
      }));
      return;
    }
    if (req.url.startsWith('/v1/today?')) {
      res.end(JSON.stringify({
        schemaVersion: 1,
        place: { id: 'gps', name: 'Rounded query point', kind: 'other', lat: 26.29, lng: 73.02 },
        asOf: at(0),
        mode: 'live',
        hours: [{ t: at(30), pm25: 58, kind: 'observed' }],
        prov: {
          mode: 'live', label: 'Nearby station', source: 'station', stationId: 'station-demo',
          stationName: 'North test monitor', distanceKm: 2.1, observedAt: at(30),
          fetchedAt: at(0), asOf: at(0), ageMinutes: 30, simulated: false,
        },
        windows: [], headline: 'Fixture source summary',
      }));
      return;
    }
    if (req.url.startsWith('/api/state')) {
      res.end(JSON.stringify({ homes: [{
        id: 'private-resident-id', label: 'Private home', lat: 19.1, lon: 72.8,
        reported: true, warned: true, in_ring: true, messages: ['private text'],
      }] }));
      return;
    }
    if (req.url === '/write-test') {
      res.writeHead(202);
      res.end(JSON.stringify({ method: req.method, authorization: req.headers.authorization ?? null }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamAddress = upstream.address();
  baseUrl = `http://127.0.0.1:${upstreamAddress.port}`;
  process.env.JUNKSNAP_API_URL = baseUrl;
  process.env.VAYU_API_URL = baseUrl;
  process.env.TEESRI_API_URL = baseUrl;
  process.env.CLEARSKY_API_URL = baseUrl;

  gateway = createGatewayServer();
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
});

after(async () => {
  if (gateway?.listening) await new Promise((resolve, reject) => gateway.close((err) => err ? reject(err) : resolve()));
  if (upstream?.listening) await new Promise((resolve, reject) => upstream.close((err) => err ? reject(err) : resolve()));
  if (oldJunkSnapUrl === undefined) delete process.env.JUNKSNAP_API_URL;
  else process.env.JUNKSNAP_API_URL = oldJunkSnapUrl;
  if (oldVayuUrl === undefined) delete process.env.VAYU_API_URL;
  else process.env.VAYU_API_URL = oldVayuUrl;
  if (oldTeesriUrl === undefined) delete process.env.TEESRI_API_URL;
  else process.env.TEESRI_API_URL = oldTeesriUrl;
  if (oldClearSkyUrl === undefined) delete process.env.CLEARSKY_API_URL;
  else process.env.CLEARSKY_API_URL = oldClearSkyUrl;
});

test('read-only cascade endpoint returns live provenance and a verifiable review manifest', async () => {
  const address = gateway.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/cascade?site=site_jdh_test`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.assessment.status, 'ready_for_human_review');
  assert.equal(body.assessment.candidate, true);
  assert.equal(body.sources.junksnap, 'live');
  assert.equal(body.sources.vayu, 'live');
  assert.equal(body.evidence.site.sourceId, 'site_jdh_test');
  assert.equal(body.evidence.air.provenance.stationName, 'North test monitor');
  const { integrity, ...payload } = body.manifest;
  assert.equal(hashEvidence(payload), integrity.digest);
  assert.match(body.manifest.integrity.limitation, /does not provide independent or immutable storage/);
});

test('cascade endpoint rejects invalid identifiers, thresholds, and writes', async () => {
  const address = gateway.address();
  const invalidId = await fetch(`http://127.0.0.1:${address.port}/api/v1/cascade?site=../x`);
  assert.equal(invalidId.status, 400);
  const invalidThreshold = await fetch(`http://127.0.0.1:${address.port}/api/v1/cascade?site=site_jdh_test&radiusKm=51`);
  assert.equal(invalidThreshold.status, 400);
  const zeroThreshold = await fetch(`http://127.0.0.1:${address.port}/api/v1/cascade?site=site_jdh_test&radiusKm=0`);
  assert.equal(zeroThreshold.status, 400);
  const write = await fetch(`http://127.0.0.1:${address.port}/api/v1/cascade?site=site_jdh_test`, { method: 'POST' });
  assert.equal(write.status, 405);
});

test('explicit local walkthrough is labeled simulated and cannot become a candidate', async () => {
  const address = gateway.address();
  const before = upstreamRequestCount;
  const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/cascade?site=site_mock_1&demo=1`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.demo, true);
  assert.equal(body.sources.junksnap, 'mock');
  assert.equal(body.sources.vayu, 'mock');
  assert.equal(body.assessment.candidate, false);
  assert.equal(body.assessment.status, 'source_not_observed');
  assert.equal(body.evidence.air.provenance.simulated, true);
  assert.equal(upstreamRequestCount, before);
});

test('live source failure returns an error instead of a simulated review result', async () => {
  const address = gateway.address();
  const configuredUrl = process.env.JUNKSNAP_API_URL;
  process.env.JUNKSNAP_API_URL = 'http://127.0.0.1:1';
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/cascade?site=site_mock_1`);
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.error.code, 'source_unavailable');
    assert.equal(Object.hasOwn(body, 'assessment'), false);
  } finally {
    if (configuredUrl === undefined) delete process.env.JUNKSNAP_API_URL;
    else process.env.JUNKSNAP_API_URL = configuredUrl;
  }
});

test('Teesri snapshot is aggregated while shared source proxy remains read-only', async () => {
  const address = gateway.address();
  const localOrigin = 'http://127.0.0.1:5173';
  const response = await fetch(`http://127.0.0.1:${address.port}/api/teesri/api/state`, { headers: { origin: localOrigin } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), localOrigin);
  assert.notEqual(response.headers.get('access-control-allow-origin'), '*');
  const body = await response.json();
  assert.equal(body.mode, 'source_snapshot');
  assert.equal(body.reported, 1);
  assert.equal(Object.hasOwn(body, 'homes'), false);
  assert.equal(JSON.stringify(body).includes('private-resident-id'), false);
  assert.equal(JSON.stringify(body).includes('19.1'), false);

  const write = await fetch(`http://127.0.0.1:${address.port}/api/junksnap/write-test`, {
    method: 'POST',
    headers: { authorization: 'Bearer local-fixture-token', 'content-type': 'application/json' },
    body: JSON.stringify({ request: 'fixture-only' }),
  });
  assert.equal(write.status, 405);
  assert.equal((await write.json()).error.code, 'method_not_allowed');
  assert.equal(forwardedWriteCount, 0);

  const hostilePreflight = await fetch(`http://127.0.0.1:${address.port}/api/teesri/api/state`, {
    method: 'OPTIONS', headers: { origin: 'https://untrusted.example', 'access-control-request-method': 'POST' },
  });
  assert.equal(hostilePreflight.status, 403);
  assert.equal(hostilePreflight.headers.get('access-control-allow-origin'), null);
});

test('unified overview and health use the validated connector registry with per-source provenance', async () => {
  const address = gateway.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/unified/overview?city=delhi`);
  assert.equal(response.status, 200);
  const overview = await response.json();
  for (const source of ['junksnap', 'clearsky', 'teesri', 'vayu']) {
    assert.equal(overview.sources[source].mode, 'live');
    assert.equal(overview.sources[source].connection, 'connected');
    assert.equal(overview.sources[source].provenance.transport, 'http');
    assert.equal(overview.sources[source].provenance.attempts, 1);
  }
  assert.equal(overview.air.pm25Now, 58);
  const health = await fetch(`http://127.0.0.1:${address.port}/api/services`);
  const services = await health.json();
  assert.equal(services.services.length, 4);
  assert.ok(services.services.every((service) => service.status === 'connected'));
  const registry = await fetch(`http://127.0.0.1:${address.port}/api/connectors`);
  const descriptors = await registry.json();
  assert.equal(descriptors.connectors.length, 4);
  assert.ok(descriptors.connectors.every((connector) => connector.operations.length > 0));
});

test('gateway mission API executes behind its local boundary and survives gateway restart with evidence', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'climate-chain-gateway-mission-'));
  const missionStorePath = path.join(directory, 'missions.json');
  const previousMemoryDir = process.env.CLIMATE_CHAIN_MEMORY_DIR;
  const previousEncryptionMode = process.env.CLIMATE_CHAIN_MEMORY_ENCRYPTION;
  const previousMissionPath = process.env.CLIMATE_CHAIN_MISSIONS_PATH;
  const previousWorkerStatusPath = process.env.CLIMATE_CHAIN_WORKER_STATUS_PATH;
  process.env.CLIMATE_CHAIN_MEMORY_DIR = path.join(directory, 'memory-vault');
  process.env.CLIMATE_CHAIN_MEMORY_ENCRYPTION = 'off';
  process.env.CLIMATE_CHAIN_MISSIONS_PATH = missionStorePath;
  process.env.CLIMATE_CHAIN_WORKER_STATUS_PATH = path.join(directory, 'worker-status.json');
  let server;
  let worker;
  const start = async () => {
    server = createGatewayServer({ missionStorePath });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
  };
  const stop = async () => {
    if (server?.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  };
  const stopWorker = async () => {
    if (!worker || worker.exitCode !== null) { worker = null; return; }
    const child = worker;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    if (child.connected) child.send({ type: 'shutdown' }, () => {});
    else child.kill('SIGTERM');
    await exited;
    worker = null;
  };
  try {
    let base = await start();
    worker = spawn(process.execPath, [fileURLToPath(new URL('../mission-worker.mjs', import.meta.url))], {
      env: { ...process.env, CLIMATE_CHAIN_WORKER_POLL_MS: '100', CLIMATE_CHAIN_WORKER_ID: 'gateway-test-worker' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    let health;
    let healthBody;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      health = await fetch(`${base}/api/health`, { headers: { 'x-correlation-id': 'browser-smoke-1' } });
      healthBody = await health.json();
      if (healthBody.status === 'ready' && healthBody.worker?.status === 'running') break;
      await delay(50);
    }
    assert.equal(health.status, 200, JSON.stringify(healthBody));
    assert.equal(healthBody.status, 'ready');
    assert.equal(healthBody.worker.available, true);
    assert.equal(healthBody.worker.workerId, 'gateway-test-worker');
    assert.equal(healthBody.correlationId, 'browser-smoke-1');
    assert.equal(health.headers.get('x-correlation-id'), 'browser-smoke-1');
    assert.equal(healthBody.memory.status, 'ready');
    const forbidden = await fetch(`${base}/api/missions`, { headers: { origin: 'https://attacker.example' } });
    assert.equal(forbidden.status, 403);
    const created = await fetch(`${base}/api/missions`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'genesis-e2e-1' },
      body: JSON.stringify({ title: 'Gateway durable proof', tasks: [
        { id: 'clearsky', type: 'climate.connector_snapshot', title: 'Refresh aggregate source', input: { connector: 'clearsky' }, timeoutMs: 8_000 },
        { id: 'vayu', type: 'climate.connector_snapshot', title: 'Refresh Vayu city sample', input: { connector: 'vayu', city: 'jodhpur' }, timeoutMs: 8_000 },
        { id: 'scenario', type: 'climate.emissions_scenario', title: 'Run bounded scenario', input: { baselineTco2e: 25, reductionPercent: 20, years: 3 } },
        { id: 'report', type: 'report.render', title: 'Render evidence report', dependsOn: ['clearsky', 'vayu', 'scenario'], input: { title: 'Connector-backed proof', sections: [
          { heading: 'Source', body: { $ref: { taskId: 'clearsky', path: '' } } },
          { heading: 'Air-quality sample', body: { $ref: { taskId: 'vayu', path: '' } } },
          { heading: 'Scenario', body: { $ref: { taskId: 'scenario', path: '' } } },
        ] } },
      ] }),
    });
    assert.equal(created.status, 201);
    const missionId = (await created.json()).mission.id;
    const validated = await fetch(`${base}/api/missions/${missionId}/validate`, { method: 'POST' });
    assert.equal(validated.status, 200);
    const queued = await fetch(`${base}/api/missions/${missionId}/queue`, { method: 'POST' });
    assert.equal(queued.status, 200);
    const prepared = await fetch(`${base}/api/missions/${missionId}/run`, { method: 'POST' });
    assert.equal(prepared.status, 202);
    assert.equal((await prepared.json()).status, 'queued_for_worker');
    let result;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const current = await fetch(`${base}/api/missions/${missionId}`);
      const record = await current.json();
      if (record.mission.status === 'COMPLETED') { result = record; break; }
      await delay(100);
    }
    assert.ok(result, 'independent worker should complete the queued task');
    assert.equal(result.mission.tasks[0].output.classification, 'SOURCE_SNAPSHOT');
    assert.equal(result.mission.tasks[0].output.connector, 'clearsky');
    assert.equal(result.mission.tasks[0].output.data.fields, 12);
    assert.equal(Object.hasOwn(result.mission.tasks[0].output.data, 'resident_id'), false, 'unexpected source fields are not persisted');
    assert.equal(result.mission.tasks[0].evidence.sourceProvenance.source, 'clearsky');
    assert.equal(result.mission.tasks[0].evidence.sourceProvenance.schema, 'clearsky-public-stats');
    assert.deepEqual(result.mission.tasks[0].evidence.inputReferences, ['connector:clearsky']);
    const vayu = result.mission.tasks[1];
    assert.equal(vayu.output.classification, 'SOURCE_SNAPSHOT');
    assert.equal(vayu.output.connector, 'vayu');
    assert.equal(vayu.output.sourceMode, 'live');
    assert.deepEqual(vayu.output.data.measurements, [{ at: at(30), pm25: 58, kind: 'observed' }]);
    assert.equal(JSON.stringify(vayu.output).includes('Rounded query point'), false);
    assert.equal(JSON.stringify(vayu.output).includes('26.29'), false);
    assert.equal(vayu.evidence.sourceProvenance.source, 'vayu');
    assert.deepEqual(vayu.evidence.inputReferences, ['connector:vayu']);
    assert.equal(result.mission.tasks[2].output.classification, 'SIMULATION');
    assert.equal(result.mission.tasks[3].status, 'COMPLETED');
    assert.equal(result.mission.tasks[0].evidence.memoryContextStatus, 'retrieval_completed_no_matching_memory');
    assert.match(result.mission.tasks[0].evidence.memoryManifestSha256, /^[a-f\d]{64}$/);
    const evidence = await fetch(`${base}/api/missions/${missionId}/evidence/clearsky`);
    const sourceEvidence = (await evidence.json()).evidence;
    assert.equal(sourceEvidence.classification, 'SOURCE_SNAPSHOT');
    assert.equal(sourceEvidence.sourceProvenance.operation, 'stats');
    const vayuEvidenceResponse = await fetch(`${base}/api/missions/${missionId}/evidence/vayu`);
    const vayuEvidence = (await vayuEvidenceResponse.json()).evidence;
    assert.equal(vayuEvidence.sourceProvenance.operation, 'today');
    const report = await fetch(`${base}/api/missions/${missionId}/export`);
    assert.equal((await report.json()).format, 'climate-chain-mission-definition');
    await stopWorker();
    await stop();
    base = await start();
    const stoppedHealth = await fetch(`${base}/api/health`);
    const stoppedStatus = await stoppedHealth.json();
    assert.equal(stoppedStatus.worker.status, 'stopped', JSON.stringify(stoppedStatus.worker));
    assert.equal(stoppedHealth.status, 503);
    const restarted = await fetch(`${base}/api/missions/${missionId}`);
    assert.equal(restarted.status, 200);
    const record = await restarted.json();
    assert.equal(record.mission.status, 'COMPLETED');
    assert.ok(record.events.some((event) => event.type === 'mission.memory_context_retrieved'));
    assert.equal(restarted.headers.get('access-control-allow-origin'), null, 'mission responses do not enable cross-origin reads');
  } finally {
    await stopWorker();
    await stop();
    if (previousMemoryDir === undefined) delete process.env.CLIMATE_CHAIN_MEMORY_DIR;
    else process.env.CLIMATE_CHAIN_MEMORY_DIR = previousMemoryDir;
    if (previousEncryptionMode === undefined) delete process.env.CLIMATE_CHAIN_MEMORY_ENCRYPTION;
    else process.env.CLIMATE_CHAIN_MEMORY_ENCRYPTION = previousEncryptionMode;
    if (previousMissionPath === undefined) delete process.env.CLIMATE_CHAIN_MISSIONS_PATH;
    else process.env.CLIMATE_CHAIN_MISSIONS_PATH = previousMissionPath;
    if (previousWorkerStatusPath === undefined) delete process.env.CLIMATE_CHAIN_WORKER_STATUS_PATH;
    else process.env.CLIMATE_CHAIN_WORKER_STATUS_PATH = previousWorkerStatusPath;
    await rm(directory, { recursive: true, force: true });
  }
});
