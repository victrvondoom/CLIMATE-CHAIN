import { useEffect, useMemo, useState } from 'react';
import type { ClimateModule } from '../../core/module';
import { appendLedger, createEvidence, readLedger, verifyEvidence, type EvidenceRecord } from '../../core/evidence';
import { Card, Stat } from '../../components/Ui';
import ledgerJson from './fixtures/ledger-demo.json';
import { scanLedger, type Case, type Ledger } from './domain/detect';
import { plantedCheck } from './domain/evaluate';
import { decide, markReviewed, openBook, type DecisionAction, type DecisionBook } from './domain/freeze';
import './module.css';

const MODULE_ID = 'ecograph';
const ledger = ledgerJson as Ledger;

function EcographPage() {
  const base = useMemo(() => scanLedger(ledger), []);
  const planted = useMemo(() => plantedCheck(ledger, base.findings), [base]);
  const [book, setBook] = useState<DecisionBook>(() => openBook(base.cases));
  const cases = useMemo(() => scanLedger(ledger, new Set(book.frozen)).cases, [book.frozen]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [evidence, setEvidence] = useState<EvidenceRecord[]>(() =>
    readLedger().filter((r) => r.moduleId === MODULE_ID),
  );
  const [hashOk, setHashOk] = useState<Record<string, boolean>>({});
  const [ledgerNote, setLedgerNote] = useState('');

  useEffect(() => {
    let alive = true;
    Promise.all(evidence.map(async (r) => [r.id, await verifyEvidence(r)] as const))
      .then((pairs) => {
        if (alive) setHashOk(Object.fromEntries(pairs));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [evidence]);

  const failWith = (caseId: string, error: unknown) =>
    setErrors((e) => ({ ...e, [caseId]: error instanceof Error ? error.message : 'That step could not be saved.' }));

  const clearError = (caseId: string) =>
    setErrors((e) => {
      const { [caseId]: _cleared, ...rest } = e;
      return rest;
    });

  function review(c: Case) {
    try {
      setBook(markReviewed(book, c.id, notes[c.id] ?? ''));
      clearError(c.id);
    } catch (error) {
      failWith(c.id, error);
    }
  }

  async function finish(c: Case, action: DecisionAction) {
    try {
      const at = new Date().toISOString();
      const { book: next, entry } = decide(book, c.id, action, at);
      setBook(next);
      clearError(c.id);
      try {
        const record = await createEvidence({
          moduleId: MODULE_ID,
          kind: 'freeze-decision',
          mode: 'SIMULATED',
          summary: `${action === 'freeze' ? 'Frozen' : 'Dismissed'} ${c.id}: ${entry.creditsFrozen} credit(s) frozen by a human reviewer`,
          payload: {
            case: c.id,
            title: c.title,
            score: c.score,
            band: c.band,
            suggested: entry.suggested,
            action,
            reviewer: entry.reviewer,
            note: entry.note,
            creditsFrozen: entry.creditsFrozen,
            atRiskIds: c.atRiskIds,
            findings: c.findings.map((f) => f.id),
            at,
          },
        });
        appendLedger(record);
        setEvidence((prev) => [record, ...prev]);
        setLedgerNote('');
      } catch {
        setLedgerNote('The decision is saved on this page. This browser could not compute the evidence hash.');
      }
    } catch (error) {
      failWith(c.id, error);
    }
  }

  const freezeBand = cases.filter((c) => c.band === 'freeze').length;

  return (
    <div className="m-ecograph-root">
      <Card className="m-ecograph-head">
        <div className="m-ecograph-title-row">
          <h2>EcoGraph</h2>
          <span className="m-ecograph-mode">SIMULATED</span>
          <span className="m-ecograph-chip">DEMO ledger, seed {ledger.seed}</span>
        </div>
        <p>
          Rules from eco/detect.py run over a synthetic carbon ledger. Nothing here is read live. A person must review
          each case before anything is frozen.
        </p>
        <p className="m-ecograph-note">{ledger.note}</p>
      </Card>

      <div className="m-ecograph-stats">
        <Stat label="Findings" value={base.findingCount} hint="four rules" />
        <Stat label="Cases" value={cases.length} hint={`${freezeBand} in the freeze band`} />
        <Stat label="Frozen credits" value={book.frozen.length} hint="by human decision only" />
        <Stat
          label="Planted cases found"
          value={`${planted.truePositives}/${planted.planted}`}
          hint={`${planted.falsePositives.length} false alarms`}
        />
      </div>

      <Card>
        <h3>Planted-case check</h3>
        <p className="m-ecograph-meta">
          Missed: {planted.missed.length ? planted.missed.join(', ') : 'none'}. False alarms:{' '}
          {planted.falsePositives.length ? planted.falsePositives.join(', ') : 'none'}.
        </p>
        <p>Decoys the rules must not flag:</p>
        <ul className="m-ecograph-list">
          {planted.decoys.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      </Card>

      <section className="m-ecograph-cases" aria-label="Cases">
        {cases.map((c) => {
          const status = book.records[c.id].status;
          return (
            <Card key={c.id} className="m-ecograph-case">
              <div className="m-ecograph-case-head">
                <h3>{c.title}</h3>
                <span className={`m-ecograph-band m-ecograph-band-${c.band}`}>{c.band}</span>
                <span className="m-ecograph-state">{status}</span>
              </div>
              <p className="m-ecograph-meta">
                {c.id} · score {c.score.toFixed(3)} · suggested {c.suggested} · {c.projects.join(', ')}
              </p>
              <p>{c.summary}</p>
              <ul className="m-ecograph-signals">
                {c.signals.map((s) => (
                  <li key={`${s.signal}-${s.finding ?? 'audit'}`}>
                    <strong>{s.signal}</strong> <span className="m-ecograph-weight">{s.weight.toFixed(2)}</span>{' '}
                    <span>{s.why}</span>
                  </li>
                ))}
              </ul>
              <p className="m-ecograph-meta">
                {c.creditsAtRisk} credit(s), {c.tonnesAtRisk} t at risk · {c.creditsFrozen} already frozen
              </p>

              {status === 'proposed' ? (
                <div className="m-ecograph-actions">
                  <label className="m-ecograph-field">
                    Reviewer note (12 characters or more)
                    <textarea
                      rows={2}
                      value={notes[c.id] ?? ''}
                      onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))}
                    />
                  </label>
                  <button type="button" onClick={() => review(c)}>
                    Mark reviewed
                  </button>
                </div>
              ) : null}

              {status === 'reviewed' ? (
                <div className="m-ecograph-actions">
                  <button type="button" onClick={() => void finish(c, 'freeze')}>
                    Freeze {c.creditsAtRisk} credit(s)
                  </button>
                  <button type="button" onClick={() => void finish(c, 'dismiss')}>
                    Dismiss
                  </button>
                </div>
              ) : null}

              {status === 'frozen' || status === 'dismissed' ? (
                <p className="m-ecograph-meta">
                  Final: {status}. Reviewer note: {book.records[c.id].reviewNote}
                </p>
              ) : null}

              {errors[c.id] ? (
                <p role="alert" className="m-ecograph-error">
                  {errors[c.id]}
                </p>
              ) : null}
            </Card>
          );
        })}
      </section>

      <Card>
        <h3>Decision evidence</h3>
        {evidence.length === 0 ? (
          <p className="m-ecograph-meta">No decisions recorded yet in this browser.</p>
        ) : (
          <ol className="m-ecograph-log">
            {evidence.slice(0, 8).map((r) => (
              <li key={r.id}>
                <span>{r.summary}</span> <code>{r.sha256.slice(0, 12)}</code>{' '}
                <span className="m-ecograph-meta">
                  {hashOk[r.id] === undefined ? 'checking' : hashOk[r.id] ? 'hash ok' : 'hash mismatch'}
                </span>
              </li>
            ))}
          </ol>
        )}
        {ledgerNote ? <p className="m-ecograph-meta">{ledgerNote}</p> : null}
      </Card>

      <Card>
        <h3>Not ported</h3>
        <ul className="m-ecograph-list">
          <li>The 11 MCP tools and the agent loop (out of scope in the registry).</li>
          <li>FalkorDB Cypher, the betweenness ranking and the WCC call. Clustering is a union-find here.</li>
          <li>The upstream credit trace, the geohash land map and the Flutter app.</li>
          <li>"refer" is a band suggestion only. A reviewer can freeze or dismiss, as the spec's state machine allows.</li>
          <li>Case ids use FNV-1a instead of MD5 because WebCrypto has no MD5, so ids differ from the source.</li>
        </ul>
      </Card>
    </div>
  );
}

const climateModule: ClimateModule = {
  id: 'ecograph',
  name: 'EcoGraph',
  tagline:
    'Finds double retirements and trading loops in a carbon ledger, then waits for a person to freeze or dismiss each case.',
  stages: ['verify', 'prove'],
  tone: 'carbon',
  mode: 'SIMULATED',
  features: [
    'Double-retirement check: one credit retired by two buyers',
    'Trading-loop check: a credit sold around a circle back to an earlier holder',
    'Overlap and registry-duplicate checks on shared land',
    'Noisy-OR case score with freeze, review and watch bands and a reason per signal',
    'Planted-case check against the fixture truth: 7 of 7 found, 0 false alarms',
    'Human-reviewed freeze: proposed, reviewed, then frozen or dismissed, each decision hashed into the evidence ledger',
  ],
  source: {
    folder: 'ecograph-main',
    files: ['eco/detect.py', 'eco/evaluate.py', 'eco/graph.py', 'tests/test_detection.py'],
  },
  Page: EcographPage,
};

export default climateModule;
