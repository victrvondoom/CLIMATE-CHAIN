import { useMemo, useState } from 'react';
import { useSignals } from '../../core/signals';
import { Card, Stat } from '../../components/Ui';
import { appendLedger, createEvidence } from '../../core/evidence';
import type { ClimateModule } from '../../core/module';
import { ALERT_BOOK_BUTTON, farmersToNotify, villageAlertText } from './domain/alerts';
import { scoreField, type FieldState, type FieldStatus, type RiskLevel } from './domain/risk';
import { routeToBaler, type Baler, type ClusterDays, type FieldSite, type Ledger, type Route } from './domain/routing';
import seedJson from './fixtures/seed.json';
import './module.css';

interface SeedField {
  fieldId: string;
  villageId: string;
  acres: number;
  lat: number;
  lng: number;
  status: string;
  harvestDate: string;
  sowingDeadline: string;
  harvestConfirmed: boolean;
}
interface Seed {
  asOf: string;
  villages: { villageId: string; name: string; fireHistoryScore: number }[];
  fields: SeedField[];
  balers: Baler[];
}

const SEED = seedJson as Seed;
const TODAY = SEED.asOf;
// The fixture has no bookings, so every baler starts empty and the slot check runs against full capacity.
const LEDGER: Ledger = {};
const CLUSTER_DAYS: ClusterDays = {};

interface Scored {
  field: SeedField;
  village: Seed['villages'][number];
  route: Route | null;
  risk: { score: number; level: RiskLevel; reasons: readonly string[] };
}

function scoreSeed(): Scored[] {
  return SEED.fields.map((field) => {
    const village = SEED.villages.find((row) => row.villageId === field.villageId) ?? SEED.villages[0];
    const site: FieldSite = { acres: field.acres, lat: field.lat, lng: field.lng, harvestDate: field.harvestDate, sowingDeadline: field.sowingDeadline };
    const route = routeToBaler(site, SEED.balers, LEDGER, CLUSTER_DAYS, TODAY);
    const state: FieldState = {
      status: field.status as FieldStatus,
      harvestDate: field.harvestDate,
      sowingDeadline: field.sowingDeadline,
      harvestConfirmed: field.harvestConfirmed,
    };
    // A field can be booked when a baler has room in the window; that is the source's slot check.
    return { field, village, route, risk: scoreField(state, village.fireHistoryScore, TODAY, route !== null) };
  });
}

function bandClass(level: RiskLevel): string {
  return `m-clearsky-band m-clearsky-${level.toLowerCase()}`;
}

