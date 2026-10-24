import test from 'node:test';
import assert from 'node:assert/strict';
import { createGatewayServer } from '../gateway.mjs';

const LOCAL = { origin: 'http://127.0.0.1:8080', 'content-type': 'application/json' };
const evidenceId = `ev-${'a'.repeat(24)}`;
const claimId = `cl-${'b'.repeat(24)}`;

function fakeService(calls) {
  const record = (name) => (...args) => { calls.push([name, ...args]); return Promise.resolve({ ok: name }); };
  return {
    status: async () => ({ ledgerMode: 'LOCAL_EVM', chainId: 31337 }),
    sites: () => ({ sites: [{ id: 'new-delhi' }] }),
    history: record('history'),
    reset: record('reset'),
    buildEvidence: record('buildEvidence'),
    getEvidence: record('getEvidence'),
    verify: record('verify'),
    anchor: async (id) => { calls.push(['anchor', id]); return { evidenceId: id, alreadyAnchored: calls.filter(([name]) => name === 'anchor').length > 1 }; },
    tamper: record('tamper'),
    replay: record('replay'),
    submitClaim: record('submitClaim'),
    getClaim: record('getClaim'),
    duplicateClaim: async () => { throw Object.assign(new Error('The contract rejected submitClaim: DuplicateClaim.'), { status: 409, code: 'contract_rejected', errorName: 'DuplicateClaim', errorArgs: ['0x01', '0x02'] }); },
    challenge: record('challenge'),
    correct: record('correct'),
    resolve: record('resolve'),
  };
}

async function withGateway(service, run) {
  const gateway = createGatewayServer({ missionEngine: {}, connectorRegistry: {}, projectRegistry: [], integrityService: service });
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${gateway.address().port}/api/v1/integrity`); }
  finally { await new Promise((resolve, reject) => gateway.close((error) => error ? reject(error) : resolve())); }
}

test('integrity reads return the service results', async () => {
  const calls = [];
  await withGateway(fakeService(calls), async (base) => {
    assert.deepEqual(await (await fetch(`${base}/status`)).json(), { ledgerMode: 'LOCAL_EVM', chainId: 31337 });
    assert.deepEqual(await (await fetch(`${base}/sites`)).json(), { sites: [{ id: 'new-delhi' }] });
    assert.equal((await fetch(`${base}/evidence/${evidenceId}`)).status, 200);
    assert.equal((await fetch(`${base}/evidence/${evidenceId}/verify`)).status, 200);
    assert.equal((await fetch(`${base}/claims/${claimId}`)).status, 200);
    assert.equal((await fetch(`${base}/history`)).status, 200);
    assert.deepEqual(calls.map(([name]) => name), ['getEvidence', 'verify', 'getClaim', 'history']);
  });
});

test('local writes reach the service with their bodies and return 201 when they create records', async () => {
  const calls = [];
  await withGateway(fakeService(calls), async (base) => {
    const built = await fetch(`${base}/evidence`, { method: 'POST', headers: LOCAL, body: JSON.stringify({ siteId: 'new-delhi', analyte: 'pm2_5', mode: 'cached' }) });
    assert.equal(built.status, 201);
    assert.equal((await fetch(`${base}/evidence/${evidenceId}/anchor`, { method: 'POST', headers: LOCAL })).status, 201);
    assert.equal((await fetch(`${base}/evidence/${evidenceId}/anchor`, { method: 'POST', headers: LOCAL })).status, 200, 'an existing anchor is not re-created');
    assert.equal((await fetch(`${base}/evidence/${evidenceId}/tamper`, { method: 'POST', headers: LOCAL, body: '{}' })).status, 200);
    assert.equal((await fetch(`${base}/claims`, { method: 'POST', headers: LOCAL, body: JSON.stringify({ evidenceId }) })).status, 201);
    await fetch(`${base}/claims/${claimId}/challenge`, { method: 'POST', headers: LOCAL, body: JSON.stringify({ reasonCode: 'STALE_SOURCE', detail: 'The cached example is two days old.' }) });
    await fetch(`${base}/claims/${claimId}/resolve`, { method: 'POST', headers: LOCAL, body: JSON.stringify({ upheld: false }) });
    await fetch(`${base}/claims/${claimId}/correct`, { method: 'POST', headers: LOCAL, body: JSON.stringify({ note: 'Re-fetched live data.' }) });
    assert.deepEqual(calls.find(([name]) => name === 'buildEvidence')[1], { siteId: 'new-delhi', analyte: 'pm2_5', mode: 'cached' });
    assert.deepEqual(calls.find(([name]) => name === 'challenge').slice(1), [claimId, { reasonCode: 'STALE_SOURCE', detail: 'The cached example is two days old.' }]);
    assert.deepEqual(calls.find(([name]) => name === 'resolve').slice(1), [claimId, { upheld: false }]);
    assert.deepEqual(calls.find(([name]) => name === 'correct').slice(1), [claimId, { note: 'Re-fetched live data.' }]);
  });
});

test('writes from a non-local browser origin are refused before the service runs', async () => {
  const calls = [];
  await withGateway(fakeService(calls), async (base) => {
    const response = await fetch(`${base}/evidence/${evidenceId}/anchor`, { method: 'POST', headers: { origin: 'https://attacker.example', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'local_access_required');
    assert.equal(calls.length, 0);
  });
});

test('contract rejections and source limits keep their codes, names and retry hints', async () => {
  const calls = [];
  const service = {
    ...fakeService(calls),
    buildEvidence: async () => { throw Object.assign(new Error('Open-Meteo rate limit reached (HTTP 429).'), { status: 503, code: 'source_rate_limited', retryAfterSeconds: 30 }); },
  };
  await withGateway(service, async (base) => {
    const duplicate = await fetch(`${base}/claims/${claimId}/duplicate`, { method: 'POST', headers: LOCAL });
    assert.equal(duplicate.status, 409);
    const body = await duplicate.json();
    assert.equal(body.error.code, 'contract_rejected');
    assert.equal(body.error.errorName, 'DuplicateClaim');
    assert.deepEqual(body.error.errorArgs, ['0x01', '0x02']);

    const limited = await fetch(`${base}/evidence`, { method: 'POST', headers: LOCAL, body: '{}' });
    assert.equal(limited.status, 503);
    assert.equal((await limited.json()).error.retryAfterSeconds, 30);
  });
});

test('bad bodies, unknown routes and unsupported methods are refused clearly', async () => {
  await withGateway(fakeService([]), async (base) => {
    const invalid = await fetch(`${base}/evidence`, { method: 'POST', headers: LOCAL, body: '{not json' });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, 'INVALID_JSON');
    assert.equal((await fetch(`${base}/evidence/${evidenceId}/explode`, { method: 'POST', headers: LOCAL })).status, 404);
    assert.equal((await fetch(`${base}/nothing`)).status, 404);
    assert.equal((await fetch(`${base}/status`, { method: 'PUT', headers: LOCAL, body: '{}' })).status, 405);
  });
});
