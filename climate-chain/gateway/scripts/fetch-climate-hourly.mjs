#!/usr/bin/env node
// Reproducible keyless fetch: Open-Meteo CAMS-global (air quality incl. methane) + ERA5 (weather)
// -> one gzip CSV of city-hour rows + sha256 manifest. Standalone: Node >= 18, no dependencies.
//
//   node scripts/fetch-climate-hourly.mjs                       # all 6 cities, writes climate-chain/data/climate-hourly/
//   node scripts/fetch-climate-hourly.mjs --cities=sample       # first 2 cities only
//   node scripts/fetch-climate-hourly.mjs --noaa                # also fetch NOAA GML / GISTEMP measured series
//   node scripts/fetch-climate-hourly.mjs --start=2024-11-01 --end=2026-07-31 --out=./out
//
// HONEST LABELS (also written into the manifest, never drop them downstream):
//   cams_*  : Copernicus CAMS global atmospheric-composition MODEL output (analysis/forecast archive,
//             ~40 km grid) served by Open-Meteo. Modelled, NOT station measurements. CC BY 4.0.
//   era5_*  : ECMWF ERA5 atmospheric REANALYSIS (~0.25 deg) served by Open-Meteo. Model-assimilated, NOT
//             station measurements. CC BY 4.0 (Copernicus licence).
//   noaa_*  : MEASURED (NOAA GML flask / in-situ network, NASA GISTEMP station analysis). Public domain.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const START = args.start || '2024-11-01';   // CAMS methane is first non-null on 2024-10-26 (probed)
const END = args.end || '2026-07-31';       // pinned & >2 months old so ERA5T -> ERA5 revisions have settled
const OUT = args.out || fileURLToPath(new URL('../../data/climate-hourly/', import.meta.url));
const CITIES_ALL = [
  { id: 'delhi',        name: 'Delhi, IN',              lat: 28.6139, lon: 77.2090 },
  { id: 'midland_tx',   name: 'Midland TX (Permian)',   lat: 31.9973, lon: -102.0779 },
  { id: 'chennai',      name: 'Chennai, IN',            lat: 13.0827, lon: 80.2707 },
  { id: 'jodhpur',      name: 'Jodhpur, IN',            lat: 26.2389, lon: 73.0243 },
  { id: 'chandigarh',   name: 'Chandigarh, IN',         lat: 30.7333, lon: 76.7794 },
  { id: 'port_harcourt',name: 'Port Harcourt (Niger Delta)', lat: 4.8156, lon: 7.0498 },
];
const CITIES = args.cities === 'sample' ? CITIES_ALL.slice(0, 2) : CITIES_ALL;

const AQ_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const WX_URL = 'https://archive-api.open-meteo.com/v1/archive';
const AQ_VARS = ['pm2_5', 'pm10', 'nitrogen_dioxide', 'sulphur_dioxide', 'ozone', 'carbon_monoxide', 'methane', 'carbon_dioxide'];
const WX_VARS = ['temperature_2m', 'relative_humidity_2m', 'wind_speed_10m', 'wind_direction_10m', 'surface_pressure', 'precipitation'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha256 = b => createHash('sha256').update(b).digest('hex');

async function getJson(url, tries = 5) {
  for (let i = 1; i <= tries; i++) {
    const res = await fetch(url, { headers: { 'user-agent': 'climate-chain-fetch-sample/1.0 (research; CC BY 4.0 attribution kept)' } });
    const text = await res.text();
    if (res.ok) return { json: JSON.parse(text), bytes: text.length, sha256: sha256(text) };
    if (res.status === 429 || res.status >= 500) { await sleep(2000 * i * i); continue; } // minutely/hourly limit: back off
    throw new Error(`HTTP ${res.status} ${url} :: ${text.slice(0, 200)}`);
  }
  throw new Error('retries exhausted ' + url);
}

// 366-day windows: keeps each call small & well inside the free-tier weighting.
function windows(start, end, days = 366) {
  const out = []; let a = new Date(start + 'T00:00:00Z'); const z = new Date(end + 'T00:00:00Z');
  while (a <= z) { const b = new Date(Math.min(+a + (days - 1) * 864e5, +z)); out.push([a.toISOString().slice(0, 10), b.toISOString().slice(0, 10)]); a = new Date(+b + 864e5); }
  return out;
}

async function getText(url, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try { const res = await fetch(url, { headers: { 'user-agent': 'climate-chain-fetch-sample/1.0 (research)', accept: 'text/csv,*/*' } }); if (res.ok) return await res.text(); } catch {}
    await sleep(1500 * i);
  }
  throw new Error('fetch failed ' + url);
}

const requests = [];
const rows = [];
const COLS = ['city', 'time_utc',
  ...AQ_VARS.map(v => 'cams_' + v), 'cams_methane_ppb_approx',
  ...WX_VARS.map(v => 'era5_' + v)];

// CH4 mass conc (ug/m3, at 10 m) -> mole fraction (ppb), assuming 25 C / 1013.25 hPa (24.45 L/mol); molar mass 16.043.
// Approximation only: the true conversion needs the model's local T and p. Kept as a separate, labelled column.
const ch4ppb = u => (u == null ? null : +(u * 24.45 / 16.043).toFixed(1));

