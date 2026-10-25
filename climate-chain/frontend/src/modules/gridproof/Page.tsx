import { useReducer, useState } from 'react';
import { appendLedger, createEvidence, readLedger, type EvidenceRecord } from '../../core/evidence';
import series from './fixtures/demo-hourly-series.json';
import { maxPlausibleWh, expectedWh, type Kind, type Weather } from './domain/physics';
import { scoreSeries, THRESHOLD, type Scored } from './domain/integrity';
import { ANOMALY_THRESHOLD_BPS, CertificateBook, allocateHour, tokenIdFor, type Reading } from './domain/ledger';

// Unix hour of the first reading, and the hour the series ends at (readings must be finished hours).
const START_HOUR = Date.parse(series.start) / 3_600_000;
const NOW_HOUR = START_HOUR + series.hours;
const WEATHER = series.weather as Weather[];

type Decision = 'issue' | 'quarantine' | 'no output';

interface Row {
  unix: number;
  expected: number;
  plausible: number;
  reported: number;
  scored: Scored;
  bps: number;
  decision: Decision;
}

interface DeviceRun {
  key: string;
  name: string;
  kind: Kind;
  capacityW: number;
  deviceId: number;
  rows: Row[];
}

// The same rule the contract applies: a reading at or above the threshold is quarantined, not issued.
function decide(reported: number, bps: number): Decision {
  if (reported === 0) return 'no output';
  return bps >= ANOMALY_THRESHOLD_BPS ? 'quarantine' : 'issue';
}

const DEVICE_RUNS: DeviceRun[] = series.devices.map((d, k) => {
  const kind = d.kind as Kind;
  const expected = expectedWh(kind, d.capacity_w, WEATHER).map((x) => Math.round(x));
  const plausible = maxPlausibleWh(kind, d.capacity_w, WEATHER).map((x) => Math.round(x));
  const reported = series.reported_wh[d.key as keyof typeof series.reported_wh];
  const hours = reported.map((wh, i) => ({ expectedWh: expected[i], maxPlausibleWh: plausible[i], reportedWh: wh }));
  const scored = scoreSeries(kind, d.capacity_w, hours);
  return {
    key: d.key,
    name: d.name,
    kind,
    capacityW: d.capacity_w,
    deviceId: k + 1,
    rows: reported.map((wh, i) => {
      const bps = Math.round(scored[i].physics * 10_000);
      return {
        unix: START_HOUR + i,
        expected: expected[i],
        plausible: plausible[i],
        reported: wh,
        scored: scored[i],
        bps,
        decision: decide(wh, bps),
      };
    }),
  };
});

const DEVICE_BY_ID = new Map(DEVICE_RUNS.map((d) => [d.deviceId, d]));
const FLAGGED_TOTAL = DEVICE_RUNS.reduce((n, d) => n + d.rows.filter((r) => r.decision === 'quarantine').length, 0);
const hhmm = (unix: number) => new Date(unix * 3_600_000).toISOString().slice(11, 16);

function ModeLabel() {
  return (
    <span className="m-gridproof-mode" title="Synthetic DEMO series: not measured meter data">
      DEMO
    </span>
  );
}

function decisionLabel(d: Decision): string {
  if (d === 'issue') return 'issue';
  if (d === 'quarantine') return 'quarantine';
  return 'outage, not submitted';
}

