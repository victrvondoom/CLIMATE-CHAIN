import test from 'node:test';
import assert from 'node:assert/strict';
import { ConnectorError, createConnectorRegistry, SOURCE_CONNECTORS } from './registry.mjs';

function response(body, status = 200, headers = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function clearSkyStats() {
  return {
    farmers: 1, fields: 2, acres_registered: 4.5, acres_booked: 3, acres_cleared: 1.5,
    tonnes_booked: 1, tonnes_delivered: 0.5, payouts_estimated_inr: 300, red_fields: 1,
    yellow_fields: 1, alerts_sent: 2, bookings: 1, bookings_done: 0,
    fields_saved_after_alert: null, today: '2026-10-22', demo_prices: true,
  };
}

function vayuToday(mode = 'model') {
  return {
    schemaVersion: 1,
    place: { id: 'gps', name: 'Jodhpur', kind: 'other', lat: 26.29, lng: 73.02 },
    asOf: '2026-10-22T00:00:00.000Z', mode,
    hours: [{ t: '2026-10-22T00:00:00.000Z', pm25: 42, kind: 'forecast' }],
    windows: [], headline: 'Model-based outlook',
    prov: { mode, label: 'Estimate', source: 'model', fetchedAt: '2026-10-22T00:00:00.000Z', asOf: '2026-10-22T00:00:00.000Z', ageMinutes: 0 },
  };
}

test('registry exposes configured source contracts without treating configuration as live health', () => {
  const registry = createConnectorRegistry({ fetchImpl: async () => response({}) });
  assert.deepEqual(registry.names(), ['junksnap', 'clearsky', 'teesri', 'vayu']);
  const config = registry.getConfig('teesri');
  assert.equal(config.operations[0].schema, 'teesri-public-state');
  assert.match(config.auth, /masks\/rounds resident data/u);
  assert.equal(registry.getStatus('teesri').status, 'unknown');
  assert.equal(SOURCE_CONNECTORS.vayu.endpoints.today.path, '/v1/today');
});

test('read validates shape and returns endpoint provenance with query-safe URL', async () => {
  let called;
  const registry = createConnectorRegistry({
    env: { CLEARSKY_API_URL: 'https://example.test/base?token=secret' },
    fetchImpl: async (url, init) => {
      called = { url: String(url), init };
      return response(clearSkyStats(), 200, { 'x-request-id': 'src-123' });
    },
    maxRetries: 0,
  });
  const result = await registry.read('clearsky', 'stats', { query: { region: 'north' } });
  assert.equal(called.init.method, 'GET');
  assert.equal(new URL(called.url).searchParams.get('region'), 'north');
  assert.equal(result.data.fields, 2);
  assert.equal(result.provenance.mode, 'source_snapshot');
  assert.equal(result.provenance.connection, 'connected');
  assert.equal(result.provenance.requestId, 'src-123');
  assert.equal(result.provenance.url.includes('secret'), false);
  assert.equal(registry.getStatus('clearsky').status, 'connected');
});

test('successful reads use a bounded TTL cache and expose cache freshness accurately', async () => {
  let currentTime = Date.parse('2026-10-22T10:00:00.000Z');
  let calls = 0;
  const registry = createConnectorRegistry({
    now: () => currentTime,
    maxRetries: 0,
    cacheTtlMs: 1000,
    fetchImpl: async () => {
      calls += 1;
      return response({ ...clearSkyStats(), fields: calls });
    },
  });
  const first = await registry.read('clearsky', 'stats');
  const cached = await registry.read('clearsky', 'stats');
  assert.equal(calls, 1);
  assert.equal(first.provenance.cacheHit, false);
  assert.equal(cached.provenance.cacheHit, true);
  assert.equal(cached.data.fields, 1);
  assert.equal(cached.provenance.fetchedAt, first.provenance.fetchedAt);
  currentTime += 1001;
  const refreshed = await registry.read('clearsky', 'stats');
  assert.equal(calls, 2);
  assert.equal(refreshed.provenance.cacheHit, false);
  assert.equal(refreshed.data.fields, 2);
});

test('connector response cache evicts entries to stay within its total byte budget', async () => {
  let calls = 0;
  const payload = { ...clearSkyStats(), note: 'x'.repeat(512) };
  const maxCacheBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  const registry = createConnectorRegistry({
    maxRetries: 0,
    maxCacheBytes,
    fetchImpl: async () => { calls += 1; return response(payload); },
  });
  await registry.read('clearsky', 'stats', { query: { region: 'first' } });
  await registry.read('clearsky', 'stats', { query: { region: 'second' } });
  const firstAgain = await registry.read('clearsky', 'stats', { query: { region: 'first' } });
  assert.equal(firstAgain.provenance.cacheHit, false);
  assert.equal(calls, 3);
});

test('schema failures are explicit and are not retried as if they were a transient outage', async () => {
  let calls = 0;
  const registry = createConnectorRegistry({
    fetchImpl: async () => { calls += 1; return response({ farmers: 'unknown' }); },
    maxRetries: 3,
    breakerThreshold: 1,
  });
  await assert.rejects(registry.read('clearsky', 'stats'), (error) => {
    assert.ok(error instanceof ConnectorError);
    assert.equal(error.code, 'schema_invalid');
    assert.equal(error.details.schema, 'clearsky-public-stats');
    return true;
  });
  assert.equal(calls, 1);
  assert.equal(registry.getStatus('clearsky').breaker, 'open');
});

test('transient HTTP failures retry only within the configured bound', async () => {
  let calls = 0;
  const registry = createConnectorRegistry({
    fetchImpl: async () => (++calls === 1 ? response({ message: 'try later' }, 503) : response(clearSkyStats())),
    maxRetries: 1,
    delay: async () => {},
  });
  const result = await registry.read('clearsky', 'stats');
  assert.equal(calls, 2);
  assert.equal(result.provenance.attempts, 2);
});

test('non-retryable HTTP errors do not retry or open the circuit', async () => {
  let calls = 0;
  const registry = createConnectorRegistry({
    fetchImpl: async () => { calls += 1; return response({ message: 'unauthorized' }, 401); },
    maxRetries: 4,
    breakerThreshold: 1,
  });
  await assert.rejects(registry.read('clearsky', 'stats'), (error) => error.status === 401 && error.retryable === false);
  assert.equal(calls, 1);
  assert.equal(registry.getStatus('clearsky').breaker, 'closed');
});

test('network failures open a circuit, reject requests, then permit one recovery probe', async () => {
  let currentTime = 1000;
  let calls = 0;
  let online = false;
  const registry = createConnectorRegistry({
    now: () => currentTime,
    fetchImpl: async () => {
      calls += 1;
      if (!online) throw new Error('offline');
      return response(clearSkyStats());
    },
    maxRetries: 0,
    breakerThreshold: 2,
    breakerCooldownMs: 50,
  });
  await assert.rejects(registry.read('clearsky', 'stats'), { code: 'network_error' });
  await assert.rejects(registry.read('clearsky', 'stats'), { code: 'network_error' });
  assert.equal(registry.getStatus('clearsky').breaker, 'open');
  await assert.rejects(registry.read('clearsky', 'stats'), { code: 'circuit_open' });
  assert.equal(calls, 2);
  online = true;
  currentTime += 51;
  const recovered = await registry.read('clearsky', 'stats');
  assert.equal(recovered.data.fields, 2);
  assert.equal(registry.getStatus('clearsky').breaker, 'closed');
  assert.equal(registry.getStatus('clearsky').failures, 0);
});

test('request timeout aborts fetch and reports an explicit timeout', async () => {
  const registry = createConnectorRegistry({
    timeoutMs: 5,
    maxRetries: 0,
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  });
  await assert.rejects(registry.read('clearsky', 'stats'), { code: 'timeout' });
});

test('rejects declared oversized connector responses before parsing', async () => {
  let calls = 0;
  const registry = createConnectorRegistry({
    fetchImpl: async () => { calls += 1; return response(clearSkyStats(), 200, { 'content-length': '1000' }); },
    maxResponseBytes: 128,
    maxRetries: 3,
    breakerThreshold: 1,
  });
  await assert.rejects(registry.read('clearsky', 'stats'), (error) => {
    assert.equal(error.code, 'response_too_large');
    assert.equal(error.retryable, false);
    assert.equal(error.details.maxResponseBytes, 128);
    return true;
  });
  assert.equal(calls, 1);
  assert.equal(registry.getStatus('clearsky').breaker, 'open');
});

test('bounds streamed connector and health bodies when content length is absent', async () => {
  const oversized = () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('12345678'));
      controller.enqueue(new TextEncoder().encode('90123456'));
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  const registry = createConnectorRegistry({
    fetchImpl: async () => oversized(),
    maxResponseBytes: 12,
    maxRetries: 0,
  });
  await assert.rejects(registry.read('clearsky', 'stats'), { code: 'response_too_large' });

  const healthRegistry = createConnectorRegistry({
    fetchImpl: async () => oversized(),
    maxResponseBytes: 12,
    maxRetries: 0,
  });
  const health = await healthRegistry.health('clearsky');
  assert.equal(health.status, 'disconnected');
  assert.equal(health.error.code, 'response_too_large');
});

