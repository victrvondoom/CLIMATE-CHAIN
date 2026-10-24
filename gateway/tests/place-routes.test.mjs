import test from 'node:test';
import assert from 'node:assert/strict';
import { createGatewayServer } from '../gateway.mjs';
import { PlaceServiceError } from '../place-environment.mjs';

async function withGateway(run) {
  const calls = [];
  const gateway = createGatewayServer({
    missionEngine: {}, connectorRegistry: {}, projectRegistry: [],
    placeService: {
      async inspectPlace(point) { calls.push({ kind: 'place', point }); return { requested: point, weather: { status: 'available' }, air: { status: 'unavailable' } }; },
      async searchPlaces(query) {
        calls.push({ kind: 'search', query });
        if (query === 'Failed') throw new PlaceServiceError('source_timeout', 'The source timed out.');
        return { query, results: [] };
      },
    },
    facilitiesService: { async nearby(lat, lng, radiusKm) { calls.push({ kind: 'facilities', lat, lng, radiusKm }); return { status: 'available', facilities: [] }; } },
  });
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${gateway.address().port}`, calls); }
  finally { await new Promise((resolve, reject) => gateway.close((error) => error ? reject(error) : resolve())); }
}

test('place routes delegate validated coordinates, search and facilities through injected services', async () => {
  await withGateway(async (base, calls) => {
    const result = await fetch(`${base}/api/v1/place?lat=28.61&lng=77.23`);
    assert.equal(result.status, 200);
    assert.deepEqual((await result.json()).requested, { lat: 28.61, lng: 77.23 });
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(`${base}/api/v1/places/search?q=Delhi`)).status, 200);
    assert.equal((await fetch(`${base}/api/v1/place/facilities?lat=0&lng=0&radiusKm=20`)).status, 200);
    assert.deepEqual(calls, [{ kind: 'place', point: { lat: 28.61, lng: 77.23 } }, { kind: 'search', query: 'Delhi' }, { kind: 'facilities', lat: 0, lng: 0, radiusKm: 20 }]);
  });
});

test('place routes reject invalid coordinates/radii and writes before invoking services', async () => {
  await withGateway(async (base, calls) => {
    for (const path of ['/api/v1/place?lat=91&lng=0', '/api/v1/place?lat=&lng=0', '/api/v1/place/facilities?lat=0&lng=0&radiusKm=26', '/api/v1/place/facilities?lat=0&lng=0&radiusKm=']) {
      assert.equal((await fetch(base + path)).status, 400);
    }
    for (const path of ['/api/v1/place', '/api/v1/places/search', '/api/v1/place/facilities']) assert.equal((await fetch(base + path, { method: 'POST' })).status, 405);
    assert.equal(calls.length, 0);
    const failedSearch = await fetch(`${base}/api/v1/places/search?q=Failed`);
    assert.equal(failedSearch.status, 502);
    assert.equal((await failedSearch.json()).error.code, 'source_timeout');
  });
});
