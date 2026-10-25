import { useMemo, useState } from 'react';
import { appendLedger, createEvidence, readLedger, verifyEvidence, type EvidenceRecord } from '../../core/evidence';
import sample from './fixtures/carbonmapper-permian-sample.json';
import { DEFAULT_CLUSTER_PARAMS } from './domain/cluster';
import { WEIGHTS, type FactorName } from './domain/priority';
import { buildIncidents, type Incident, type SourceSummary } from './domain/incidents';
import { normalizeBatch, type RawPlume } from './domain/normalize';
import { OUTCOMES, allowedActions, checkTransition, TransitionError } from './domain/repair';

const NORMALIZED = normalizeBatch(sample.plumes as RawPlume[]);
const SOURCES: SourceSummary[] = sample.sources.map((s) => ({
  sourceName: s.source_name,
  sector: s.sector,
  plumeIds: s.plume_ids,
  persistence: s.persistence,
}));

const EPS_OPTIONS = [100, 200, 500] as const;
const ROLES = ['sponsor', 'provider', 'verifier', 'admin'] as const;
const DEMO_PROJECT = 'demo-repair-project';
const SIMULATED_FUNDING = '1.25 ETH';
const FACTOR_LABEL: Record<FactorName, string> = {
  magnitude: 'Magnitude',
  recurrence: 'Recurrence',
  provider_persistence: 'Provider persistence',
  corroboration: 'Corroboration',
  recency: 'Recency',
  measurement_confidence: 'Measurement confidence',
  localization: 'Localization',
};
const MODE_TITLE: Record<'RESEARCH' | 'SIMULATED', string> = {
  RESEARCH: 'Measured Carbon Mapper detections, copied from the project sample',
  SIMULATED: 'Simulated workflow: no chain, no escrow contract, no money moves',
};

function ModeLabel({ mode }: { mode: 'RESEARCH' | 'SIMULATED' }) {
  return (
    <span className={`m-plume-mode m-plume-mode-${mode.toLowerCase()}`} title={MODE_TITLE[mode]}>
      {mode}
    </span>
  );
}

const fmt2 = (x: number | null) => (x === null ? 'n/a' : x.toFixed(2));

