import { useEffect, useRef, useState } from 'react';
import './facilities.css';

export interface Facility {
  id: string;
  name: string;
  lat: number;
  lng: number;
  kind: 'industrial_works' | 'power_plant';
  operator: string | null;
  product: string | null;
  sourceUrl: string;
}

export interface FacilityDiscoveryResponse {
  status: 'available' | 'unavailable';
  facilities: Facility[];
  asOf: string;
  provenance: { provider: string; sourceUrl: string; dataKind: 'mapped'; notes: string[] };
  error: { code: string; message: string } | null;
}

interface Props {
  place: { lat: number; lng: number; name: string };
  onInspect?: (facility: Facility) => void;
  onAddToNetwork?: (facility: Facility) => void;
  onResults?: (facilities: Facility[]) => void;
}

function validFacility(value: unknown): value is Facility {
  if (!value || typeof value !== 'object') return false;
  const item = value as Facility;
  return typeof item.id === 'string' && typeof item.name === 'string'
    && Number.isFinite(item.lat) && Math.abs(item.lat) <= 90 && Number.isFinite(item.lng) && Math.abs(item.lng) <= 180
    && ['industrial_works', 'power_plant'].includes(item.kind)
    && typeof item.sourceUrl === 'string' && /^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/\d+$/.test(item.sourceUrl)
    && (item.operator === null || typeof item.operator === 'string') && (item.product === null || typeof item.product === 'string');
}

