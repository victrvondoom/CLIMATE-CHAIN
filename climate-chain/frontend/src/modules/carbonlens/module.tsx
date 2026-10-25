import { useEffect, useMemo, useState } from 'react';
import type { ClimateModule } from '../../core/module';
import { appendLedger, createEvidence } from '../../core/evidence';
import { Card, Stat } from '../../components/Ui';
import { auditSerials } from './domain/serials';
import { checkReportHashes, compareWithLedger, type HashCheck } from './domain/reporthash';
import results from './fixtures/results.json';
import ledger from './fixtures/ledger.json';
import './module.css';

const short = (hex: string) => `${hex.slice(0, 10)}…${hex.slice(-6)}`;
const pct = (x: number, digits = 2) => `${(x * 100).toFixed(digits)}%`;

function CarbonLensPage() {
  const serials = useMemo(() => auditSerials(ledger.entries), []);
  const [checks, setChecks] = useState<HashCheck[] | null>(null);
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [revision, setRevision] = useState(0);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    let live = true;
    setChecks(null);
    setVerificationError(null);
    void checkReportHashes(results.projects).then((rows) => {
      if (live) setChecks(rows);
    }).catch((error: unknown) => { if (live) setVerificationError(error instanceof Error ? error.message : 'Report verification failed.'); });
    return () => {
      live = false;
    };
  }, [revision]);

  const ledgerRows = useMemo(() => (checks ? compareWithLedger(ledger.entries, checks) : []), [checks]);
  const model = results.model;
  const cm = model.confusion_matrix_ref_x_map;
  const matching = checks ? checks.filter((c) => c.matches).length : 0;
  const visibleProjects = results.projects.filter((project) => `${project.project_id} ${project.country} ${project.status}`.toLowerCase().includes(query.toLowerCase()));
  const projectIds = new Set(visibleProjects.map((project) => project.project_id));
  const visibleChecks = checks?.filter((check) => projectIds.has(check.project_id) && (!onlyIssues || !check.matches || !ledgerRows.find((row) => row.project_id === check.project_id)?.same));

  async function recordChecks() {
    if (!checks) return;
    setRecording(true);
    try {
    const entry = await createEvidence({
      moduleId: 'carbonlens',
      kind: 'report-hash-check',
      mode: 'RESEARCH',
      summary: `${matching} of ${checks.length} report hashes match; serials unique: ${serials.unique ? 'yes' : 'no'}`,
      payload: {
        report_hashes: checks.map((c) => ({ project_id: c.project_id, matches: c.matches })),
        serials_unique: serials.unique,
      },
    });
    setStatus(
      appendLedger(entry)
        ? `Recorded ${entry.id.slice(0, 8)} with digest ${short(entry.sha256)}.`
        : 'Not saved: browser storage is unavailable. The checks are still shown here.',
    );
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not record the checks.'); }
    finally { setRecording(false); }
  }

  return (
    <div className="m-carbonlens-page">
      <header className="m-carbonlens-head">
        <div>
          <p className="m-carbonlens-kicker">Carbon integrity · Verify, finance, prove</p>
          <h2>CarbonLens</h2>
          <p>
            Satellite checks for forest credit claims. The port covers serial uniqueness and report hashes. Pipeline
            outputs are shown as recorded.
          </p>
        </div>
        <span className="m-carbonlens-mode" title="Measured results copied from the project's own outputs">
          RESEARCH
        </span>
      </header>

      <div className="data-controls">
        <label>Find project <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Project identifier, country, status…" /></label>
        <label><input type="checkbox" checked={onlyIssues} onChange={(event) => setOnlyIssues(event.target.checked)} />Only mismatching hashes</label>
        <button type="button" disabled={!checks && !verificationError} onClick={() => setRevision((value) => value + 1)}>{!checks && !verificationError ? 'Verifying…' : 'Re-run report verification'}</button>
        <span role="status">{visibleProjects.length} of {results.projects.length} projects</span>
      </div>
      {verificationError && <p role="alert">Verification unavailable: {verificationError}</p>}

      <Card>
        <h3>Random-forest land classification</h3>
        <p className="m-carbonlens-note">
          Recorded by ml/run_pipeline.py on synthetic scenes. The forest is not retrained in this module.
        </p>
        <div className="m-carbonlens-stats">
          <Stat label="Held-out accuracy" value={pct(model.accuracy)} />
          <Stat label="Forest F1" value={model.f1_forest.toFixed(4)} />
          <Stat label="False-loss rate" value={pct(model.false_loss_rate)} />
          <Stat label="Held-out pixels" value={model.n_pixels.toLocaleString('en-US')} />
        </div>
        <div className="m-carbonlens-scroll">
          <table className="m-carbonlens-table">
            <caption>Confusion matrix: reference (rows) by map (columns), {model.n_reference_samples} samples</caption>
            <thead>
              <tr>
                <th scope="col">Reference</th>
                <th scope="col">Map forest</th>
                <th scope="col">Map non-forest</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Forest</th>
                <td>{cm[0][0]}</td>
                <td>{cm[0][1]}</td>
              </tr>
              <tr>
                <th scope="row">Non-forest</th>
                <td>{cm[1][0]}</td>
                <td>{cm[1][1]}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h3>Change detection and reversals</h3>
        <p className="m-carbonlens-note">
          Values are the pipeline's recorded outputs for each project. The significance test in ml/verifier.py is not
          ported.
        </p>
        <div className="m-carbonlens-scroll">
          <table className="m-carbonlens-table">
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col">Claimed</th>
                <th scope="col">Verified</th>
                <th scope="col">Forest now</th>
                <th scope="col">Loss (ha)</th>
                <th scope="col">Significant</th>
                <th scope="col">Reversal tCO₂e</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleProjects.map((p) => (
                <tr key={p.project_id}>
                  <td>
                    {p.project_id} <span className="m-carbonlens-muted">{p.country}</span>
                  </td>
                  <td>{p.claimed_credits.toLocaleString('en-US')}</td>
                  <td>{p.verified_credits.toLocaleString('en-US')}</td>
                  <td>{p.measured.current_forest_pct.toFixed(2)}%</td>
                  <td>{p.measured.forest_loss_ha.toFixed(1)}</td>
                  <td>{p.measured.loss_significant ? 'yes' : 'no'}</td>
                  <td>{p.measured.reversal_tco2e.toLocaleString('en-US')}</td>
                  <td>{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h3>Unique serials in ledger.json</h3>
        <div className="m-carbonlens-stats">
          <Stat label="Serials unique" value={serials.unique ? 'Yes' : 'No'} color={serials.unique ? 'green' : 'red'} />
          <Stat label="Credits issued" value={ledger.entries.reduce((s, e) => s + e.issued, 0).toLocaleString('en-US')} />
        </div>
        <div className="m-carbonlens-scroll">
          <table className="m-carbonlens-table">
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col">Serial range</th>
                <th scope="col">Issued</th>
                <th scope="col">Check</th>
              </tr>
            </thead>
            <tbody>
              {ledger.entries.map((e, i) => {
                if (!projectIds.has(e.project_id)) return null;
                const issues = serials.entries[i].issues;
                return (
                  <tr key={e.project_id}>
                    <td>{e.project_id}</td>
                    <td>{e.issued > 0 ? `${e.serial_start}–${e.serial_end}` : 'none issued'}</td>
                    <td>{e.issued.toLocaleString('en-US')}</td>
                    <td className={issues.length ? 'm-carbonlens-bad' : 'm-carbonlens-ok'}>
                      {issues.length ? issues.join('; ') : 'ok'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h3>Report hashes</h3>
        <p className="m-carbonlens-note">
          Each report is hashed as ml/verifier.py hashes it, then compared with the stored report_hash and with the
          hash anchored in the ledger.
        </p>
        {checks ? (
          <div className="m-carbonlens-scroll">
            <table className="m-carbonlens-table">
              <thead>
                <tr>
                  <th scope="col">Project</th>
                  <th scope="col">Stored</th>
                  <th scope="col">Recomputed</th>
                  <th scope="col">Report</th>
                  <th scope="col">Ledger anchor</th>
                </tr>
              </thead>
              <tbody>
                {visibleChecks?.map((c) => {
                  const row = ledgerRows.find((r) => r.project_id === c.project_id);
                  return (
                    <tr key={c.project_id}>
                      <td>{c.project_id}</td>
                      <td className="m-carbonlens-hash">{short(c.stored)}</td>
                      <td className="m-carbonlens-hash">{short(c.recomputed)}</td>
                      <td className={c.matches ? 'm-carbonlens-ok' : 'm-carbonlens-bad'}>{c.matches ? 'match' : 'differs'}</td>
                      <td className={row?.same ? 'm-carbonlens-ok' : 'm-carbonlens-bad'}>{row?.same ? 'match' : 'differs'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="m-carbonlens-note">{verificationError ? 'Report verification failed. Re-run verification to try again.' : 'Computing SHA-256 digests…'}</p>
        )}
        <div className="m-carbonlens-actions">
          <button type="button" className="m-carbonlens-button" onClick={() => void recordChecks()} disabled={!checks || recording}>
            {recording ? 'Saving checks…' : 'Record all checks to the evidence ledger'}
          </button>
          {checks && visibleChecks?.length === 0 && <p role="status">No hash checks match these filters.</p>}
          {status ? <p className="m-carbonlens-note" role="status">{status}</p> : null}
          <p className="m-carbonlens-note">
            {checks ? `${matching} of ${checks.length} report hashes match.` : ''}
          </p>
        </div>
      </Card>

      <p className="m-carbonlens-note">
        Not ported: forest training and inference, the significance test in ml/verifier.py, the Hardhat contract, the
        anchor.js transactions, and the map images. The hashes use sha256Hex from core/evidence over a canonical text
        that matches Python's float output, because hashValue drops the ".0" on integer-valued floats.
      </p>
    </div>
  );
}

const climateModule: ClimateModule = {
  id: 'carbonlens',
  name: 'CarbonLens',
  tagline: 'Research: satellite checks for forest credit claims, with serial and report-hash checks on the recorded ledger.',
  stages: ['verify', 'finance', 'prove'],
  tone: 'carbon',
  mode: 'RESEARCH',
  features: [
    'Random-forest metrics and confusion matrix from the pipeline output (no retraining)',
    'Reversal and change-detection results per project from the pipeline output',
    'Serial-range uniqueness check over ledger.json, following the contract allocation',
    'Report hash recomputed from each report and compared with the stored and anchored hash',
    'Records each hash check to the evidence ledger',
  ],
  source: {
    folder: 'carbonlens-main',
    files: [
      'carbonlens-main/dashboard/data/results.json',
      'carbonlens-main/dashboard/data/ledger.json',
      'carbonlens-main/ml/verifier.py',
      'carbonlens-main/contracts/CarbonRegistry.sol',
      'carbonlens-main/test/CarbonRegistry.test.js',
    ],
  },
  Page: CarbonLensPage,
};

export default climateModule;
