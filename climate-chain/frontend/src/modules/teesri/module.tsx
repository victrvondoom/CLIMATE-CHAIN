import { useMemo, useState } from 'react';
import { useSignals } from '../../core/signals';
import { Card, Stat } from '../../components/Ui';
import { appendLedger, createEvidence } from '../../core/evidence';
import type { ClimateModule } from '../../core/module';
import { addHours, BUILDING_M, decide, haversineM, MIN_HOMES, offsetPoint, RING_M, WINDOW_H, type Decision, type Report, type Verdict, type WaterFields } from './domain/ring';
import scenariosJson from './fixtures/scenarios.json';
import './module.css';

interface ScenarioReport {
  home: string;
  northM: number;
  eastM: number;
  h: number;
  dirty: boolean;
}
interface Scenario {
  id: string;
  title: string;
  expect: Decision;
  reports: ScenarioReport[];
}
interface ScenarioFile {
  base: { lat: number; lon: number; startIso: string };
  scenarios: Scenario[];
}

const FILE = scenariosJson as ScenarioFile;
const DIRTY: WaterFields = { colour: 'brown', smell: true, illness: [] };
const CLEAR: WaterFields = { colour: 'clear', smell: false, illness: [] };

const DECISION_TEXT: Record<Decision, string> = {
  already: 'Already in an incident',
  clean: 'Clear water: not counted',
  join: 'Joins an open incident',
  none: 'Not enough homes: no warning',
  tank: 'One building: tank advice, no area alarm',
  incident: 'Warning ring: three homes within 250 m in 72 h',
};

function buildReports(scenario: Scenario): Report[] {
  return scenario.reports.map((row, index) => {
    const [lat, lon] = offsetPoint(FILE.base.lat, FILE.base.lon, row.northM, row.eastM);
    return {
      id: `${scenario.id}-${index}`,
      homeId: `sim-${row.home}`,
      lat,
      lon,
      ts: addHours(FILE.base.startIso, row.h),
      fields: row.dirty ? DIRTY : CLEAR,
      incidentId: null,
    };
  });
}

// The last report is the new one; the earlier reports are what it is compared with.
function verdictFor(scenario: Scenario): { reports: Report[]; trigger: Report; verdict: Verdict } {
  const reports = buildReports(scenario);
  const trigger = reports[reports.length - 1];
  return { reports, trigger, verdict: decide(trigger, reports.slice(0, -1)) };
}

