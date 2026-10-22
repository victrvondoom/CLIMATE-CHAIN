import { useState } from 'react';
import { STAGES, type StageId } from '../data/capabilities';
import { hashValue } from '../core/evidence';
import { EXAMPLE_PAYLOAD, checkPacket, examplePacket } from '../core/packet';
import { decide, queuePacket, readSession, waitingAt, type SessionItem, type Verdict } from '../core/session';
import { CLIMATE_MODULES } from './index';

// The review desk. One path, four levels: stage, then module, then packet, then verdict.
// Each level shows only the choices that are valid at that depth.

const SCHEMA_TEXT = `{
  "schema": "climate-chain.packet/1",
  "module": "<module id>",
  "stage": "sense | verify | act | finance | prove",
  "claim": "one sentence, 280 characters at most",
  "mode": "SIMULATED | RESEARCH | DEMO",
  "evidence": {
    "kind": "lowercase-kind",
    "payload": { },
    "sha256": "<sha256 of the canonical payload>"
  }
}`;

interface Path {
  stage: StageId | null;
  moduleId: string | null;
  packetId: string | null;
}

const STATUS_LABEL: Record<SessionItem['status'], string> = {
  waiting: 'waiting',
  accepted: 'accepted',
  held: 'held',
  rejected: 'rejected',
};

const stageOf = (id: StageId) => STAGES.find((stage) => stage.id === id)!;

