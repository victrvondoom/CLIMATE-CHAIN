import { describe, expect, it } from 'vitest';
import type { AirCategoryId, AirCountry } from '../../api';
import { AIR_BANDS, bandFor, rankCountries, summariseCountries } from './aqi';

const category = (aqi: number | null): { id: AirCategoryId; label: string } => {
  if (aqi === null) return { id: 'unknown', label: 'No data' };
  const band = [[50, 'good'], [100, 'moderate'], [150, 'sensitive'], [200, 'unhealthy'], [300, 'very-unhealthy']].find(([max]) => aqi <= (max as number));
  return { id: ((band?.[1] as AirCategoryId) ?? 'hazardous'), label: '' };
};
const make = (iso2: string, name: string, region: string, aqi: number | null): AirCountry => ({
  iso2, name, capital: `${name} City`, region, lat: 0, lng: 0,
  reading: { time: null, usAqi: aqi, pm25: aqi === null ? null : aqi / 3, pm10: null, no2: null, o3: null, so2: null, co: null },
  category: category(aqi),
});
const list = [
  make('AA', 'Alpha', 'Asia', 160), make('BB', 'Bravo', 'Africa', 40), make('CC', 'Charlie', 'Asia', 160),
  make('DD', 'Delta', 'Europe', null), make('EE', 'Echo', 'Europe', 101), make('FF', 'Foxtrot', 'Asia', 100),
];

describe('country ranking', () => {
  it('orders most polluted first, breaks ties by name and leaves out countries with no reading', () => {
    expect(rankCountries(list, { mode: 'worst', region: 'All', query: '' }).map((c) => c.iso2)).toEqual(['AA', 'CC', 'EE', 'FF', 'BB']);
  });
  it('orders cleanest first without ranking missing values as clean', () => {
    const best = rankCountries(list, { mode: 'best', region: 'All', query: '' }).map((c) => c.iso2);
    expect(best[0]).toBe('BB');
    expect(best).not.toContain('DD');
  });
  it('filters by region and by country or capital text', () => {
    expect(rankCountries(list, { mode: 'worst', region: 'Asia', query: '' }).map((c) => c.iso2)).toEqual(['AA', 'CC', 'FF']);
    expect(rankCountries(list, { mode: 'worst', region: 'All', query: ' bravo city ' }).map((c) => c.iso2)).toEqual(['BB']);
    expect(rankCountries(list, { mode: 'worst', region: 'Africa', query: 'alpha' })).toEqual([]);
  });
});

describe('global summary', () => {
  it('counts only AQI above 100 as polluted and names the extremes', () => {
    const summary = summariseCountries(list);
    expect(summary.ranked).toBe(5);
    expect(summary.pollutedCount).toBe(3); // 160, 160, 101; exactly 100 is not above the threshold
    expect(summary.pollutedPct).toBe(60);
    expect(summary.worst?.iso2).toBe('AA');
    expect(summary.best?.iso2).toBe('BB');
  });
  it('reports nothing when no country has a reading', () => {
    expect(summariseCountries([make('DD', 'Delta', 'Europe', null)])).toEqual({ ranked: 0, worst: null, best: null, pollutedCount: 0, pollutedPct: null });
  });
});

describe('AQI bands', () => {
  it('gives each category a distinct colour and a plain-language label', () => {
    expect(new Set(AIR_BANDS.map((band) => band.color)).size).toBe(AIR_BANDS.length);
    expect(AIR_BANDS.map((band) => band.id)).toEqual(['good', 'moderate', 'sensitive', 'unhealthy', 'very-unhealthy', 'hazardous']);
    expect(bandFor('unhealthy').label).toBe('Unhealthy');
  });
  it('falls back to a neutral band when the model has no value', () => {
    expect(bandFor('unknown').label).toBe('No model data');
    expect(AIR_BANDS.some((band) => band.color === bandFor('unknown').color)).toBe(false);
  });
});
