import test from 'node:test';
import assert from 'node:assert/strict';
import { aqiCategory, buildAirGrid, createWorldSignalService, mergeNews, nearestCountry, parseAirReadings, parseInflation, parseOni, parseRss, summariseAirArea, WorldSignalError } from '../world-signals.mjs';
import { COUNTRIES } from '../countries.mjs';

const oniText = () => {
  const seasons = ['DJF', 'JFM', 'FMA', 'MAM', 'AMJ', 'MJJ', 'JJA', 'JAS', 'ASO', 'SON', 'OND', 'NDJ'];
  const lines = ['SEAS  YR   TOTAL   ANOM'];
  for (let year = 2000; year < 2012; year++) seasons.forEach((s, i) => lines.push(`${s} ${year} 27.0 ${(Math.sin(year + i) * 1.2).toFixed(2)}`));
  return lines.join('\n');
};
const reply = (body, ok = true, status = 200) => async () => ({ ok, status, headers: new Map(), text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

test('ONI parser keeps valid rows, classifies phase and rejects malformed tables', () => {
  const rows = parseOni(`${oniText()}\nXXX 2020 1 9\nDJF 2020 27 99`);
  assert.equal(rows.length, 144);
  assert.ok(rows.every((r) => ['El Nino', 'La Nina', 'Neutral'].includes(r.phase)));
  assert.equal(parseOni(oniText()).find((r) => r.oni >= 0.5)?.phase, 'El Nino');
  assert.throws(() => parseOni('<html>blocked</html>'), WorldSignalError);
});

const rss = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${items.join('')}</channel></rss>`;
const item = (title, link, date) => `<item><title>${title}</title><link>${link}</link><pubDate>${date}</pubDate></item>`;

test('RSS parser decodes entities/CDATA, drops unsafe links and rejects non-feeds', () => {
  const out = parseRss(rss([
    item('<![CDATA[Heatwave &amp; drought grip <b>north</b>]]>', 'https://a.example/x', 'Sat, 24 Oct 2026 10:15:00 GMT'),
    item('bad', 'javascript:alert(1)', 'Sat, 24 Oct 2026 10:15:00 GMT'),
    item('also bad', 'not a url', ''),
  ]), 'Test Outlet');
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Heatwave & drought grip north');
  assert.equal(out[0].seenAt, '2026-10-24T10:15:00.000Z');
  assert.equal(out[0].outlet, 'Test Outlet');
  assert.throws(() => parseRss('<html>nope</html>', 'X'), WorldSignalError);
});

test('news merge dedupes across outlets, filters by topic and sorts newest first', () => {
  const a = [{ title: 'El Nino returns', seenAt: '2026-10-01T00:00:00.000Z' }, { title: 'Solar boom', seenAt: '2026-10-02T00:00:00.000Z' }];
  const b = [{ title: 'el nino returns', seenAt: '2026-10-03T00:00:00.000Z' }, { title: 'La Nina watch issued', seenAt: '2026-10-04T00:00:00.000Z' }];
  assert.deepEqual(mergeNews([a, b], /el ni.o|la ni.a/i).map((x) => x.title), ['La Nina watch issued', 'El Nino returns']);
  assert.equal(mergeNews([a, b], null).length, 3);
});

test('inflation parser skips unpublished years and sorts ascending', () => {
  const series = parseInflation([{}, [{ date: '2024', value: 4.95 }, { date: '2025', value: null }, { date: '2023', value: '5.65' }]]);
  assert.deepEqual(series, [{ year: 2023, inflationPct: 5.65 }, { year: 2024, inflationPct: 4.95 }]);
  assert.throws(() => parseInflation([{}, [{ date: '2025', value: null }]]), WorldSignalError);
});

test('service caches, serves stale on failure, fails visibly with no copy, and validates topic', async () => {
  let clock = 0;
  let calls = 0;
  let healthy = true;
  const fetchImpl = async (...args) => { calls++; return healthy ? reply(oniText())(...args) : reply('down', false, 503)(...args); };
  const svc = createWorldSignalService({ fetchImpl, now: () => clock });
  const first = await svc.enso();
  assert.equal(first.status, 'live');
  assert.equal((await svc.enso()).cached, true);
  assert.equal(calls, 1);
  clock += 7 * 3600_000; healthy = false;
  const stale = await svc.enso();
  assert.equal(stale.status, 'stale');
  assert.equal(stale.series.length, 144);
  const cold = createWorldSignalService({ fetchImpl: reply('down', false, 503) });
  await assert.rejects(() => cold.indiaInflation(), (e) => e.code === 'source_unavailable');
  assert.throws(() => cold.news('../../etc'), (e) => e.code === 'invalid_topic' && e.status === 400);
});

test('news survives one failed feed, fails visibly when all fail, and never retries rate limits', async () => {
  const feed = rss([item('Monsoon deficit widens', 'https://x.example/a', 'Sat, 24 Oct 2026 10:15:00 GMT')]);
  const partial = createWorldSignalService({ fetchImpl: async (url, ...r) => (String(url).includes('theguardian') ? reply('x', false, 500)(url, ...r) : reply(feed)(url, ...r)) });
  const out = await partial.news('enso');
  assert.equal(out.articles.length, 1);
  assert.deepEqual(out.failedOutlets, ['The Guardian - Climate crisis']);
  const allDown = createWorldSignalService({ fetchImpl: reply('x', false, 500) });
  await assert.rejects(() => allDown.news('climate'), (e) => e.code === 'source_unavailable');
  let limited = 0;
  const throttled = createWorldSignalService({ fetchImpl: async (...a) => { limited++; return reply('slow down', false, 429)(...a); } });
  await assert.rejects(() => throttled.news('india'), (e) => e.code === 'source_rate_limited' && e.status === 503);
  assert.equal(limited, 1);
  let calls = 0;
  const flaky = createWorldSignalService({ fetchImpl: async (...a) => { calls++; if (calls === 1) throw new TypeError('fetch failed'); return reply(feed)(...a); } });
  assert.equal((await flaky.news('india')).articles.length, 1);
  assert.equal(calls, 2);
});

test('concurrent identical requests share one upstream call', async () => {
  let calls = 0;
  const svc = createWorldSignalService({ fetchImpl: async (...a) => { calls++; return reply(oniText())(...a); } });
  await Promise.all([svc.enso(), svc.enso(), svc.enso()]);
  assert.equal(calls, 1);
});

// ---- Air quality --------------------------------------------------------------------------------
const omEntry = (aqi, pm25 = 10) => ({ current: { time: '2026-10-25T04:00', us_aqi: aqi, pm2_5: pm25, pm10: 20, nitrogen_dioxide: 5, ozone: 60, sulphur_dioxide: 1, carbon_monoxide: 150 } });
// Fake Open-Meteo: answers with one entry per requested coordinate; aqiFor() decides each value.
const fakeOpenMeteo = (aqiFor = () => 42, seen = []) => async (url) => {
  const q = new URL(url).searchParams;
  const lats = q.get('latitude').split(',').map(Number);
  const lngs = q.get('longitude').split(',').map(Number);
  seen.push({ n: lats.length, url: String(url) });
  const list = lats.map((lat, i) => omEntry(aqiFor(lat, lngs[i])));
  return reply(list.length === 1 ? list[0] : list)(url);
};

test('country list covers 195 unique, in-range sample points', () => {
  assert.equal(COUNTRIES.length, 195);
  assert.equal(new Set(COUNTRIES.map((c) => c.iso2)).size, 195);
  assert.ok(COUNTRIES.every((c) => /^[A-Z]{2}$/.test(c.iso2) && c.capital && Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180 && Number.isFinite(c.lat + c.lng)));
  assert.ok(['Africa', 'Americas', 'Asia', 'Europe', 'Oceania'].every((r) => COUNTRIES.some((c) => c.region === r)));
  assert.equal(nearestCountry(28.6, 77.2).iso2, 'IN');
});

test('AQI categories follow the US EPA bands and treat missing data as unknown', () => {
  assert.deepEqual([0, 50, 51, 150, 151, 201, 301].map((v) => aqiCategory(v).id), ['good', 'good', 'moderate', 'sensitive', 'unhealthy', 'very-unhealthy', 'hazardous']);
  assert.equal(aqiCategory(100).id, 'moderate');
  assert.equal(aqiCategory(101).id, 'sensitive');
  assert.equal(aqiCategory(null).id, 'unknown');
  assert.equal(aqiCategory(-3).id, 'unknown');
});

test('reading parser accepts one or many points, keeps gaps as null and rejects bad payloads', () => {
  const single = parseAirReadings(omEntry(159, 59.8), 1);
  assert.equal(single[0].usAqi, 159);
  assert.equal(single[0].pm25, 59.8);
  assert.equal(single[0].time, '2026-10-25T04:00:00.000Z');
  const gap = parseAirReadings([{ current: { time: '2026-10-25T04:00', us_aqi: null, pm2_5: 'x' } }, omEntry(30)], 2);
  assert.equal(gap[0].usAqi, null);
  assert.equal(gap[0].pm25, null);
  assert.throws(() => parseAirReadings([omEntry(1)], 2), WorldSignalError);
  assert.throws(() => parseAirReadings({ error: true, reason: 'nope' }, 1), WorldSignalError);
});

test('air grid is 5 x 5, north row first, centred, and wraps across the antimeridian and poles', () => {
  const cells = buildAirGrid(10, 179.9);
  assert.equal(cells.length, 25);
  assert.deepEqual(cells[0], { row: -2, col: -2, lat: 10.8, lng: 179.1 });
  assert.equal(cells[12].row, 0);
  assert.equal(cells[12].lat, 10);
  assert.ok(cells.every((c) => c.lng >= -180 && c.lng < 180));
  assert.ok(cells.some((c) => c.lng < -179));
  assert.ok(buildAirGrid(89.9, 0).every((c) => c.lat <= 90));
});

test('area summary counts polluted share only over cells that have data', () => {
  const cells = buildAirGrid(0, 0);
  const readings = cells.map((_, i) => ({ ...omEntry(0).current, usAqi: i < 5 ? 160 : i < 10 ? 80 : i < 15 ? null : 20 }));
  const area = summariseAirArea(cells, readings, 0);
  assert.equal(area.cellsWithData, 20);
  assert.equal(area.pollutedCells, 5);
  assert.equal(area.pollutedSharePct, 25);
  assert.deepEqual(area.byCategory, { unhealthy: 5, moderate: 5, good: 10 });
  assert.equal(area.cells.find((c) => c.usAqi === null).category, 'unknown');
  assert.ok(area.pollutedAreaKm2 > 0 && area.pollutedAreaKm2 < area.sampledAreaKm2);
  assert.ok(summariseAirArea(cells, readings.map(() => ({ ...omEntry(0).current, usAqi: null })), 0).pollutedSharePct === null);
  // grid cells shrink east-west toward the poles
  assert.ok(summariseAirArea(cells, readings, 70).cellKm.width < area.cellKm.width);
});

test('point reading reports pollutants, WHO multiple and polluted share, and validates coordinates', async () => {
  const seen = [];
  const svc = createWorldSignalService({ fetchImpl: fakeOpenMeteo((lat) => (lat >= 28.7 ? 180 : 60), seen) });
  const out = await svc.airPoint('28.61', '77.23');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].n, 25);
  assert.equal(out.status, 'live');
  assert.equal(out.place.nearest.iso2, 'IN');
  assert.equal(out.reading.usAqi, 60);
  assert.equal(out.category.id, 'moderate');
  assert.equal(out.pm25VsWho, 0.7);
  assert.equal(out.area.pollutedSharePct, 40);
  assert.match(out.resolutionNote, /not a measured/);
  assert.equal((await svc.airPoint('28.6', '77.2')).cached, true); // same 0.1 degree cell
  for (const [lat, lng] of [['', '0'], ['abc', '0'], ['91', '0'], ['0', '181'], [null, null]]) {
    assert.throws(() => svc.airPoint(lat, lng), (e) => e.code === 'invalid_coordinates' && e.status === 400);
  }
});

test('country air quality batches 195 points into five calls and tolerates one failed batch', async () => {
  const seen = [];
  const svc = createWorldSignalService({ fetchImpl: fakeOpenMeteo((lat) => (lat > 0 ? 120 : 30), seen) });
  const out = await svc.airCountries();
  assert.equal(seen.length, 5);
  assert.deepEqual(seen.map((s) => s.n), [40, 40, 40, 40, 35]);
  assert.equal(out.count, 195);
  assert.equal(out.withData, 195);
  assert.equal(out.countries.find((c) => c.iso2 === 'IN').category.id, 'sensitive');
  assert.equal(out.countries.find((c) => c.iso2 === 'AR').category.id, 'good');

  let calls = 0;
  const partial = createWorldSignalService({ fetchImpl: async (url, ...r) => { calls++; return calls === 2 ? reply('x', false, 500)(url, ...r) : fakeOpenMeteo()(url, ...r); } });
  const some = await partial.airCountries();
  assert.equal(some.failed, 40);
  assert.equal(some.withData, 155);
  assert.equal(some.countries.filter((c) => c.category.id === 'unknown').length, 40);

  const down = createWorldSignalService({ fetchImpl: reply('x', false, 503) });
  await assert.rejects(() => down.airCountries(), (e) => e.code === 'source_unavailable');
});
