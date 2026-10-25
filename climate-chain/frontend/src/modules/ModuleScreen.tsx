import { useEffect, useRef, useState } from 'react';
import type { ClimateModule } from '../core/module';
import { readLedger, subscribeLedger, type EvidenceRecord } from '../core/evidence';
import { MAX_CLAIM, PACKET_SCHEMA, checkPacket } from '../core/packet';
import { queuePacket, readSession, subscribeSession, type SessionItem } from '../core/session';
import { STAGES } from '../data/capabilities';
import { WorkspaceErrorBoundary } from '../components/WorkspaceErrorBoundary';
import { CLIMATE_MODULES } from './index';
import './shell.css';

export function findModule(id: string): ClimateModule | undefined {
  return CLIMATE_MODULES.find((item) => item.id === id);
}

// One frame for every native module: stages, evidence mode, features, then the module's own page.
export function ModuleScreen({ climateModule, onOpenReview, onOpenLedger }: { climateModule: ClimateModule; onOpenReview?: () => void; onOpenLedger?: () => void }) {
  const { Page } = climateModule;
  const stageTitles = climateModule.stages.map((id) => STAGES.find((stage) => stage.id === id)?.title ?? id);
  return (
    <section className={`module-screen tone-${climateModule.tone}`} aria-labelledby={`module-${climateModule.id}-title`}>
      <header className="module-head">
        <span className="eyebrow">{stageTitles.join(' · ').toUpperCase()}</span>
        <h2 id={`module-${climateModule.id}-title`}>{climateModule.name}</h2>
        <p className="module-tagline">{climateModule.tagline}</p>
        <div className="module-meta">
          <span className={`mode-pill mode-${climateModule.mode.toLowerCase()}`}>{climateModule.mode}</span>
          <span className="muted small">{climateModule.source.folder ? 'Re-implemented in-app from the original project' : 'Climate Chain core'}</span>
        </div>
      </header>
      <ul className="module-features" aria-label={`${climateModule.name} features`}>
        {climateModule.features.map((feature) => <li key={feature}>{feature}</li>)}
      </ul>
      <WorkspaceErrorBoundary key={`${climateModule.id}:page`} label={climateModule.name}>
        <div className="module-body">
          <Page />
        </div>
      </WorkspaceErrorBoundary>
      <ModuleEvidence key={`${climateModule.id}:evidence`} climateModule={climateModule} onOpenReview={onOpenReview} onOpenLedger={onOpenLedger} />
    </section>
  );
}

const packetClaim = (record: EvidenceRecord) => Array.from(record.summary, (character) => {
  const code = character.codePointAt(0)!;
  return code < 32 || code === 127 ? ' ' : character;
}).join('').trim().slice(0, MAX_CLAIM);

function ModuleEvidence({ climateModule, onOpenReview, onOpenLedger }: { climateModule: ClimateModule; onOpenReview?: () => void; onOpenLedger?: () => void }) {
  const [records, setRecords] = useState<EvidenceRecord[]>(() => readLedger());
  const [items, setItems] = useState<SessionItem[]>(() => readSession());
  const [stage, setStage] = useState(climateModule.stages[0]);
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const pending = useRef(false);
  const outcomes = records.filter((record) => record.moduleId === climateModule.id && record.kind !== 'verdict');

  useEffect(() => {
    const syncLedger = () => setRecords(readLedger());
    const syncSession = () => setItems(readSession());
    const stopLedger = subscribeLedger(syncLedger);
    const stopSession = subscribeSession(syncSession);
    syncLedger();
    syncSession();
    return () => { stopLedger(); stopSession(); };
  }, []);

  async function queue(record: EvidenceRecord) {
    if (pending.current) return;
    pending.current = true;
    setSaving(record.id);
    setNotice('');
    setError('');
    try {
      const result = await checkPacket({
        schema: PACKET_SCHEMA,
        module: climateModule.id,
        stage,
        claim: packetClaim(record),
        mode: record.mode,
        evidence: { kind: record.kind, payload: record.payload, sha256: record.sha256 },
      }, CLIMATE_MODULES);
      if (!result.ok) {
        setError(result.errors.join('. '));
        return;
      }
      const queued = await queuePacket(result.packet);
      if (!queued.saved) setError('The evidence passed validation, but this browser could not save the review packet. Enable site storage and retry.');
      else setNotice(queued.duplicate ? `This result is already ${queued.item.status} in the review desk.` : 'Evidence checked and queued for human review. Open the review desk to decide.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The result could not be queued. Retry.');
    } finally {
      pending.current = false;
      setSaving(null);
    }
  }

  return (
    <section className="desk-panel" aria-labelledby="module-outcomes-title">
      <h3 id="module-outcomes-title">Recorded outcomes · {outcomes.length}</h3>
      <p className="muted">Results recorded by this module appear here immediately. Queue a result to request a human verdict. Evidence and decisions stay in this browser.</p>
      <div className="verdict-row">
        <label>Review stage <select value={stage} disabled={saving !== null} onChange={(event) => setStage(event.target.value as typeof stage)}>
          {climateModule.stages.map((id) => <option key={id} value={id}>{STAGES.find((item) => item.id === id)?.title ?? id}</option>)}
        </select></label>
        {onOpenReview && <button type="button" onClick={onOpenReview}>Open review desk</button>}
        {onOpenLedger && <button type="button" onClick={onOpenLedger}>Open evidence ledger</button>}
      </div>
      {outcomes.length === 0 && <p className="muted">No result recorded yet. Use the workflow above to run a check and record its evidence.</p>}
      {notice && <p className="muted" role="status">{notice}</p>}
      {error && <p className="ledger-bad" role="alert">{error}</p>}
      <ol className="ledger-list">
        {outcomes.slice(0, 8).map((record) => {
          const queued = items.find((item) => item.packet.module === climateModule.id && item.packet.stage === stage
            && item.packet.evidence.sha256 === record.sha256 && item.packet.evidence.kind === record.kind
            && item.packet.claim === packetClaim(record) && item.packet.mode === record.mode);
          return <li className="ledger-item" key={record.id}>
            <div className="ledger-meta"><strong>{record.kind}</strong><span className={`mode-pill mode-${record.mode.toLowerCase()}`}>{record.mode}</span><span className="muted small">{new Date(record.createdAt).toLocaleString()}</span></div>
            <p>{record.summary}</p>
            <details><summary>Inspect result</summary><pre className="packet-payload">{JSON.stringify(record.payload, null, 2)}</pre></details>
            {record.mode === 'LIVE' ? <p className="muted">This intake accepts SIMULATED, RESEARCH or DEMO packets. LIVE evidence retains its original mode in the ledger.</p>
              : <button type="button" disabled={saving !== null || !!queued} onClick={() => void queue(record)}>{saving === record.id ? 'Checking evidence…' : queued ? `Review status: ${queued.status}` : 'Queue result for review'}</button>}
          </li>;
        })}
      </ol>
      {outcomes.length > 8 && <p className="muted">Showing the 8 most recent outcomes. The evidence ledger includes all recorded outcomes.</p>}
    </section>
  );
}
