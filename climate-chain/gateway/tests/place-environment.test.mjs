import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaceService, PlaceServiceError, validatePlaceCoordinates } from '../place-environment.mjs';

const AT = Date.parse('2026-10-23T09:15:00Z');
const json = (body, init) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, ...init });
function forecast(url) {
  const parsed = new URL(url);
  const fields = parsed.searchParams.get('current').split(',');
  const hourlyFields = parsed.searchParams.get('hourly').split(',');
  const units = (field) => field === 'carbon_dioxide' ? 'ppm' : field === 'methane' || field === 'pm2_5' ? 'µg/m³' : 'unit';
  return {
    latitude: 28.6, longitude: 77.2,
    current: { time: '2026-10-23T09:00', ...Object.fromEntries(fields.map((field) => [field, 20])) },
    current_units: Object.fromEntries(fields.map((field) => [field, units(field)])),
    hourly: { time: ['2026-10-23T09:00', '2026-10-23T10:00'], ...Object.fromEntries(hourlyFields.map((field) => [field, field === 'carbon_dioxide' ? [420, 421] : [20, 21]])) },
    hourly_units: Object.fromEntries(hourlyFields.map((field) => [field, units(field)])),
  };
}
const service = (fetchImpl, options = {}) => createPlaceService({ now: () => AT, fetchImpl, ...options });

test('coordinates reject missing, nonfinite, out-of-bounds and injected values before fetching', () => {
  for (const point of [{}, { lat: '', lng: '' }, { lat: null, lng: 0 }, { lat: 91, lng: 0 }, { lat: 0, lng: -181 }, { lat: Infinity, lng: 0 }, { lat: '1&url=http://localhost', lng: 0 }]) {
    assert.throws(() => validatePlaceCoordinates(point), (error) => error instanceof PlaceServiceError && error.status === 400);
  }
  assert.deepEqual(validatePlaceCoordinates({ lat: '-90', lng: '180' }), { lat: -90, lng: 180 });
});

test('weather and air read in parallel from fixed hosts with explicit model provenance and separate carbon concentration', async () => {
  const calls = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const client = service(async (url, init) => {
    calls.push(new URL(url));
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    await gate;
    return json(forecast(url));
  });
  const request = client.inspectPlace({ lat: 28.61, lng: 77.23 });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((url) => url.hostname).sort(), ['air-quality-api.open-meteo.com', 'api.open-meteo.com']);
  release();
  const result = await request;
  assert.equal(result.weather.status, 'available');
  assert.equal(result.air.status, 'available');
  assert.equal(result.weather.current.time, '2026-10-23T09:00:00.000Z');
  assert.equal(result.air.provenance.dataKind, 'modelled');
  assert.equal(result.air.provenance.measured, false);
  assert.equal(result.air.provenance.modelRunAt, null);
  assert.equal(result.carbon.current.carbon_dioxide, 420);
  assert.equal(result.carbon.units.carbon_dioxide, 'ppm');
  assert.equal(result.carbon.units.methane, 'µg/m³');
  assert.match(result.carbon.provenance.notes, /not production emissions/);
});

test('a failed source preserves the independent success without fabricated fallback values', async () => {
  const client = service(async (url) => new URL(url).hostname.startsWith('air-quality') ? json({ reason: 'unavailable' }, { status: 503 }) : json(forecast(url)));
  const result = await client.inspectPlace({ lat: 0, lng: 0 });
  assert.equal(result.weather.status, 'available');
  assert.equal(result.air.status, 'unavailable');
  assert.equal(result.air.current, null);
  assert.equal(result.air.hourly, null);
  assert.equal(result.air.error.code, 'source_http_error');
  assert.equal(result.carbon.status, 'unavailable');
});

test('missing greenhouse fields remain unavailable, never zero or an emissions estimate', async () => {
  const client = service(async (url) => {
    const body = forecast(url);
    delete body.hourly.carbon_dioxide;
    delete body.hourly.methane;
    return json(body);
  });
  const result = await client.inspectPlace({ lat: 0, lng: 0 });
  assert.equal(result.air.status, 'available');
  assert.equal(result.carbon.status, 'unavailable');
  assert.equal(result.carbon.current, null);
  assert.equal(result.carbon.hourly, null);
});

