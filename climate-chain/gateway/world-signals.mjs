// Keyless public readers for the Causal Lab: NOAA CPC Oceanic Nino Index,
// publisher RSS climate headlines and World Bank India CPI inflation. Every
// result carries its source and fetch time. A failed refresh serves the last
// good copy labelled "stale"; with none, it fails visibly. Nothing is invented.
import { COUNTRIES } from './countries.mjs';

const SOURCES = {
  air: { url: 'https://air-quality-api.open-meteo.com/v1/air-quality', name: 'Open-Meteo Air Quality API - Copernicus CAMS atmospheric composition model (modelled values, not station observations)', ttlMs: 60 * 60_000 },
  enso: { url: 'https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt', name: 'NOAA Climate Prediction Center - Oceanic Nino Index (ERSSTv5)', ttlMs: 6 * 3600_000 },
  news: { url: 'https://www.carbonbrief.org/feed/', name: 'Publisher RSS feeds (headline index, not a fact-check)', ttlMs: 10 * 60_000 },
  inflation: { url: 'https://api.worldbank.org/v2/country/IND/indicator/FP.CPI.TOTL.ZG', name: 'World Bank - India consumer price inflation, annual % (FP.CPI.TOTL.ZG)', ttlMs: 12 * 3600_000 },
};
const MAX_BYTES = 2 * 1024 * 1024;
const DEADLINE_MS = 8000;
const SEASONS = ['DJF', 'JFM', 'FMA', 'MAM', 'AMJ', 'MJJ', 'JJA', 'JAS', 'ASO', 'SON', 'OND', 'NDJ'];
const FEEDS = {
  'Carbon Brief': 'https://www.carbonbrief.org/feed/',
  'The Guardian - Climate crisis': 'https://www.theguardian.com/environment/climate-crisis/rss',
  'Mongabay India': 'https://india.mongabay.com/feed/',
};
const NEWS_TOPICS = {
  climate: { feeds: ['Carbon Brief', 'The Guardian - Climate crisis'], match: null },
  india: { feeds: ['Mongabay India'], match: null },
  enso: { feeds: ['Carbon Brief', 'The Guardian - Climate crisis', 'Mongabay India'], match: /\b(el ni(?:n|ñ)o|la ni(?:n|ñ)a|enso|monsoon)\b/i },
};

export class WorldSignalError extends Error {
  constructor(code, message, status = 502) { super(message); this.name = 'WorldSignalError'; this.code = code; this.status = status; }
}

