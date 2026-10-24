// Climate Integrity Lab source adapter: Open-Meteo Air Quality API, CAMS global domain.
// Values are MODEL FORECASTS for a ~45 km grid cell, never station measurements.
// Protocol and limits: https://open-meteo.com/en/docs/air-quality-api (free for
// non-commercial use, no API key; attribute Open-Meteo and CAMS).
//
// The adapter keeps the exact response text so the bundle can hash the raw payload.
// When a live fetch fails it can serve a captured response, labelled
// CACHED_HISTORICAL_EXAMPLE with its capture time. It never presents that as live.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digestOf, sha256Hex } from './integrity-evidence.mjs';

export const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
export const DOCS_URL = 'https://open-meteo.com/en/docs/air-quality-api';
export const AIR_ANALYTES = ['pm2_5', 'pm10', 'nitrogen_dioxide', 'ozone', 'sulphur_dioxide', 'carbon_monoxide'];
export const SOURCE_UNIT = 'μg/m³';
export const STALE_AFTER_HOURS = 6;
const UNIT_SPELLINGS = new Set(['μg/m³', 'µg/m³']);
const MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_FIXTURE_DIR = fileURLToPath(new URL('./fixtures/integrity/', import.meta.url));
const RETRYABLE = new Set(['source_timeout', 'source_unavailable', 'source_http_error']);

// Public city-centre coordinates only. No household, facility or sensitive-site location.
export const SITES = Object.freeze([
  { id: 'new-delhi', label: 'New Delhi', lat: 28.6139, lon: 77.209, country: 'IN', note: 'Public city-centre coordinates. No household, facility or sensitive-site location.' },
  { id: 'chennai', label: 'Chennai', lat: 13.0827, lon: 80.2707, country: 'IN', note: 'Public city-centre coordinates. No household, facility or sensitive-site location.' },
]);

export class SourceError extends Error {
  constructor(code, message, status = 502, extra = {}) {
    super(message);
    this.name = 'SourceError';
    this.code = code;
    this.status = status;
    Object.assign(this, extra);
  }
}

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

export function findSite(siteId) {
  const site = SITES.find((item) => item.id === siteId);
  if (!site) throw new SourceError('unknown_site', `Unknown site "${siteId}". Choose one of ${SITES.map((item) => item.id).join(', ')}.`, 400);
  return site;
}

export function airQualityUrl(site) {
  const url = new URL(AIR_URL);
  url.searchParams.set('latitude', String(site.lat));
  url.searchParams.set('longitude', String(site.lon));
  url.searchParams.set('hourly', AIR_ANALYTES.join(','));
  url.searchParams.set('past_days', '1');
  url.searchParams.set('forecast_days', '1');
  url.searchParams.set('timezone', 'GMT');
  url.searchParams.set('domains', 'cams_global');
  return url.href;
}

export async function fetchRaw({ fetchImpl, url, timeoutMs }) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new SourceError('source_timeout', `Open-Meteo did not respond within ${timeoutMs} ms.`, 504)); }, timeoutMs);
  });
  try {
    return await Promise.race([deadline, (async () => {
      let response;
      try {
        response = await fetchImpl(url, { signal: controller.signal, redirect: 'error', headers: { accept: 'application/json' } });
      } catch (error) {
        if (error instanceof SourceError) throw error;
        throw new SourceError('source_unavailable', 'Open-Meteo could not be reached. The network may be offline.', 503);
      }
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('retry-after'));
        throw new SourceError('source_rate_limited', 'Open-Meteo rate limit reached (HTTP 429). Wait before retrying.', 503, { retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : null });
      }
      if (!response.ok) throw new SourceError('source_http_error', `Open-Meteo returned HTTP ${response.status}.`, 502, { httpStatus: response.status });
      const length = Number(response.headers.get('content-length'));
      if (Number.isFinite(length) && length > MAX_BYTES) throw new SourceError('source_too_large', 'Open-Meteo response exceeded 2 MiB.', 502);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > MAX_BYTES) throw new SourceError('source_too_large', 'Open-Meteo response exceeded 2 MiB.', 502);
      return { rawText: bytes.toString('utf8'), httpStatus: response.status };
    })()]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function utcHour(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const iso = `${value}:00Z`;
  return Number.isFinite(Date.parse(iso)) ? iso : null;
}

