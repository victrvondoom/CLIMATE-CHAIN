// Fixed Open-Meteo readers for selected places. These are model forecasts,
// never local sensor measurements or estimates of a facility's emissions.
// Protocol: https://open-meteo.com/en/docs and /en/docs/air-quality-api
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const SEARCH_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const MAX_BYTES = 2 * 1024 * 1024;
const CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 128;
const MAX_PENDING = 16;
const WEATHER_CURRENT = ['temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'precipitation', 'weather_code', 'cloud_cover', 'wind_speed_10m', 'wind_direction_10m'];
const WEATHER_HOURLY = ['temperature_2m', 'relative_humidity_2m', 'precipitation_probability', 'precipitation', 'wind_speed_10m', 'shortwave_radiation'];
const AIR_CURRENT = ['pm2_5', 'pm10', 'us_aqi', 'european_aqi', 'carbon_monoxide', 'nitrogen_dioxide', 'sulphur_dioxide', 'ozone'];
const CARBON_FIELDS = ['carbon_dioxide', 'methane'];
const AIR_HOURLY = [...AIR_CURRENT, ...CARBON_FIELDS];
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const iso = (milliseconds) => new Date(milliseconds).toISOString();

export class PlaceServiceError extends Error {
  constructor(code, message, status = 502) { super(message); this.name = 'PlaceServiceError'; this.code = code; this.status = status; }
}

export function validatePlaceCoordinates({ lat, lng } = {}) {
  const parse = (value, min, max) => {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    if (typeof value === 'string' && (!value.trim() || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()))) return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : null;
  };
  const latitude = parse(lat, -90, 90);
  const longitude = parse(lng, -180, 180);
  if (latitude === null || longitude === null) throw new PlaceServiceError('invalid_coordinates', 'lat and lng must be finite decimal coordinates within -90..90 and -180..180.', 400);
  return { lat: latitude, lng: longitude };
}

function utcTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) return null;
  const parsed = Date.parse(/Z$|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`);
  return Number.isFinite(parsed) ? iso(parsed) : null;
}

function normalizeUnits(value, fields) {
  if (!record(value)) throw new PlaceServiceError('source_contract_invalid', 'The source did not provide units.');
  const units = {};
  for (const field of fields) {
    if (typeof value[field] === 'string' && value[field].length <= 40) units[field] = value[field];
  }
  return { time: 'ISO 8601 UTC', ...units };
}

function normalizeCurrent(value, fields) {
  if (!record(value) || !utcTime(value.time)) throw new PlaceServiceError('source_contract_invalid', 'The source did not provide a valid current model timestamp.');
  const result = { time: utcTime(value.time) };
  for (const field of fields) {
    if (value[field] != null && !finite(value[field])) throw new PlaceServiceError('source_contract_invalid', `The source returned an invalid ${field} value.`);
    result[field] = value[field] ?? null;
  }
  return result;
}

function normalizeHourly(value, fields) {
  if (!record(value) || !Array.isArray(value.time) || value.time.length === 0 || value.time.length > 192) throw new PlaceServiceError('source_contract_invalid', 'The source did not provide a bounded hourly series.');
  const time = value.time.map(utcTime);
  if (time.some((item) => !item)) throw new PlaceServiceError('source_contract_invalid', 'The source returned an invalid hourly timestamp.');
  const result = { time: time.slice(0, 48) };
  for (const field of fields) {
    const values = value[field];
    if (values === undefined) { result[field] = result.time.map(() => null); continue; }
    if (!Array.isArray(values) || values.length !== time.length || values.some((item) => item !== null && !finite(item))) throw new PlaceServiceError('source_contract_invalid', `The source returned an invalid ${field} series.`);
    result[field] = values.slice(0, 48);
  }
  return result;
}

function provenance(product, sourceUrl, fetchedAt, body = null) {
  return {
    provider: 'Open-Meteo', product,
    dataKind: 'modelled', measured: false, fetchedAt,
    modelTime: body?.current?.time ? utcTime(body.current.time) : null,
    modelRunAt: null,
    grid: body && finite(body.latitude) && finite(body.longitude) ? { lat: body.latitude, lng: body.longitude } : null,
    timezone: 'UTC', sourceUrl,
    attribution: product === 'weather' ? 'Weather model data via Open-Meteo (CC BY 4.0).' : 'CAMS forecasts via Open-Meteo (CC BY 4.0); Copernicus Atmosphere Monitoring Service.',
    notes: product === 'weather'
      ? 'Forecast model grid values. Current valid time is supplied; model initialisation time is not supplied by this endpoint.'
      : 'Modelled near-surface concentrations. Grid resolution and forecast interpolation vary by CAMS product; these values do not measure local or facility emissions.',
  };
}

const errorBody = (error) => ({ code: error instanceof PlaceServiceError ? error.code : 'source_unavailable', message: error instanceof PlaceServiceError ? error.message : 'The source could not be reached.' });
function unavailable(product, sourceUrl, fetchedAt, error) {
  return { status: 'unavailable', current: null, hourly: null, units: { current: {}, hourly: {} }, provenance: provenance(product, sourceUrl, fetchedAt), error: errorBody(error) };
}

async function fetchJson(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => { controller.abort(); reject(new PlaceServiceError('source_timeout', 'The source did not respond within 10 seconds.')); }, timeoutMs);
  });
  try {
    return await Promise.race([deadline, (async () => {
      const response = await fetchImpl(url, { signal: controller.signal, redirect: 'error', headers: { accept: 'application/json' } });
      if (!response.ok) throw new PlaceServiceError('source_http_error', `The source returned HTTP ${response.status}.`);
      const length = Number(response.headers.get('content-length'));
      if (Number.isFinite(length) && length > MAX_BYTES) throw new PlaceServiceError('source_too_large', 'The source response exceeded 2 MiB.');
      if (!response.body?.getReader) throw new PlaceServiceError('source_contract_invalid', 'The source returned no readable response.');
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BYTES) throw new PlaceServiceError('source_too_large', 'The source response exceeded 2 MiB.');
          chunks.push(value);
        }
      } catch (error) { void reader.cancel().catch(() => {}); throw error; }
      finally { reader.releaseLock(); }
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!record(body) || body.error) throw new Error('invalid source object');
        return body;
      } catch { throw new PlaceServiceError('source_contract_invalid', 'The source returned invalid JSON or an error response.'); }
    })()]);
  } catch (error) {
    if (error instanceof PlaceServiceError) throw error;
    throw new PlaceServiceError('source_unavailable', 'The source could not be reached.');
  } finally { clearTimeout(timeout); controller.abort(); }
}

export function createPlaceService({ fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 10_000 } = {}) {
  const timeout = Math.min(10_000, Math.max(1, Number(timeoutMs) || 10_000));
  const cache = new Map();
  const pending = new Map();
  async function cached(key, load) {
    const at = now();
    const prior = cache.get(key);
    if (prior && prior.expiresAt > at) return { ...structuredClone(prior.value), asOf: iso(at), cache: { hit: true, expiresAt: iso(prior.expiresAt) } };
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= MAX_PENDING) throw new PlaceServiceError('place_service_busy', 'Too many place requests are active. Retry shortly.', 503);
    const task = (async () => {
      const value = await load();
      const expiresAt = now() + (value.weather && (value.weather.status !== 'available' || value.air.status !== 'available') ? 30_000 : CACHE_TTL_MS);
      for (const [oldKey, entry] of cache) if (entry.expiresAt <= now()) cache.delete(oldKey);
      if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
      cache.set(key, { value: structuredClone(value), expiresAt });
      return { ...value, asOf: iso(now()), cache: { hit: false, expiresAt: iso(expiresAt) } };
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  }

  async function source(product, url, fields, hourlyFields) {
    const fetchedAt = iso(now());
    try {
      const body = await fetchJson(fetchImpl, url, timeout);
      if (!finite(body.latitude) || Math.abs(body.latitude) > 90 || !finite(body.longitude) || Math.abs(body.longitude) > 180) throw new PlaceServiceError('source_contract_invalid', 'The source did not return a valid model grid location.');
      const current = normalizeCurrent(body.current, fields);
      const hourly = normalizeHourly(body.hourly, hourlyFields);
      const units = { current: normalizeUnits(body.current_units, fields), hourly: normalizeUnits(body.hourly_units, hourlyFields) };
      if (!fields.some((field) => finite(current[field])) && !hourlyFields.some((field) => hourly[field].some(finite))) throw new PlaceServiceError('source_data_missing', 'The source returned no model values at this place.');
      for (const field of fields) if (finite(current[field]) && !units.current[field]) throw new PlaceServiceError('source_contract_invalid', `The source omitted units for ${field}.`);
      for (const field of hourlyFields) if (hourly[field].some(finite) && !units.hourly[field]) throw new PlaceServiceError('source_contract_invalid', `The source omitted units for ${field}.`);
      return { status: 'available', current, hourly, units, provenance: provenance(product, url, iso(now()), body), error: null };
    } catch (error) { return unavailable(product, url, fetchedAt, error); }
  }

  function carbonFrom(air) {
    const base = { ...air.provenance, product: 'greenhouse-gas', modelTime: null, notes: 'CAMS modelled atmospheric CO₂ and methane concentrations near the surface. Concentrations are not production emissions, a carbon footprint, or a source attribution.' };
    if (air.status !== 'available') return { status: 'unavailable', current: null, hourly: null, units: {}, provenance: base, error: air.error };
    const times = air.hourly.time;
    let picked = -1;
    let distance = Infinity;
    times.forEach((time, index) => {
      const delta = Math.abs(Date.parse(time) - now());
      if (delta <= 90 * 60_000 && delta < distance && CARBON_FIELDS.some((field) => finite(air.hourly[field][index]))) { picked = index; distance = delta; }
    });
    const hasData = CARBON_FIELDS.some((field) => air.hourly[field].some(finite));
    const current = picked >= 0 ? { time: times[picked], ...Object.fromEntries(CARBON_FIELDS.map((field) => [field, air.hourly[field][picked]])) } : null;
    return {
      status: hasData ? 'available' : 'unavailable', current,
      hourly: hasData ? { time: times, ...Object.fromEntries(CARBON_FIELDS.map((field) => [field, air.hourly[field]])) } : null,
      units: Object.fromEntries(CARBON_FIELDS.filter((field) => air.units.hourly[field]).map((field) => [field, air.units.hourly[field]])),
      provenance: { ...base, modelTime: current?.time ?? null },
      error: hasData ? null : { code: 'source_data_missing', message: 'This forecast response has no CO₂ or methane values for the selected place.' },
    };
  }

  return {
    inspectPlace(coordinates) {
      const point = validatePlaceCoordinates(coordinates);
      return cached(`place:${point.lat}:${point.lng}`, async () => {
        const params = { latitude: String(point.lat), longitude: String(point.lng), timezone: 'GMT', forecast_hours: '24', timeformat: 'iso8601' };
        const weatherUrl = new URL(WEATHER_URL);
        weatherUrl.search = new URLSearchParams({ ...params, current: WEATHER_CURRENT.join(','), hourly: WEATHER_HOURLY.join(',') }).toString();
        const airUrl = new URL(AIR_URL);
        airUrl.search = new URLSearchParams({ ...params, current: AIR_CURRENT.join(','), hourly: AIR_HOURLY.join(',') }).toString();
        const [weather, air] = await Promise.all([source('weather', weatherUrl.href, WEATHER_CURRENT, WEATHER_HOURLY), source('air-quality', airUrl.href, AIR_CURRENT, AIR_HOURLY)]);
        return { schema: 'climate-chain.place/1', requested: point, weather, air, carbon: carbonFrom(air) };
      });
    },
    searchPlaces(input) {
      if (typeof input !== 'string' || input.trim().length < 2 || input.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(input)) throw new PlaceServiceError('invalid_search', 'Search must contain 2 to 100 characters without control characters.', 400);
      const query = input.trim();
      return cached(`search:${query.toLowerCase()}`, async () => {
        const url = new URL(SEARCH_URL);
        url.search = new URLSearchParams({ name: query, count: '8', language: 'en', format: 'json' }).toString();
        const body = await fetchJson(fetchImpl, url.href, timeout);
        if (body.results !== undefined && !Array.isArray(body.results)) throw new PlaceServiceError('source_contract_invalid', 'The geocoder returned an invalid results list.');
        const results = (body.results ?? []).slice(0, 8).map((place) => {
          if (!record(place) || !finite(place.latitude) || Math.abs(place.latitude) > 90 || !finite(place.longitude) || Math.abs(place.longitude) > 180 || typeof place.name !== 'string') throw new PlaceServiceError('source_contract_invalid', 'The geocoder returned an invalid place.');
          return { id: String(place.id ?? `${place.latitude}:${place.longitude}`), name: place.name.slice(0, 160), country: typeof place.country === 'string' ? place.country.slice(0, 100) : null, admin1: typeof place.admin1 === 'string' ? place.admin1.slice(0, 100) : null, lat: place.latitude, lng: place.longitude, timezone: typeof place.timezone === 'string' ? place.timezone.slice(0, 80) : null };
        });
        return { query, results, provenance: { provider: 'Open-Meteo Geocoding / GeoNames', sourceUrl: url.href, fetchedAt: iso(now()), attribution: 'GeoNames geographical data via Open-Meteo (CC BY 4.0).' } };
      });
    },
  };
}