function ClearskyPage() {
  const { data: overview, error: feedError } = useSignals();
  const [villageId, setVillageId] = useState<string>(SEED.villages[0].villageId);
  const [recorded, setRecorded] = useState<{ fieldId: string; sha256: string; saved: boolean } | null>(null);

  const scored = useMemo(() => scoreSeed(), []);
  const village = SEED.villages.find((row) => row.villageId === villageId) ?? SEED.villages[0];
  const alertFields = scored.filter((row) => row.field.villageId === village.villageId);
  const contacts = farmersToNotify(
    alertFields.map((row) => ({ phone: row.field.fieldId, status: row.field.status as FieldStatus, riskScore: row.risk.score })),
  );
  const fire = overview?.fire;

  async function recordRoute(row: Scored) {
    const evidence = await createEvidence({
      moduleId: 'clearsky',
      kind: 'baler-route',
      mode: 'SIMULATED',
      summary: `${row.field.fieldId}: ${row.route ? `routed to ${row.route.balerId} on ${row.route.day}` : 'no baler has room'}`,
      payload: { fieldId: row.field.fieldId, asOf: TODAY, route: row.route, risk: row.risk },
    });
    setRecorded({ fieldId: row.field.fieldId, sha256: evidence.sha256, saved: appendLedger(evidence) });
  }

  return (
    <section className="m-clearsky-page">
      <header className="m-clearsky-head">
        <div>
          <p className="m-clearsky-kicker">Fire · Punjab</p>
          <h2>clearsky</h2>
          <p>Stubble fires are prevented before ignition: score the fields, warn the village, route the straw to a baler with room.</p>
        </div>
        <span className="m-clearsky-mode">Mode: SIMULATED</span>
      </header>

      <div className="m-clearsky-grid">
        <Card className="m-clearsky-card">
          <h3>Burn Risk Radar</h3>
          <div className="m-clearsky-stats">
            <Stat label={`RED fields (${overview?.sources.clearsky.mode === 'live' ? 'connected' : 'simulated'})`} value={fire ? fire.redFields : 'n/a'} hint={feedError ? `Overview not reachable: ${feedError}` : 'From the shared, refreshed clearsky feed'} />
            <Stat label={`YELLOW fields (${overview?.sources.clearsky.mode === 'live' ? 'connected' : 'simulated'})`} value={fire ? fire.yellowFields : 'n/a'} />
          </div>
          <table className="m-clearsky-table">
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Score</th>
                <th scope="col">Band</th>
              </tr>
            </thead>
            <tbody>
              {scored.map((row) => (
                <tr key={row.field.fieldId}>
                  <td>
                    {row.field.fieldId}
                    <span className="m-clearsky-sub"> {row.village.name}, {row.field.acres} ac</span>
                  </td>
                  <td>{row.risk.score}</td>
                  <td>
                    <span className={bandClass(row.risk.level)}>{row.risk.level}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="m-clearsky-reasons">
            {scored.map((row) => (
              <li key={row.field.fieldId}>
                <strong>{row.field.fieldId}</strong>: {row.risk.reasons.join(', ')}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="m-clearsky-card">
          <h3>Village alert</h3>
          <div className="m-clearsky-picker" role="group" aria-label="Choose a village">
            {SEED.villages.map((row) => (
              <button
                key={row.villageId}
                type="button"
                className={row.villageId === village.villageId ? 'm-clearsky-chip m-clearsky-chip-on' : 'm-clearsky-chip'}
                aria-pressed={row.villageId === village.villageId}
                onClick={() => setVillageId(row.villageId)}
              >
                {row.name}
              </button>
            ))}
          </div>
          <p className="m-clearsky-message">{villageAlertText(village.name)}</p>
          <p className="m-clearsky-sub">
            Button: &ldquo;{ALERT_BOOK_BUTTON}&rdquo;. Contacts to notify: {contacts.length} (by field id; the fixture has no phone numbers).
          </p>
        </Card>

        <Card className="m-clearsky-card">
          <h3>Baler routing</h3>
          <p className="m-clearsky-sub">The nearest baler-day with room in the booking window, scored by distance, delay and village cluster.</p>
          <ul className="m-clearsky-routes">
            {scored.map((row) => (
              <li key={row.field.fieldId}>
                <span>{row.field.fieldId}</span>
                {row.route ? (
                  <span>
                    {row.route.balerId} on {row.route.day}, {row.route.distKm} km{row.route.cluster ? ', same village' : ''}
                  </span>
                ) : (
                  <span className="m-clearsky-error">no baler has room in the window</span>
                )}
                <button type="button" className="m-clearsky-action" onClick={() => void recordRoute(row)}>
                  Record in ledger
                </button>
              </li>
            ))}
          </ul>
          {recorded ? (
            <p className="m-clearsky-sub" role="status">
              Recorded {recorded.fieldId}, sha256 {recorded.sha256.slice(0, 16)}… {recorded.saved ? '(saved to the ledger)' : '(ledger unavailable in this browser)'}
            </p>
          ) : null}
        </Card>
      </div>

      <Card className="m-clearsky-card">
        <h3>Not ported</h3>
        <ul className="m-clearsky-sub">
          <li>WhatsApp and voice intake (Hindi and Punjabi), the farmer agent, and the booking messages: they need the channel APIs.</li>
          <li>Buyer routing and net price: the port routes straw to a baler only; buyer prices are demo parameters in the source.</li>
          <li>Pollution impact: clearsky ships no emission factor, so no PM2.5 figure is shown.</li>
          <li>FIRMS fire history: the fixture uses the seed fire-history scores; live counts come from the overview only.</li>
        </ul>
      </Card>
    </section>
  );
}

const climateModule: ClimateModule = {
  id: 'clearsky',
  name: 'clearsky',
  tagline: 'Burn Risk Radar scores fields, village alerts ask for bookings, and straw is routed to a baler with room.',
  stages: ['sense', 'act', 'prove'],
  tone: 'fire',
  mode: 'SIMULATED',
  features: [
    'Burn Risk Radar: RED and YELLOW field bands with reasons',
    'Village alert text and the farmers to notify',
    'Baler routing for straw that respects daily capacity',
  ],
  source: {
    folder: 'clearsky-main',
    files: [
      'backend/src/clearsky/domain/risk.py',
      'backend/src/clearsky/domain/alerts.py',
      'backend/src/clearsky/domain/matching.py',
      'backend/src/clearsky/domain/geo.py',
      'backend/src/clearsky/channels/templates.py',
      'backend/src/clearsky/config.py',
      'backend/tests/test_risk_alerts.py',
      'backend/tests/test_matching.py',
      'data/seed/villages.json',
      'data/seed/fields.json',
      'data/seed/balers.json',
    ],
  },
  Page: ClearskyPage,
};

export default climateModule;
