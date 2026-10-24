import { useMemo, useState } from 'react';
import type { ClimateModule } from '../../core/module';
import { Card, Stat } from '../../components/Ui';
import { joinVerdicts } from './domain/candidates';
import { buildMerkle, leafOf, rootFromProof, type FindingInput } from './domain/merkle';
import { screenScore } from './domain/screen';
import { appendLedger, createEvidence } from '../../core/evidence';
import candidatesFixture from './fixtures/candidates.json';
import verdictsFixture from './fixtures/verdicts.json';
import './module.css';

const short = (hex: string) => `${hex.slice(0, 10)}…${hex.slice(-6)}`;
const count = (n: number) => n.toLocaleString('en-US');

function CarbonTwinPage() {
  const [search, setSearch] = useState('');
  const [verdict, setVerdict] = useState('all');
  const [minScore, setMinScore] = useState(0);
  const [notice, setNotice] = useState('');
  const [recording, setRecording] = useState(false);
  const joined = useMemo(() => joinVerdicts(candidatesFixture.candidates, verdictsFixture.verdicts), []);
  const yesRows = useMemo(() => joined.filter((j) => j.verdict === 'yes'), [joined]);
  const noCount = joined.filter((j) => j.verdict === 'no').length;
  const withOverlap = joined.filter((j) => j.candidate.overlap_vintages.length > 0).length;
  const overlapVolume = yesRows.reduce((sum, j) => sum + Math.trunc(j.candidate.overlap_volume), 0);

  const findings: FindingInput[] = useMemo(
    () =>
      yesRows.map(({ candidate: c }) => ({
        id: `${c.a}~${c.b}`,
        a: c.a,
        b: c.b,
        overlap_vintages: c.overlap_vintages,
        overlap_volume: c.overlap_volume,
        verdict: 'yes',
      })),
    [yesRows],
  );
  const leaves = useMemo(() => findings.map(leafOf), [findings]);
  const tree = useMemo(() => (leaves.length ? buildMerkle(leaves) : null), [leaves]);
  const [picked, setPicked] = useState(0);
  const proof = tree ? tree.proof(picked) : [];
  const folds = tree ? rootFromProof(leaves[picked], proof) === tree.root : false;

  const topRows = useMemo(
    () =>
      [...joined]
        .sort((x, y) => y.candidate.screen_score - x.candidate.screen_score || y.candidate.overlap_volume - x.candidate.overlap_volume)
        .filter((row) => (verdict === 'all' || row.verdict === verdict) && row.candidate.screen_score >= minScore && JSON.stringify(row.candidate).toLowerCase().includes(search.toLowerCase())),
    [joined, verdict, minScore, search],
  );

  async function recordProof() {
    if (!tree || !findings[picked]) return;
    setRecording(true);
    try {
      const record = await createEvidence({ moduleId: 'carbontwin', kind: 'merkle-proof', mode: 'RESEARCH', summary: `${findings[picked].id}: inclusion proof ${folds ? 'matches' : 'differs from'} the local slice root`, payload: { finding: findings[picked], leaf: leaves[picked], proof, root: tree.root, verified: folds, source: 'bundled research candidates and recorded verdicts', externalAnchorVerified: false } });
      setNotice(appendLedger(record) ? `Proof saved to the evidence ledger: ${record.sha256.slice(0, 12)}.` : 'Proof checked; browser storage could not save it.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not save the proof.'); }
    finally { setRecording(false); }
  }

  return (
    <div className="m-carbontwin-page">
      <header className="m-carbontwin-head">
        <div>
          <p className="m-carbontwin-kicker">Carbon integrity · Verify, finance, prove</p>
          <h2>CarbonTwin</h2>
          <p>
            Cross-registry double-issuance screening. Name matching is ported and checked against the pipeline output.
            The verdicts are the local model's recorded answers.
          </p>
        </div>
        <span className="m-carbontwin-mode" title="Measured results copied from the project's own outputs">
          RESEARCH
        </span>
      </header>

      <div className="m-carbontwin-stats">
        <Card>
          <Stat label="Candidate pairs" value={count(joined.length)} hint="Slice of the 1,989 screened" />
        </Card>
        <Card>
          <Stat label="Recorded same asset" value={count(yesRows.length)} hint={`${count(noCount)} recorded no`} />
        </Card>
        <Card>
          <Stat label="Pairs with vintage overlap" value={count(withOverlap)} />
        </Card>
        <Card>
          <Stat label="Overlap volume (same-asset pairs)" value={count(overlapVolume)} unit="credits" />
        </Card>
      </div>

      <Card>
        <h3>Candidate matching (TF-IDF name screen)</h3>
        <p className="m-carbontwin-note">
          name_sim is the TF-IDF cosine that pipeline/screen.py computes over each country's project names. The
          screen_score is recomputed here from the stored parts. Showing {count(topRows.length)} of {count(joined.length)} pairs by score.
        </p>
        <div className="data-controls">
          <label>Find candidate <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Project, registry, country…" /></label>
          <label>Recorded verdict <select value={verdict} onChange={(event) => setVerdict(event.target.value)}><option value="all">All verdicts</option><option value="yes">Same asset</option><option value="no">Different assets</option></select></label>
          <label>Minimum score {minScore.toFixed(2)} <input type="range" min="0" max="1" step="0.01" value={minScore} onChange={(event) => setMinScore(Number(event.target.value))} /></label>
          <button type="button" onClick={() => { setSearch(''); setVerdict('all'); setMinScore(0); }}>Clear filters</button>
        </div>
        {topRows.length === 0 && <p role="status">No candidate pairs match these filters.</p>}
        <div className="m-carbontwin-scroll">
          <table className="m-carbontwin-table">
            <thead>
              <tr>
                <th scope="col">Pair</th>
                <th scope="col">Country</th>
                <th scope="col">Registries</th>
                <th scope="col">Name sim</th>
                <th scope="col">Score</th>
                <th scope="col">Vintages</th>
                <th scope="col">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {topRows.map(({ candidate: c, verdict }) => {
                const recomputed = screenScore(c);
                return (
                  <tr key={`${c.a}~${c.b}`}>
                    <td className="m-carbontwin-hash">
                      {c.a} ~ {c.b}
                    </td>
                    <td>{c.country}</td>
                    <td>
                      {c.registry_a} / {c.registry_b}
                    </td>
                    <td>{c.name_sim.toFixed(4)}</td>
                    <td>
                      {recomputed.toFixed(4)}{' '}
                      <span className={recomputed === c.screen_score ? 'm-carbontwin-ok' : 'm-carbontwin-bad'}>
                        {recomputed === c.screen_score ? 'matches' : 'differs'}
                      </span>
                    </td>
                    <td>{c.overlap_vintages.length ? c.overlap_vintages.join(', ') : '—'}</td>
                    <td className={verdict === 'yes' ? 'm-carbontwin-ok' : 'm-carbontwin-muted'}>{verdict ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h3>Local LLM review (recorded verdicts)</h3>
        <p className="m-carbontwin-note">
          The verdicts below were written by the local model during the pipeline run. The model is not run in this
          module, and no verdict is re-decided here.
        </p>
        <ul className="m-carbontwin-list">
          {yesRows.slice(0, 3).map(({ candidate: c, reason }) => (
            <li key={`${c.a}~${c.b}`}>
              <strong>
                {c.a} ~ {c.b}: yes.
              </strong>{' '}
              {reason}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h3>Merkle-anchored findings</h3>
        <p className="m-carbontwin-note">
          Each same-asset pair becomes a leaf: keccak256 of the ABI-encoded pair, vintages, overlap volume and verdict.
          The tree below is built here from this slice. The anchored root in the source covers its 61 published
          findings and is not reproduced by this slice; the leaf and proof rules are checked against those published
          values in the tests.
        </p>
        {tree ? (
          <div className="m-carbontwin-merkle">
            <div className="m-carbontwin-stats">
              <Stat label="Leaves" value={count(leaves.length)} />
              <Stat label="Root (this slice)" value={<span className="m-carbontwin-hash">{short(tree.root)}</span>} />
            </div>
            <label className="m-carbontwin-label">
              Finding
              <select value={picked} onChange={(e) => setPicked(Number(e.target.value))}>
                {findings.map((f, i) => (
                  <option key={f.id} value={i}>
                    {f.id}
                  </option>
                ))}
              </select>
            </label>
            <p className="m-carbontwin-note">
              Leaf <span className="m-carbontwin-hash">{short(leaves[picked])}</span> with a proof of {proof.length}{' '}
              sibling hashes folds to the root:{' '}
              <span className={folds ? 'm-carbontwin-ok' : 'm-carbontwin-bad'}>{folds ? 'yes' : 'no'}</span>.
            </p>
            <button type="button" disabled={recording} onClick={() => void recordProof()}>{recording ? 'Saving proof…' : 'Record selected proof'}</button>
            {notice && <p role="status">{notice}</p>}
          </div>
        ) : (
          <p className="m-carbontwin-note">No same-asset pairs in this slice.</p>
        )}
      </Card>

      <Card>
        <h3>Smart-contract issuance guard (described, not ported)</h3>
        <p className="m-carbontwin-note">
          contracts/src/CreditClaimRegistry.sol is the on-chain guard. Its tests in contracts/test/registry.test.mjs
          show these rules: only registries record issuance, and only auditors link two listings. A second registry
          cannot issue a vintage that is already issued on a linked asset (DoubleIssuance). The same batch cannot be
          recorded twice (DuplicateIssuance). Retirement cannot exceed the balance left (OverRetirement). A report
          root is checked with verifyFinding. None of this runs here.
        </p>
      </Card>

      <p className="m-carbontwin-note">
        Not ported: the local LLM review itself, the full 11,468-project pipeline run, the listing and second-pass
        evidence files, the anchor transaction in pipeline/anchor.mjs, and the on-chain guard.
      </p>
    </div>
  );
}

const climateModule: ClimateModule = {
  id: 'carbontwin',
  name: 'CarbonTwin',
  tagline: 'Cross-registry double-issuance screening: name matching, recorded verdicts and Merkle-anchored findings.',
  stages: ['verify', 'finance', 'prove'],
  tone: 'carbon',
  mode: 'RESEARCH',
  features: [
    'TF-IDF name similarity and screen score, with the score recomputed for each candidate',
    'Recorded local-LLM verdicts joined to each candidate pair; the model is not run',
    'Leaf hashing and sorted-pair Merkle root over the same-asset pairs, with proof checks',
  ],
  source: {
    folder: 'carbontwin-main',
    files: [
      'carbontwin-main/pipeline/screen.py',
      'carbontwin-main/pipeline/test_pipeline.py',
      'carbontwin-main/data/candidates.json',
      'carbontwin-main/data/verdicts.jsonl',
      'carbontwin-main/contracts/leaf.mjs',
      'carbontwin-main/contracts/chain.mjs',
      'carbontwin-main/contracts/test/registry.test.mjs',
      'carbontwin-main/contracts/test/report.test.mjs',
      'carbontwin-main/web/public/data/findings.json',
    ],
  },
  Page: CarbonTwinPage,
};

export default climateModule;
