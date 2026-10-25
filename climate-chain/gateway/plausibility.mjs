// Statistical plausibility envelope for the Trust Firewall.
//
// What it is: a per-city, per-variable, per-season, per-time-of-day QUANTILE model fitted to the committed
// climate-hourly dataset (91,872 city-hours of CAMS-modelled composition + ERA5 reanalysis weather, six cities).
// What it is not: a neural network, a fraud detector, or a measure of truth. It answers one narrow question:
// "has a value this extreme been seen at this place, season and time of day?" Anything outside the envelope is
// routed to human review; nothing is ever rejected on this rule alone.
//
// Honest evaluation lives in scripts/evaluate-plausibility.mjs (time-split hold-out on real data; the anomaly
// detection numbers use SYNTHETIC injected spikes and are labelled as such).
//
// The envelope is fitted on MODELLED data. Station readings can legitimately exceed CAMS peaks, so measurements that
// are not themselves model-labelled get a wider upper bound (OBSERVED_UPPER_FACTOR). That allowance is a documented
// judgement, not something the hold-out evaluation measures.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { distanceKm, isModelLike, num, pointOf, token } from './claim-sufficiency.mjs';

const DEFAULT_DIR = fileURLToPath(new URL('../data/climate-hourly/', import.meta.url));

export const CITIES = Object.freeze({
  delhi: { lat: 28.6139, lon: 77.2090 },
  midland_tx: { lat: 31.9973, lon: -102.0779 },
  chennai: { lat: 13.0827, lon: 80.2707 },
  jodhpur: { lat: 26.2389, lon: 73.0243 },
  chandigarh: { lat: 30.7333, lon: 76.7794 },
  port_harcourt: { lat: 4.8156, lon: 7.0498 },
});
export const COVERAGE_RADIUS_KM = 75;
const OBSERVED_UPPER_FACTOR = 2;
const MAX_REPORTED_OUT_OF_ENVELOPE = 20;

// analyte token -> dataset column + accepted unit keys. Units are compared after lower-casing and stripping symbols.
export const VARIABLES = Object.freeze({
  PM2_5: { column: 'cams_pm2_5', units: ['ugm3'] },
  PM25: { column: 'cams_pm2_5', units: ['ugm3'] },
  PM10: { column: 'cams_pm10', units: ['ugm3'] },
  NO2: { column: 'cams_nitrogen_dioxide', units: ['ugm3'] },
  SO2: { column: 'cams_sulphur_dioxide', units: ['ugm3'] },
  O3: { column: 'cams_ozone', units: ['ugm3'] },
  CO: { column: 'cams_carbon_monoxide', units: ['ugm3'] },
  CH4_UGM3: { column: 'cams_methane', units: ['ugm3'] },
  CH4: { column: 'cams_methane_ppb_approx', units: ['ppb'] },
  TEMPERATURE_2M: { column: 'era5_temperature_2m', units: ['c', 'degc', 'celsius'] },
});
export const COLUMNS = [...new Set(Object.values(VARIABLES).map((v) => v.column))];

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const unitKey = (u) => String(u ?? '').toLowerCase().replace(/[μµ]/g, 'u').replace(/³/g, '3').replace(/²/g, '2').replace(/[^a-z0-9]/g, '');
const season = (month) => (month === 11 || month <= 1 ? 0 : month <= 4 ? 1 : month <= 7 ? 2 : 3); // DJF MAM JJA SON (0-based month)
const block = (hour) => Math.floor(hour / 6);
const binOf = (d) => season(d.getUTCMonth()) * 4 + block(d.getUTCHours());

// The parsed rows are read-only and reused: the dataset is a committed file, so one parse per process is enough.
const rowCache = new Map();
export function loadClimateHourly(dir = DEFAULT_DIR) {
  if (rowCache.has(dir)) return rowCache.get(dir).rows;
  const file = join(dir, 'climate-hourly.csv.gz');
  if (!existsSync(file)) return null;
  const text = gunzipSync(readFileSync(file)).toString('utf8');
  const lines = text.split('\n');
  const header = lines[0].split(',');
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const rows = [];
  const byCity = new Map();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = lines[i].split(',');
    const row = { city: f[idx.city], t: Date.parse(f[idx.time_utc]) };
    for (const c of COLUMNS) { const v = f[idx[c]]; row[c] = v === '' || v === undefined ? null : Number(v); }
    rows.push(row);
    if (!byCity.has(row.city)) byCity.set(row.city, []);
    byCity.get(row.city).push(row);
  }
  for (const list of byCity.values()) list.sort((a, b) => a.t - b.t);
  rowCache.set(dir, { rows, byCity });
  return rows;
}

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Fits the envelope on rows with t < trainEndMs. Each bin stores [lo, hi] quantiles; a value is "in envelope" if it
 * lies within [lo - margin*(hi-lo), hi + margin*(hi-lo)].
 */
