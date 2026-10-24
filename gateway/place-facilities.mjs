// Fixed provider and a deliberately small query. OSM features are mapping evidence,
// not evidence of current production, ownership or emissions.
// Query reference: https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL
// `body center` preserves node coordinates as well as way/relation bounding-box centers.
export const FACILITY_PROVIDER_URL = 'https://overpass-api.de/api/interpreter';
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS = 40;
const MAX_TTL_MS = 5 * 60_000;

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

function validate(lat, lng, radiusKm) {
  for (const [name, value, min, max] of [['latitude', lat, -90, 90], ['longitude', lng, -180, 180], ['radiusKm', radiusKm, Number.MIN_VALUE, 25]]) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`);
    if (value < min || value > max) throw new RangeError(`${name} must be ${name === 'radiusKm' ? 'greater than 0 and at most 25' : `between ${min} and ${max}`}`);
  }
}

function text(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 240) || null : null;
}

async function boundedJson(response) {
  const declaredLength = response.headers?.get('content-length');
  if (declaredLength && Number(declaredLength) > MAX_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw fail('FACILITY_RESPONSE_TOO_LARGE', 'The mapping provider response exceeded the 2 MiB limit.');
  }
  if (!response.body?.getReader) throw fail('FACILITY_INVALID_RESPONSE', 'The mapping provider returned no readable response.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        throw fail('FACILITY_RESPONSE_TOO_LARGE', 'The mapping provider response exceeded the 2 MiB limit.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let parsed;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw fail('FACILITY_INVALID_RESPONSE', 'The mapping provider returned invalid JSON.'); }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.elements) || parsed.remark) {
    throw fail('FACILITY_INVALID_RESPONSE', 'The mapping provider returned an incomplete or invalid result.');
  }
  return parsed;
}

function facility(element) {
  if (!element || !['node', 'way', 'relation'].includes(element.type) || !Number.isSafeInteger(element.id) || element.id <= 0) return null;
  const tags = element.tags;
  if (!tags || typeof tags !== 'object' || Array.isArray(tags)) return null;
  const kind = tags.power === 'plant' ? 'power_plant' : tags.man_made === 'works' ? 'industrial_works' : null;
  if (!kind) return null;
  const lat = element.type === 'node' ? element.lat : element.center?.lat;
  const lng = element.type === 'node' ? element.lon : element.center?.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return {
    id: `osm:${element.type}:${element.id}`,
    name: text(tags.name) ?? text(tags['name:en']) ?? (kind === 'power_plant' ? 'Unnamed mapped power plant' : 'Unnamed mapped industrial works'),
    lat, lng, kind,
    operator: text(tags.operator),
    product: text(tags.product),
    sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
  };
}

export function createFacilityService({ fetchImpl = fetch, now = Date.now, timeoutMs = 15_000, cacheTtlMs = MAX_TTL_MS, maxCacheEntries = 64 } = {}) {
  if (typeof fetchImpl !== 'function' || typeof now !== 'function') throw new TypeError('fetchImpl and now must be functions');
  const deadline = Number.isFinite(timeoutMs) ? Math.max(1, Math.min(timeoutMs, 15_000)) : 15_000;
  const ttl = Number.isFinite(cacheTtlMs) ? Math.max(0, Math.min(cacheTtlMs, MAX_TTL_MS)) : MAX_TTL_MS;
  const capacity = Number.isFinite(maxCacheEntries) ? Math.max(1, Math.min(100, Math.floor(maxCacheEntries))) : 64;
  const cache = new Map();
  const pending = new Map();
  const provenance = {
    provider: 'OpenStreetMap via Overpass API', sourceUrl: FACILITY_PROVIDER_URL, dataKind: 'mapped',
    notes: [
      'OpenStreetMap contributor mapping may be incomplete or outdated. A mapped facility is not proof that it is currently operating.',
      'Queries include man_made=works and power=plant only, capped at 40 matching features. This is not a complete industrial inventory or a nearest-first search.',
      'Ways and relations use bounding-box centers, which may lie outside the feature or search radius. Node coordinates come from the mapped object.',
      'Production volumes, emissions, supply relationships and operating status are unknown. Operator and product text are unverified map tags.',
    ],
  };
  const unavailable = (error) => ({
    status: 'unavailable', facilities: [], asOf: new Date(now()).toISOString(), provenance: structuredClone(provenance),
    error: { code: error?.code ?? 'FACILITY_PROVIDER_UNAVAILABLE', message: error?.code ? error.message : 'The mapping provider could not be reached. Try again later.' },
  });

  async function load(lat, lng, radiusKm) {
    const controller = new AbortController();
    let timer;
    try {
      // Fixed decimal literals avoid exponent notation for places near zero.
      const point = `${lat.toFixed(7)},${lng.toFixed(7)}`;
      const query = `[out:json][timeout:12];(nwr["man_made"="works"](around:${Math.round(radiusKm * 1000)},${point});nwr["power"="plant"](around:${Math.round(radiusKm * 1000)},${point}););out body center 40;`;
      const operation = (async () => {
        const response = await fetchImpl(FACILITY_PROVIDER_URL, {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'ClimateChain/1.0 (explicit nearby mapping discovery)' },
          body: new URLSearchParams({ data: query }).toString(),
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          throw fail('FACILITY_PROVIDER_HTTP_ERROR', `The mapping provider returned HTTP ${response.status}. Try again later.`);
        }
        const body = await boundedJson(response);
        const unique = new Map();
        for (const element of body.elements) {
          const item = facility(element);
          if (item && !unique.has(item.id)) unique.set(item.id, item);
          if (unique.size >= MAX_ITEMS) break;
        }
        const metadata = structuredClone(provenance);
        if (typeof body.osm3s?.timestamp_osm_base === 'string' && Number.isFinite(Date.parse(body.osm3s.timestamp_osm_base))) metadata.notes.push(`Provider OSM database timestamp: ${body.osm3s.timestamp_osm_base.slice(0, 40)}.`);
        return { status: 'available', facilities: [...unique.values()], asOf: new Date(now()).toISOString(), provenance: metadata, error: null };
      })();
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(fail('FACILITY_PROVIDER_TIMEOUT', 'The mapping provider did not respond within the request time limit. Try again later.')); }, deadline);
      });
      return await Promise.race([operation, timeout]);
    } catch (error) { return unavailable(error); }
    finally { clearTimeout(timer); }
  }

  return {
    async nearby(lat, lng, radiusKm = 15) {
      validate(lat, lng, radiusKm);
      // Full validated coordinates are kept in the key so different places never
      // reuse a result from a neighboring rounded search point.
      const key = `${lat},${lng},${radiusKm}`;
      for (const [cachedKey, value] of cache) if (value.expiresAt <= now()) cache.delete(cachedKey);
      const hit = cache.get(key);
      if (hit) return structuredClone(hit.value);
      if (pending.has(key)) return structuredClone(await pending.get(key));
      if (pending.size >= 8) return unavailable(fail('FACILITY_DISCOVERY_BUSY', 'Nearby discovery is busy. Try again after the current requests finish.'));
      const request = load(lat, lng, radiusKm);
      pending.set(key, request);
      try {
        const result = await request;
        if (result.status === 'available' && ttl > 0) {
          if (cache.size >= capacity) cache.delete(cache.keys().next().value);
          cache.set(key, { value: result, expiresAt: now() + ttl });
        }
        return structuredClone(result);
      } finally { pending.delete(key); }
    },
  };
}