// Parses an Open-Meteo response into a source record and per-analyte series, keeping
// only values valid at or before the retrieval time. Forecast hours after retrieval
// are excluded from evidence.
export function parseAirQuality(rawText, { site, requestUrl, retrievedAt, retrievalMode, capturedAt = null, servedAt = null, liveError = null, reused = false }) {
  let body;
  try {
    body = JSON.parse(rawText);
  } catch {
    throw new SourceError('source_invalid_json', 'Open-Meteo returned text that is not valid JSON.', 502);
  }
  if (!record(body)) throw new SourceError('source_contract_invalid', 'Open-Meteo returned a non-object response.', 502);
  if (body.error) throw new SourceError('source_error_response', `Open-Meteo reported an error: ${String(body.reason ?? 'no reason given').slice(0, 200)}`, 502);
  if (body.utc_offset_seconds !== 0 || !['GMT', 'UTC'].includes(body.timezone)) throw new SourceError('source_contract_invalid', 'Open-Meteo did not return UTC timestamps.', 502);
  if (!finite(body.latitude) || !finite(body.longitude)) throw new SourceError('source_contract_invalid', 'Open-Meteo did not return grid coordinates.', 502);
  if (!record(body.hourly) || !record(body.hourly_units) || !Array.isArray(body.hourly.time)) throw new SourceError('source_missing_field', 'Open-Meteo response is missing hourly data or units.', 502, { fields: ['hourly', 'hourly_units'] });

  const missing = AIR_ANALYTES.filter((analyte) => !Array.isArray(body.hourly[analyte]) || typeof body.hourly_units[analyte] !== 'string');
  if (missing.length > 0) throw new SourceError('source_missing_field', `Open-Meteo response is missing: ${missing.join(', ')}.`, 502, { fields: missing });
  const wrongUnits = AIR_ANALYTES.filter((analyte) => !UNIT_SPELLINGS.has(body.hourly_units[analyte]));
  if (wrongUnits.length > 0) {
    throw new SourceError('source_unit_mismatch', `Expected ${SOURCE_UNIT} but got ${wrongUnits.map((analyte) => `${analyte}=${body.hourly_units[analyte]}`).join(', ')}.`, 502, { fields: wrongUnits });
  }

  const times = body.hourly.time.map(utcHour);
  if (times.length === 0 || times.length > 192 || times.some((item) => !item)) throw new SourceError('source_contract_invalid', 'Open-Meteo returned an empty, oversized or malformed hourly time axis.', 502);
  for (let index = 1; index < times.length; index += 1) {
    if (Date.parse(times[index]) <= Date.parse(times[index - 1])) throw new SourceError('source_contract_invalid', 'Open-Meteo hourly times are not strictly increasing.', 502);
  }
  for (const analyte of AIR_ANALYTES) {
    const values = body.hourly[analyte];
    if (values.length !== times.length || values.some((value) => value !== null && !finite(value))) {
      throw new SourceError('source_contract_invalid', `Open-Meteo returned an invalid ${analyte} series.`, 502);
    }
  }

  const retrievalMs = Date.parse(retrievedAt);
  const keep = times.map((time) => Date.parse(time) <= retrievalMs);
  if (!keep.some(Boolean)) throw new SourceError('source_no_past_values', 'Open-Meteo returned no hours at or before the retrieval time.', 422);
  const series = Object.fromEntries(AIR_ANALYTES.map((analyte) => [analyte, times
    .map((validTimeUtc, index) => ({ validTimeUtc, value: body.hourly[analyte][index] }))
    .filter((_, index) => keep[index])]));
  const units = Object.fromEntries(AIR_ANALYTES.map((analyte) => [analyte, SOURCE_UNIT]));
  const grid = { lat: body.latitude, lon: body.longitude, elevationM: finite(body.elevation) ? body.elevation : null };

  const latest = series[AIR_ANALYTES[0]].at(-1).validTimeUtc;
  const ageHoursAtRetrieval = Math.round(((retrievalMs - Date.parse(latest)) / 3_600_000) * 100) / 100;
  const rawPayloadSha256 = sha256Hex(rawText);
  const sourceRecord = {
    sourceId: `src-${rawPayloadSha256.slice(0, 16)}`,
    provider: 'Open-Meteo',
    dataProvider: 'Copernicus Atmosphere Monitoring Service (CAMS) global atmospheric composition forecasts',
    product: 'Open-Meteo Air Quality API v1, domains=cams_global',
    dataKind: 'MODEL_FORECAST',
    retrievalMode,
    sourceUrl: requestUrl,
    documentationUrl: DOCS_URL,
    license: 'Free for non-commercial use without an API key, per the Open-Meteo documentation. Attribute Open-Meteo and CAMS (Copernicus).',
    retrievedAt,
    capturedAt,
    servedAt,
    reusedRecentResponse: reused,
    liveError,
    rawPayloadSha256,
    rawPayloadBytes: Buffer.byteLength(rawText, 'utf8'),
    normalizedPayloadSha256: digestOf({ grid, units, series }),
    grid,
    spatialResolution: '0.4° (~45 km) CAMS global grid, per provider documentation',
    temporalResolution: 'CAMS global output is 3-hourly; Open-Meteo returns hourly steps, so values between model steps are interpolated.',
    heightAboveGround: '10 m above ground, per provider documentation',
    freshness: {
      latestValidTimeUtc: latest,
      ageHoursAtRetrieval,
      stale: ageHoursAtRetrieval > STALE_AFTER_HOURS,
      rule: `Stale when the newest value at or before retrieval is more than ${STALE_AFTER_HOURS} hours old.`,
    },
    limitations: [
      'Model forecast, not a ground observation.',
      'A single grid cell can differ strongly from street-level exposure.',
      'Model initialisation time is not returned by this endpoint.',
    ],
  };
  return { sourceRecord, series, units, site, rawText };
}

