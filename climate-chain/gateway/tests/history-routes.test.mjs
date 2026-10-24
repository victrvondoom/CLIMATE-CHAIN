import test from 'node:test';
import assert from 'node:assert/strict';
import { createGatewayServer } from '../gateway.mjs';

function makeRequest(server, path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}${path}`;
    fetch(url, { method })
      .then(async (res) => {
        const text = await res.text();
        let body;
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
        resolve({ status: res.status, headers: res.headers, body });
      })
      .catch(reject);
  });
}

test('History Routes: /api/v1/history/datasets returns catalog', async () => {
  const server = await createGatewayServer();
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  try {
    const res = await makeRequest(server, '/api/v1/history/datasets');
    assert.equal(res.status, 200);
    assert.ok(res.body.datasets);
    assert.ok(res.body.total_cataloged_datasets >= 8);
  } finally {
    server.close();
  }
});

test('History Routes: /api/v1/history/timeline returns observations and preserves data gaps', async () => {
  const server = await createGatewayServer();
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  try {
    const res = await makeRequest(server, '/api/v1/history/timeline?indicator=temperature_anomaly&startYear=1875&endYear=1885');
    assert.equal(res.status, 200);
    assert.equal(res.body.indicator, 'temperature_anomaly');
    const obs = res.body.observations;
    assert.ok(obs.length === 11);
    
    // 1875 is a gap
    const pre1880 = obs.find((o) => o.year === 1875);
    assert.equal(pre1880.is_gap, true);
    assert.equal(pre1880.value, null);

    // 1880 is observed
    const year1880 = obs.find((o) => o.year === 1880);
    assert.equal(year1880.is_gap, false);
    assert.equal(year1880.value, -0.16);
  } finally {
    server.close();
  }
});

test('History Routes: /api/v1/history/events returns policy and science milestones', async () => {
  const server = await createGatewayServer();
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  try {
    const res = await makeRequest(server, '/api/v1/history/events');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.events));
    assert.ok(res.body.events.length >= 10);
    const montreal = res.body.events.find((e) => e.year === 1987);
    assert.ok(montreal);
    assert.ok(montreal.title.includes('Montreal Protocol'));
  } finally {
    server.close();
  }
});

test('History Routes: /api/v1/history/observation-evidence produces evidence manifest', async () => {
  const server = await createGatewayServer();
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  try {
    const res = await makeRequest(server, '/api/v1/history/observation-evidence?indicator=temperature_anomaly&year=2024');
    assert.equal(res.status, 200);
    assert.equal(res.body.evidence_id, 'HIST-TEMPERATURE_ANOMALY-2024');
    assert.equal(res.body.payload.observed_value, 1.28);
    assert.ok(res.body.sha256_digest);
  } finally {
    server.close();
  }
});