test('cached responses keep source fetch time, deduplicate pending reads and expire within five minutes', async () => {
  let at = AT;
  let calls = 0;
  const client = service(async (url) => { calls += 1; return json(forecast(url)); }, { now: () => at });
  const [first, same] = await Promise.all([client.inspectPlace({ lat: 1, lng: 2 }), client.inspectPlace({ lat: '1', lng: '2' })]);
  assert.equal(calls, 2);
  assert.equal(first.asOf, same.asOf);
  at += 60_000;
  const cached = await client.inspectPlace({ lat: 1, lng: 2 });
  assert.equal(cached.cache.hit, true);
  assert.equal(cached.weather.provenance.fetchedAt, first.weather.provenance.fetchedAt);
  cached.weather.current.temperature_2m = 999;
  assert.equal((await client.inspectPlace({ lat: 1, lng: 2 })).weather.current.temperature_2m, 20);
  at += 5 * 60_000;
  assert.equal((await client.inspectPlace({ lat: 1, lng: 2 })).cache.hit, false);
  assert.equal(calls, 4);
});

test('cache has bounded cardinality and evicts the oldest place', async () => {
  let calls = 0;
  const client = service(async (url) => { calls += 1; return json(forecast(url)); });
  for (let index = 0; index < 129; index += 1) await client.inspectPlace({ lat: 0, lng: index });
  const before = calls;
  assert.equal((await client.inspectPlace({ lat: 0, lng: 0 })).cache.hit, false);
  assert.equal(calls, before + 2);
});

test('malformed and oversized responses are unavailable, including oversized chunked bodies', async () => {
  for (const makeResponse of [
    () => new Response('{bad json'),
    () => json({ current: { time: 'bad' } }),
    () => new Response('x', { headers: { 'content-length': String(2 * 1024 * 1024 + 1) } }),
    () => new Response(new Uint8Array(2 * 1024 * 1024 + 1)),
  ]) {
    const result = await service(async () => makeResponse()).inspectPlace({ lat: 0, lng: 0 });
    assert.equal(result.weather.status, 'unavailable');
    assert.equal(result.air.status, 'unavailable');
    assert.equal(result.weather.current, null);
  }
});

test('timeouts settle even when a fetch implementation ignores abort', async () => {
  const result = await service(() => new Promise(() => {}), { timeoutMs: 5 }).inspectPlace({ lat: 0, lng: 0 });
  assert.equal(result.weather.error.code, 'source_timeout');
  assert.equal(result.air.error.code, 'source_timeout');
});

test('search bounds query/results and uses only the fixed encoded geocoder', async () => {
  const urls = [];
  const client = service(async (url) => {
    urls.push(new URL(url));
    return json({ results: Array.from({ length: 12 }, (_, index) => ({ id: index, name: `Place ${index}`, country: 'India', latitude: 12, longitude: 77 })) });
  });
  for (const value of ['', 'x', 'x'.repeat(101), '\u0000a']) assert.throws(() => client.searchPlaces(value), /Search must contain/);
  const result = await client.searchPlaces('Bengaluru & farms');
  assert.equal(urls[0].hostname, 'geocoding-api.open-meteo.com');
  assert.equal(urls[0].searchParams.get('name'), 'Bengaluru & farms');
  assert.equal(urls[0].searchParams.get('count'), '8');
  assert.equal(result.results.length, 8);
  assert.equal(result.results[0].lat, 12);
  assert.equal(result.results[0].lng, 77);
});

test('empty geocoding results are successful while source failures remain actionable errors', async () => {
  assert.deepEqual((await service(async () => json({})).searchPlaces('Nowhere')).results, []);
  await assert.rejects(() => service(async () => { throw new TypeError('fetch failed'); }).searchPlaces('Delhi'), (error) => error.code === 'source_unavailable' && error.status === 502);
});
