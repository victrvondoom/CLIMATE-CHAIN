import { useEffect, useRef, useState } from 'react';
import { STAGES, type StageId } from '../data/capabilities';
import { hashValue } from '../core/evidence';
import { EXAMPLE_PAYLOAD, checkPacket, examplePacket } from '../core/packet';
import { MAX_NOTE, decide, queuePacket, readSession, subscribeSession, waitingAt, type SessionItem, type Verdict } from '../core/session';
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

export function SessionDesk({ onOpenModule }: { onOpenModule?: (id: string) => void }) {
  const [items, setItems] = useState<SessionItem[]>(() => readSession());
  const [path, setPath] = useState<Path>({ stage: null, moduleId: null, packetId: null });
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [reviewerNote, setReviewerNote] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  useEffect(() => {
    const sync = () => setItems(readSession());
    const unsubscribe = subscribeSession(sync);
    sync();
    return unsubscribe;
  }, []);

  const refresh = () => setItems(readSession());
  const total = waitingAt(items);
  const moduleName = (id: string | null) => CLIMATE_MODULES.find((item) => item.id === id)?.name ?? id ?? '';
  const modulesIn = (stage: StageId) => CLIMATE_MODULES.filter((item) => item.stages.includes(stage));
  const packetsAt = (stage: StageId, moduleId: string) => items
    .filter((item) => item.packet.stage === stage && item.packet.module === moduleId)
    .sort((a, b) => Number(b.status === 'waiting') - Number(a.status === 'waiting'));
  const current = items.find((item) => item.id === path.packetId) ?? null;

  function navigate(next: Path) {
    if (pending.current) return;
    setPath(next);
    setReviewerNote('');
    setNotice('');
    setErrors([]);
  }

  async function runAction(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setErrors([]);
    setNotice('');
    try {
      await action();
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'The action could not finish. Please retry.']);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function submit() {
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
    } else setErrors(['The packet passed validation, but this browser could not save it. Your input is retained; enable site storage and retry.']);
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
    if (!result.item) setNotice('That packet is no longer in the queue.');
    else if (result.alreadyDecided) setNotice(`This packet was already ${result.item.status}. The latest decision is shown.`);
    else if (!result.sessionSaved) setErrors([result.ledgerSaved
      ? 'The verdict reached the ledger, but the review queue could not save it. The packet is still waiting; enable site storage before retrying.'
      : 'The verdict could not be saved to the queue or ledger. Enable site storage and retry.']);
    else {
      setReviewerNote('');
      if (result.ledgerSaved) setNotice(`Recorded as ${verdict} in the evidence ledger.`);
      else setErrors([`The queue saved ${verdict}, but the evidence ledger could not save its record.`]);
    }
  }

  function nextWaiting() {
    if (!path.stage || !path.moduleId) return;
    const next = packetsAt(path.stage, path.moduleId).find((item) => item.status === 'waiting' && item.id !== path.packetId);
    if (next) navigate({ ...path, packetId: next.id });
    else setNotice('No other packets are waiting for this module and stage.');
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
          <button type="button" onClick={() => navigate({ stage: null, moduleId: null, packetId: null })}>All stages</button>
          {path.stage && <span aria-hidden="true">/</span>}
          {path.stage && (
            <button type="button" onClick={() => navigate({ stage: path.stage, moduleId: null, packetId: null })}>
              {stageOf(path.stage).title}
            </button>
          )}
          {path.moduleId && <span aria-hidden="true">/</span>}
          {path.moduleId && (
            <button type="button" onClick={() => navigate({ stage: path.stage, moduleId: path.moduleId, packetId: null })}>
              {moduleName(path.moduleId)}
            </button>
          )}
          {path.packetId && <span aria-hidden="true">/</span>}
          {path.packetId && <span className="desk-crumb-here">Packet</span>}
        </nav>
      </header>

      <p className="muted" role="status">{items.length} local packet{items.length === 1 ? '' : 's'} · {total} waiting · {items.length - total} reviewed. Updates follow activity in this browser and other tabs.</p>
      {errors.length > 0 && <ul className="intake-errors" role="alert">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
      {notice && <p className="muted" role="status">{notice}</p>}

      {!path.stage && (
        <>
          <div className="desk-stages">
            {STAGES.map((stage) => (
              <button
                key={stage.id}
                type="button"
                className="desk-stage"
                onClick={() => navigate({ stage: stage.id, moduleId: null, packetId: null })}
              >
                <span>{stage.number}</span>
                <strong>{stage.title}</strong>
                <span className="desk-count">{waitingAt(items, stage.id)}</span>
                <span>{modulesIn(stage.id).length} modules</span>
              </button>
            ))}
          </div>

          {onOpenModule && (
            <section className="desk-panel" aria-labelledby="desk-work-title">
              <h3 id="desk-work-title">Create evidence in a module</h3>
              <p className="muted">Run a native workflow, record its result, then queue that result for human review. Outcomes and verdicts stay in this browser.</p>
              <div className="verdict-row">
                {CLIMATE_MODULES.map((item) => <button key={item.id} type="button" onClick={() => onOpenModule(item.id)}>{item.name}</button>)}
              </div>
            </section>
          )}

          <section className="desk-panel intake" aria-labelledby="intake-title">
            <h3 id="intake-title">Agent intake</h3>
            <p className="muted">An agent submits one packet of this shape. Anything else is refused, and every problem is listed.</p>
            <pre className="schema-block">{SCHEMA_TEXT}</pre>
            <textarea
              aria-label="Packet JSON"
              value={text}
              disabled={busy}
              onChange={(event) => setText(event.target.value)}
              placeholder="Paste one packet as JSON"
            />
            <div className="verdict-row">
              <button type="button" className="primary-action" onClick={() => void runAction(submit)} disabled={busy || text.trim().length === 0}>
                {busy ? 'Working…' : 'Queue packet'}
              </button>
              <button type="button" onClick={() => void runAction(loadExample)} disabled={busy}>Load example</button>
            </div>
          </section>
        </>
      )}

      {path.stage && !path.moduleId && (
        <ul className="desk-list">
          {modulesIn(path.stage).map((item) => (
            <li key={item.id}>
              <button type="button" className="desk-row" onClick={() => navigate({ stage: path.stage, moduleId: item.id, packetId: null })}>
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
                <button type="button" className="desk-row" onClick={() => navigate({ ...path, packetId: item.id })}>
                  <strong>{item.packet.claim}</strong>
                  <span>{STATUS_LABEL[item.status]}</span>
                </button>
              </li>
            ))}
          </ul>
          {packetsAt(path.stage, path.moduleId).length === 0 && (
            <p className="muted">No packets for this module in this stage yet. Run the module to create evidence, or submit a checked packet from Agent intake.</p>
          )}
          {onOpenModule && <button type="button" className="primary-action" onClick={() => onOpenModule(path.moduleId!)}>Open {moduleName(path.moduleId)} workflow</button>}
        </>
      )}

      {path.packetId && !current && <p className="muted" role="status">This packet is no longer available in local storage. Return to its module to choose another packet.</p>}

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
                disabled={busy}
                maxLength={MAX_NOTE}
                onChange={(event) => setReviewerNote(event.target.value)}
                placeholder="Reviewer note (optional, 280 characters)"
              />
              <div className="verdict-row">
                <button type="button" className="verdict-accept" disabled={busy} onClick={() => void runAction(() => record('accepted'))}>Accept</button>
                <button type="button" disabled={busy} onClick={() => void runAction(() => record('held'))}>Hold</button>
                <button type="button" disabled={busy} onClick={() => void runAction(() => record('rejected'))}>Reject</button>
                <button type="button" className="text-action" disabled={busy} onClick={nextWaiting}>Next waiting packet</button>
              </div>
            </>
          ) : (
            <><p className="muted">
              Decided {current.decidedAt ? new Date(current.decidedAt).toLocaleString() : ''}
              {current.note ? `. Note: ${current.note}` : ''}
              {current.ledgerSaved === false ? '. The ledger did not save this verdict.' : ''}
            </p><button type="button" className="text-action" disabled={busy} onClick={nextWaiting}>Next waiting packet</button></>
          )}
        </article>
      )}
    </section>
  );
}