const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

export function createAirQualitySource({
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  timeoutMs = 10_000,
  fixtureDir = DEFAULT_FIXTURE_DIR,
  reuseWindowMs = 60_000,
  retries = 2,
  sleep = delay,
} = {}) {
  const recent = new Map();

  async function loadCached(site, liveError = null) {
    let capture;
    try {
      capture = JSON.parse(await readFile(join(fixtureDir, `open-meteo-cams-global-${site.id}.json`), 'utf8'));
    } catch {
      throw new SourceError('no_cached_example', `No cached historical example is stored for ${site.label}.`, 503);
    }
    if (typeof capture.rawText !== 'string' || typeof capture.capturedAt !== 'string' || typeof capture.requestUrl !== 'string') {
      throw new SourceError('cached_example_invalid', 'The cached historical example is malformed.', 503);
    }
    return parseAirQuality(capture.rawText, {
      site,
      requestUrl: capture.requestUrl,
      retrievedAt: capture.capturedAt,
      capturedAt: capture.capturedAt,
      servedAt: new Date(now()).toISOString(),
      retrievalMode: 'CACHED_HISTORICAL_EXAMPLE',
      liveError,
    });
  }

  // Retries network failures, timeouts and HTTP errors with capped backoff (250, 500 ms).
  // A 429 is never retried here: the caller must wait.
  async function fetchWithRetry(url) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await fetchRaw({ fetchImpl, url, timeoutMs });
      } catch (error) {
        if (!(error instanceof SourceError) || !RETRYABLE.has(error.code) || attempt >= retries) throw error;
        await sleep(Math.min(1000, 250 * 2 ** attempt));
      }
    }
  }

  async function loadLive(site) {
    const url = airQualityUrl(site);
    const previous = recent.get(site.id);
    if (previous && now() - previous.at < reuseWindowMs) {
      return parseAirQuality(previous.rawText, { site, requestUrl: url, retrievedAt: previous.retrievedAt, retrievalMode: 'LIVE_FETCH', reused: true });
    }
    const { rawText } = await fetchWithRetry(url);
    const retrievedAt = new Date(now()).toISOString();
    const parsed = parseAirQuality(rawText, { site, requestUrl: url, retrievedAt, retrievalMode: 'LIVE_FETCH' });
    recent.set(site.id, { at: now(), rawText, retrievedAt });
    return parsed;
  }

  // mode: 'live' fails loudly; 'cached' uses the captured example; 'live-or-cached'
  // tries live first and, on failure, serves the cached example with the live error attached.
  async function load(siteId, { mode = 'live-or-cached' } = {}) {
    const site = findSite(siteId);
    if (!['live', 'cached', 'live-or-cached'].includes(mode)) throw new SourceError('invalid_mode', 'mode must be live, cached or live-or-cached.', 400);
    if (mode === 'cached') return loadCached(site);
    try {
      return await loadLive(site);
    } catch (error) {
      if (mode === 'live' || !(error instanceof SourceError)) throw error;
      return loadCached(site, { code: error.code, message: error.message });
    }
  }

  return Object.freeze({ load, sites: () => SITES });
}
