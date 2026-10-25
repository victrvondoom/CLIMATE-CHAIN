import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AirCountry, AirPointSignal } from '../../api';
import { AtlasDetail, AtlasLegend, AtlasRanking, AtlasStats } from './AtlasParts';
import { summariseCountries } from './aqi';

const place = { lat: 28.6, lng: 77.2, name: 'New Delhi, India' };
const reading = { time: '2026-10-25T04:00:00.000Z', usAqi: 159, pm25: 58.4, pm10: 66, no2: 31.8, o3: 84, so2: 32.5, co: 892 };
const cells = Array.from({ length: 25 }, (_, i) => ({ row: Math.floor(i / 5) - 2, col: (i % 5) - 2, usAqi: i < 10 ? 170 : 60, category: (i < 10 ? 'unhealthy' : 'moderate') as 'unhealthy' | 'moderate' }));
const data: AirPointSignal = {
  status: 'live', source: 'Open-Meteo Air Quality API - Copernicus CAMS atmospheric composition model (modelled values, not station observations)', sourceUrl: 'https://air-quality-api.open-meteo.com/v1/air-quality', fetchedAt: '2026-10-25T04:30:00.000Z',
  place: { lat: 28.6, lng: 77.2, nearest: { iso2: 'IN', name: 'India', capital: 'New Delhi', distanceKm: 1 } },
  reading, category: { id: 'unhealthy', label: 'Unhealthy' }, whoPm25Guideline: 15, pm25VsWho: 3.9,
  area: { gridCells: 25, cellsWithData: 25, cellKm: { height: 44.5, width: 39.1 }, windowKm: { height: 222, width: 196 }, threshold: 'US AQI above 100', pollutedCells: 10, pollutedSharePct: 40, pollutedAreaKm2: 17400, sampledAreaKm2: 43500, byCategory: { unhealthy: 10, moderate: 15 }, cells },
  resolutionNote: 'CAMS global model, roughly 40 km resolution outside Europe. The area figure is the share of a 5 x 5 grid of model cells, not a measured pollution footprint.',
};
const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

const country = (i: number): AirCountry => ({
  iso2: `C${i}`, name: `Country ${String(i).padStart(2, '0')}`, capital: `Capital ${i}`, region: i % 2 ? 'Asia' : 'Europe', lat: 0, lng: 0,
  reading: { ...reading, usAqi: i * 10, pm25: i * 3 }, category: { id: i * 10 > 100 ? 'sensitive' : 'good', label: i * 10 > 100 ? 'Unhealthy for sensitive groups' : 'Good' },
});
const countries = Array.from({ length: 20 }, (_, i) => country(i + 1));

describe('AtlasDetail', () => {
  it('invites a click before anything is selected', () => {
    expect(html(createElement(AtlasDetail, { selected: null, point: { status: 'idle' } }))).toContain('Pick a place');
  });
  it('shows loading and error states for the selected place', () => {
    expect(html(createElement(AtlasDetail, { selected: place, point: { status: 'loading' } }))).toContain('Reading the atmospheric model');
    const failed = html(createElement(AtlasDetail, { selected: place, point: { status: 'error', message: 'source_unavailable: try later' } }));
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('source_unavailable: try later');
  });
  it('reports AQI, WHO multiple, pollutants and how much area is polluted', () => {
    const out = html(createElement(AtlasDetail, { selected: place, point: { status: 'ready', data } }));
    expect(out).toContain('159');
    expect(out).toContain('Unhealthy');
    expect(out).toContain('3.9×');
    for (const label of ['PM2.5', 'PM10', 'NO₂', 'O₃', 'SO₂', 'CO']) expect(out).toContain(label);
    expect(out).toContain('40%');
    expect(out).toContain('10 of 25 model cells');
    expect(out).toContain('17,400 km²');
    expect((out.match(/class="pa-cell/g) ?? []).length).toBe(25);
    expect((out.match(/pa-cell-centre/g) ?? []).length).toBe(1);
  });
  it('states that the area figure is modelled and says so when the copy is stale', () => {
    const out = html(createElement(AtlasDetail, { selected: place, point: { status: 'ready', data: { ...data, status: 'stale' } } }));
    expect(out).toContain('not a measured pollution footprint');
    expect(out).toContain('stale copy');
  });
  it('shows model values beyond the top of the AQI scale as 500+ and says why', () => {
    const extreme = { ...data, reading: { ...reading, usAqi: 855 }, category: { id: 'hazardous' as const, label: 'Hazardous' } };
    const out = html(createElement(AtlasDetail, { selected: place, point: { status: 'ready', data: extreme } }));
    expect(out).toContain('500+');
    expect(out).toContain('above the top of the US AQI scale');
    expect(out).not.toContain('>855<');
  });
  it('does not claim a polluted share when the model returned nothing', () => {
    const empty = { ...data, area: { ...data.area, cellsWithData: 0, pollutedCells: 0, pollutedSharePct: null, pollutedAreaKm2: null } };
    const out = html(createElement(AtlasDetail, { selected: place, point: { status: 'ready', data: empty } }));
    expect(out).toContain('returned no values');
    expect(out).not.toContain('pa-grid');
  });
});

describe('AtlasStats and legend', () => {
  it('names the most polluted and cleanest capital and the share above AQI 100', () => {
    const out = html(createElement(AtlasStats, { summary: summariseCountries(countries), total: 195 }));
    expect(out).toContain('Capital 20 · AQI 200');
    expect(out).toContain('Capital 1 · AQI 10');
    expect(out).toContain('10 capitals (50%)');
    expect(out).toContain('20 / 195');
  });
  it('lists every AQI band', () => {
    const out = html(createElement(AtlasLegend));
    for (const label of ['Good', 'Moderate', 'Unhealthy for sensitive groups', 'Very unhealthy', 'Hazardous']) expect(out).toContain(label);
  });
});

describe('AtlasRanking', () => {
  it('starts with the 15 most polluted and offers the full list', () => {
    const out = html(createElement(AtlasRanking, { countries, onSelect: () => undefined, selectedIso: 'C20' }));
    expect((out.match(/class="pa-link"/g) ?? []).length).toBe(15);
    expect(out.indexOf('Country 20')).toBeLessThan(out.indexOf('Country 19'));
    expect(out).not.toContain('Country 05');
    expect(out).toContain('Show all 20');
    expect(out).toContain('pa-row-selected');
  });
});
