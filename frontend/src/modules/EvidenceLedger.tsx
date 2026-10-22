import { useState } from 'react';
import { readLedger, verifyEvidence, type EvidenceRecord } from '../core/evidence';
import { CLIMATE_MODULES } from './index';
import './shell.css';

type CheckState = 'checking' | 'matches' | 'changed';

// One ledger for every module. Verify re-hashes a record's payload in this browser.
export function EvidenceLedger() {
  const [records] = useState<EvidenceRecord[]>(() => readLedger());
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const names = new Map(CLIMATE_MODULES.map((item) => [item.id, item.name]));

  const check = async (record: EvidenceRecord) => {
    setChecks((current) => ({ ...current, [record.id]: 'checking' }));
    const ok = await verifyEvidence(record);
    setChecks((current) => ({ ...current, [record.id]: ok ? 'matches' : 'changed' }));
  };

  return (
    <section className="ledger" aria-labelledby="ledger-title">
      <header className="ledger-head">
        <span className="eyebrow">ONE LEDGER · ALL MODULES</span>
        <h2 id="ledger-title">Evidence ledger</h2>
        <p className="muted">Every outcome a module records lands here with its SHA-256 digest. Verify re-hashes the payload in your browser. Records stay in this browser only.</p>
      </header>
      {records.length === 0 && <p className="ledger-empty">No evidence recorded yet. A module adds a record when it runs an outcome check.</p>}
      <ol className="ledger-list">
        {records.map((record) => {
          const state = checks[record.id];
          return (
            <li key={record.id} className="ledger-item">
              <div className="ledger-meta">
                <span className={`mode-pill mode-${record.mode.toLowerCase()}`}>{record.mode}</span>
                <strong>{names.get(record.moduleId) ?? record.moduleId}</strong>
                <span className="muted small">{record.kind} · {new Date(record.createdAt).toLocaleString()}</span>
              </div>
              <p>{record.summary}</p>
              <code className="ledger-digest" title={record.sha256}>{record.sha256.slice(0, 16)}…</code>
              <button type="button" className="text-action" onClick={() => void check(record)} disabled={state === 'checking'}>
                {state === 'checking' ? 'Re-hashing…' : 'Verify digest'}
              </button>
              {state === 'matches' && <span className="ledger-ok">Digest matches the payload</span>}
              {state === 'changed' && <span className="ledger-bad">Payload no longer matches its digest</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