export function fitEnvelope(rows, { trainEndMs = Infinity, quantiles = [0.002, 0.998], margin = 0.25, minSamples = 200 } = {}) {
  const buckets = new Map();
  for (const r of rows) {
    if (r.t >= trainEndMs) continue;
    const bin = binOf(new Date(r.t));
    for (const c of COLUMNS) {
      if (r[c] === null || !Number.isFinite(r[c])) continue;
      const key = `${r.city}|${c}|${bin}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(r[c]);
    }
  }
  const bands = new Map();
  for (const [key, values] of buckets) {
    if (values.length < minSamples) continue;
    values.sort((a, b) => a - b);
    bands.set(key, [quantile(values, quantiles[0]), quantile(values, quantiles[1]), values.length]);
  }
  return { bands, margin, quantiles, trainEndMs };
}

export function checkValue(model, city, column, tMs, value, { upperFactor = 1 } = {}) {
  const band = model.bands.get(`${city}|${column}|${binOf(new Date(tMs))}`);
  if (!band) return { covered: false };
  const [lo, hi] = band;
  const width = Math.max(hi - lo, 1e-9);
  const low = lo - model.margin * width;
  const high = (hi + model.margin * width) * upperFactor;
  return { covered: true, inside: value >= low && value <= high, low, high, samples: band[2] };
}

export function nearestCity(point, radiusKm = COVERAGE_RADIUS_KM) {
  if (!point) return null;
  let best = null;
  for (const [id, c] of Object.entries(CITIES)) {
    const km = distanceKm(point, c);
    if (km <= radiusKm && (!best || km < best.km)) best = { id, km };
  }
  return best;
}

const modelCache = new Map();
function modelFor(dir) {
  if (!modelCache.has(dir)) {
    const rows = loadClimateHourly(dir);
    modelCache.set(dir, { model: rows ? fitEnvelope(rows) : null, rows: rows?.length ?? 0 });
  }
  return modelCache.get(dir);
}

/**
 * Returns a provider for evaluateClaimThroughFirewall({ plausibility }), or null when the dataset is not shipped.
 * The envelope is built on the first call, not at construction, so a serverless cold start pays nothing until a
 * claim is actually evaluated.
 */
export function createPlausibilityProvider({ dir = DEFAULT_DIR } = {}) {
  if (!existsSync(join(dir, 'climate-hourly.csv.gz'))) return null;
  return ({ claim, evidence }) => {
    const state = modelFor(dir);
    if (!state.model) return { covered: false };
    const city = nearestCity(pointOf(evidence?.location, claim?.scope));
    if (!city) return { covered: false };
    const out = [];
    let checked = 0;
    const measurements = Array.isArray(evidence?.measurements) ? evidence.measurements.slice(0, 5000) : [];
    for (const m of measurements) {
      if (!m || typeof m !== 'object') continue;
      const key = token(m.analyte);
      if (!hasOwn(VARIABLES, key)) continue;
      const spec = VARIABLES[key];
      const value = num(m.value);
      const t = Date.parse(m.validTimeUtc);
      if (value === null || !Number.isFinite(t)) continue;
      if (!spec.units.includes(unitKey(m.unit))) continue;
      const observed = !isModelLike(m.basis);
      const verdict = checkValue(state.model, city.id, spec.column, t, value, { upperFactor: observed ? OBSERVED_UPPER_FACTOR : 1 });
      if (!verdict.covered) continue;
      checked += 1;
      if (!verdict.inside && out.length < MAX_REPORTED_OUT_OF_ENVELOPE) {
        out.push({
          analyte: String(m.analyte).slice(0, 24), value, low: verdict.low, high: verdict.high,
          summary: `${String(m.analyte).slice(0, 24)}=${value} ${String(m.unit ?? '').slice(0, 12)} at ${city.id} is outside ${verdict.low.toFixed(1)}-${verdict.high.toFixed(1)} seen for this season and time of day`.replace(/\s+/g, ' '),
        });
      }
    }
    if (!checked) return { covered: false };
    return { covered: true, envelope: { city: city.id, kmFromCity: Math.round(city.km), checked, trainedOnRows: state.rows }, outOfEnvelope: out };
  };
}

// ---------------------------------------------------------------- dataset access (served at /api/v1/history/hourly)

export function hourlyDatasetInfo(dir = DEFAULT_DIR) {
  const file = join(dir, 'manifest.json');
  if (!existsSync(file)) return null;
  const m = JSON.parse(readFileSync(file, 'utf8'));
  return {
    dataset: 'climate-hourly',
    schema: m.schema,
    rows: m.rows,
    rowsWithMethane: m.rows_with_methane,
    rowUnit: m.row_unit,
    periodUtc: m.period_utc,
    cities: m.cities,
    nonNullCounts: m.non_null_counts,
    classification: m.classification,
    sha256: m.data_file_sha256,
    licence: m.licence,
    honestLabel: 'MODELLED (CAMS) and REANALYSIS (ERA5) values served by Open-Meteo. These are not station observations and must not be presented as measured data.',
    reproduce: 'node gateway/scripts/fetch-climate-hourly.mjs',
  };
}

const HOURLY_LIMIT = 500;
function lowerBound(list, t) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t < t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * Bounded query over the cached, per-city, time-sorted rows. Returns {error} for an unknown city or unparseable
 * time so the route can answer 400; null when the dataset is not shipped.
 */
export function queryHourly({ city, from, to, limit = 48, dir = DEFAULT_DIR } = {}) {
  if (!hasOwn(CITIES, city)) return { error: 'unknown_city', cities: Object.keys(CITIES) };
  const fromMs = from ? Date.parse(from) : -Infinity;
  const toMs = to ? Date.parse(to) : Infinity;
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return { error: 'invalid_time' };
  if (!loadClimateHourly(dir)) return null;
  const list = rowCache.get(dir).byCity.get(city) ?? [];
  const take = Math.max(1, Math.min(HOURLY_LIMIT, Math.trunc(Number(limit)) || 48));
  const out = [];
  for (let i = lowerBound(list, fromMs); i < list.length && out.length < take; i++) {
    const r = list[i];
    if (r.t >= toMs) break;
    out.push({ city: r.city, time_utc: new Date(r.t).toISOString(), ...Object.fromEntries(COLUMNS.map((c) => [c, r[c]])) });
  }
  return { count: out.length, limit: take, rows: out, classification: 'MODELLED/REANALYSIS, not station observations' };
}
