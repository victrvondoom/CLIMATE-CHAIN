// Air module: AirPulse's features — the 24-hour exposure dial,
// every reading's provenance, and the north-India air map — surfaced in
// the unified shell, cross-linked to the Fire module.

import { useState } from 'react';
import { Card, ModeBadge, Sparkline, Stat } from '../components/Ui';
import { CITIES, type CityKey } from '../api';
import type { Overview } from '../types';
import { downloadSnapshot, SignalSnapshot } from './SignalSnapshot';

export function Air({ data, onCity, city }: { data: Overview; onCity: (c: CityKey) => void; city: CityKey }) {
  const { air } = data;
  const [windowSize, setWindowSize] = useState(24);
  const [kind, setKind] = useState('all');
  const [selectedTime, setSelectedTime] = useState('');
  const kinds = [...new Set(air.hours.map((hour) => hour.kind))];
  const hours = air.hours.filter((hour) => Number.isFinite(hour.pm25) && (kind === 'all' || kind === hour.kind))
    .sort((a, b) => Date.parse(a.t) - Date.parse(b.t)).slice(-windowSize);
  const selected = hours.find((hour) => hour.t === selectedTime) ?? hours.at(-1);
  const average = hours.length ? hours.reduce((sum, hour) => sum + hour.pm25, 0) / hours.length : null;
  const ageMinutes = air.provenance?.ageMinutes;
  return (
    <div className="stack signal-page">
      <div className="module-head">
        <div>
          <h1>Air <span className="by">· AirPulse</span></h1>
          <ModeBadge mode={data.sources.vayu.mode} />
          <p>Explore the AirPulse series for the selected city. Source observations, forecasts and simulated values keep their own labels. A regional monitor reading does not establish personal exposure.</p>
        </div>
        <div className="city-picker">
          {(Object.keys(CITIES) as CityKey[]).map((c) => (
            <button key={c} className={`city ${city === c ? 'active' : ''}`} onClick={() => onCity(c)}>
              {CITIES[c].name}
            </button>
          ))}
        </div>
      </div>

      <SignalSnapshot data={data} source="vayu" />

      <div className="kpis">
        <Card accent="air">
          <Stat
            label={`PM2.5 now · ${air.place?.name ?? CITIES[city].name}`}
            value={air.pm25Now ?? '—'}
            unit={air.pm25Now != null ? 'µg/m³' : ''}
            hint={air.severity.label}
            color="air"
          />
        </Card>
        <Card accent="air"><Stat label="Source series maximum" value={air.pm25Max24h ?? '—'} unit={air.pm25Max24h != null ? 'µg/m³' : ''} color="air" /></Card>
        <Card accent="air"><Stat label="Source reading age" value={ageMinutes == null ? 'Unknown' : `${Math.round(ageMinutes)} min`} hint={air.provenance?.stationName ?? 'Monitor not identified'} color="air" /></Card>
        <Card accent="air"><Stat label="Reading mode" value={air.mode === 'live' ? 'Live' : air.mode === 'mock' ? 'Simulated' : air.mode} hint={air.place ? `Nearest monitors around ${air.place.lat.toFixed(2)}°N ${air.place.lng.toFixed(2)}°E` : ''} color="air" /></Card>
      </div>

      <div className="grid-2">
        <Card>
          <h2>Explore the source series</h2>
          <div className="library-controls"><label>Window <select value={windowSize} onChange={(event) => setWindowSize(Number(event.target.value))}>{[6, 12, 24, 48].map((value) => <option key={value} value={value}>Last {value} readings</option>)}</select></label><label>Reading type <select value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">All types</option>{kinds.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><button className="text-action" onClick={() => downloadSnapshot('air-series', { asOf: data.asOf, source: data.sources.vayu, provenance: air.provenance, place: air.place, hours })}>Export visible series</button></div>
          <Sparkline hours={hours} max={Math.max(250, ...hours.map((hour) => hour.pm25))} />
          <div className="muted small">
            {hours.length} {data.sources.vayu.mode === 'mock' ? 'simulated' : 'source-reported'} readings near {air.place?.name ?? CITIES[city].name}, as of{' '}
            {air.asOf ? new Date(air.asOf).toLocaleString() : '—'}. Dashed line: Climate Chain reference at 115 µg/m³.
          </div>
          {hours.length > 0 ? <div className="stack tight"><p>Selected-series mean: <strong>{average?.toFixed(1)} µg/m³</strong>. {hours.filter((hour) => hour.kind === 'observed').length} readings labeled observed.</p><label>Inspect a reading <select value={selected?.t ?? ''} onChange={(event) => setSelectedTime(event.target.value)}>{hours.map((hour, index) => <option key={`${hour.t}-${index}`} value={hour.t}>{new Date(hour.t).toLocaleString()} · {hour.kind}</option>)}</select></label>{selected && <p role="status"><strong>{selected.pm25} µg/m³</strong> · {selected.kind} · {new Date(selected.t).toLocaleString()}{data.sources.vayu.mode === 'mock' ? ' · simulated source' : ''}</p>}</div> : <p role="status">No readings match this selection.</p>}
        </Card>

        <Card>
          <h2>Where this module meets the others</h2>
          <ul className="cross">
            <li><strong>Fire context.</strong> AshAlert reports {num(data.fire.redFields)} RED fields in its own scope. Their locations and times are not joined to this air series.</li>
            <li><strong>Waste context.</strong> DumpWatch reports {num(data.waste.open)} open sites. Open a site in Waste to check a nearby monitor and its timestamps in Cascade Review.</li>
            <li><strong>Monitor provenance.</strong> {air.provenance?.stationName ?? 'No monitor name returned'} · {air.provenance?.distanceKm == null ? 'distance unavailable' : `${air.provenance.distanceKm.toFixed(1)} km from the query point`} · {air.provenance?.observedAt ? `observed ${new Date(air.provenance.observedAt).toLocaleString()}` : 'observation time unavailable'}.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

function num(n: number) {
  return new Intl.NumberFormat('en-IN').format(n);
}
