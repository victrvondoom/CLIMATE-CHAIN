import { useEffect, useMemo, useState } from 'react';
import { fetchEvidenceAnchors, type EvidenceAnchorProof } from '../../api';
import { readLedger, subscribeLedger, type EvidenceRecord } from '../../core/evidence';
import { ThreeCanvas, ledgerSetup, type LedgerBlock } from './three-scenes';
import './lab.css';

const norm = (hash: string) => hash.toLowerCase().replace(/^0x/, '');

/** The evidence ledger as a 3D chain. Gold blocks are anchored on the local EVM; stone blocks are hashed locally only. */
export function LedgerChain3D() {
  const [records, setRecords] = useState<EvidenceRecord[]>(() => readLedger());
  const [proofs, setProofs] = useState<EvidenceAnchorProof[]>([]);
  const [proofNote, setProofNote] = useState('');
  const [selected, setSelected] = useState<LedgerBlock | null>(null);

  useEffect(() => {
    const sync = () => setRecords(readLedger());
    sync();
    return subscribeLedger(sync);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetchEvidenceAnchors(controller.signal)
      .then((r) => { setProofs(r.anchors); setProofNote(''); })
      .catch(() => { if (!controller.signal.aborted) setProofNote('Chain anchors could not be read; every block is shown as locally hashed only.'); });
    return () => controller.abort();
  }, []);

  const blocks = useMemo<LedgerBlock[]>(() => {
    const anchored = new Map(proofs.filter((p) => p.anchored).map((p) => [norm(p.digest), p]));
    return records.slice(0, 40).reverse().map((r) => {
      const proof = anchored.get(norm(r.sha256));
      return { id: r.id, label: r.kind, hash: r.sha256, anchored: Boolean(proof), blockNumber: proof?.blockNumber, summary: r.summary, at: r.createdAt };
    });
  }, [records, proofs]);
  const setup = useMemo(() => ledgerSetup(blocks), [blocks]);
  const anchoredCount = blocks.filter((b) => b.anchored).length;

  return (
    <div className="lab-ledger">
      <ThreeCanvas setup={setup} label={`3D evidence chain with ${blocks.length} blocks, ${anchoredCount} anchored on the local chain`} height={380} distance={9} onPick={(v) => setSelected(v && typeof v === 'object' && 'hash' in v ? (v as LedgerBlock) : null)} />
      <p className="lab-caption">Order is creation time (oldest at the bottom). <strong>Gold</strong> = anchored on the local Hardhat EVM; <strong>stone</strong> = SHA-256 recorded in this browser only. Drag to orbit, scroll to zoom, click a block.</p>
      {proofNote ? <p className="lab-note" role="status">{proofNote}</p> : null}
      <p className="lab-stat" aria-live="polite">{blocks.length} records · {anchoredCount} anchored</p>
      {selected && selected.hash ? (
        <dl className="lab-block-detail">
          <dt>Record</dt><dd>{selected.label} — {selected.summary}</dd>
          <dt>SHA-256</dt><dd className="lab-mono">{selected.hash}</dd>
          <dt>Status</dt><dd>{selected.anchored ? `Anchored in block #${selected.blockNumber ?? '?'}` : 'Hashed locally, not anchored'}</dd>
          <dt>Created</dt><dd>{selected.at}</dd>
        </dl>
      ) : null}
      {blocks.length ? (
        <details className="lab-text-alt"><summary>Text list of blocks</summary>
          <ol>{blocks.slice().reverse().map((b) => <li key={b.id}><button type="button" className="lab-chip" onClick={() => setSelected(b)}><span className="lab-mono">{b.hash.slice(0, 12)}…</span> {b.label} · {b.anchored ? `anchored #${b.blockNumber ?? '?'}` : 'local'}</button></li>)}</ol>
        </details>
      ) : <p className="lab-note">No evidence yet. Seal a scenario below, or run any module, and its block appears here.</p>}
    </div>
  );
}
