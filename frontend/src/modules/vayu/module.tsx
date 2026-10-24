import { useState } from 'react';
import { useSignals } from '../../core/signals';
import { Card, Stat } from '../../components/Ui';
import { appendLedger, createEvidence } from '../../core/evidence';
import type { ClimateModule } from '../../core/module';
import type { AirNow } from '../../types';
import { aqi24h, BAND_LABEL, bandFromConcentration, type Aqi24h } from './domain/bands';
import {
  haversineKm,
  newestReading,
  nearestFreshMonitor,
  readingState,
  window24h,
  type Monitor,
  type MonitorHour,
  type Point,
  type ReadingState,
} from './domain/monitors';
import monitorsFixture from './fixtures/monitors-dec14.json';
import roomFixture from './fixtures/room-reading.json';
import './module.css';

interface Place extends Point {
  readonly id: string;
  readonly name: string;
}

interface MonitorsFixture {
  readonly note: string;
  readonly places: Place[];
  readonly monitors: Monitor[];
}

interface RoomReading {
  readonly id: string;
  readonly ts: string;
  readonly pm25: number | null;
  readonly pm10: number | null;
  readonly tempC?: number;
  readonly rhPct?: number;
  readonly flags: string[];
  readonly simulated: boolean;
}

const DATA = monitorsFixture as MonitorsFixture;
const ROOM = roomFixture as RoomReading;

// Each check is a moment in the recorded window. The fixture's last hour ends at 00:00 UTC on 15 Dec.
const CHECKS = [
  { id: 'two', label: '02:00 UTC, 15 Dec (2 h after the last hour)', asOf: '2025-12-15T02:00:00.000Z' },
  { id: 'four', label: '04:00 UTC, 15 Dec (4 h after)', asOf: '2025-12-15T04:00:00.000Z' },
  { id: 'seven', label: '07:00 UTC, 15 Dec (7 h after)', asOf: '2025-12-15T07:00:00.000Z' },
] as const;

const STATE_TEXT: Readonly<Record<ReadingState, string>> = {
  current: 'Current: advice allowed',
  old_no_advice: 'Over 3 h old: shown, no advice',
  dropped: 'Dropped: over 6 h old, or from the future',
};

const STATE_SHORT: Readonly<Record<ReadingState, string>> = {
  current: 'Current',
  old_no_advice: 'Shown, no advice',
  dropped: 'Dropped',
};

const km = (value: number): string => `${value.toFixed(2)} km`;
const hhmm = (iso: string): string => `${iso.slice(11, 16)} UTC`;

function DialGauge({ result }: { result: Aqi24h }) {
  const width = Math.min(100, (result.aqi / 500) * 100);
  return (
    <div className="m-vayu-dial" role="img" aria-label={`24-hour AQI ${Math.round(result.aqi)}, ${BAND_LABEL[result.band]}`}>
      <div className={`m-vayu-dial-fill m-vayu-band-${result.band}`} style={{ width: `${width}%` }} />
    </div>
  );
}

function ModeTag({ mode }: { mode: string }) {
  return <span className={`m-vayu-mode m-vayu-mode-${mode.toLowerCase()}`}>{mode}</span>;
}

type LiveState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; air: AirNow };

