import { useCallback, useEffect, useState } from 'react';
import { fetchEvidenceAnchorStatus, fetchEvidenceAnchors, verifyEvidenceAnchor, type EvidenceAnchorProof, type EvidenceAnchorStatus } from '../api';
import { canonicalJson, readLedger, subscribeLedger, verifyEvidence, type EvidenceRecord } from '../core/evidence';
import { CLIMATE_MODULES } from './index';
import './shell.css';

type CheckState = 'checking' | 'matches' | 'changed' | 'error';
interface CheckResult { state: CheckState; fingerprint: string; error?: string }
const fingerprint = (record: EvidenceRecord) => `${record.sha256}:${canonicalJson(record.payload)}`;

// One ledger for every module. Verify re-hashes a record's payload in this browser.
export function EvidenceLedger({ onOpenModule, onOpenReview }: { onOpenModule?: (id: string) => void; onOpenReview?: () => void }) {
  const [records, setRecords] = useState<EvidenceRecord[]>(() => readLedger());
  const [checks, setChecks] = useState<Record<string, CheckResult>>({});
  const [moduleId, setModuleId] = useState('');
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [chainStatus, setChainStatus] = useState<EvidenceAnchorStatus | null>(null);
  const [chainProofs, setChainProofs] = useState<EvidenceAnchorProof[]>([]);
  const [chainDigest, setChainDigest] = useState('');
  const [chainCheck, setChainCheck] = useState<EvidenceAnchorProof | null>(null);
  const [chainNotice, setChainNotice] = useState('');
  const [chainLoading, setChainLoading] = useState(false);
  const names = new Map(CLIMATE_MODULES.map((item) => [item.id, item.name]));
  const shown = records.filter((record) => (!moduleId || record.moduleId === moduleId)
    && `${record.summary} ${record.kind} ${record.mode} ${names.get(record.moduleId) ?? record.moduleId}`.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    const sync = () => setRecords(readLedger());
    const unsubscribe = subscribeLedger(sync);
    sync();
    return unsubscribe;
  }, []);

  const refreshChain = useCallback(async () => {
    setChainLoading(true);
    setChainNotice('');
    try {
      const [status, response] = await Promise.all([fetchEvidenceAnchorStatus(), fetchEvidenceAnchors()]);
      setChainStatus(status);
      setChainProofs(response.anchors);
    } catch (error) {
      setChainNotice(error instanceof Error ? error.message : 'Local chain records could not be loaded.');
      try { setChainStatus(await fetchEvidenceAnchorStatus()); } catch { setChainStatus(null); }
    } finally {
      setChainLoading(false);
    }
  }, []);

  useEffect(() => { void refreshChain(); }, [refreshChain]);

  async function checkChainDigest(value = chainDigest) {
    setChainCheck(null);
    setChainNotice('');
    try {
      const proof = await verifyEvidenceAnchor(value.trim());
      setChainCheck(proof);
      if (proof.anchored) setChainDigest(proof.digest.replace(/^0x/, ''));
    } catch (error) {
      setChainNotice(error instanceof Error ? error.message : 'The digest could not be checked on-chain.');
    }
  }

  const check = async (record: EvidenceRecord) => {
    const startedWith = fingerprint(record);
    setChecks((current) => ({ ...current, [record.id]: { state: 'checking', fingerprint: startedWith } }));
    try {
      const ok = await verifyEvidence(record);
      setChecks((current) => ({ ...current, [record.id]: { state: ok ? 'matches' : 'changed', fingerprint: startedWith } }));
    } catch (error) {
      setChecks((current) => ({ ...current, [record.id]: { state: 'error', fingerprint: startedWith, error: error instanceof Error ? error.message : 'Digest verification failed. Retry.' } }));
    }
  };

  function download() {
    try {
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), scope: 'browser-local', records: shown }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `climate-chain-evidence-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`Exported ${shown.length} local record${shown.length === 1 ? '' : 's'}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The export could not be created. Retry.');
    }
  }

  return (
    <section className="ledger" aria-labelledby="ledger-title">
      <header className="ledger-head">
        <span className="eyebrow">ONE LEDGER · ALL MODULES</span>
        <h2 id="ledger-title">Evidence ledger</h2>
        <p className="muted">Every outcome a module records lands here with its SHA-256 digest. Verify re-hashes the payload in your browser. Records stay in this browser only and update as modules or other tabs save work.</p>
      </header>
      <section className="chain-ledger" aria-labelledby="chain-ledger-title">
        <div className="chain-ledger-head">
          <div>
            <span className="eyebrow">ON-CHAIN EVIDENCE · LOCAL EVM</span>
            <h3 id="chain-ledger-title">Manifest proof records</h3>
          </div>
          <span className={`chain-state ${chainStatus?.available ? 'chain-state-ready' : 'chain-state-offline'}`} role="status">
            {chainStatus?.available ? `CONNECTED · ${chainStatus.anchorCount ?? 0} anchors` : 'LOCAL CHAIN OFFLINE'}
          </span>
        </div>
        <p className="muted small">Cascade Review can anchor a SHA-256 digest. The contract holds no source text or measurements; compare an exported manifest’s digest with these records to check integrity. A local chain is not a public testnet and resets on restart.</p>
        {chainStatus?.contractAddress && <code className="chain-ledger-contract">Contract {chainStatus.contractAddress} · chain ID {chainStatus.chainId} · deploy block {chainStatus.deployBlock}</code>}
        <div className="chain-verify-row">
          <label htmlFor="chain-digest-input">Check a manifest SHA-256 digest</label>
          <div>
            <input id="chain-digest-input" value={chainDigest} onChange={(event) => setChainDigest(event.target.value)} placeholder="64 hexadecimal characters" spellCheck={false} />
            <button type="button" onClick={() => void checkChainDigest()} disabled={!chainStatus?.available || !chainDigest.trim() || chainLoading}>Verify on chain</button>
            <button type="button" onClick={() => void refreshChain()} disabled={chainLoading}>{chainLoading ? 'Refreshing…' : 'Refresh records'}</button>
          </div>
        </div>
        {chainNotice && <p className="ledger-bad" role="alert">{chainNotice}</p>}
        {chainCheck && <div className={`chain-check-result ${chainCheck.anchored && chainCheck.proofVerified ? 'chain-check-ok' : 'chain-check-missing'}`} role="status">
          <strong>{chainCheck.anchored && chainCheck.proofVerified ? 'Digest matches an on-chain record' : 'No verified on-chain record for this digest'}</strong>
          {chainCheck.transactionHash && <code>{chainCheck.transactionHash}</code>}
          {chainCheck.anchored && <span>Block {chainCheck.blockNumber} · {chainCheck.anchoredAt ? new Date(chainCheck.anchoredAt).toLocaleString() : 'time unavailable'}</span>}
        </div>}
        {chainProofs.length === 0 && !chainLoading && <p className="ledger-empty">{chainStatus?.available ? 'No manifests have been anchored yet. Open Place-based review to create the first proof.' : 'Start the full local launcher to connect the proof chain.'}</p>}
        {chainProofs.length > 0 && <ol className="chain-proof-list">
          {chainProofs.map((proof) => <li key={`${proof.digest}:${proof.transactionHash}`}>
            <div>
              <strong>{proof.proofVerified ? 'Verified on chain' : 'Needs verification'}</strong>
              <span>Block {proof.blockNumber} · {proof.anchoredAt ? new Date(proof.anchoredAt).toLocaleString() : 'time unavailable'}</span>
              <code title={proof.digest}>{proof.digest.replace(/^0x/, '')}</code>
              {proof.transactionHash && <code title={proof.transactionHash}>Tx {proof.transactionHash}</code>}
            </div>
            <button type="button" className="text-action" onClick={() => { setChainDigest(proof.digest.replace(/^0x/, '')); void checkChainDigest(proof.digest); }} disabled={chainLoading}>Verify record</button>
          </li>)}
        </ol>}
      </section>
      <div className="verdict-row">
        <label>Module <select value={moduleId} onChange={(event) => setModuleId(event.target.value)}>
          <option value="">All modules</option>
          <option value="earth">Earth intelligence</option>
          {CLIMATE_MODULES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label>Search records <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Summary, kind or mode" /></label>
        <button type="button" disabled={shown.length === 0} onClick={download}>Export shown records</button>
        {onOpenReview && <button type="button" onClick={onOpenReview}>Open review desk</button>}
      </div>
      <p className="muted" role="status">Showing {shown.length} of {records.length} local records. {notice}</p>
      {records.length === 0 && <div className="ledger-empty"><p>No evidence recorded yet. Open a module and record an outcome check.</p>{onOpenModule && <div className="verdict-row">{CLIMATE_MODULES.map((item) => <button type="button" key={item.id} onClick={() => onOpenModule(item.id)}>{item.name}</button>)}</div>}</div>}
      {records.length > 0 && shown.length === 0 && <p className="ledger-empty">No records match these filters.</p>}
      <ol className="ledger-list">
        {shown.map((record) => {
          const result = checks[record.id];
          const state = result?.fingerprint === fingerprint(record) ? result.state : undefined;
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
              {state === 'matches' && <span className="ledger-ok" role="status">Digest matches the payload</span>}
              {state === 'changed' && <span className="ledger-bad" role="alert">Payload no longer matches its digest</span>}
              {state === 'error' && <span className="ledger-bad" role="alert">{result.error}</span>}
              <details><summary>Inspect evidence payload</summary><pre className="packet-payload">{JSON.stringify(record.payload, null, 2)}</pre></details>
              {onOpenModule && <button type="button" className="text-action" onClick={() => onOpenModule(record.moduleId)}>Open module workflow</button>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