export default function GridProofPage() {
  const [book] = useState(() => new CertificateBook());
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [deviceKey, setDeviceKey] = useState(DEVICE_RUNS[0].key);
  const [buyerKey, setBuyerKey] = useState(series.buyers[0].key);
  const [message, setMessage] = useState<string | null>(null);
  const device = DEVICE_RUNS.find((d) => d.key === deviceKey) ?? DEVICE_RUNS[0];
  const records: EvidenceRecord[] = readLedger().filter((r) => r.moduleId === 'gridproof').slice(0, 5);
  const minted = DEVICE_RUNS.reduce((n, d) => n + d.rows.filter((r) => r.reported > 0).length, 0);

  async function record(kind: string, summary: string, payload: Record<string, unknown>) {
    const rec = await createEvidence({ moduleId: 'gridproof', kind, mode: 'DEMO', summary, payload });
    appendLedger(rec);
    bump();
  }

  function submit() {
    const readings: Reading[] = DEVICE_RUNS.flatMap((d) =>
      d.rows
        .filter((r) => r.reported > 0)
        .map((r) => ({ deviceId: d.deviceId, hour: r.unix, wh: r.reported, anomalyBps: r.bps })),
    );
    const result = book.submitBatch(
      readings,
      (id) => ({ capacityW: DEVICE_BY_ID.get(id)?.capacityW ?? 0 }),
      NOW_HOUR,
    );
    setMessage(
      `${result.issued} certificates issued, ${result.quarantined} quarantined, ${result.skipped} already on the book and skipped.`,
    );
    void record('mint-batch', `Submitted ${readings.length} device-hours: ${result.issued} issued, ${result.quarantined} quarantined`, {
      ...result,
      device_hours: readings.length,
    });
    bump();
  }

  function retireToMatch() {
    for (const b of series.buyers) {
      for (let i = 0; i < series.hours; i++) {
        book.reportLoad(b.key, START_HOUR + i, series.load_wh[b.key as keyof typeof series.load_wh][i]);
      }
    }
    let allocated = 0;
    for (let i = 0; i < series.hours; i++) {
      const unix = START_HOUR + i;
      const supply = DEVICE_RUNS.flatMap((d) => {
        const id = tokenIdFor(d.deviceId, unix);
        const wh = book.balance(id);
        return wh > 0 ? [{ tokenId: id, wh }] : [];
      });
      const demand: Record<string, number> = {};
      for (const b of series.buyers) {
        if (book.matched(b.key, unix).matched > 0) continue; // already matched this hour
        demand[b.key] = series.load_wh[b.key as keyof typeof series.load_wh][i];
      }
      for (const share of allocateHour(supply, demand)) {
        book.retire(share.tokenId, share.wh, share.buyer);
        allocated += share.wh;
      }
    }
    setMessage(`${allocated.toLocaleString('en-US')} Wh retired, each against the hour it was issued for.`);
    void record('retire-by-hour', `Retired ${allocated} Wh against same-hour load`, { allocated_wh: allocated });
    bump();
  }

  const buyer = series.buyers.find((b) => b.key === buyerKey) ?? series.buyers[0];
  const buyerRows = Array.from({ length: series.hours }, (_, i) => {
    const unix = START_HOUR + i;
    const { load, matched } = book.matched(buyer.key, unix);
    return { unix, load, matched: Math.min(matched, load), bps: book.hourlyMatchBps(buyer.key, unix) };
  });
  const period = book.periodMatch(buyer.key, START_HOUR, NOW_HOUR);

  return (
    <main className="m-gridproof">
      <header className="m-gridproof-head">
        <p className="m-gridproof-kicker">Renewable energy · Certificates</p>
        <h2>WattCert: a certificate per device-hour, only for output the weather allows</h2>
        <p className="m-gridproof-lede">
          Each meter reading is checked against the weather and the device's rating before a certificate is minted. A device-hour gets
          one certificate, and a certificate covers only the hour it was produced in. The series is synthetic DEMO data.
        </p>
      </header>

      <section className="m-gridproof-card" aria-labelledby="m-gridproof-readings">
        <div className="m-gridproof-card-head">
          <h3 id="m-gridproof-readings">Readings and the plausibility check</h3>
          <ModeLabel />
        </div>
        <p className="m-gridproof-note">
          Expected output comes from the weather at the next hour. The plausible maximum allows for local weather error. A reading above
          it, a solar reading at night, or a replayed peak raises the score. At 70 percent the reading is quarantined. {FLAGGED_TOTAL} of{' '}
          {minted} submitted device-hours are quarantined. Not ported: the IsolationForest part of the score.
        </p>
        <div className="m-gridproof-controls">
          <label>
            Device
            <select value={deviceKey} onChange={(e) => setDeviceKey(e.target.value)}>
              {DEVICE_RUNS.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.name} ({d.kind}, {(d.capacityW / 1000).toFixed(0)} kW)
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="m-gridproof-table-wrap">
          <table className="m-gridproof-table">
            <thead>
              <tr>
                <th>Hour (UTC)</th>
                <th>Expected Wh</th>
                <th>Plausible max Wh</th>
                <th>Reported Wh</th>
                <th>Score</th>
                <th>Decision</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {device.rows.map((r) => (
                <tr key={r.unix} className={r.decision === 'quarantine' ? 'm-gridproof-row-flag' : undefined}>
                  <td>{hhmm(r.unix)}</td>
                  <td>{r.expected.toLocaleString('en-US')}</td>
                  <td>{r.plausible.toLocaleString('en-US')}</td>
                  <td>{r.reported.toLocaleString('en-US')}</td>
                  <td>{(r.scored.physics * 100).toFixed(0)}%</td>
                  <td>{decisionLabel(r.decision)}</td>
                  <td className="m-gridproof-why">{r.scored.reasons.join('; ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="m-gridproof-note">Threshold {(THRESHOLD * 100).toFixed(0)}% ({ANOMALY_THRESHOLD_BPS.toLocaleString('en-US')} basis points).</p>
      </section>

      <section className="m-gridproof-card" aria-labelledby="m-gridproof-mint">
        <div className="m-gridproof-card-head">
          <h3 id="m-gridproof-mint">Mint once per device-hour</h3>
          <ModeLabel />
        </div>
        <p className="m-gridproof-note">
          Certificates are minted to a local ledger in this page, with the contract's token id: the device and the hour. Sending the same
          device-hours again skips every one already minted.
        </p>
        <div className="m-gridproof-actions">
          <button type="button" className="m-gridproof-btn m-gridproof-btn-primary" onClick={submit}>
            Submit readings
          </button>
          <button type="button" className="m-gridproof-btn" onClick={submit}>
            Send the same readings again
          </button>
        </div>
        <p className="m-gridproof-stats">
          <span>
            Issued: <strong>{countStatus(book, 'issued')}</strong>
          </span>
          <span>
            Quarantined: <strong>{countStatus(book, 'quarantined')}</strong>
          </span>
        </p>
        {message ? <p className="m-gridproof-message" role="status">{message}</p> : null}
      </section>

      <section className="m-gridproof-card" aria-labelledby="m-gridproof-match">
        <div className="m-gridproof-card-head">
          <h3 id="m-gridproof-match">Retire to match load, by hour</h3>
          <ModeLabel />
        </div>
        <p className="m-gridproof-note">
          Each certificate is retired against the load of the hour it was issued for. An hour's load can only be matched by that hour's
          certificates, so evening load cannot be covered with midday solar.
        </p>
        <div className="m-gridproof-controls">
          <label>
            Buyer
            <select value={buyerKey} onChange={(e) => setBuyerKey(e.target.value)}>
              {series.buyers.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="m-gridproof-actions">
          <button type="button" className="m-gridproof-btn m-gridproof-btn-primary" onClick={retireToMatch}>
            Retire issued certificates to match load
          </button>
        </div>
        <p className="m-gridproof-stats">
          <span>
            Period match: <strong>{period.totalLoadWh > 0 ? ((period.matchedCappedWh / period.totalLoadWh) * 100).toFixed(1) : '0.0'}%</strong>
          </span>
          <span>
            Load: <strong>{period.totalLoadWh.toLocaleString('en-US')} Wh</strong>
          </span>
        </p>
        <div className="m-gridproof-table-wrap">
          <table className="m-gridproof-table">
            <thead>
              <tr>
                <th>Hour (UTC)</th>
                <th>Load Wh</th>
                <th>Matched Wh</th>
                <th>Hourly match</th>
              </tr>
            </thead>
            <tbody>
              {buyerRows.map((r) => (
                <tr key={r.unix}>
                  <td>{hhmm(r.unix)}</td>
                  <td>{r.load.toLocaleString('en-US')}</td>
                  <td>{r.matched.toLocaleString('en-US')}</td>
                  <td>{(r.bps / 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="m-gridproof-card" aria-labelledby="m-gridproof-records">
        <div className="m-gridproof-card-head">
          <h3 id="m-gridproof-records">Recorded steps</h3>
          <ModeLabel />
        </div>
        {records.length === 0 ? (
          <p className="m-gridproof-note">No steps recorded yet. Submit readings or retire certificates above.</p>
        ) : (
          <ul className="m-gridproof-records">
            {records.map((r) => (
              <li key={r.id}>
                <span>{r.summary}</span>
                <span className="m-gridproof-hash" title={r.sha256}>
                  {r.sha256.slice(0, 12)}…
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="m-gridproof-card m-gridproof-not-ported" aria-labelledby="m-gridproof-gaps">
        <h3 id="m-gridproof-gaps">Not ported</h3>
        <ul>
          <li>The device signature on each reading (the meter's key signs the reading digest). The page trusts the DEMO series.</li>
          <li>The IsolationForest part of the integrity score, which needs scikit-learn.</li>
          <li>The live Open-Meteo weather fetch, the Sepolia contracts and their explorer links, and the auditor's release of quarantined readings.</li>
          <li>Grid carbon intensity, surplus-hour bonuses, emissions accounting and the day-ahead forecast.</li>
        </ul>
      </section>
    </main>
  );
}

function countStatus(book: CertificateBook, want: 'issued' | 'quarantined'): number {
  let n = 0;
  for (const d of DEVICE_RUNS) {
    for (const r of d.rows) if (book.status(tokenIdFor(d.deviceId, r.unix)) === want) n++;
  }
  return n;
}
