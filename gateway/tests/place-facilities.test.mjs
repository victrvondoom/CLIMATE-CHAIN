import test from 'node:test';
import assert from 'node:assert/strict';
import { createFacilityService, FACILITY_PROVIDER_URL } from '../place-facilities.mjs';

const works = (id = 1) => ({ type: 'way', id, center: { lat: 26.3, lon: 73.1 }, tags: { man_made: 'works', name: 'Mapped fixture works', operator: 'Fixture operator', product: 'textiles' } });
const response = (elements = [works()], extra = {}) => Response.json({ elements, ...extra });

test('fixed bounded POST query normalizes mapped works and power plants with source links', async () => {
  const calls = [];
  const service = createFacilityService({ fetchImpl: async (...args) => {
    calls.push(args);
    return response([works(), { type: 'node', id: 2, lat: 26.31, lon: 73.12, tags: { power: 'plant', 'name:en': 'Mapped fixture plant' } }]);
  } });
  const result = await service.nearby(26.29, 73.02);
  assert.equal(result.status, 'available');
  assert.equal(result.facilities.length, 2);
  assert.deepEqual(result.facilities[0], { id: 'osm:way:1', name: 'Mapped fixture works', lat: 26.3, lng: 73.1, kind: 'industrial_works', operator: 'Fixture operator', product: 'textiles', sourceUrl: 'https://www.openstreetmap.org/way/1' });
  assert.equal(result.facilities[1].kind, 'power_plant');
  assert.equal(result.facilities[1].operator, null);
  assert.equal(result.provenance.dataKind, 'mapped');
  assert.ok(result.provenance.notes.some((note) => /emissions.*unknown/i.test(note)));
  assert.equal(calls[0][0], FACILITY_PROVIDER_URL);
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].redirect, 'error');
  const query = new URLSearchParams(calls[0][1].body).get('data');
  assert.match(query, /\[timeout:12\]/);
  assert.match(query, /around:15000,26\.2900000,73\.0200000/);
  assert.match(query, /nwr\["man_made"="works"\]/);
  assert.match(query, /nwr\["power"="plant"\]/);
  assert.match(query, /out body center 40;/);
});

test('invalid coordinates, nonfinite numbers and excessive radii never fetch', async () => {
  let calls = 0;
  const service = createFacilityService({ fetchImpl: async () => { calls++; return response(); } });
  for (const args of [[91, 0], [0, -181], [NaN, 0], [0, Infinity], ['26', 73], [0, 0, 0], [0, 0, -1], [0, 0, 26], [0, 0, '15']]) {
    await assert.rejects(service.nearby(...args), /must be/);
  }
  assert.equal(calls, 0);
});

test('ignores unsupported and unlocated records, deduplicates and caps results at40', async () => {
  const elements = [null, { ...works(), center: null }, { ...works(), id: -1 }, { ...works(), tags: { shop: 'mall' } }, works(4), works(4), ...Array.from({ length: 70 }, (_, index) => works(index + 10))];
  const result = await createFacilityService({ fetchImpl: async () => response(elements) }).nearby(0, 0, 25);
  assert.equal(result.status, 'available');
  assert.equal(result.facilities.length, 40);
  assert.equal(new Set(result.facilities.map((item) => item.id)).size, 40);
  assert.ok(result.facilities.every((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng)));
});

test('unknown facility names are visibly unnamed and arbitrary tags do not become URLs', async () => {
  const result = await createFacilityService({ fetchImpl: async () => response([{ ...works(), tags: { man_made: 'works', name: '\u0000', operator: ['invalid'], website: 'javascript:alert(1)' } }]) }).nearby(0, 0);
  assert.equal(result.facilities[0].name, 'Unnamed mapped industrial works');
  assert.equal(result.facilities[0].operator, null);
  assert.equal(result.facilities[0].sourceUrl, 'https://www.openstreetmap.org/way/1');
});

test('valid empty mapping result differs from provider failure or partial remark', async () => {
  const empty = await createFacilityService({ fetchImpl: async () => response([]) }).nearby(0, 0);
  assert.equal(empty.status, 'available');
  assert.deepEqual(empty.facilities, []);
  for (const providerResponse of [new Response('busy', { status: 429 }), Response.json({ unexpected: [] }), response([works()], { remark: 'runtime error: Query timed out' }), new Response('not-json')]) {
    const result = await createFacilityService({ fetchImpl: async () => providerResponse }).nearby(0, 0);
    assert.equal(result.status, 'unavailable');
    assert.deepEqual(result.facilities, []);
    assert.ok(result.error.code);
  }
});

test('network failure is explicit and never replaced with invented records', async () => {
  const result = await createFacilityService({ fetchImpl: async () => { throw new Error('private network detail'); } }).nearby(0, 0);
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.facilities, []);
  assert.equal(result.error.code, 'FACILITY_PROVIDER_UNAVAILABLE');
  assert.doesNotMatch(result.error.message, /private/);
});

test('declared oversized responses and streamed oversized responses are rejected', async () => {
  const declared = await createFacilityService({ fetchImpl: async () => new Response('{}', { headers: { 'content-length': '2097153' } }) }).nearby(0, 0);
  assert.equal(declared.error.code, 'FACILITY_RESPONSE_TOO_LARGE');
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); controller.enqueue(new Uint8Array(1024 * 1024 + 1)); },
    cancel() { cancelled = true; },
  });
  const streamed = await createFacilityService({ fetchImpl: async () => new Response(stream) }).nearby(0, 0);
  assert.equal(streamed.error.code, 'FACILITY_RESPONSE_TOO_LARGE');
  assert.equal(cancelled, true);
});

test('deadline terminates even a fetch implementation that ignores cancellation', async () => {
  let signal;
  const result = await createFacilityService({ timeoutMs: 5, fetchImpl: async (_url, options) => { signal = options.signal; return new Promise(() => {}); } }).nearby(0, 0);
  assert.equal(result.error.code, 'FACILITY_PROVIDER_TIMEOUT');
  assert.equal(signal.aborted, true);
});

test('cache expires by five minutes, is bounded, and does not share mutable results', async () => {
  let now = 0;
  let calls = 0;
  const service = createFacilityService({ now: () => now, cacheTtlMs: 999_999, maxCacheEntries: 1, fetchImpl: async () => { calls++; return response(); } });
  const first = await service.nearby(1, 1);
  first.facilities[0].name = 'mutated';
  const cached = await service.nearby(1, 1);
  assert.equal(calls, 1);
  assert.equal(cached.facilities[0].name, 'Mapped fixture works');
  now = 300_001;
  await service.nearby(1, 1);
  assert.equal(calls, 2);
  await service.nearby(2, 2);
  await service.nearby(1, 1);
  assert.equal(calls, 4);
});

test('concurrent identical queries share one request, while total in-flight work is capped', async () => {
  let resolveFetch;
  let calls = 0;
  const responseReady = new Promise((resolve) => { resolveFetch = resolve; });
  const service = createFacilityService({ fetchImpl: async () => { calls++; await responseReady; return response(); } });
  const first = service.nearby(1, 1);
  const duplicate = service.nearby(1, 1);
  const others = Array.from({ length: 7 }, (_, index) => service.nearby(index + 2, 1));
  const busy = await service.nearby(10, 1);
  assert.equal(busy.error.code, 'FACILITY_DISCOVERY_BUSY');
  resolveFetch();
  const [a, b] = await Promise.all([first, duplicate, ...others]);
  assert.deepEqual(a, b);
  assert.equal(calls, 8);
});
