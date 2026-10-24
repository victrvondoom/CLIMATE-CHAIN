import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { CesiumGlobe, type GlobeMarker, type GlobeRoute } from '../../components/CesiumGlobe';
import { useLiveQuery } from '../../hooks/useLiveQuery';
import { useSignals } from '../../core/signals';
import { appendLedger, createEvidence } from '../../core/evidence';
import { alignedDifference, destination, downloadEvidence, fetchPlace, metric, searchPlaces, type ModelSource, type Place, type PlaceResult, type PlaceSnapshot } from './environment';
import { FacilityDiscovery, type Facility } from './FacilityDiscovery';
import { SupplyChainPanel } from './SupplyChainPanel';
import { calculateLegFootprint, calculateSiteFootprint, type IncomingSupplySite, type SupplyNetwork } from './supply';
import './earth.css';

const INITIAL: Place = { name: 'Delhi, India', lat: 28.6139, lng: 77.2090 };
const INITIAL_NETWORK: SupplyNetwork = { sites: [], legs: [] };
const PRESETS: Place[] = [INITIAL, { name: 'Jodhpur, India', lat: 26.2389, lng: 73.0243 }, { name: 'Rotterdam, Netherlands', lat: 51.9225, lng: 4.4792 }, { name: 'Singapore', lat: 1.3521, lng: 103.8198 }];
const format = (value: number | null, digits = 1) => value === null ? 'UNKNOWN' : value.toLocaleString(undefined, { maximumFractionDigits: digits });
const moment = (value?: string | number | null) => value ? new Date(value).toLocaleString() : 'Unknown';
const notes = (value: string | string[]) => Array.isArray(value) ? value.join(' ') : value;
function quality(aqi: number | null) {
  if (aqi === null) return { label: 'AQI unavailable', tone: 'unknown' };
  if (aqi <= 50) return { label: 'Good', tone: 'good' };
  if (aqi <= 100) return { label: 'Moderate', tone: 'moderate' };
  if (aqi <= 150) return { label: 'Unhealthy for sensitive groups', tone: 'poor' };
  if (aqi <= 200) return { label: 'Unhealthy', tone: 'poor' };
  return { label: aqi <= 300 ? 'Very unhealthy' : 'Hazardous', tone: 'severe' };
}

function ModelFacts({ title, source }: { title: string; source: ModelSource | PlaceSnapshot['carbon'] }) {
  return <details className="earth-provenance"><summary>{title} · {source.status === 'available' ? 'model data received' : 'unavailable'}</summary>
    <dl><div><dt>Provider</dt><dd>{source.provenance.provider} · {source.provenance.product}</dd></div><div><dt>Valid time</dt><dd>{moment(source.provenance.modelTime)}</dd></div><div><dt>Retrieved</dt><dd>{moment(source.provenance.fetchedAt)}</dd></div><div><dt>Returned grid</dt><dd>{source.provenance.grid ? `${source.provenance.grid.lat.toFixed(3)}°, ${source.provenance.grid.lng.toFixed(3)}°` : 'Unknown'}</dd></div></dl>
    <p>{notes(source.provenance.notes)}</p><p>{source.provenance.attribution}</p><a href={source.provenance.sourceUrl} target="_blank" rel="noreferrer noopener">Inspect original data query ↗</a>
    {source.error && <p role="alert">{source.error.code}: {source.error.message}</p>}
  </details>;
}