for (const c of CITIES) {
  const byTime = new Map();
  for (const [a, b] of windows(START, END)) {
    const aqU = `${AQ_URL}?latitude=${c.lat}&longitude=${c.lon}&start_date=${a}&end_date=${b}&hourly=${AQ_VARS.join(',')}&timezone=GMT&domains=cams_global`;
    const wxU = `${WX_URL}?latitude=${c.lat}&longitude=${c.lon}&start_date=${a}&end_date=${b}&hourly=${WX_VARS.join(',')}&timezone=GMT`;
    for (const [kind, url] of [['cams_global', aqU], ['era5', wxU]]) {
      const r = await getJson(url);
      requests.push({ city: c.id, kind, url, response_sha256: r.sha256, response_bytes: r.bytes, grid_lat: r.json.latitude, grid_lon: r.json.longitude });
      const h = r.json.hourly;
      h.time.forEach((t, i) => {
        const row = byTime.get(t) || { city: c.id, time_utc: t + ':00Z' };
        if (kind === 'cams_global') AQ_VARS.forEach(v => { row['cams_' + v] = h[v][i]; });
        else WX_VARS.forEach(v => { row['era5_' + v] = h[v][i]; });
        byTime.set(t, row);
      });
      await sleep(400); // ~150 calls/min, far below 600/min
    }
  }
  for (const row of byTime.values()) { row.cams_methane_ppb_approx = ch4ppb(row.cams_methane); rows.push(row); }
  console.log(`${c.id}: ${byTime.size} hourly rows`);
}

const fmt = v => (v == null ? '' : String(v));
const csv = [COLS.join(','), ...rows.map(r => COLS.map(k => fmt(r[k])).join(','))].join('\n') + '\n';
const gz = gzipSync(Buffer.from(csv), { level: 9, mtime: 0 }); // mtime 0 => byte-reproducible gzip
mkdirSync(OUT, { recursive: true });
const dataFile = 'climate-hourly.csv.gz';
writeFileSync(join(OUT, dataFile), gz);

const nn = k => rows.filter(r => r[k] != null).length;
const stats = Object.fromEntries(COLS.slice(2).map(k => [k, nn(k)]));
const manifest = {
  schema: 'climate-chain.hourly-cams-era5.v1',
  generated_by: 'fetch-climate-hourly.mjs',
  generated_at: new Date().toISOString(),
  data_file: dataFile, data_file_sha256: sha256(gz), csv_uncompressed_sha256: sha256(Buffer.from(csv)),
  bytes_gz: gz.length, bytes_csv: csv.length,
  row_unit: 'one row = one city x one UTC hour', rows: rows.length, rows_with_methane: stats.cams_methane,
  period_utc: [START, END], cities: CITIES, non_null_counts: stats,
  classification: {
    'cams_*': 'MODELLED (Copernicus CAMS global atmospheric composition, ~40 km grid, via Open-Meteo). Not a station observation.',
    'era5_*': 'REANALYSIS (ECMWF ERA5, ~0.25 deg, via Open-Meteo). Not a station observation.',
    cams_methane_ppb_approx: 'DERIVED: ug/m3 -> ppb at assumed 25C/1013.25hPa; approximate.',
  },
  licence: { data: 'CC BY 4.0', attribution: 'Weather data by Open-Meteo.com (CC BY 4.0). Contains modified Copernicus Atmosphere Monitoring Service information (CAMS) and Copernicus Climate Change Service ERA5 data (2024-2026).', terms: 'https://open-meteo.com/en/license', free_tier: 'non-commercial use only; <=10,000 calls/day (600/min, 5,000/h documented)' },
  requests_made: requests.length, requests,
};

if (args.noaa) { // MEASURED tier (public domain), small & stable. Appended to manifest only (rows kept in own files).
  const sources = [
    ['noaa_ch4_monthly_global.csv', 'https://gml.noaa.gov/webdata/ccgg/trends/ch4/ch4_mm_gl.csv'],
    ['noaa_co2_daily_mlo.csv', 'https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_daily_mlo.csv'],
    ['nasa_gistemp_glb_monthly.csv', 'https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv'],
  ];
  manifest.measured_tier = [];
  for (const [name, url] of sources) {
    const text = await getText(url);
    const dataLines = text.split('\n').filter(l => /^\d{4}/.test(l)).length;
    const g = gzipSync(Buffer.from(text), { level: 9, mtime: 0 });
    writeFileSync(join(OUT, name + '.gz'), g);
    manifest.measured_tier.push({ file: name + '.gz', url, raw_sha256: sha256(Buffer.from(text)), gz_sha256: sha256(g), data_lines: dataLines, classification: 'MEASURED' });
  }
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ rows: rows.length, rows_with_methane: stats.cams_methane, rows_with_pm2_5: stats.cams_pm2_5, rows_with_era5_t2m: stats.era5_temperature_2m, bytes_gz: gz.length, sha256: manifest.data_file_sha256, requests: requests.length }, null, 2));
