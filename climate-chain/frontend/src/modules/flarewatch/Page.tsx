import { useMemo, useState } from 'react';
import { appendLedger, createEvidence, readLedger, type EvidenceRecord } from '../../core/evidence';
import { DAY_FILES, INDEX } from './data';
import { checkAnchor, reconcileAnchor, type AnchorCheck } from './domain/anchor';
import { buildSites, dayStats, parseDay, type Site } from './domain/derive';

const DAYS = DAY_FILES.map((d) => ({ day: d.day, raw: d.raw, file: parseDay(d.raw) }));
const NIGHT_STATS = DAYS.map((d) => ({ day: d.day, ...dayStats(d.file) }));
const SITES = buildSites(DAYS.map((d) => d.file));
const PERSISTENT_COUNT = SITES.filter((s) => s.flare).length;
const TOTAL_DETECTIONS = NIGHT_STATS.reduce((s, n) => s + n.detections, 0);
const LEDGER_KIND = 'night-anchor-check';

function ModeLabel() {
  return (
    <span className="m-flarewatch-mode" title="Measured NASA FIRMS VIIRS detections, copied from the project's own day files">
      RESEARCH
    </span>
  );
}

function ClassBadge({ site }: { site: Site }) {
  return (
    <span className={site.flare ? 'm-flarewatch-class m-flarewatch-class-persistent' : 'm-flarewatch-class'}>
      {site.flare ? 'persistent flare' : 'transient'}
    </span>
  );
}

const shortDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
};