function VayuPage() {
  const [placeId, setPlaceId] = useState(DATA.places[0].id);
  const [checkId, setCheckId] = useState<string>(CHECKS[0].id);
  const signals = useSignals();
  const live: LiveState = signals.data ? { status: 'ready', air: signals.data.air } : signals.error ? { status: 'error' } : { status: 'loading' };
  const [recorded, setRecorded] = useState('');

  const place = DATA.places.find((candidate) => candidate.id === placeId) ?? DATA.places[0];
  const check = CHECKS.find((candidate) => candidate.id === checkId) ?? CHECKS[0];
  const asOf = check.asOf;

  const fresh = nearestFreshMonitor(place, DATA.monitors, asOf);
  const hours24 = fresh ? window24h(fresh.monitor.hours, asOf) : null;
  const dial = hours24 ? aqi24h(hours24.pm25, hours24.pm10) : null;
  const validPm25 = hours24 ? hours24.pm25.filter((value) => value !== null).length : 0;
  const roomBand = ROOM.pm25 === null ? null : bandFromConcentration('pm25', ROOM.pm25);

  async function recordCheck() {
    const payload = {
      placeId: place.id,
      asOf,
      monitorId: fresh?.monitor.id ?? null,
      observedAt: fresh?.observedAt ?? null,
      ageMinutes: fresh?.ageMinutes ?? null,
      state: fresh?.state ?? null,
      distanceKm: fresh ? Math.round(fresh.distanceKm * 100) / 100 : null,
      aqi24h: dial ? { aqi: Math.round(dial.aqi * 10) / 10, band: dial.band, driver: dial.driver } : null,
    };
    const summary = `${place.name}: ${fresh ? fresh.monitor.name : 'no recent monitor'} at ${asOf}`;
    try {
      const record = await createEvidence({ moduleId: 'vayu', kind: 'nearest-monitor-check', mode: 'RESEARCH', summary, payload });
      const kept = appendLedger(record);
      setRecorded(
        kept
          ? `Recorded. sha256 ${record.sha256.slice(0, 16)}..., kept in this browser's ledger.`
          : `Hashed (sha256 ${record.sha256.slice(0, 16)}...), but browser storage is blocked, so it is not kept.`,
      );
    } catch {
      setRecorded('This browser could not hash the check.');
    }
  }

  const liveAir = live.status === 'ready' ? live.air : null;
  const liveAge = liveAir?.provenance?.ageMinutes ?? null;
  const liveState = liveAge === null ? null : readingState(liveAge);
  const liveProv = liveAir?.provenance ?? null;
  const liveReading =
    liveProv !== null && liveAge !== null && liveState !== null && liveState !== 'dropped'
      ? { prov: liveProv, age: liveAge, state: liveState }
      : null;
  const liveHours: MonitorHour[] = (liveAir?.hours ?? [])
    .filter((hour) => hour.kind === 'observed')
    .map((hour) => ({ hourStart: hour.t, pm25: hour.pm25, pm10: null }));
  const liveDial = liveAir ? aqi24h(window24h(liveHours, liveAir.asOf).pm25, []) : null;

  return (
    <div className="m-vayu-root">
      <header className="m-vayu-head">
        <div className="m-vayu-kicker">The Vayu Project · Air</div>
        <h2 className="m-vayu-title">Nearest monitor, reading age and a 24-hour dial</h2>
        <p className="m-vayu-lede">
          Monitor readings for four Delhi places, from a recorded week (14 Dec 2025). Readings older than six hours are
          dropped, and readings older than three hours get no advice. Mode: <ModeTag mode="RESEARCH" />
        </p>
      </header>

      <div className="m-vayu-controls">
        <label className="m-vayu-field">
          Place
          <select value={place.id} onChange={(event) => setPlaceId(event.target.value)}>
            {DATA.places.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <label className="m-vayu-field">
          Check at
          <select value={check.id} onChange={(event) => setCheckId(event.target.value)}>
            {CHECKS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="m-vayu-grid">
        <Card className="m-vayu-card">
          <h3>Nearest monitor</h3>
          {fresh ? (
            <>
              <div className="m-vayu-stats">
                <Stat label="Monitor" value={fresh.monitor.name} />
                <Stat label="Distance" value={km(fresh.distanceKm)} />
                <Stat label="Reading age" value={`${fresh.ageMinutes} min`} hint={`Observed to ${hhmm(fresh.observedAt)}`} />
              </div>
              <p className={`m-vayu-state m-vayu-state-${fresh.state}`}>{STATE_TEXT[fresh.state]}</p>
            </>
          ) : (
            <p className="m-vayu-empty">
              No monitor has a PM2.5 reading within six hours at this time. The page shows no number and no advice.
            </p>
          )}
          <table className="m-vayu-table">
            <thead>
              <tr>
                <th>Monitor</th>
                <th>Distance</th>
                <th>Newest reading</th>
              </tr>
            </thead>
            <tbody>
              {DATA.monitors.map((monitor) => {
                const reading = newestReading(monitor, asOf);
                return (
                  <tr key={monitor.id}>
                    <td>{monitor.name}</td>
                    <td>{km(haversineKm(place, monitor))}</td>
                    <td className={reading ? `m-vayu-state-${reading.state}` : 'm-vayu-state-dropped'}>
                      {reading ? `${reading.ageMinutes} min, ${STATE_SHORT[reading.state]}` : 'No PM2.5'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <Card className="m-vayu-card">
          <h3>24-hour exposure dial</h3>
          {!fresh ? (
            <p className="m-vayu-empty">No monitor, so there is no 24-hour dial.</p>
          ) : dial ? (
            <>
              <div className="m-vayu-dial-value">
                <span>{Math.round(dial.aqi)}</span>
                <span className={`m-vayu-band-label m-vayu-band-${dial.band}`}>{BAND_LABEL[dial.band]}</span>
              </div>
              <DialGauge result={dial} />
              <p className="m-vayu-note">
                Driver: {dial.driver === 'pm25' ? 'PM2.5' : 'PM10'}. Valid hours: {dial.validHours.pm25} PM2.5,{' '}
                {dial.validHours.pm10} PM10. Only hours that ended in the last 24 hours count.
              </p>
            </>
          ) : (
            <p className="m-vayu-empty">
              Not enough data. CPCB needs 16 valid hours, and this window has {validPm25} valid PM2.5 hours.
            </p>
          )}
        </Card>

        <Card className="m-vayu-card">
          <h3>
            Room sensor, ESP32-S3 <ModeTag mode="SIMULATED" />
          </h3>
          <div className="m-vayu-stats">
            <Stat label="PM2.5" value={ROOM.pm25 === null ? 'none' : ROOM.pm25} unit="µg/m³" hint={roomBand ? `${BAND_LABEL[roomBand]} (CPCB band)` : undefined} />
            <Stat label="PM10" value={ROOM.pm10 === null ? 'none' : ROOM.pm10} unit="µg/m³" />
            <Stat label="Temperature" value={ROOM.tempC ?? 'none'} unit={ROOM.tempC === undefined ? undefined : '°C'} />
            <Stat label="Humidity" value={ROOM.rhPct ?? 'none'} unit={ROOM.rhPct === undefined ? undefined : '%'} />
          </div>
          <p className="m-vayu-note">
            Reading {ROOM.id} at {ROOM.ts}. Flags: {ROOM.flags.length ? ROOM.flags.join(', ') : 'none'}. This is a sample from the
            project's fixtures, not a reading from a device.
          </p>
        </Card>

        <Card className="m-vayu-card">
          <h3>
            Live air from the gateway{' '}
            {liveAir ? <ModeTag mode={liveAir.mode === 'live' ? 'LIVE' : 'SIMULATED'} /> : null}
          </h3>
          {live.status === 'loading' ? <p className="m-vayu-empty">Reading the gateway...</p> : null}
          {live.status === 'error' ? (
            <p className="m-vayu-empty">The gateway did not answer, so no live number is shown.</p>
          ) : null}
          {liveAir ? (
            liveReading === null ? (
              <p className="m-vayu-empty">
                The gateway has no monitor reading within six hours, so no live number is shown as current.
              </p>
            ) : (
              <>
                <div className="m-vayu-stats">
                  <Stat label="Monitor" value={liveReading.prov.stationName ?? 'regional model'} />
                  <Stat label="Distance" value={liveReading.prov.distanceKm === null ? 'none' : km(liveReading.prov.distanceKm)} />
                  <Stat label="Reading age" value={`${liveReading.age} min`} />
                  <Stat label="PM2.5 now" value={liveAir.pm25Now ?? 'none'} unit="µg/m³" />
                </div>
                <p className={`m-vayu-state m-vayu-state-${liveReading.state}`}>{STATE_TEXT[liveReading.state]}</p>
                {liveDial ? (
                  <p className="m-vayu-note">
                    24-hour AQI from observed hours: {Math.round(liveDial.aqi)} ({BAND_LABEL[liveDial.band]}).
                  </p>
                ) : (
                  <p className="m-vayu-note">Not enough observed hours for a 24-hour AQI (16 needed).</p>
                )}
              </>
            )
          ) : null}
        </Card>
      </div>

      <div className="m-vayu-record">
        <button type="button" className="m-vayu-btn" onClick={() => void recordCheck()}>
          Record this check
        </button>
        {recorded ? <span className="m-vayu-status">{recorded}</span> : null}
      </div>

      <footer className="m-vayu-foot">
        <p>
          Source: the Vayu replay of 14 Dec 2025 (four monitors, measured hours), the ESP32-S3 sample reading and the
          gateway's live answer. The recorded hours are a fixture, so they are not live.
        </p>
        <p>
          <strong>Not ported:</strong> the cleaner, the language assistant (English, Hindi and voice), GRAP stage and walk-window
          advice, the room verdict, the Telegram alerts, and the live station fetch. Staleness is ported as a state; no advice is
          shown from it.
        </p>
      </footer>
    </div>
  );
}

const climateModule: ClimateModule = {
  id: 'vayu',
  name: 'The Vayu Project',
  tagline: 'Nearest monitor with its distance and reading age, a 24-hour CPCB dial, and an honest staleness rule.',
  stages: ['sense', 'verify', 'act', 'prove'],
  tone: 'air',
  mode: 'RESEARCH',
  features: [
    'Monitor name, distance and reading age',
    '24-hour exposure dial (CPCB AQI, 16 valid hours)',
    'ESP32-S3 room sensor readings view',
    'Live gateway air reading, labelled LIVE or SIMULATED',
    'Evidence record for each check',
  ],
  source: {
    folder: 'the-vayu-project-main',
    files: [
      'packages/core/src/bands.ts',
      'packages/core/src/bands.test.ts',
      'packages/core/src/provenance.ts',
      'packages/core/src/timeline.ts',
      'packages/contracts/rules/cpcb.json',
      'packages/contracts/rules/trust.json',
      'packages/data/src/station.ts',
      'packages/data/src/freshStation.ts',
      'packages/contracts/src/demoPlaces.ts',
      'packages/data/replay-data/replay/W1/home.json',
      'packages/data/replay-data/replay/W1/school.json',
      'packages/data/replay-data/replay/W1/office.json',
      'packages/data/replay-data/replay/W1/park.json',
      'packages/contracts/fixtures/sample-reading.json',
      'apps/api/src/stationsRoute.ts',
      'docs/safety.md',
    ],
  },
  Page: VayuPage,
};

export default climateModule;