function IncidentRow({ incident, rank, open, onToggle }: { incident: Incident; rank: number; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="m-plume-row" onClick={onToggle} aria-expanded={open}>
        <td>{rank}</td>
        <td>{incident.sector ?? 'unassigned'}</td>
        <td>{incident.keys.length}</td>
        <td>{incident.spreadM.toFixed(0)}</td>
        <td className="m-plume-score">{incident.score.toFixed(2)}</td>
        <td className="m-plume-source">{incident.primarySource ?? 'no provider group'}</td>
      </tr>
      {open ? (
        <tr className="m-plume-detail-row">
          <td colSpan={6}>
            <ul className="m-plume-factors">
              {incident.factors.map((f) => (
                <li key={f.name}>
                  <span className="m-plume-factor-name">{FACTOR_LABEL[f.name]}</span>
                  <span className="m-plume-factor-value">
                    {fmt2(f.value)} × {f.weight} = {f.contribution.toFixed(2)}
                  </span>
                  <span className="m-plume-factor-evidence">{f.evidence}</span>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export default function PlumePage() {
  const [epsM, setEpsM] = useState<number>(DEFAULT_CLUSTER_PARAMS.epsM);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const run = useMemo(
    () => buildIncidents(NORMALIZED.observations, SOURCES, { epsM, minSamples: DEFAULT_CLUSTER_PARAMS.minSamples }),
    [epsM],
  );
  const ranked = useMemo(() => [...run.incidents].sort((a, b) => b.score - a.score), [run]);

  const [status, setStatus] = useState('DRAFT');
  const [role, setRole] = useState<(typeof ROLES)[number]>('sponsor');
  const [outcome, setOutcome] = useState<string>(OUTCOMES[0]);
  const [message, setMessage] = useState<string | null>(null);
  const [ledger, setLedger] = useState<EvidenceRecord[]>(() => readLedger());
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const actions = allowedActions(status, role);
  const receipts = ledger.filter((r) => r.moduleId === 'plume').slice(0, 6);

  async function take(action: string) {
    try {
      const from = status;
      const to = checkTransition(action, status, role, action === 'decide' ? outcome : undefined);
      const record = await createEvidence({
        moduleId: 'plume',
        kind: 'repair-step',
        mode: 'SIMULATED',
        summary: `${action} by ${role}: ${from} to ${to}`,
        payload: { project: DEMO_PROJECT, action, role, from, to, simulatedFunding: SIMULATED_FUNDING },
      });
      appendLedger(record);
      setStatus(to);
      setLedger(readLedger());
      setMessage(`${action}: ${from} to ${to}. Receipt ${record.sha256.slice(0, 12)} recorded.`);
    } catch (e) {
      setMessage(e instanceof TransitionError ? `Refused (${e.code}): ${e.message}` : 'Unexpected error.');
    }
  }

  async function recheck(record: EvidenceRecord) {
    const ok = await verifyEvidence(record);
    setChecks((c) => ({ ...c, [record.id]: ok }));
  }

  return (
    <main className="m-plume">
      <header className="m-plume-head">
        <p className="m-plume-kicker">Methane · Permian Basin</p>
        <h2>MethaneMend: from detection to a verified repair</h2>
        <p className="m-plume-lede">
          Carbon Mapper methane detections are grouped into candidate sources, ranked for field investigation, and moved
          through a repair workflow. The detections are measured. The repair and its funds are simulated.
        </p>
      </header>

      <section className="m-plume-card" aria-labelledby="m-plume-detections">
        <div className="m-plume-card-head">
          <h3 id="m-plume-detections">Candidate sources</h3>
          <ModeLabel mode="RESEARCH" />
        </div>
        <p className="m-plume-note">
          DBSCAN with the haversine metric, per sector, min samples 1. {NORMALIZED.observations.length} detections used,{' '}
          {NORMALIZED.dropped.length} re-issued record dropped.
        </p>
        <div className="m-plume-controls">
          <label>
            Grouping radius
            <select value={epsM} onChange={(e) => setEpsM(Number(e.target.value))}>
              {EPS_OPTIONS.map((eps) => (
                <option key={eps} value={eps}>
                  {eps} m{eps === DEFAULT_CLUSTER_PARAMS.epsM ? ' (MethaneMend default)' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="m-plume-stats">
          <div>
            <span className="m-plume-stat-label">Incidents</span>
            <span className="m-plume-stat-value">{run.incidents.length}</span>
          </div>
          <div>
            <span className="m-plume-stat-label">Agreement with Carbon Mapper groups (ARI)</span>
            <span className="m-plume-stat-value">{run.comparison.ari === null ? 'n/a' : run.comparison.ari.toFixed(3)}</span>
          </div>
          <div>
            <span className="m-plume-stat-label">Identical to a provider source</span>
            <span className="m-plume-stat-value">
              {run.comparison.identical} of {run.comparison.providerGroups}
            </span>
          </div>
        </div>
        <div className="m-plume-table-wrap">
          <table className="m-plume-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Sector</th>
                <th>Detections</th>
                <th>Spread (m)</th>
                <th>Priority</th>
                <th>Provider source</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((incident, i) => (
                <IncidentRow
                  key={incident.keys[0]}
                  incident={incident}
                  rank={i + 1}
                  open={openKey === incident.keys[0]}
                  onToggle={() => setOpenKey(openKey === incident.keys[0] ? null : incident.keys[0])}
                />
              ))}
            </tbody>
          </table>
        </div>
        <p className="m-plume-note">
          Priority (priority-v1, weights sum to {Object.values(WEIGHTS).reduce((a, b) => a + b, 0)}) ranks where to look first.
          It is not an estimate of emissions, climate impact or health risk. Select a row to see each factor.
        </p>
      </section>

      <section className="m-plume-card" aria-labelledby="m-plume-repair">
        <div className="m-plume-card-head">
          <h3 id="m-plume-repair">Repair and funds (demo)</h3>
          <ModeLabel mode="SIMULATED" />
        </div>
        <p className="m-plume-note">
          Simulated escrow: {SIMULATED_FUNDING} (the value from MethaneMend's integration test). No value moves. The buttons
          below follow the escrow rule: each role may take only the actions allowed from the current state.
        </p>
        <div className="m-plume-controls">
          <label>
            Acting as
            <select value={role} onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label>
            Verification outcome
            <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              {OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="m-plume-status">
          <span className="m-plume-status-label">Status</span>
          <span className="m-plume-status-value">{status}</span>
          <button type="button" className="m-plume-reset" onClick={() => setStatus('DRAFT')}>
            Restart demo
          </button>
        </div>
        <div className="m-plume-actions">
          {actions.length === 0 ? (
            <span className="m-plume-note">No action for this role in this state.</span>
          ) : (
            actions.map((a) => (
              <button key={a} type="button" className="m-plume-action" onClick={() => void take(a)}>
                {a.replace(/_/g, ' ')}
              </button>
            ))
          )}
        </div>
        {message ? <p className="m-plume-message" role="status">{message}</p> : null}
      </section>

      <section className="m-plume-card" aria-labelledby="m-plume-receipts">
        <div className="m-plume-card-head">
          <h3 id="m-plume-receipts">Public receipts</h3>
          <ModeLabel mode="SIMULATED" />
        </div>
        <p className="m-plume-note">
          Each simulated step writes a receipt to this browser's evidence ledger. Re-check a receipt to confirm its SHA-256 still
          matches its payload.
        </p>
        {receipts.length === 0 ? (
          <p className="m-plume-note">No receipts yet. Take a step above.</p>
        ) : (
          <ul className="m-plume-receipts">
            {receipts.map((r) => (
              <li key={r.id}>
                <span className="m-plume-receipt-summary">{r.summary}</span>
                <span className="m-plume-receipt-hash" title={r.sha256}>
                  {r.sha256.slice(0, 16)}…
                </span>
                <button type="button" className="m-plume-reset" onClick={() => void recheck(r)}>
                  Re-check
                </button>
                {r.id in checks ? (
                  <span className={checks[r.id] ? 'm-plume-ok' : 'm-plume-bad'}>
                    {checks[r.id] ? 'matches' : 'changed'}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="m-plume-card m-plume-not-ported" aria-labelledby="m-plume-gaps">
        <h3 id="m-plume-gaps">Not ported</h3>
        <ul>
          <li>The verifier's EIP-712 signature and the RepairEscrow contract. Only the lifecycle rule is modelled.</li>
          <li>Live Carbon Mapper API calls and the PostGIS store. The page uses a 60-record sample, with no network calls.</li>
          <li>Methane impact (avoided CH₄ and CO₂e), the verifier's policy checks and the LLM narrative.</li>
        </ul>
      </section>
    </main>
  );
}