export default function FlarewatchPage() {
  const [filter, setFilter] = useState<'persistent' | 'all'>('persistent');
  const [checks, setChecks] = useState<Record<string, AnchorCheck>>({});
  const [ledger, setLedger] = useState<EvidenceRecord[]>(() => readLedger());
  const [busy, setBusy] = useState(false);

  const shownSites = useMemo(
    () => (filter === 'persistent' ? SITES.filter((s) => s.flare) : SITES).slice(0, 12),
    [filter],
  );
  const records = ledger.filter((r) => r.moduleId === 'flarewatch' && r.kind === LEDGER_KIND).slice(0, 6);

  async function verify(days: string[]) {
    setBusy(true);
    const next: Record<string, AnchorCheck> = {};
    for (const day of days) {
      const night = DAYS.find((d) => d.day === day);
      const anchored = INDEX.days.find((x) => x.day === day)?.sha256;
      if (!night || !anchored) continue;
      const check = await checkAnchor(night.raw, anchored);
      next[day] = check;
      const verdict = reconcileAnchor(anchored, check.computed) === 'unchanged' ? 'matches' : 'differs from';
      const record = await createEvidence({
        moduleId: 'flarewatch',
        kind: LEDGER_KIND,
        mode: 'RESEARCH',
        summary: `${day} file ${verdict} its anchored SHA-256`,
        payload: { day, anchored, computed: check.computed, match: check.match },
      });
      appendLedger(record);
    }
    setChecks((c) => ({ ...c, ...next }));
    setLedger(readLedger());
    setBusy(false);
  }

  return (
    <main className="m-flarewatch">
      <header className="m-flarewatch-head">
        <p className="m-flarewatch-kicker">Gas flaring · Niger Delta</p>
        <h2>TorchSight: flares seen from space, each night fixed by a digest</h2>
        <p className="m-flarewatch-lede">
          NASA FIRMS VIIRS night detections are grouped into sites within 1 km. A site detected on 3 or more nights within 7 days is a
          persistent flare. Each night's file is hashed, and the hash is checked against the digest the project anchored.
        </p>
      </header>

      <section className="m-flarewatch-card" aria-labelledby="m-flarewatch-nights">
        <div className="m-flarewatch-card-head">
          <h3 id="m-flarewatch-nights">Nightly detections, 15 to 20 Oct 2026</h3>
          <ModeLabel />
        </div>
        <div className="m-flarewatch-stats">
          <div>
            <span className="m-flarewatch-stat-label">Nights</span>
            <span className="m-flarewatch-stat-value">{NIGHT_STATS.length}</span>
          </div>
          <div>
            <span className="m-flarewatch-stat-label">Detections</span>
            <span className="m-flarewatch-stat-value">{TOTAL_DETECTIONS}</span>
          </div>
          <div>
            <span className="m-flarewatch-stat-label">Sites</span>
            <span className="m-flarewatch-stat-value">{SITES.length}</span>
          </div>
          <div>
            <span className="m-flarewatch-stat-label">Persistent flares</span>
            <span className="m-flarewatch-stat-value">{PERSISTENT_COUNT}</span>
          </div>
        </div>
        <p className="m-flarewatch-note">
          Totals rebuilt in this page from the day files match the project's index: {INDEX.totals.sites} sites, {INDEX.totals.flares}{' '}
          persistent flares, {INDEX.totals.detections} detections.
        </p>
        <div className="m-flarewatch-table-wrap">
          <table className="m-flarewatch-table">
            <thead>
              <tr>
                <th>Night (UTC)</th>
                <th>Detections</th>
                <th>Flare sites</th>
                <th>Total FRP (kW)</th>
                <th>Anchored SHA-256</th>
                <th>Check against the anchor</th>
              </tr>
            </thead>
            <tbody>
              {NIGHT_STATS.map((n) => {
                const anchored = INDEX.days.find((x) => x.day === n.day)?.sha256 ?? '';
                const check = checks[n.day];
                return (
                  <tr key={n.day}>
                    <td>{n.day}</td>
                    <td>{n.detections}</td>
                    <td>{n.flareSites}</td>
                    <td>{n.totalFrpKw.toLocaleString('en-US')}</td>
                    <td className="m-flarewatch-hash" title={anchored}>
                      {anchored.slice(0, 12)}…
                    </td>
                    <td>
                      {check ? (
                        <span className={check.match ? 'm-flarewatch-ok' : 'm-flarewatch-bad'}>
                          {check.match ? 'matches' : 'differs'}
                        </span>
                      ) : (
                        <button type="button" className="m-flarewatch-btn" disabled={busy} onClick={() => void verify([n.day])}>
                          Verify
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="m-flarewatch-actions">
          <button type="button" className="m-flarewatch-btn m-flarewatch-btn-primary" disabled={busy} onClick={() => void verify(DAYS.map((d) => d.day))}>
            Verify all nights
          </button>
          <span className="m-flarewatch-note">
            Each check hashes the day file's exact bytes and writes a record to the evidence ledger in this browser.
          </span>
        </div>
      </section>

      <section className="m-flarewatch-card" aria-labelledby="m-flarewatch-sites">
        <div className="m-flarewatch-card-head">
          <h3 id="m-flarewatch-sites">Sites and persistent flares</h3>
          <ModeLabel />
        </div>
        <div className="m-flarewatch-controls" role="group" aria-label="Site filter">
          <button
            type="button"
            className={filter === 'persistent' ? 'm-flarewatch-tab m-flarewatch-tab-on' : 'm-flarewatch-tab'}
            onClick={() => setFilter('persistent')}
          >
            Persistent flares
          </button>
          <button
            type="button"
            className={filter === 'all' ? 'm-flarewatch-tab m-flarewatch-tab-on' : 'm-flarewatch-tab'}
            onClick={() => setFilter('all')}
          >
            All sites
          </button>
        </div>
        <div className="m-flarewatch-table-wrap">
          <table className="m-flarewatch-table">
            <thead>
              <tr>
                <th>Site (lat, lon)</th>
                <th>Class</th>
                <th>Nights</th>
                <th>Detections</th>
                <th>Mean FRP (MW)</th>
                <th>Max FRP (MW)</th>
              </tr>
            </thead>
            <tbody>
              {shownSites.map((s) => (
                <tr key={s.id}>
                  <td className="m-flarewatch-site">
                    {s.id}
                    <span className="m-flarewatch-nights">{s.nights.map((n) => shortDate(n.day)).join(', ')}</span>
                  </td>
                  <td>
                    <ClassBadge site={s} />
                  </td>
                  <td>{s.nightsActive}</td>
                  <td>{s.detections}</td>
                  <td>{s.meanFrp.toFixed(2)}</td>
                  <td>{s.maxFrp.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="m-flarewatch-note">
          Showing the first {shownSites.length} of {filter === 'persistent' ? PERSISTENT_COUNT : SITES.length}. FRP is the heat the sensor sees
          at each pass. It is not converted to a gas volume, because the project does not claim a calibration for that.
        </p>
      </section>

      <section className="m-flarewatch-card" aria-labelledby="m-flarewatch-receipts">
        <div className="m-flarewatch-card-head">
          <h3 id="m-flarewatch-receipts">Recorded checks</h3>
          <ModeLabel />
        </div>
        {records.length === 0 ? (
          <p className="m-flarewatch-note">No checks recorded yet. Verify a night above.</p>
        ) : (
          <ul className="m-flarewatch-records">
            {records.map((r) => (
              <li key={r.id}>
                <span>{r.summary}</span>
                <span className="m-flarewatch-hash" title={r.sha256}>
                  {r.sha256.slice(0, 12)}…
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="m-flarewatch-card m-flarewatch-not-ported" aria-labelledby="m-flarewatch-gaps">
        <h3 id="m-flarewatch-gaps">Not ported</h3>
        <ul>
          <li>
            The Solana program and devnet reads and writes. The check compares with the digest recorded in the project index, and the page does not read
            the chain.
          </li>
          <li>The nightly NASA FIRMS download and the publish step. The page uses the six day files already published.</li>
          <li>Place names and the daily brief.</li>
        </ul>
      </section>
    </main>
  );
}