// initialPlace carries the shared air location in. It is read on mount only, so the place the
// user moves to here is never overwritten by a later navigation.
export function EarthWorkspace({ initialPlace }: { initialPlace?: Place } = {}) {
  const signals = useSignals();
  const start = initialPlace ?? INITIAL;
  const [place, setPlace] = useState<Place>(start);
  const [search, setSearch] = useState('');
  const [searchState, setSearchState] = useState<{ loading: boolean; results: PlaceResult[]; error: string; searched: boolean }>({ loading: false, results: [], error: '', searched: false });
  const searchRequest = useRef<AbortController | null>(null);
  const [latText, setLatText] = useState(String(start.lat));
  const [lngText, setLngText] = useState(String(start.lng));
  const [coordinateError, setCoordinateError] = useState('');
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [incomingSite, setIncomingSite] = useState<IncomingSupplySite | null>(null);
  const [network, setNetwork] = useState<SupplyNetwork>(INITIAL_NETWORK);
  const [layers, setLayers] = useState({ facilities: true, production: true, routes: true, waste: false, corridor: true });
  const [rangeKm, setRangeKm] = useState(20);
  const [corridor, setCorridor] = useState<{ key: string; loading: boolean; up: PlaceSnapshot | null; down: PlaceSnapshot | null; error: string; points: Place[]; weatherTime: string | null }>({ key: '', loading: false, up: null, down: null, error: '', points: [], weatherTime: null });
  const corridorRequest = useRef<AbortController | null>(null);
  const [forecastField, setForecastField] = useState('pm2_5');
  const [selectedHour, setSelectedHour] = useState('');
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState('');
  const load = useCallback((signal: AbortSignal) => fetchPlace(place, signal), [place]);
  const query = useLiveQuery(load, { key: `${place.lat}:${place.lng}`, intervalMs: 300_000 });
  const data = query.data;
  const aqi = quality(metric(data?.air, 'us_aqi'));
  const temperature = metric(data?.weather, 'temperature_2m');
  const pm25 = metric(data?.air, 'pm2_5');
  const wind = metric(data?.weather, 'wind_speed_10m');
  const direction = metric(data?.weather, 'wind_direction_10m');
  const corridorKey = `${place.lat}:${place.lng}:${rangeKm}`;
  const activeCorridor = corridor.key === corridorKey ? corridor : null;

  useEffect(() => () => { searchRequest.current?.abort(); corridorRequest.current?.abort(); }, []);
  useEffect(() => { corridorRequest.current?.abort(); }, [place, rangeKm]);

  const selectPlace = useCallback((next: Place) => {
    if (![next.lat, next.lng].every(Number.isFinite) || Math.abs(next.lat) > 90 || Math.abs(next.lng) > 180) return;
    setPlace(next); setLatText(next.lat.toFixed(5)); setLngText(next.lng.toFixed(5));
    setCoordinateError(''); setSearchState({ loading: false, results: [], error: '', searched: false });
    setSelectedHour(''); setNotice(''); setFacilities([]);
    searchRequest.current?.abort();
  }, []);
  async function findPlace(event: FormEvent) {
    event.preventDefault(); searchRequest.current?.abort();
    const controller = new AbortController(); searchRequest.current = controller;
    setSearchState({ loading: true, results: [], error: '', searched: true });
    try {
      const result = await searchPlaces(search.trim(), controller.signal);
      if (!controller.signal.aborted) setSearchState({ loading: false, results: result.results, error: '', searched: true });
    } catch (cause) { if (!controller.signal.aborted) setSearchState({ loading: false, results: [], error: cause instanceof Error ? cause.message : 'Place search failed.', searched: true }); }
  }
  function locate(event: FormEvent) {
    event.preventDefault();
    const lat = Number(latText); const lng = Number(lngText);
    if (!latText.trim() || !lngText.trim() || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) { setCoordinateError('Enter latitude −90 to 90 and longitude −180 to 180.'); return; }
    selectPlace({ lat, lng, name: `${lat.toFixed(4)}°, ${lng.toFixed(4)}°` });
  }
  async function sampleCorridor() {
    if (!data || direction === null || wind === null || wind < 1) return;
    corridorRequest.current?.abort(); const controller = new AbortController(); corridorRequest.current = controller;
    const up = { ...destination(place, direction, rangeKm), name: 'Upwind sample' };
    const down = { ...destination(place, (direction + 180) % 360, rangeKm), name: 'Downwind sample' };
    const weatherTime = typeof data.weather.current?.time === 'string' ? data.weather.current.time : null;
    setCorridor({ key: corridorKey, loading: true, up: null, down: null, error: '', points: [up, down], weatherTime });
    try {
      const [a, b] = await Promise.all([fetchPlace(up, controller.signal), fetchPlace(down, controller.signal)]);
      if (!controller.signal.aborted) setCorridor({ key: corridorKey, loading: false, up: a, down: b, error: '', points: [up, down], weatherTime });
    } catch (cause) { if (!controller.signal.aborted) setCorridor({ key: corridorKey, loading: false, up: null, down: null, error: cause instanceof Error ? cause.message : 'The model comparison could not be completed.', points: [up, down], weatherTime }); }
  }
  const comparison = activeCorridor?.up && activeCorridor.down ? alignedDifference(activeCorridor.up, activeCorridor.down, 'pm2_5') : null;
  const sameGrid = Boolean(activeCorridor?.up?.air.provenance.grid && activeCorridor.down?.air.provenance.grid && JSON.stringify(activeCorridor.up.air.provenance.grid) === JSON.stringify(activeCorridor.down.air.provenance.grid));
  const markers = useMemo<GlobeMarker[]>(() => [
    ...(layers.facilities ? facilities.map((facility) => ({ ...facility, kind: 'facility' as const, valueLabel: 'OSM mapped' })) : []),
    ...(layers.production ? network.sites.map((site) => ({ ...site, kind: 'production' as const, valueLabel: `${format(calculateSiteFootprint(site).totalKgCo2e)} kg CO₂e · estimate` })) : []),
    ...(layers.waste ? (signals.data?.waste.sites ?? []).flatMap((site) => site.lat == null || site.lng == null ? [] : [{ id: `waste:${site.id}`, name: `JunkSnap ${site.id}`, lat: site.lat, lng: site.lng, kind: 'waste' as const, valueLabel: signals.data?.sources.junksnap.mode === 'live' ? 'Source report' : 'SIMULATED' }]) : []),
    ...(layers.corridor && activeCorridor ? activeCorridor.points.map((point, index) => ({ ...point, id: `corridor:${index}`, kind: 'sample' as const, valueLabel: activeCorridor.loading ? 'Requesting model' : `${format(metric(index === 0 ? activeCorridor.up?.air : activeCorridor.down?.air, 'pm2_5'))} µg/m³ PM2.5` })) : []),
  ], [layers, facilities, network.sites, signals.data, activeCorridor]);
  const routes = useMemo<GlobeRoute[]>(() => [
    ...(layers.routes ? network.legs.flatMap((leg) => {
      const from = network.sites.find((site) => site.id === leg.fromSiteId); const to = network.sites.find((site) => site.id === leg.toSiteId);
      return from && to ? [{ id: leg.id, from, to, label: 'Entered freight leg · geodesic approximation', uncertain: calculateLegFootprint(leg, network.sites).totalKgCo2e === null }] : [];
    }) : []),
    ...(layers.corridor && activeCorridor?.points.length === 2 ? [{ id: 'wind-corridor', from: activeCorridor.points[0], to: activeCorridor.points[1], label: 'Wind-oriented model sampling transect', uncertain: true }] : []),
  ], [layers.routes, layers.corridor, network, activeCorridor]);
  const hourly = data?.air.hourly;
  const hours = hourly?.time ?? [];
  const hourIndex = Math.max(0, hours.indexOf(selectedHour));
  const valueAtHour = hourly?.[forecastField]?.[hourIndex];
  const series = (hourly?.[forecastField] ?? []).map((value) => typeof value === 'number' ? value : null);
  const maxSeries = Math.max(1, ...series.filter((value): value is number => value !== null));
  const unit = data?.air.units.hourly[forecastField] ?? '';

  function evidence() { return { schema: 'climate-chain.earth-inspection/1', capturedAt: new Date().toISOString(), place, snapshot: data, windComparison: activeCorridor, productionNetwork: network, mappedFacilities: facilities, boundaries: ['Weather and air are model grid values.', 'Atmospheric concentration is not facility emissions.', 'Supply estimates use entered activity and factors; completeness is not verified.', 'Wind sampling is spatial model context, not a dispersion or source attribution model.'] }; }
  async function record() {
    if (!data || query.error) return;
    setRecording(true); setNotice('');
    try { const entry = await createEvidence({ moduleId: 'earth', kind: 'place-climate-inspection', mode: 'RESEARCH', summary: `${place.name}: modelled weather, air and entered production context`, payload: evidence() }); setNotice(appendLedger(entry) ? `Inspection saved to the evidence ledger · ${entry.sha256.slice(0, 12)}` : 'Inspection computed; browser storage could not save it. Export JSON to keep it.'); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Could not save the inspection.'); }
    finally { setRecording(false); }
  }
  const addFacility = (facility: Facility) => { setIncomingSite({ ...facility, requestKey: crypto.randomUUID() }); document.getElementById('earth-production')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  return <div className="earth-workspace">
    <header className="earth-heading"><div><span className="earth-eyebrow">CLIMATE CHAIN / EARTH INTELLIGENCE</span><h2>Read the planet.<br /><em>Inspect the evidence.</em></h2><p>Satellite context, place-based climate checks, and the carbon trail of your production network.</p></div><div className="earth-heading-note"><span>CESIUMJS · WGS84</span><strong>One place. Multiple evidence layers.</strong><small>Model forecasts · mapped facilities · declared production</small></div></header>
    <div className="earth-searchbar"><form onSubmit={(event) => void findPlace(event)} className="earth-place-search"><label htmlFor="earth-search">Find a place</label><div><input id="earth-search" value={search} minLength={2} maxLength={100} required onChange={(event) => { setSearch(event.target.value); searchRequest.current?.abort(); setSearchState({ loading: false, results: [], error: '', searched: false }); }} placeholder="City, port, manufacturing region…" /><button type="submit" disabled={searchState.loading}>{searchState.loading ? 'Searching…' : 'Search Earth'}</button></div></form><form className="earth-coordinates" onSubmit={locate}><label>Latitude<input type="number" value={latText} min={-90} max={90} step="any" required onChange={(event) => setLatText(event.target.value)} /></label><label>Longitude<input type="number" value={lngText} min={-180} max={180} step="any" required onChange={(event) => setLngText(event.target.value)} /></label><button type="submit">Go to coordinates</button></form></div>
    {(searchState.error || coordinateError) && <p className="earth-alert" role="alert">{searchState.error || coordinateError}</p>}
    {searchState.results.length > 0 && <ul className="earth-search-results">{searchState.results.map((result) => <li key={result.id}><button type="button" onClick={() => selectPlace({ ...result, name: [result.name, result.admin1, result.country].filter(Boolean).join(', ') })}><strong>{result.name}</strong><span>{[result.admin1, result.country].filter(Boolean).join(' · ')} · {result.lat.toFixed(3)}°, {result.lng.toFixed(3)}°</span></button></li>)}</ul>}
    {searchState.searched && !searchState.loading && !searchState.error && searchState.results.length === 0 && <p role="status">No matching places. Try coordinates or a nearby city.</p>}
    <div className="earth-presets">{PRESETS.map((preset) => <button type="button" key={preset.name} onClick={() => selectPlace(preset)}>{preset.name}</button>)}<a href="#earth-production">Production &amp; routes ↓</a></div>
    <div className="earth-map-layout"><div className="earth-map-main"><CesiumGlobe place={place} markers={markers} routes={routes} radiusKm={rangeKm} onSelectPlace={selectPlace} /><div className="earth-layer-controls" aria-label="Evidence layers">{(Object.keys(layers) as (keyof typeof layers)[]).map((key) => <label key={key}><input type="checkbox" checked={layers[key]} onChange={(event) => setLayers({ ...layers, [key]: event.target.checked })} />{({ facilities: 'Mapped industry', production: 'Entered production', routes: 'Supply routes', waste: 'JunkSnap reports', corridor: 'Wind samples' })[key]}</label>)}<p>Mapped features, entered production, and model samples retain their labels. Dashed lines mark incomplete routes or sampling guides. Route lines approximate great-circle distance.</p></div></div>
      <aside className="earth-inspector" aria-label="Selected place climate"><span className="earth-eyebrow">PLACE INSPECTION</span><h3>{place.name}</h3><p className="earth-location">{place.lat.toFixed(5)}° N/S · {place.lng.toFixed(5)}° E/W</p><div className="earth-inspector-status" role="status">{query.refreshing ? 'Checking model sources…' : query.error ? 'Source refresh failed' : `Fetched ${moment(query.updatedAt)} · refresh 5 min`}</div><button type="button" disabled={query.refreshing} onClick={() => void query.refresh()}>{query.refreshing ? 'Checking…' : query.error ? 'Retry place check' : 'Refresh place check'}</button>
      {query.error && <p className="earth-alert" role="alert">{query.error}{data ? ' Last received values retained.' : ''}</p>}
      {query.loading && <p role="status">Loading weather, air quality and atmospheric composition…</p>}
      <div className={`earth-aqi earth-aqi-${aqi.tone}`}><small>US AQI · model estimate</small><strong>{format(metric(data?.air, 'us_aqi'), 0)}</strong><span>{aqi.label}</span></div><div className="earth-mini-grid"><div><small>Temperature</small><strong>{format(temperature)} <em>°C</em></strong></div><div><small>PM2.5</small><strong>{format(pm25)} <em>µg/m³</em></strong></div><div><small>Wind at 10 m</small><strong>{format(wind)} <em>km/h</em></strong></div><div><small>Wind from</small><strong>{format(direction, 0)} <em>°</em></strong></div><div><small>Humidity</small><strong>{format(metric(data?.weather, 'relative_humidity_2m'), 0)} <em>%</em></strong></div><div><small>Precipitation</small><strong>{format(metric(data?.weather, 'precipitation'))} <em>mm</em></strong></div></div>
      <p className="earth-scope">Weather and air values are modeled for a grid cell. A successful retrieval does not turn them into on-site measurements.</p>{data && <div className="earth-source-stack"><ModelFacts title="Weather" source={data.weather} /><ModelFacts title="Air quality" source={data.air} /></div>}</aside></div>
    <div className="earth-section-grid"><section className="earth-panel"><div className="earth-panel-title"><span className="earth-eyebrow">ATMOSPHERIC CONTEXT</span><h3>Carbon in the air</h3></div><div className="earth-carbon-values"><div><small>CO₂ · model concentration</small><strong>{format(metric(data?.carbon, 'carbon_dioxide'))}<em> {data?.carbon.units.carbon_dioxide || 'ppm'}</em></strong></div><div><small>Methane · model concentration</small><strong>{format(metric(data?.carbon, 'methane'))}<em> {data?.carbon.units.methane || 'µg/m³'}</em></strong></div></div><p>These concentrations describe the atmosphere at a model grid cell. Production emissions require activity data and emission factors; enter those in your supply network below.</p>{data && <ModelFacts title="Greenhouse-gas model" source={data.carbon} />}</section>
    <section className="earth-panel"><div className="earth-panel-title"><span className="earth-eyebrow">24-HOUR MODEL WINDOW</span><h3>Explore the air-quality forecast</h3></div><div className="earth-forecast-controls"><label>Pollutant<select value={forecastField} onChange={(event) => setForecastField(event.target.value)}><option value="pm2_5">PM2.5</option><option value="pm10">PM10</option><option value="nitrogen_dioxide">NO₂</option><option value="ozone">Ozone</option><option value="carbon_monoxide">Carbon monoxide</option></select></label><span>{format(typeof valueAtHour === 'number' ? valueAtHour : null)} {unit}</span></div>{hours.length > 0 ? <><div className="earth-forecast-bars" role="group" aria-label="Hourly model forecast">{hours.map((time, index) => <button key={time} type="button" className={index === hourIndex ? 'active' : ''} aria-label={`${moment(time)}: ${format(series[index])} ${unit}`} aria-pressed={index === hourIndex} onClick={() => setSelectedHour(time)} title={`${moment(time)} · ${format(series[index])} ${unit}`}><i style={{ height: `${series[index] === null ? 0 : Math.max(3, (series[index]! / maxSeries) * 100)}%` }} /></button>)}</div><label className="earth-hour-select">Forecast valid time<select value={hours[hourIndex]} onChange={(event) => setSelectedHour(event.target.value)}>{hours.map((time) => <option key={time} value={time}>{moment(time)}</option>)}</select></label></> : <p>No hourly model series available. Check source status or retry.</p>}<p className="earth-scope">CAMS atmospheric composition via Open-Meteo. Times show the local display timezone; original evidence uses UTC.</p></section></div>
    <section className="earth-panel earth-corridor"><div className="earth-panel-title"><span className="earth-eyebrow">WIND-ORIENTED EVIDENCE LENS</span><h3>Compare upwind and downwind model cells</h3><p>Sample two places along the current modeled wind direction. Compare only matching pollutant units, model products, and valid times.</p></div><div className="earth-corridor-actions"><label>Distance each side<select value={rangeKm} onChange={(event) => setRangeKm(Number(event.target.value))}>{[10, 20, 40, 80].map((value) => <option key={value} value={value}>{value} km</option>)}</select></label><button type="button" disabled={!data || direction === null || wind === null || wind < 1 || query.refreshing || activeCorridor?.loading} onClick={() => void sampleCorridor()}>{activeCorridor?.loading ? 'Sampling model cells…' : 'Check wind corridor'}</button></div>{wind !== null && wind < 1 && <p>Wind is below 1 km/h; no directional comparison is offered.</p>}{activeCorridor?.error && <p role="alert" className="earth-alert">{activeCorridor.error}</p>}{activeCorridor?.up && activeCorridor.down && <><div className="earth-corridor-values"><div><small>Upwind PM2.5</small><strong>{format(metric(activeCorridor.up.air, 'pm2_5'))} <em>µg/m³</em></strong></div><div><small>Downwind PM2.5</small><strong>{format(metric(activeCorridor.down.air, 'pm2_5'))} <em>µg/m³</em></strong></div><div><small>Aligned difference</small><strong>{format(comparison?.value ?? null)} <em>µg/m³</em></strong></div></div><p>{comparison?.reason}</p><p>Wind valid at {moment(activeCorridor.weatherTime)}. Air valid at {moment(activeCorridor.up.air.current?.time)} / {moment(activeCorridor.down.air.current?.time)}.</p>{sameGrid && <p className="earth-alert">Both points resolve to the same returned model grid location. This comparison has no independent spatial resolution at that separation.</p>}</>}<p className="earth-scope">This is a contextual sampling transect. It does not simulate a plume, attribute pollution to a facility, or measure avoided emissions.</p></section>
    <FacilityDiscovery place={place} onResults={setFacilities} onInspect={selectPlace} onAddToNetwork={addFacility} />
    <div id="earth-production"><SupplyChainPanel selectedPlace={place} incomingSite={incomingSite} onNetworkChange={setNetwork} onSelectSite={selectPlace} /></div>
    <section className="earth-panel earth-export"><div><span className="earth-eyebrow">PORTABLE EVIDENCE</span><h3>Keep the place, model times, inputs, and limits together.</h3><p>Capture the selected place, source responses, wind comparison and entered production network as one reviewable inspection.</p></div><div><button type="button" disabled={!data || !!query.error} onClick={() => downloadEvidence('climate-chain-earth-inspection', evidence())}>Export inspection JSON</button><button type="button" disabled={!data || !!query.error || recording} onClick={() => void record()}>{recording ? 'Saving…' : 'Record in evidence ledger'}</button></div>{notice && <p role="status">{notice}</p>}</section>
    <footer className="earth-footer"><a href="https://cesium.com/platform/cesiumjs/" target="_blank" rel="noreferrer noopener">CesiumJS</a><a href="https://open-meteo.com/en/docs" target="_blank" rel="noreferrer noopener">Open-Meteo weather</a><a href="https://open-meteo.com/en/docs/air-quality-api" target="_blank" rel="noreferrer noopener">CAMS air &amp; greenhouse gases</a><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer noopener">OpenStreetMap contributors</a><span>Regional model data · local production inputs · explicit evidence limits</span></footer>
  </div>;
}
