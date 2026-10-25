import { useMemo, useState } from 'react';
import type { ClimateModule } from '../../core/module';
import { appendLedger, createEvidence } from '../../core/evidence';
import { Card, Stat } from '../../components/Ui';
import { evaluate, isPayable, type Evaluation, type EvidenceBundle, type Verdict } from './domain/verdict';
import { PlotRegistry, type ClaimResult, type RegisterResult } from './domain/registry';
import plot1 from './fixtures/plot-1-clean.json';
import plot2 from './fixtures/plot-2-burned.json';
import plot3 from './fixtures/plot-3-cloudy.json';
import plot4 from './fixtures/plot-4-duplicate.json';
import webCells from './fixtures/web_plot1_cells.json';
import './module.css';

const SEASON = 2026;

// What this Page does, in the order it appears. Kept in step with the rendered sections.
const FEATURES = [
  'H3 cell land registry that reverts on any overlapping plot',
  'One claim per plot and season',
  'Oracle verdict rule: NoBurn, Burned or Uncertain from FIRMS and Sentinel-2 (signature not ported)',
];

type Mode = 'SIMULATED' | 'RESEARCH';

function ModeTag({ mode }: { mode: Mode }) {
  return <span className={`m-plotlock-mode m-plotlock-mode-${mode.toLowerCase()}`}>{mode}</span>;
}

interface SeasonRow {
  key: string;
  label: string;
  district: string;
  cells: string[];
  provenance: string;
  registration: RegisterResult;
  evaluation: Evaluation | null;
  verdict: Verdict | null;
  claim: ClaimResult | null;
  bundle: EvidenceBundle | null;
}

interface SeasonRun {
  rows: SeasonRow[];
  sharedWithPlot1: number;
  repeatClaim: ClaimResult | null;
}

// Runs one season in order: four plot registrations, the oracle verdict for each evidence bundle,
// and a second claim for plot 1, which must revert. Pure, so the Page can recompute it safely.
function runSeason(): SeasonRun {
  const registry = new PlotRegistry();
  const plot1Cells = new Set<string>(webCells.h3_cells);
  const entries = [
    { key: 'plot-1-clean', label: plot1.plot.label, district: plot1.plot.district, cells: plot1.plot.h3_cells, provenance: plot1.provenance, bundle: plot1 as EvidenceBundle },
    { key: 'plot-2-burned', label: plot2.plot.label, district: plot2.plot.district, cells: plot2.plot.h3_cells, provenance: plot2.provenance, bundle: plot2 as EvidenceBundle },
    { key: 'plot-3-cloudy', label: plot3.plot.label, district: plot3.plot.district, cells: plot3.plot.h3_cells, provenance: plot3.provenance, bundle: plot3 as EvidenceBundle },
    // plot 4 is a registration scenario, not an evidence bundle: it has no verdict of its own
    { key: 'plot-4-duplicate', label: plot4.plot.label, district: plot4.plot.district, cells: plot4.plot.h3_cells, provenance: plot4.provenance, bundle: null },
  ];

  let plot1Id: number | null = null;
  const rows: SeasonRow[] = entries.map((entry) => {
    const registration = registry.registerPlot(SEASON, entry.cells);
    if (!registration.ok) {
      return { ...entry, registration, evaluation: null, verdict: null, claim: null };
    }
    if (entry.key === 'plot-1-clean') plot1Id = registration.plotId;
    if (!entry.bundle) {
      return { ...entry, registration, evaluation: null, verdict: null, claim: null };
    }
    const evaluation = evaluate(entry.bundle);
    const claim = registry.submitClaim(registration.plotId, SEASON, evaluation.verdict);
    return { ...entry, registration, evaluation, verdict: evaluation.verdict, claim };
  });

  const sharedWithPlot1 = plot4.plot.h3_cells.filter((cell) => plot1Cells.has(cell)).length;
  const repeatClaim = plot1Id === null ? null : registry.submitClaim(plot1Id, SEASON, 'NoBurn');
  return { rows, sharedWithPlot1, repeatClaim };
}

