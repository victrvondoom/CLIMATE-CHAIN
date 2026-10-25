import { useMemo, useState } from 'react';
import type { AirCountry, AirPointSignal } from '../../api';
import type { Place } from '../earth/environment';
import { AIR_BANDS, POLLUTANTS, REGIONS, bandFor, rankCountries, type AirSummary, type RankMode, type Region } from './aqi';

export type PointState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: AirPointSignal }
  | { status: 'error'; message: string };

const TOP_ROWS = 15;
const fmt = (value: number | null, digits = 0) => (value === null ? '–' : value.toLocaleString('en-US', { maximumFractionDigits: digits }));
/** The US AQI scale ends at 500. The model extrapolates past it in extreme events, so anything above shows as 500+. */
export const AQI_SCALE_MAX = 500;
export const aqiText = (value: number | null) => (value === null ? '–' : value > AQI_SCALE_MAX ? `${AQI_SCALE_MAX}+` : fmt(value));
export const when =(iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC' : 'unknown time');

export function AqiChip({ country }: { country: AirCountry }) {
  const band = bandFor(country.category.id);
  return <span className="pa-chip" style={{ background: band.color, color: band.ink }}>{aqiText(country.reading.usAqi)}</span>;
}

export function AtlasStats({ summary, total }: { summary: AirSummary; total: number }) {
  const card = (label: string, value: string, detail: string, color?: string) => (
    <div className="pa-stat"><span>{label}</span><b style={color ? { borderLeftColor: color } : undefined}>{value}</b><small>{detail}</small></div>
  );
  return (
    <section className="pa-stats" aria-label="Global summary">
      {card('Capitals with a model reading', `${summary.ranked} / ${total}`, 'one sample point per country')}
      {summary.worst && card('Most polluted capital', `${summary.worst.capital} · AQI ${aqiText(summary.worst.reading.usAqi)}`, summary.worst.name, bandFor(summary.worst.category.id).color)}
      {summary.best && card('Cleanest capital', `${summary.best.capital} · AQI ${aqiText(summary.best.reading.usAqi)}`, summary.best.name, bandFor(summary.best.category.id).color)}
      {card('Above AQI 100', summary.pollutedPct === null ? '–' : `${summary.pollutedCount} capitals (${summary.pollutedPct}%)`, 'unhealthy for sensitive groups or worse')}
    </section>
  );
}

export function AtlasLegend() {
  return (
    <ul className="pa-legend" aria-label="Air quality colour scale">
      {AIR_BANDS.map((band) => <li key={band.id}><i style={{ background: band.color }} />{band.label}<small>{band.range}</small></li>)}
    </ul>
  );
}

export function AtlasDetail({ selected, point }: { selected: Place | null; point: PointState }) {
  if (!selected) {
    return (
      <div className="pa-empty">
        <h2>Pick a place</h2>
        <p>Click a coloured country marker, or anywhere on the globe. You get the pollutants, how far PM2.5 is above the WHO guideline, and how much of the surrounding area is polluted.</p>
      </div>
    );
  }
  if (point.status === 'idle' || point.status === 'loading') return <div className="pa-empty" role="status"><h2>{selected.name}</h2><p>Reading the atmospheric model…</p></div>;
  if (point.status === 'error') return <div className="pa-empty" role="alert"><h2>{selected.name}</h2><p>{point.message}</p></div>;

  const { data } = point;
  const band = bandFor(data.category.id);
  const { area } = data;
  const nearest = data.place.nearest;
  return (
    <div className="pa-detail-body" aria-live="polite">
      <div className="pa-detail-head">
        <h2>{selected.name}</h2>
        {nearest && nearest.distanceKm > 30 && <small>Nearest capital in the atlas: {nearest.capital}, {nearest.name} ({fmt(nearest.distanceKm)} km away)</small>}
        <small>{data.place.lat.toFixed(1)}°, {data.place.lng.toFixed(1)}° · model time {when(data.reading.time)}</small>
      </div>
      <div className="pa-aqi" style={{ background: band.color, color: band.ink }}>
        <b>{aqiText(data.reading.usAqi)}</b><span>US AQI</span><strong>{band.label}</strong>
      </div>
      <p className="pa-advice">{band.advice}</p>
      {data.reading.usAqi !== null && data.reading.usAqi > AQI_SCALE_MAX && <p className="pa-note">The model value ({fmt(data.reading.usAqi)}) is above the top of the US AQI scale ({AQI_SCALE_MAX}), so it is shown as {AQI_SCALE_MAX}+.</p>}
      {data.pm25VsWho !== null && <p className="pa-who">PM2.5 is <b>{data.pm25VsWho}×</b> the WHO 24-hour guideline of {data.whoPm25Guideline} µg/m³.</p>}

      <h3>Pollutants right now</h3>
      <dl className="pa-pollutants">
        {POLLUTANTS.map((pollutant) => <div key={pollutant.key} title={pollutant.hint}><dt>{pollutant.label}</dt><dd>{fmt(data.reading[pollutant.key], 1)} <small>{pollutant.unit}</small></dd></div>)}
      </dl>

      <h3>How much area is polluted</h3>
      {area.pollutedSharePct === null ? <p className="pa-note">The model returned no values around this point.</p> : (
        <>
          <p className="pa-area-line">
            <b>{area.pollutedSharePct}%</b> of the sampled area is above AQI 100
            <span> · {area.pollutedCells} of {area.cellsWithData} model cells, about {fmt(area.pollutedAreaKm2)} km² of {fmt(area.sampledAreaKm2)} km²</span>
          </p>
          <div className="pa-grid" role="img" aria-label={`${area.pollutedCells} of ${area.cellsWithData} model cells around the point are above AQI 100`}>
            {area.cells.map((cell) => (
              <span key={`${cell.row}:${cell.col}`} className={cell.row === 0 && cell.col === 0 ? 'pa-cell pa-cell-centre' : 'pa-cell'} style={{ background: bandFor(cell.category).color }} title={cell.usAqi === null ? 'No model value' : `US AQI ${cell.usAqi}`} />
            ))}
          </div>
          <small className="pa-note">Window about {fmt(area.windowKm.width)} × {fmt(area.windowKm.height)} km, north up; each cell about {fmt(area.cellKm.width)} × {fmt(area.cellKm.height)} km. The ringed cell is the point you picked.</small>
        </>
      )}
      <p className="pa-note">{data.resolutionNote}</p>
      <p className="pa-note">Source: {data.source}. Fetched {when(data.fetchedAt)}{data.status === 'stale' ? ' (stale copy: the source could not be refreshed)' : ''}.</p>
    </div>
  );
}

export function AtlasRanking({ countries, onSelect, selectedIso }: { countries: AirCountry[]; onSelect: (country: AirCountry) => void; selectedIso: string | null }) {
  const [mode, setMode] = useState<RankMode>('worst');
  const [region, setRegion] = useState<Region>('All');
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => rankCountries(countries, { mode, region, query }), [countries, mode, region, query]);
  const visible = showAll || query.trim() ? rows : rows.slice(0, TOP_ROWS);
  return (
    <section className="pa-rank" aria-label="Country ranking">
      <div className="pa-rank-head">
        <h2>Country ranking</h2>
        <div className="pa-rank-controls">
          <div role="group" aria-label="Sort order">
            <button type="button" className="pa-pill" aria-pressed={mode === 'worst'} onClick={() => setMode('worst')}>Most polluted</button>
            <button type="button" className="pa-pill" aria-pressed={mode === 'best'} onClick={() => setMode('best')}>Cleanest</button>
          </div>
          <label>Region <select value={region} onChange={(event) => setRegion(event.target.value as Region)}>{REGIONS.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
          <label>Find <input type="search" value={query} placeholder="Country or capital" onChange={(event) => setQuery(event.target.value)} /></label>
        </div>
      </div>
      <div className="pa-table-wrap">
        <table className="pa-table">
          <thead><tr><th>#</th><th>Country</th><th>Capital</th><th>AQI</th><th>PM2.5 µg/m³</th><th>Level</th></tr></thead>
          <tbody>
            {visible.map((country, index) => (
              <tr key={country.iso2} className={country.iso2 === selectedIso ? 'pa-row-selected' : undefined}>
                <td>{index + 1}</td>
                <td><button type="button" className="pa-link" onClick={() => onSelect(country)}>{country.name}</button></td>
                <td>{country.capital}</td>
                <td><AqiChip country={country} /></td>
                <td>{fmt(country.reading.pm25, 1)}</td>
                <td>{country.category.label}</td>
              </tr>
            ))}
            {!visible.length && <tr><td colSpan={6} className="pa-note">No country matches this filter.</td></tr>}
          </tbody>
        </table>
      </div>
      {!query.trim() && rows.length > TOP_ROWS && <button type="button" className="pa-pill" onClick={() => setShowAll((value) => !value)}>{showAll ? `Show top ${TOP_ROWS}` : `Show all ${rows.length}`}</button>}
    </section>
  );
}

