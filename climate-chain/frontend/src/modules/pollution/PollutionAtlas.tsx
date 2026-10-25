import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchAirCountries, fetchAirPoint, type AirCountry } from '../../api';
import { CesiumGlobe, type GlobeMarker } from '../../components/CesiumGlobe';
import { useLiveQuery } from '../../hooks/useLiveQuery';
import type { Place } from '../earth/environment';
import { AtlasDetail, AtlasLegend, AtlasRanking, AtlasStats, aqiText, when, type PointState } from './AtlasParts';
import { bandFor, summariseCountries } from './aqi';
import './pollution.css';

export function PollutionAtlas() {
  const countriesQuery = useLiveQuery(fetchAirCountries, { intervalMs: 30 * 60_000, allowOffline: true });
  const countries = useMemo(() => countriesQuery.data?.countries ?? [], [countriesQuery.data]);
  const [selected, setSelected] = useState<Place | null>(null);
  const [selectedIso, setSelectedIso] = useState<string | null>(null);
  const [point, setPoint] = useState<PointState>({ status: 'idle' });

  const byIso = useMemo(() => new Map(countries.map((country) => [country.iso2, country])), [countries]);
  const summary = useMemo(() => summariseCountries(countries), [countries]);
  const markers = useMemo<GlobeMarker[]>(() => countries.filter((c) => c.reading.usAqi !== null).map((c) => ({
    id: `air:${c.iso2}`, name: c.capital, lat: c.lat, lng: c.lng, kind: 'air' as const,
    color: bandFor(c.category.id).color, size: 11, valueLabel: `AQI ${aqiText(c.reading.usAqi)}`,
  })), [countries]);

  const selectCountry = useCallback((country: AirCountry) => {
    setSelectedIso(country.iso2);
    setSelected({ lat: country.lat, lng: country.lng, name: `${country.capital}, ${country.name}` });
  }, []);
  const pick = useCallback((place: Place) => {
    const id = (place as Partial<GlobeMarker>).id;
    const country = id?.startsWith('air:') ? byIso.get(id.slice(4)) : undefined;
    if (country) { selectCountry(country); return; }
    setSelectedIso(null);
    setSelected({ lat: place.lat, lng: place.lng, name: place.name });
  }, [byIso, selectCountry]);

  const lat = selected?.lat;
  const lng = selected?.lng;
  useEffect(() => {
    if (lat === undefined || lng === undefined) { setPoint({ status: 'idle' }); return; }
    const controller = new AbortController();
    setPoint({ status: 'loading' });
    fetchAirPoint(lat, lng, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setPoint({ status: 'ready', data }); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setPoint({ status: 'error', message: cause instanceof Error ? cause.message : 'Could not read air quality for this point.' }); });
    return () => controller.abort();
  }, [lat, lng]);

  const envelope = countriesQuery.data;
  return (
    <div className="pa">
      <header className="pa-head">
        <div>
          <h1>Global Pollution Atlas</h1>
          <p>Live air quality for 195 countries. Click a country marker or any spot on the globe to see the pollutants, how far above WHO guidance the air is, and how much of the surrounding area is polluted.</p>
        </div>
        <div className="pa-source" role="status">
          <span className="pa-badge">MODELLED</span>
          <small>
            {envelope ? <>CAMS atmospheric model via Open-Meteo · {envelope.status === 'stale' ? 'stale copy · ' : ''}fetched {when(envelope.fetchedAt)}</> : countriesQuery.error ? 'Source unavailable' : 'Loading the model…'}
          </small>
          <button type="button" className="pa-pill" onClick={() => void countriesQuery.refresh()} disabled={countriesQuery.refreshing}>{countriesQuery.refreshing ? 'Refreshing…' : 'Refresh'}</button>
        </div>
      </header>

      {countriesQuery.error && !envelope && <p className="pa-banner" role="alert">{countriesQuery.error} The globe and ranking need the gateway's air-quality route.</p>}
      {envelope && envelope.failed > 0 && <p className="pa-banner" role="status">{envelope.failed} of {envelope.count} capitals had no reading in the latest model fetch and are left out of the ranking rather than shown as clean.</p>}

      <AtlasStats summary={summary} total={envelope?.count ?? 195} />

      <div className="pa-main">
        <div className="pa-globe">
          <CesiumGlobe compact hideSolar place={selected} markers={markers} focusHeightM={5_500_000} onSelectPlace={pick} />
          <AtlasLegend />
        </div>
        <aside className="pa-detail" aria-label="Selected place air quality"><AtlasDetail selected={selected} point={point} /></aside>
      </div>

      <AtlasRanking countries={countries} onSelect={selectCountry} selectedIso={selectedIso} />

      <footer className="pa-foot">
        <p><b>How to read this.</b> Each country is sampled at its capital, so a value describes that city region, not the whole country. Values come from the Copernicus CAMS global atmospheric model (about 40 km grid outside Europe), not from ground sensors, so a street-level monitor can differ. The polluted-area figure is the share of a 5 × 5 grid of model cells around the picked point that is above US AQI 100.</p>
        <p>Labelled MODELLED, in line with Climate Chain's rule that modelled values are never presented as observations.</p>
      </footer>
    </div>
  );
}
