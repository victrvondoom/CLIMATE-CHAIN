import type { AirCategoryId, AirCountry } from '../../api';

// US EPA AQI bands. Colours follow the familiar green-to-maroon scale so a viewer can read the globe
// without a legend lesson; the category label and advice always travel with the colour.
export interface AirBand { id: AirCategoryId; label: string; range: string; color: string; ink: string; advice: string }

export const AIR_BANDS: AirBand[] = [
  { id: 'good', label: 'Good', range: '0-50', color: '#3fae49', ink: '#ffffff', advice: 'Air quality is satisfactory and poses little or no health risk.' },
  { id: 'moderate', label: 'Moderate', range: '51-100', color: '#f2c230', ink: '#2b2620', advice: 'Acceptable for most people. Unusually sensitive people should consider limiting prolonged outdoor exertion.' },
  { id: 'sensitive', label: 'Unhealthy for sensitive groups', range: '101-150', color: '#f08a24', ink: '#2b2620', advice: 'Children, older adults and people with asthma or heart disease should limit prolonged outdoor exertion.' },
  { id: 'unhealthy', label: 'Unhealthy', range: '151-200', color: '#d9412e', ink: '#ffffff', advice: 'Everyone may begin to feel health effects. Sensitive groups should avoid outdoor exertion.' },
  { id: 'very-unhealthy', label: 'Very unhealthy', range: '201-300', color: '#8d3a9a', ink: '#ffffff', advice: 'Health alert: everyone may experience serious effects. Avoid outdoor exertion.' },
  { id: 'hazardous', label: 'Hazardous', range: '301+', color: '#6b1630', ink: '#ffffff', advice: 'Emergency conditions. Stay indoors with filtered air and avoid all outdoor exertion.' },
];

const UNKNOWN: AirBand = { id: 'unknown', label: 'No model data', range: '-', color: '#b9b2a2', ink: '#2b2620', advice: 'The model returned no value for this point.' };

export function bandFor(id: AirCategoryId): AirBand {
  return AIR_BANDS.find((band) => band.id === id) ?? UNKNOWN;
}

export type RankMode = 'worst' | 'best';
export const REGIONS = ['All', 'Africa', 'Americas', 'Asia', 'Europe', 'Oceania'] as const;
export type Region = (typeof REGIONS)[number];

/** Countries with a model value, filtered and ordered. Missing values are left out of a ranking, never ranked as clean. */
export function rankCountries(list: AirCountry[], { mode, region, query }: { mode: RankMode; region: Region; query: string }): AirCountry[] {
  const needle = query.trim().toLowerCase();
  const sign = mode === 'worst' ? -1 : 1;
  return list
    .filter((c) => c.reading.usAqi !== null)
    .filter((c) => region === 'All' || c.region === region)
    .filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.capital.toLowerCase().includes(needle))
    .sort((a, b) => sign * ((a.reading.usAqi as number) - (b.reading.usAqi as number)) || a.name.localeCompare(b.name));
}

export interface AirSummary { ranked: number; worst: AirCountry | null; best: AirCountry | null; pollutedCount: number; pollutedPct: number | null }

/** Headline numbers over every country that has a value. "Polluted" means US AQI above 100. */
export function summariseCountries(list: AirCountry[]): AirSummary {
  const ranked = rankCountries(list, { mode: 'worst', region: 'All', query: '' });
  const pollutedCount = ranked.filter((c) => (c.reading.usAqi as number) > 100).length;
  return {
    ranked: ranked.length,
    worst: ranked[0] ?? null,
    best: ranked.length ? ranked[ranked.length - 1] : null,
    pollutedCount,
    pollutedPct: ranked.length ? Math.round((pollutedCount / ranked.length) * 1000) / 10 : null,
  };
}

export const POLLUTANTS = [
  { key: 'pm25', label: 'PM2.5', unit: 'µg/m³', hint: 'Fine particles, the strongest link to health harm' },
  { key: 'pm10', label: 'PM10', unit: 'µg/m³', hint: 'Coarse dust and smoke particles' },
  { key: 'no2', label: 'NO₂', unit: 'µg/m³', hint: 'Traffic and combustion' },
  { key: 'o3', label: 'O₃', unit: 'µg/m³', hint: 'Ground-level ozone' },
  { key: 'so2', label: 'SO₂', unit: 'µg/m³', hint: 'Coal and industrial burning' },
  { key: 'co', label: 'CO', unit: 'µg/m³', hint: 'Incomplete combustion' },
] as const;