function TeesriPage() {
  const { data: overview, error: feedError } = useSignals();
  const [scenarioId, setScenarioId] = useState<string>(FILE.scenarios[0].id);
  const [recorded, setRecorded] = useState<{ sha256: string; saved: boolean } | null>(null);

  const scenario = FILE.scenarios.find((row) => row.id === scenarioId) ?? FILE.scenarios[0];
  const { reports, trigger, verdict } = useMemo(() => verdictFor(scenario), [scenario]);
  const water = overview?.water;

  async function recordVerdict() {
    const evidence = await createEvidence({
      moduleId: 'teesri',
      kind: 'ring-verdict',
      mode: 'SIMULATED',
      summary: `${scenario.id}: ${verdict.decision}`,
      payload: {
        scenario: scenario.id,
        expect: scenario.expect,
        decision: verdict.decision,
        homes: verdict.stats?.homes ?? verdict.members.length,
        spreadM: verdict.stats?.spreadM ?? null,
        spanH: verdict.stats?.spanH ?? null,
        windowH: WINDOW_H,
        ringM: RING_M,
      },
    });
    setRecorded({ sha256: evidence.sha256, saved: appendLedger(evidence) });
  }

  const agrees = verdict.decision === scenario.expect;

  return (
    <section className="m-teesri-page">
      <header className="m-teesri-head">
        <div>
          <p className="m-teesri-kicker">Water · Mumbai (Dongri)</p>
          <h2>Teesri Shikayat</h2>
          <p>Neighbourhood water safety: three dirty-water reports from nearby homes trip a warning to every home around them.</p>
        </div>
        <span className="m-teesri-mode">Mode: SIMULATED</span>
      </header>

      <div className="m-teesri-grid">
        <Card className="m-teesri-card">
          <h3>Warning ring</h3>
          <p className="m-teesri-note">
            {MIN_HOMES} different homes, each within {RING_M} m of the others, reporting dirty water within {WINDOW_H} hours. If the homes are all within {BUILDING_M} m, it is one building and gets tank advice instead.
          </p>
          <div className="m-teesri-picker" role="group" aria-label="Choose a scenario">
            {FILE.scenarios.map((row) => (
              <button
                key={row.id}
                type="button"
                className={row.id === scenario.id ? 'm-teesri-chip m-teesri-chip-on' : 'm-teesri-chip'}
                aria-pressed={row.id === scenario.id}
                onClick={() => {
                  setScenarioId(row.id);
                  setRecorded(null);
                }}
              >
                {row.title}
              </button>
            ))}
          </div>
          <p className={`m-teesri-decision m-teesri-${verdict.decision}`} role="status">
            {DECISION_TEXT[verdict.decision]}
          </p>
          <p className="m-teesri-note">
            Source test expects <strong>{scenario.expect}</strong>; this port returns <strong>{verdict.decision}</strong>.{' '}
            {agrees ? 'They agree.' : 'They disagree: check the rule.'}
          </p>
          <table className="m-teesri-table">
            <thead>
              <tr>
                <th scope="col">Home</th>
                <th scope="col">Distance from the new report</th>
                <th scope="col">Hours after the first report</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr key={report.id}>
                  <td>{report.homeId}</td>
                  <td>{report.id === trigger.id ? 'new report' : `${Math.round(haversineM(trigger.lat, trigger.lon, report.lat, report.lon))} m`}</td>
                  <td>{Math.round((Date.parse(report.ts) - Date.parse(reports[0].ts)) / 3_600_000)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {verdict.stats ? (
            <p className="m-teesri-note">
              Homes {verdict.stats.homes}, spread {verdict.stats.spreadM} m, span {verdict.stats.spanH} h.
            </p>
          ) : null}
          <button type="button" className="m-teesri-action" onClick={() => void recordVerdict()}>
            Record this verdict in the evidence ledger
          </button>
          {recorded ? (
            <p className="m-teesri-note" role="status">
              Recorded, sha256 {recorded.sha256.slice(0, 16)}… {recorded.saved ? '(saved to the ledger)' : '(ledger unavailable in this browser)'}
            </p>
          ) : null}
        </Card>

        <Card className="m-teesri-card">
          <h3>Live water counts</h3>
          <div className="m-teesri-stats">
            <Stat label="Reported" value={water ? water.reported : 'n/a'} hint={feedError ? `Overview not reachable: ${feedError}` : 'From fetchOverview().water'} />
            <Stat label="Warned" value={water ? water.warned : 'n/a'} />
            <Stat label="In a ring" value={water ? water.inRing : 'n/a'} />
            <Stat label="All reports" value={water ? water.total : 'n/a'} />
          </div>
          <p className="m-teesri-note">
            Ward: {water ? water.ward : 'n/a'}. Case open: {water ? (water.caseOpen ? 'yes' : 'no') : 'n/a'}.
          </p>
        </Card>
      </div>

      <Card className="m-teesri-card">
        <h3>Not ported</h3>
        <ul className="m-teesri-note">
          <li>Hindi intake: the Telegram bot, the voice-note transcription and the keyword reader are out of scope.</li>
          <li>Resident-controlled case closure: the closure workflow and its state machine are not ported.</li>
          <li>Ring population (GHS-POP residents in the ring) and the store, incident writes and Step Functions workflow: they need the AWS data.</li>
          <li>Tank advice messages: the port returns the decision only; the messages are sent by the source.</li>
        </ul>
      </Card>
    </section>
  );
}

const climateModule: ClimateModule = {
  id: 'teesri',
  name: 'Teesri Shikayat',
  tagline: 'Three dirty-water reports from nearby homes within 72 hours raise a warning ring.',
  stages: ['sense', 'verify', 'act', 'prove'],
  tone: 'water',
  mode: 'SIMULATED',
  features: [
    '3 homes within 250 m in 72 hours: the warning ring',
    'One building within 30 m gets tank advice, with no area alarm',
    'Live reported, warned and in-ring counts from the water feed',
  ],
  source: {
    folder: 'teesri-shikayat-main',
    files: [
      'src/teesri/tripwire.py',
      'src/teesri/geo.py',
      'src/teesri/extract.py',
      'tests/test_tripwire.py',
      'docs/writeup.md',
    ],
  },
  Page: TeesriPage,
};

export default climateModule;