export function FacilityDiscovery({ place, onInspect, onAddToNetwork, onResults }: Props) {
  const [radiusKm, setRadiusKm] = useState(15);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [state, setState] = useState<{ key: string; loading: boolean; result: FacilityDiscoveryResponse | null; error: string | null }>({ key: '', loading: false, result: null, error: null });
  const request = useRef<{ controller: AbortController; id: number } | null>(null);
  const sequence = useRef(0);
  const resultsCallback = useRef(onResults);
  const key = `${place.lat},${place.lng},${radiusKm}`;
  const current = state.key === key ? state : null;
  const result = current?.result;
  const loading = current?.loading ?? false;
  const validPlace = Number.isFinite(place.lat) && Math.abs(place.lat) <= 90 && Number.isFinite(place.lng) && Math.abs(place.lng) <= 180;

  useEffect(() => { resultsCallback.current = onResults; }, [onResults]);
  useEffect(() => {
    request.current?.controller.abort();
    sequence.current++;
    resultsCallback.current?.([]);
    setState({ key, loading: false, result: null, error: null });
    return () => { request.current?.controller.abort(); };
  }, [key]);

  async function discover() {
    if (!validPlace) return;
    request.current?.controller.abort();
    const controller = new AbortController();
    const id = ++sequence.current;
    request.current = { controller, id };
    setState({ key, loading: true, result: null, error: null });
    resultsCallback.current?.([]);
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 20_000);
    try {
      const params = new URLSearchParams({ lat: String(place.lat), lng: String(place.lng), radiusKm: String(radiusKm) });
      const response = await fetch(`/api/v1/place/facilities?${params}`, { headers: { accept: 'application/json' }, signal: controller.signal });
      const body: unknown = await response.json();
      if (id !== sequence.current || controller.signal.aborted) return;
      if (!body || typeof body !== 'object') throw new Error('The facility service returned an invalid response.');
      const payload = body as FacilityDiscoveryResponse;
      if (payload.status === 'unavailable') throw new Error(payload.error?.message ?? 'Nearby facility discovery is unavailable. Try again later.');
      if (!response.ok) throw new Error(`The facility service returned HTTP ${response.status}. Try again.`);
      if (payload.status !== 'available' || !Array.isArray(payload.facilities) || payload.facilities.length > 40
        || !payload.facilities.every(validFacility) || payload.provenance?.dataKind !== 'mapped'
        || typeof payload.provenance?.provider !== 'string' || !Array.isArray(payload.provenance?.notes)
        || !payload.provenance.notes.every((note) => typeof note === 'string') || typeof payload.asOf !== 'string' || !Number.isFinite(Date.parse(payload.asOf))) {
        throw new Error('The facility service returned incomplete mapping evidence. Try again.');
      }
      setState({ key, loading: false, result: payload, error: null });
      resultsCallback.current?.(payload.facilities);
    } catch (cause) {
      if (id !== sequence.current) return;
      if (controller.signal.aborted && !timedOut) return;
      setState({ key, loading: false, result: null, error: timedOut ? 'Nearby discovery timed out. Try again later.' : cause instanceof Error ? cause.message : 'Nearby discovery failed. Try again.' });
      resultsCallback.current?.([]);
    } finally {
      window.clearTimeout(timer);
      if (request.current?.id === id) request.current = null;
    }
  }

  const visible = (result?.facilities ?? []).filter((facility) => (filter === 'all' || facility.kind === filter)
    && [facility.name, facility.operator, facility.product].join(' ').toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <section className="facility-discovery" aria-labelledby="facility-discovery-title">
      <header className="facility-heading"><div><span className="eyebrow">MAPPED INDUSTRIAL CONTEXT</span><h2 id="facility-discovery-title">Facilities near {place.name}</h2></div><span className="facility-evidence">Mapping evidence</span></header>
      <p className="muted">Discover industrial works and power plants mapped by OpenStreetMap contributors. Discovery runs when you request it for this place.</p>
      <div className="facility-controls"><label>Search radius<select value={radiusKm} onChange={(event) => setRadiusKm(Number(event.target.value))}>{[5, 10, 15, 25].map((radius) => <option key={radius} value={radius}>{radius} km</option>)}</select></label><button type="button" className="primary-action" disabled={loading || !validPlace} onClick={() => void discover()}>{loading ? 'Discovering mapped facilities…' : current?.error ? 'Retry nearby discovery' : result ? 'Refresh nearby facilities' : 'Discover nearby facilities'}</button></div>
      {!validPlace && <p role="alert">Select a place with valid latitude and longitude to discover nearby facilities.</p>}
      {loading && <p role="status">Querying OpenStreetMap via Overpass. No facility data is substituted if the provider is unavailable.</p>}
      {current?.error && <div className="facility-error" role="alert"><strong>Discovery unavailable</strong><p>{current.error}</p><span>Production and emissions remain unknown. A failed search does not establish that no facilities exist.</span></div>}
      {!result && !loading && !current?.error && <p className="facility-empty">No discovery requested for this place and radius yet.</p>}
      {result && <>
        <p className="facility-resultline" role="status">{result.facilities.length} mapped feature{result.facilities.length === 1 ? '' : 's'} returned · fetched {new Date(result.asOf).toLocaleString()} · up to 40 features, not a complete inventory.</p>
        {result.facilities.length > 0 ? <>
          <div className="facility-controls"><label>Find facility<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, operator or mapped product" /></label><label>Facility type<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All mapped facilities</option><option value="industrial_works">Industrial works</option><option value="power_plant">Power plants</option></select></label></div>
          <ul className="facility-list">{visible.map((facility) => <li key={facility.id} className="facility-item"><div><span className="facility-kind">{facility.kind === 'power_plant' ? 'Mapped power plant' : 'Mapped industrial works'}</span><h3>{facility.name}</h3><dl><div><dt>Mapped operator</dt><dd>{facility.operator ?? 'Unknown'}</dd></div><div><dt>Mapped product</dt><dd>{facility.product ?? 'Unknown'}</dd></div><div><dt>Production / emissions</dt><dd>Unknown</dd></div></dl><p className="muted small">Mapped point: {facility.lat.toFixed(5)}°, {facility.lng.toFixed(5)}°. Area features use approximate bounding-box centers.</p></div><div className="facility-actions">{onInspect && <button type="button" className="text-action" onClick={() => onInspect(facility)}>Inspect this place</button>}{onAddToNetwork && <button type="button" className="text-action" onClick={() => onAddToNetwork(facility)}>Add to network draft</button>}<a href={facility.sourceUrl} target="_blank" rel="noreferrer noopener">Open mapped source ↗</a></div></li>)}</ul>
          {visible.length === 0 && <div className="facility-empty"><p>No mapped facilities match these filters.</p><button type="button" className="text-action" onClick={() => { setQuery(''); setFilter('all'); }}>Reset facility filters</button></div>}
        </> : <p className="facility-empty">No matching mapped features were returned. OSM coverage may be incomplete; this does not establish that the area has no industrial facilities.</p>}
        <details className="facility-provenance"><summary>Evidence source and limits</summary><p>{result.provenance.provider} · mapped features, not measured production.</p><ul>{result.provenance.notes.map((note, index) => <li key={index}>{note}</li>)}</ul><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer noopener">© OpenStreetMap contributors · Open Database License</a></details>
      </>}
    </section>
  );
}