export function SessionDesk() {
  const [items, setItems] = useState<SessionItem[]>(() => readSession());
  const [path, setPath] = useState<Path>({ stage: null, moduleId: null, packetId: null });
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [reviewerNote, setReviewerNote] = useState('');

  const refresh = () => setItems(readSession());
  const total = waitingAt(items);
  const moduleName = (id: string | null) => CLIMATE_MODULES.find((item) => item.id === id)?.name ?? id ?? '';
  const modulesIn = (stage: StageId) => CLIMATE_MODULES.filter((item) => item.stages.includes(stage));
  const packetsAt = (stage: StageId, moduleId: string) => items
    .filter((item) => item.packet.stage === stage && item.packet.module === moduleId)
    .sort((a, b) => Number(b.status === 'waiting') - Number(a.status === 'waiting'));
  const current = items.find((item) => item.id === path.packetId) ?? null;

  async function submit() {
    setErrors([]);
    setNotice('');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      setErrors([`Not valid JSON: ${error instanceof Error ? error.message : 'unknown error'}`]);
      return;
    }
    const result = await checkPacket(parsed, CLIMATE_MODULES);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    const queued = await queuePacket(result.packet);
    refresh();
    if (queued.duplicate) setNotice('That packet is already in the queue.');
    else if (queued.saved) {
      setNotice('Queued for review.');
      setText('');
    } else setNotice('Checked, but this browser would not save it.');
  }

  async function loadExample() {
    const sha = await hashValue(EXAMPLE_PAYLOAD);
    setText(JSON.stringify(examplePacket(sha), null, 2));
    setErrors([]);
    setNotice('Example loaded. Queue it to see it in the desk.');
  }

  async function record(verdict: Verdict) {
    if (!current) return;
    const result = await decide(current.id, verdict, reviewerNote);
    refresh();
    setReviewerNote('');
    if (!result.item) setNotice('That packet is no longer in the queue.');
    else if (result.ledgerSaved) setNotice(`Recorded as ${verdict} in the evidence ledger.`);
    else setNotice(`Recorded as ${verdict}, but the ledger could not save it.`);
  }

  function nextWaiting() {
    if (!path.stage || !path.moduleId) return;
    const next = packetsAt(path.stage, path.moduleId).find((item) => item.status === 'waiting');
    setPath({ ...path, packetId: next?.id ?? null });
    setNotice('');
  }

  const title = path.packetId ? 'Verdict' : path.moduleId ? moduleName(path.moduleId) : path.stage ? stageOf(path.stage).title : 'Review desk';
  const subtitle = path.packetId
    ? 'Read the claim and its evidence, then decide.'
    : path.moduleId
      ? 'Choose a packet to review.'
      : path.stage
        ? `Choose a module for ${stageOf(path.stage).title.toLowerCase()}.`
        : `${total} packet${total === 1 ? '' : 's'} waiting. Start with a stage.`;

  return (
    <section className="desk" aria-labelledby="desk-title">
      <header className="desk-head">
        <div>
          <span className="eyebrow">Review desk</span>
          <h2 id="desk-title">{title}</h2>
          <p className="muted">{subtitle}</p>
        </div>
        <nav className="desk-crumbs" aria-label="Path">
          <button type="button" onClick={() => setPath({ stage: null, moduleId: null, packetId: null })}>All stages</button>
          {path.stage && <span aria-hidden="true">/</span>}
          {path.stage && (
            <button type="button" onClick={() => setPath({ stage: path.stage, moduleId: null, packetId: null })}>
              {stageOf(path.stage).title}
            </button>
          )}
          {path.moduleId && <span aria-hidden="true">/</span>}
          {path.moduleId && (
            <button type="button" onClick={() => setPath({ stage: path.stage, moduleId: path.moduleId, packetId: null })}>
              {moduleName(path.moduleId)}
            </button>
          )}
          {path.packetId && <span aria-hidden="true">/</span>}
          {path.packetId && <span className="desk-crumb-here">Packet</span>}
        </nav>
      </header>

      {!path.stage && (
        <>
          <div className="desk-stages">
            {STAGES.map((stage) => (
              <button
                key={stage.id}
                type="button"
                className="desk-stage"
                onClick={() => setPath({ stage: stage.id, moduleId: null, packetId: null })}
              >
                <span>{stage.number}</span>
                <strong>{stage.title}</strong>
                <span className="desk-count">{waitingAt(items, stage.id)}</span>
                <span>{modulesIn(stage.id).length} modules</span>
              </button>
            ))}
          </div>

          <section className="desk-panel intake" aria-labelledby="intake-title">
            <h3 id="intake-title">Agent intake</h3>
            <p className="muted">An agent submits one packet of this shape. Anything else is refused, and every problem is listed.</p>
            <pre className="schema-block">{SCHEMA_TEXT}</pre>
            <textarea
              aria-label="Packet JSON"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Paste one packet as JSON"
            />
            <div className="verdict-row">
              <button type="button" className="primary-action" onClick={() => void submit()} disabled={text.trim().length === 0}>
                Queue packet
              </button>
              <button type="button" onClick={() => void loadExample()}>Load example</button>
            </div>
            {errors.length > 0 && (
              <ul className="intake-errors" role="alert">
                {errors.map((error) => <li key={error}>{error}</li>)}
              </ul>
            )}
            {notice && <p className="muted" role="status">{notice}</p>}
          </section>
        </>
      )}

      {path.stage && !path.moduleId && (
        <ul className="desk-list">
          {modulesIn(path.stage).map((item) => (
            <li key={item.id}>
              <button type="button" className="desk-row" onClick={() => setPath({ stage: path.stage, moduleId: item.id, packetId: null })}>
                <strong>{item.name}</strong>
                <span>{waitingAt(items, path.stage!, item.id)} waiting · {item.mode}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {path.stage && path.moduleId && !path.packetId && (
        <>
          <ul className="desk-list">
            {packetsAt(path.stage, path.moduleId).map((item) => (
              <li key={item.id}>
                <button type="button" className="desk-row" onClick={() => setPath({ ...path, packetId: item.id })}>
                  <strong>{item.packet.claim}</strong>
                  <span>{STATUS_LABEL[item.status]}</span>
                </button>
              </li>
            ))}
          </ul>
          {packetsAt(path.stage, path.moduleId).length === 0 && (
            <p className="muted">No packets for this module in this stage yet. Agents queue them from the intake on the first screen.</p>
          )}
        </>
      )}

      {current && (
        <article className="packet-card" aria-label="Packet to review">
          <span className="eyebrow">
            {moduleName(current.packet.module)} · {stageOf(current.packet.stage).title} · {current.packet.mode}
          </span>
          <h2 className="packet-claim">{current.packet.claim}</h2>
          <div className="packet-meta">
            <span>{current.packet.evidence.kind}</span>
            <code className="packet-hash" title={current.packet.evidence.sha256}>{current.packet.evidence.sha256.slice(0, 16)}…</code>
            <span>queued {new Date(current.queuedAt).toLocaleString()}</span>
            <span>status: {STATUS_LABEL[current.status]}</span>
          </div>
          <pre className="packet-payload">{JSON.stringify(current.packet.evidence.payload, null, 2)}</pre>
          {current.status === 'waiting' ? (
            <>
              <textarea
                aria-label="Reviewer note"
                value={reviewerNote}
                onChange={(event) => setReviewerNote(event.target.value)}
                placeholder="Reviewer note (optional, 280 characters)"
              />
              <div className="verdict-row">
                <button type="button" className="verdict-accept" onClick={() => void record('accepted')}>Accept</button>
                <button type="button" onClick={() => void record('held')}>Hold</button>
                <button type="button" onClick={() => void record('rejected')}>Reject</button>
                <button type="button" className="text-action" onClick={nextWaiting}>Next waiting packet</button>
              </div>
            </>
          ) : (
            <p className="muted">
              Decided {current.decidedAt ? new Date(current.decidedAt).toLocaleString() : ''}
              {current.note ? `. Note: ${current.note}` : ''}
              {current.ledgerSaved === false ? '. The ledger did not save this verdict.' : ''}
            </p>
          )}
          {notice && <p className="muted" role="status">{notice}</p>}
        </article>
      )}
    </section>
  );
}