test('query parameters reject unsafe names and non-scalar values', async () => {
  const registry = createConnectorRegistry({ fetchImpl: async () => response(clearSkyStats()) });
  await assert.rejects(registry.read('clearsky', 'stats', { query: { 'x&admin': '1' } }), { code: 'invalid_query' });
  await assert.rejects(registry.read('clearsky', 'stats', { query: { site: { id: 'x' } } }), { code: 'invalid_query' });
});

test('health reports source reachability separately and uses source path conventions', async () => {
  let requested;
  const registry = createConnectorRegistry({
    env: { TEESRI_API_URL: 'https://teesri.example' },
    fetchImpl: async (url) => { requested = String(url); return response({ homes: [] }); },
    maxRetries: 0,
  });
  const health = await registry.health('teesri');
  assert.equal(new URL(requested).pathname, '/api/state');
  assert.equal(health.status, 'connected');
  assert.equal(health.http, 200);
});

test('AirPulse contract checks versioned data shape and preserves model versus measured mode', async () => {
  const registry = createConnectorRegistry({ fetchImpl: async () => response(vayuToday()) });
  const result = await registry.read('vayu', 'today', { query: { lat: 26.29, lng: 73.02 } });
  assert.equal(result.data.hours[0].pm25, 42);
  assert.equal(result.provenance.mode, 'model');
  assert.equal(result.provenance.connection, 'connected');

  const malformed = createConnectorRegistry({ fetchImpl: async () => response({ ...vayuToday(), schemaVersion: 2, place: { lat: 'unknown' } }) });
  await assert.rejects(malformed.read('vayu', 'today'), (error) => {
    assert.equal(error.code, 'schema_invalid');
    assert.ok(error.details.errors.some((entry) => entry.path === '$.schemaVersion'));
    return true;
  });
});