function verdictClass(verdict: Verdict): string {
  if (verdict === 'NoBurn') return 'm-plotlock-verdict-noburn';
  if (verdict === 'Burned') return 'm-plotlock-verdict-burned';
  return 'm-plotlock-verdict-uncertain';
}

function PlotLockPage() {
  const run = useMemo(() => runSeason(), []);
  const [recorded, setRecorded] = useState<{ count: number; last: string | null; failed: boolean } | null>(null);

  const registered = run.rows.filter((r) => r.registration.ok).length;
  const payable = run.rows.filter((r) => r.verdict !== null && isPayable(r.verdict)).map((r) => r.label);

  async function recordVerdicts() {
    let count = 0;
    let last: string | null = null;
    let failed = false;
    for (const row of run.rows) {
      if (!row.verdict || !row.evaluation) continue;
      try {
        const record = await createEvidence({
          moduleId: 'plotlock',
          kind: 'oracle-verdict',
          mode: 'SIMULATED',
          summary: `${row.key}: ${row.verdict} (${isPayable(row.verdict) ? 'payable' : 'not payable'})`,
          payload: {
            bundle: row.key,
            season: SEASON,
            verdict: row.verdict,
            payable: isPayable(row.verdict),
            reasons: row.evaluation.reasons,
          },
        });
        if (appendLedger(record)) count += 1;
        last = record.sha256;
      } catch {
        failed = true;
        break;
      }
    }
    setRecorded({ count, last, failed });
  }

  return (
    <div className="m-plotlock">
      <header className="m-plotlock-head">
        <div>
          <h2 className="m-plotlock-title">ParcelSeal</h2>
          <p className="m-plotlock-tagline">Simulated: one attestation per plot per season on a local demo chain, bound to satellite evidence.</p>
        </div>
        <ModeTag mode="SIMULATED" />
      </header>

      <div className="m-plotlock-grid">
        <Card className="m-plotlock-wide">
          <h3 className="m-plotlock-card-title">
            H3 cell land registry <ModeTag mode="SIMULATED" />
          </h3>
          <p className="m-plotlock-card-sub">
            A plot is registered as a set of H3 res-12 cells for the season. If any cell is already taken, the whole registration reverts.
          </p>
          <div className="m-plotlock-table-wrap">
            <table className="m-plotlock-table">
              <thead>
                <tr>
                  <th>Plot</th>
                  <th>District</th>
                  <th className="m-plotlock-num">Cells</th>
                  <th>Registration</th>
                </tr>
              </thead>
              <tbody>
                {run.rows.map((row) => (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td>{row.district}</td>
                    <td className="m-plotlock-num">{row.cells.length}</td>
                    <td>
                      {row.registration.ok ? (
                        `registered as plot #${row.registration.plotId}`
                      ) : (
                        <span className="m-plotlock-error">
                          reverted: {row.registration.error}
                          {row.key === 'plot-4-duplicate' ? ` (${run.sharedWithPlot1} cells shared with plot 1)` : ''}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="m-plotlock-stats">
            <Stat label="Plots registered" value={`${registered} of ${run.rows.length}`} />
            <Stat label="Shared cells" value={run.sharedWithPlot1} hint="plot 4 vs plot 1" />
          </div>
        </Card>

        <Card className="m-plotlock-wide">
          <h3 className="m-plotlock-card-title">
            One claim per plot and season <ModeTag mode="SIMULATED" />
          </h3>
          <p className="m-plotlock-card-sub">Only NoBurn records a payable attestation. Burned and Uncertain are recorded as rejections.</p>
          <div className="m-plotlock-table-wrap">
            <table className="m-plotlock-table">
              <thead>
                <tr>
                  <th>Plot</th>
                  <th>Oracle verdict</th>
                  <th>Recorded</th>
                </tr>
              </thead>
              <tbody>
                {run.rows
                  .filter((row) => row.verdict !== null)
                  .map((row) => (
                    <tr key={row.key}>
                      <td>{row.label}</td>
                      <td>
                        <span className={`m-plotlock-verdict ${verdictClass(row.verdict!)}`}>{row.verdict}</span>
                      </td>
                      <td>
                        {row.claim?.ok
                          ? `${row.claim.status}${row.claim.payable ? ' (payable)' : ' (not payable)'}`
                          : row.claim
                            ? `refused: ${row.claim.error}`
                            : 'no claim'}
                      </td>
                    </tr>
                  ))}
                <tr>
                  <td>Second claim for plot 1</td>
                  <td>NoBurn</td>
                  <td className="m-plotlock-error">
                    {run.repeatClaim && !run.repeatClaim.ok ? `refused: ${run.repeatClaim.error}` : 'accepted (unexpected)'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="m-plotlock-note">Payable this season: {payable.length ? payable.join(', ') : 'none'}.</p>
        </Card>

        <Card className="m-plotlock-wide">
          <h3 className="m-plotlock-card-title">
            Oracle verdicts from FIRMS and Sentinel-2 <ModeTag mode="SIMULATED" />
          </h3>
          <p className="m-plotlock-card-sub">
            Both signals must agree. A missing signal or a disagreement is Uncertain, and Uncertain never pays.
          </p>
          {run.rows
            .filter((row) => row.evaluation)
            .map((row) => (
              <div key={row.key} className="m-plotlock-signal">
                <p>
                  <strong>{row.label}</strong>{' '}
                  <span className={`m-plotlock-verdict ${verdictClass(row.verdict!)}`}>{row.verdict}</span>
                </p>
                <p className="m-plotlock-note">
                  FIRMS: {row.evaluation!.signals.firms.detail}. <ModeTag mode="SIMULATED" /> Sentinel-2:{' '}
                  {row.evaluation!.signals.sentinel2.detail}. <ModeTag mode="RESEARCH" />
                </p>
                <p className="m-plotlock-note">{row.provenance}</p>
              </div>
            ))}
        </Card>

        <Card className="m-plotlock-wide">
          <h3 className="m-plotlock-card-title">Record the verdicts as evidence</h3>
          <p className="m-plotlock-card-sub">Each verdict is hashed (SHA-256 of its canonical payload) and kept in this browser's evidence ledger.</p>
          <button type="button" className="m-plotlock-button" onClick={() => void recordVerdicts()}>
            Record verdicts
          </button>
          {recorded ? (
            <p className="m-plotlock-note">
              {recorded.failed
                ? 'Hashing is unavailable in this context, so no evidence was recorded.'
                : `Recorded ${recorded.count} verdict(s) in the evidence ledger.`}
              {recorded.last ? (
                <>
                  {' '}
                  Last hash <span className="m-plotlock-code">{recorded.last}</span>
                </>
              ) : null}
            </p>
          ) : null}
        </Card>
      </div>

      <p className="m-plotlock-note">
        Not ported: the EIP-191 oracle signature with nonce and deadline, the Polygon Amoy transactions, the keccak evidence hash, live FIRMS and
        Planetary Computer pulls (these use the fixtures), and the map. The H3 library is not used: the cell ids are the fixture values.
      </p>
    </div>
  );
}

const climateModule: ClimateModule = {
  id: 'plotlock',
  name: 'ParcelSeal',
  tagline: 'Simulated: one attestation per plot per season on a local demo chain, bound to satellite evidence.',
  stages: ['verify', 'finance', 'prove'],
  tone: 'carbon',
  mode: 'SIMULATED',
  features: FEATURES,
  source: {
    folder: 'plotlock-main',
    files: [
      'contracts/PlotLock.sol',
      'oracle/evidence.py',
      'oracle/tests/test_oracle.py',
      'oracle/fixtures/plot-1-clean.json',
      'oracle/fixtures/plot-2-burned.json',
      'oracle/fixtures/plot-3-cloudy.json',
      'oracle/fixtures/plot-4-duplicate.json',
      'web/data.js',
    ],
  },
  Page: PlotLockPage,
};

export default climateModule;
