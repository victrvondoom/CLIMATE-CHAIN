// Air module: The Vayu Project's features — the 24-hour exposure dial,
// every reading's provenance, and the north-India air map — surfaced in
// the unified shell, cross-linked to the Fire module.

import { Card, ModeBadge, Sparkline, Stat } from '../components/Ui';
import { CITIES, type CityKey } from '../api';
import type { Overview } from '../types';

export function Air({ data, onCity, city }: { data: Overview; onCity: (c: CityKey) => void; city: CityKey }) {
  const { air } = data;
  return (
    <div className="stack">
      <div className="module-head">
        <div>
          <h1>Air <span className="by">· The Vayu Project</span></h1>
          <ModeBadge mode={data.sources.vayu.mode} />
          <p>A 24-hour dial of the air a person actually breathed — at home, at work or school, and outdoors.
             Every number says whether it is Live (a named monitor, how far, how old), an Estimate, or Measured
             by your own unit. Nothing is advised from a reading older than six hours.</p>
        </div>
        <div className="city-picker">
          {(Object.keys(CITIES) as CityKey[]).map((c) => (
            <button key={c} className={`city ${city === c ? 'active' : ''}`} onClick={() => onCity(c)}>
              {CITIES[c].name}
            </button>
          ))}
        </div>
      </div>

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
        <Card accent="air"><Stat label="24 h maximum" value={air.pm25Max24h ?? '—'} unit={air.pm25Max24h != null ? 'µg/m³' : ''} color="air" /></Card>
        <Card accent="air"><Stat label="Severity band" value={air.severity.label} hint="WHO 24 h guideline is 15 µg/m³; India's severe band starts at 115" color="air" /></Card>
        <Card accent="air"><Stat label="Reading mode" value={air.mode === 'live' ? 'Live' : air.mode === 'mock' ? 'Simulated' : air.mode} hint={air.place ? `Nearest monitors around ${air.place.lat.toFixed(2)}°N ${air.place.lng.toFixed(2)}°E` : ''} color="air" /></Card>
      </div>

      <div className="grid-2">
        <Card>
          <h2>Today's dial</h2>
          <Sparkline hours={air.hours.slice(-24)} />
          <div className="muted small">
            Observed hours from real monitors near {air.place?.name ?? CITIES[city].name}, as of{' '}
            {air.asOf ? new Date(air.asOf).toLocaleString() : '—'}. Dashed line: 115 µg/m³, the severe-band threshold.
          </div>
        </Card>

        <Card>
          <h2>Where this module meets the others</h2>
          <ul className="cross">
            <li><strong>Fire → Air.</strong> {num(data.fire.redFields)} clearsky fields are still at burn risk tonight. Each one that burns is tomorrow's spike on this dial, and the satellite gap is 1:30 pm to 10:30 am — the smoke is measured after the fact, so the chain books the baler first.</li>
            <li><strong>Waste → Air.</strong> Open JunkSnap dumps that get burned instead of cleared are a winter smoke source the same dial catches.</li>
            <li><strong>Hardware → Air.</strong> Vayu's ESP32 + SPS30 unit measures the room and replaces the outside reading at your address with Measured hours.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

function num(n: number) {
  return new Intl.NumberFormat('en-IN').format(n);
}