export function parseOni(text) {
  if (typeof text !== 'string') throw new WorldSignalError('source_contract_invalid', 'ONI response was not text.');
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 4 || !SEASONS.includes(parts[0])) continue;
    const year = Number(parts[1]);
    const oni = Number(parts[3]);
    if (!Number.isInteger(year) || year < 1950 || year > 2100 || !Number.isFinite(oni) || Math.abs(oni) > 5) continue;
    const month = SEASONS.indexOf(parts[0]) + 1; // centre month of the 3-month season
    rows.push({ year, month, season: parts[0], oni, phase: oni >= 0.5 ? 'El Nino' : oni <= -0.5 ? 'La Nina' : 'Neutral' });
  }
  if (rows.length < 120) throw new WorldSignalError('source_contract_invalid', 'ONI table was empty or malformed.');
  return rows;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeText(raw) {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') { const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' '; }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parses RSS 2.0 <item> entries with a tolerant, non-executing scanner (no XML entity expansion). */
export function parseRss(xml, outlet) {
  if (typeof xml !== 'string' || !/<(rss|channel)\b/i.test(xml)) throw new WorldSignalError('source_contract_invalid', `${outlet} did not return an RSS feed.`);
  const field = (block, tag) => { const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(block); return m ? decodeText(m[1]) : ''; };
  const items = [];
  for (const match of xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const block = match[0];
    const title = field(block, 'title').slice(0, 240);
    const link = field(block, 'link');
    let host;
    try { const u = new URL(link); if (u.protocol !== 'https:' && u.protocol !== 'http:') continue; host = u.hostname; } catch { continue; }
    if (!title) continue;
    const when = Date.parse(field(block, 'pubDate'));
    items.push({ title, url: link, domain: host, outlet, seenAt: Number.isFinite(when) ? new Date(when).toISOString() : null });
  }
  return items;
}

export function mergeNews(lists, match, limit = 25) {
  const seen = new Set();
  return lists.flat()
    .filter((a) => !match || match.test(a.title))
    .filter((a) => { const k = a.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (b.seenAt ?? '').localeCompare(a.seenAt ?? ''))
    .slice(0, limit);
}

export function parseInflation(json) {
  const rows = Array.isArray(json) && Array.isArray(json[1]) ? json[1] : null;
  if (!rows) throw new WorldSignalError('source_contract_invalid', 'World Bank response had no data rows.');
  const series = rows
    .filter((r) => r && r.value !== null && Number.isFinite(Number(r.value)) && /^\d{4}$/.test(String(r.date)))
    .map((r) => ({ year: Number(r.date), inflationPct: Number(r.value) }))
    .sort((a, b) => a.year - b.year);
  if (!series.length) throw new WorldSignalError('source_contract_invalid', 'World Bank returned no published inflation values.');
  return series;
}

// ---- Air quality: modelled CAMS fields via Open-Meteo (keyless, CC BY 4.0) -------------------------
const AIR_CURRENT = 'us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone,sulphur_dioxide,carbon_monoxide';
const AIR_CHUNK = 40;
const WHO_PM25_24H = 15; // ug/m3: WHO 2021 air quality guideline, 24-hour mean
const GRID_RADIUS = 2; // 5 x 5 cells around the clicked point
const GRID_STEP_DEG = 0.4; // about the native resolution of the global CAMS model
const KM_PER_DEG = 111.19;
const POLLUTED_ABOVE = 100; // US AQI above 100 is unhealthy for sensitive groups
const AQI_BANDS = [
  { max: 50, id: 'good', label: 'Good' },
  { max: 100, id: 'moderate', label: 'Moderate' },
  { max: 150, id: 'sensitive', label: 'Unhealthy for sensitive groups' },
  { max: 200, id: 'unhealthy', label: 'Unhealthy' },
  { max: 300, id: 'very-unhealthy', label: 'Very unhealthy' },
  { max: Infinity, id: 'hazardous', label: 'Hazardous' },
];
const EMPTY_READING = Object.freeze({ time: null, usAqi: null, pm25: null, pm10: null, no2: null, o3: null, so2: null, co: null });
const round = (value, places = 0) => { const f = 10 ** places; return Math.round(value * f) / f; };
const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export function aqiCategory(aqi) {
  if (!Number.isFinite(aqi) || aqi < 0) return { id: 'unknown', label: 'No data' };
  const band = AQI_BANDS.find((b) => aqi <= b.max);
  return { id: band.id, label: band.label };
}

/** Normalises Open-Meteo's one-object (single point) or array (many points) reply into one reading per point. */
export function parseAirReadings(json, expected) {
  const list = Array.isArray(json) ? json : [json];
  if (list.length !== expected || list.some((entry) => !entry || typeof entry !== 'object' || entry.error)) {
    throw new WorldSignalError('source_contract_invalid', 'Open-Meteo returned an unexpected air-quality payload.');
  }
  return list.map((entry) => {
    const c = entry.current && typeof entry.current === 'object' ? entry.current : {};
    const at = typeof c.time === 'string' ? new Date(`${c.time}Z`) : null;
    return {
      time: at && Number.isFinite(at.getTime()) ? at.toISOString() : null,
      usAqi: finite(c.us_aqi), pm25: finite(c.pm2_5), pm10: finite(c.pm10),
      no2: finite(c.nitrogen_dioxide), o3: finite(c.ozone), so2: finite(c.sulphur_dioxide), co: finite(c.carbon_monoxide),
    };
  });
}

/** 5 x 5 sample points around a centre, north row first, longitudes wrapped across the antimeridian. */
export function buildAirGrid(lat, lng) {
  const cells = [];
  for (let row = -GRID_RADIUS; row <= GRID_RADIUS; row++) {
    for (let col = -GRID_RADIUS; col <= GRID_RADIUS; col++) {
      cells.push({
        row, col,
        lat: round(Math.max(-90, Math.min(90, lat - row * GRID_STEP_DEG)), 3),
        lng: round(((lng + col * GRID_STEP_DEG + 540) % 360) - 180, 3),
      });
    }
  }
  return cells;
}

/** How much of the sampled window is above the AQI threshold. Cells without a model value are excluded, not counted as clean. */
export function summariseAirArea(cells, readings, centreLat) {
  const withData = cells.map((cell, i) => ({ cell, reading: readings[i] })).filter((x) => x.reading.usAqi !== null);
  const byCategory = {};
  for (const { reading } of withData) { const id = aqiCategory(reading.usAqi).id; byCategory[id] = (byCategory[id] ?? 0) + 1; }
  const polluted = withData.filter((x) => x.reading.usAqi > POLLUTED_ABOVE).length;
  const heightKm = GRID_STEP_DEG * KM_PER_DEG;
  const widthKm = GRID_STEP_DEG * KM_PER_DEG * Math.max(0.05, Math.cos((centreLat * Math.PI) / 180));
  const side = GRID_RADIUS * 2 + 1;
  return {
    gridCells: cells.length,
    cellsWithData: withData.length,
    cellKm: { height: round(heightKm, 1), width: round(widthKm, 1) },
    windowKm: { height: round(side * heightKm), width: round(side * widthKm) },
    threshold: `US AQI above ${POLLUTED_ABOVE}`,
    pollutedCells: polluted,
    pollutedSharePct: withData.length ? round((polluted / withData.length) * 100, 1) : null,
    pollutedAreaKm2: withData.length ? round(polluted * heightKm * widthKm) : null,
    sampledAreaKm2: round(withData.length * heightKm * widthKm),
    byCategory,
    cells: cells.map((cell, i) => ({ row: cell.row, col: cell.col, usAqi: readings[i].usAqi, category: aqiCategory(readings[i].usAqi).id })),
  };
}

export function nearestCountry(lat, lng) {
  const rad = Math.PI / 180;
  let best = null;
  for (const c of COUNTRIES) {
    const a = Math.sin(((c.lat - lat) * rad) / 2) ** 2 + Math.cos(lat * rad) * Math.cos(c.lat * rad) * Math.sin(((c.lng - lng) * rad) / 2) ** 2;
    const km = 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
    if (!best || km < best.distanceKm) best = { iso2: c.iso2, name: c.name, capital: c.capital, distanceKm: km };
  }
  return best && { ...best, distanceKm: round(best.distanceKm) };
}

function coordinate(raw, limit, label) {
  const value = raw === null || raw === undefined || String(raw).trim() === '' ? NaN : Number(raw);
  if (!Number.isFinite(value) || Math.abs(value) > limit) throw new WorldSignalError('invalid_coordinates', `${label} must be a number between -${limit} and ${limit}.`, 400);
  return value;
}

const airUrl = (points) => `${SOURCES.air.url}?${new URLSearchParams({
  latitude: points.map((p) => p.lat).join(','),
  longitude: points.map((p) => p.lng).join(','),
  current: AIR_CURRENT,
  timezone: 'UTC',
})}`;

export function createWorldSignalService({ fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const cache = new Map();
  const pending = new Map();

  // Network-level failures (e.g. a slow TCP connect) get one retry; HTTP answers never do.
  async function fetchWithRetry(url, init, attempts) {
    for (let attempt = 1; ; attempt++) {
      try { return await fetchImpl(url, { headers: init.headers, signal: AbortSignal.timeout(DEADLINE_MS) }); }
      catch (error) {
        if (attempt >= attempts || error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
        await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
      }
    }
  }

  async function get(url, kind) {
    const accept = kind === 'json' ? 'application/json' : kind === 'rss' ? 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8' : 'text/plain';
    const response = await fetchWithRetry(url, { headers: { accept, 'user-agent': 'ClimateChain/1.0 (research)' } }, 2);
    if (response.status === 429) throw new WorldSignalError('source_rate_limited', 'The source asked for fewer requests. Retry in a few seconds.', 503);
    if (!response.ok) throw new WorldSignalError('source_unavailable', `Source answered HTTP ${response.status}.`);
    const declared = Number(response.headers?.get?.('content-length') || 0);
    if (declared > MAX_BYTES) throw new WorldSignalError('source_too_large', 'Source response exceeds the size limit.');
    const text = await response.text();
    if (text.length > MAX_BYTES) throw new WorldSignalError('source_too_large', 'Source response exceeds the size limit.');
    if (kind !== 'json') return text;
    try { return JSON.parse(text); } catch { throw new WorldSignalError('source_contract_invalid', 'Source did not return JSON.'); }
  }

  async function load(key, ttlMs, source, build) {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return { ...hit.value, status: 'live', cached: true };
    if (pending.has(key)) return pending.get(key);
    const job = (async () => {
      try {
        const data = await build();
        const value = { source: source.name, sourceUrl: source.url, fetchedAt: new Date(now()).toISOString(), ...data };
        cache.set(key, { at: now(), value });
        if (cache.size > 600) cache.delete(cache.keys().next().value); // arbitrary clicked points must not grow memory without bound
        return { ...value, status: 'live', cached: false };
      } catch (error) {
        if (hit) return { ...hit.value, status: 'stale', staleReason: error instanceof WorldSignalError ? error.code : 'source_unavailable' };
        if (error instanceof WorldSignalError) throw error;
        throw new WorldSignalError('source_unavailable', `${source.name} could not be reached.`);
      } finally { pending.delete(key); }
    })();
    pending.set(key, job);
    return job;
  }

  return {
    // One modelled reading per country, taken at its capital. Batched so 195 points cost five upstream calls.
    airCountries: () => load('air:countries', SOURCES.air.ttlMs, SOURCES.air, async () => {
      const chunks = [];
      for (let i = 0; i < COUNTRIES.length; i += AIR_CHUNK) chunks.push(COUNTRIES.slice(i, i + AIR_CHUNK));
      const results = await Promise.allSettled(chunks.map(async (chunk) => parseAirReadings(await get(airUrl(chunk), 'json'), chunk.length)));
      if (results.every((r) => r.status === 'rejected')) {
        throw results[0].reason instanceof WorldSignalError ? results[0].reason : new WorldSignalError('source_unavailable', `${SOURCES.air.name} could not be reached.`);
      }
      const countries = chunks.flatMap((chunk, ci) => chunk.map((country, i) => {
        const reading = results[ci].status === 'fulfilled' ? results[ci].value[i] : EMPTY_READING;
        return { ...country, reading, category: aqiCategory(reading.usAqi) };
      }));
      const withData = countries.filter((c) => c.reading.usAqi !== null).length;
      return { count: countries.length, withData, failed: countries.length - withData, countries };
    }),
    // A clicked point: the centre reading plus a 5 x 5 model grid to estimate how much of the surroundings is polluted.
    airPoint: (latRaw, lngRaw) => {
      const lat = round(coordinate(latRaw, 90, 'lat'), 1);
      const lng = round(coordinate(lngRaw, 180, 'lng'), 1);
      return load(`air:point:${lat}:${lng}`, SOURCES.air.ttlMs / 2, SOURCES.air, async () => {
        const cells = buildAirGrid(lat, lng);
        const readings = parseAirReadings(await get(airUrl(cells), 'json'), cells.length);
        const centre = readings[cells.findIndex((c) => c.row === 0 && c.col === 0)];
        return {
          place: { lat, lng, nearest: nearestCountry(lat, lng) },
          reading: centre,
          category: aqiCategory(centre.usAqi),
          whoPm25Guideline: WHO_PM25_24H,
          pm25VsWho: centre.pm25 === null ? null : round(centre.pm25 / WHO_PM25_24H, 1),
          area: summariseAirArea(cells, readings, lat),
          resolutionNote: 'CAMS global model, roughly 40 km resolution outside Europe. The area figure is the share of a 5 x 5 grid of model cells, not a measured pollution footprint.',
        };
      });
    },
    enso: () => load('enso', SOURCES.enso.ttlMs, SOURCES.enso, async () => ({ series: parseOni(await get(SOURCES.enso.url, 'text')) })),
    news: (topic = 'climate') => {
      if (!Object.hasOwn(NEWS_TOPICS, topic)) throw new WorldSignalError('invalid_topic', `topic must be one of ${Object.keys(NEWS_TOPICS).join(', ')}.`, 400);
      const { feeds, match } = NEWS_TOPICS[topic];
      return load(`news:${topic}`, SOURCES.news.ttlMs, SOURCES.news, async () => {
        const results = await Promise.allSettled(feeds.map(async (outlet) => parseRss(await get(FEEDS[outlet], 'rss'), outlet)));
        const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
        if (!ok.length) throw results.find((r) => r.reason instanceof WorldSignalError)?.reason ?? new WorldSignalError('source_unavailable', 'No news feed could be reached.');
        const failed = results.map((r, i) => (r.status === 'rejected' ? feeds[i] : null)).filter(Boolean);
        return { topic, outlets: feeds.filter((f) => !failed.includes(f)), failedOutlets: failed, articles: mergeNews(ok, match) };
      });
    },
    indiaInflation: () => load('inflation', SOURCES.inflation.ttlMs, SOURCES.inflation, async () => ({
      country: 'India',
      series: parseInflation(await get(`${SOURCES.inflation.url}?${new URLSearchParams({ format: 'json', per_page: '30' })}`, 'json')),
    })),
  };
}
