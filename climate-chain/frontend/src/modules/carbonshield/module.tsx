import { useMemo, useState, type ChangeEvent } from 'react';
import type { ClimateModule } from '../../core/module';
import { Card, Stat } from '../../components/Ui';
import { auditLeakage } from './domain/leakage';
import { missingByField, missingByProject } from './domain/missingness';
import { parseBenchmark } from './domain/import';
import { appendLedger, createEvidence, hashValue } from '../../core/evidence';
import leakage from './fixtures/leakage_audit.json';
import benchmark from './fixtures/benchmark_projects.json';
import './module.css';

const DATASET_KEY = 'climate-chain.carbonshield.dataset.v1';
function restoredDataset() {
  try {
    const value = JSON.parse(sessionStorage.getItem(DATASET_KEY) || 'null');
    if (value && typeof value.name === 'string') return { name: value.name, rows: parseBenchmark(value.rows) };
  } catch { /* An unavailable or invalid session cache falls back to the known benchmark. */ }
  return { name: 'Bundled research benchmark', rows: parseBenchmark(benchmark) };
}

function CarbonShieldPage() {
  const rules = useMemo(() => auditLeakage(leakage), []);
  const [restored] = useState(restoredDataset);
  const [dataset, setDataset] = useState(restored.rows);
  const [datasetName, setDatasetName] = useState(restored.name);
  const [query, setQuery] = useState('');
  const [country, setCountry] = useState('all');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const countries = [...new Set(dataset.map((row) => row.country).filter((value): value is string => !!value))].sort();
  const rows = useMemo(() => dataset.filter((row) => (country === 'all' || row.country === country) && Object.values(row).some((value) => value?.toLowerCase().includes(query.toLowerCase()))), [dataset, query, country]);
  const fields = useMemo(() => missingByField(rows), [rows]);
  const projects = useMemo(() => missingByProject(rows), [rows]);
  const visibleFields = onlyMissing ? fields.filter((field) => field.missing > 0) : fields;
  const blankCells = fields.reduce((sum, f) => sum + f.missing, 0);
  const passing = rules.filter((r) => r.passed).length;

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    setBusy(true);
    try {
      if (file.size > 1_048_576) throw new Error('Choose a JSON file under 1 MB.');
      const next = parseBenchmark(JSON.parse(await file.text()));
      setDataset(next); setDatasetName(file.name); setQuery(''); setCountry('all');
      try {
        sessionStorage.setItem(DATASET_KEY, JSON.stringify({ name: file.name, rows: next }));
        setNotice(`Loaded ${next.length} project rows. Dataset preserved for this tab's session; all audit counts recalculated locally.`);
      } catch { setNotice(`Loaded ${next.length} project rows, but session storage is unavailable. Keep this screen open to retain this dataset.`); }
    } catch (error) { setNotice(error instanceof Error ? error.message : 'The dataset could not be read.'); }
    finally { setBusy(false); }
  }

  async function recordAudit() {
    setBusy(true);
    try {
      const record = await createEvidence({ moduleId: 'carbonshield', kind: 'missing-data-audit', mode: 'RESEARCH', summary: `${rows.length} projects audited; ${blankCells} missing cells in ${datasetName}`, payload: { dataset: datasetName, inputSha256: await hashValue(dataset), selectedRows: rows, filters: { country, query }, projectIds: rows.map((row) => row.project_id), fields, projects, leakagePolicySource: 'bundled leakage_audit.json', rules } });
      setNotice(appendLedger(record) ? `Audit saved to the evidence ledger: ${record.sha256.slice(0, 12)}.` : 'Audit computed, but browser storage could not save it.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Audit could not be recorded.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="m-carbonshield-page">
      <header className="m-carbonshield-head">
        <div>
          <p className="m-carbonshield-kicker">Carbon integrity · Research</p>
          <h2>CarbonShield</h2>
          <p>
            Audit view for REDD+ claims. The rules come from the leakage and missing-data reports and run over the
            benchmark outputs of the Swinfield et al. (2026) dataset.
          </p>
        </div>
        <span className="m-carbonshield-mode" title="Local audit over the selected dataset using the recorded research policy">
          RESEARCH
        </span>
      </header>

      <Card>
        <h3>Explore and audit project data</h3>
        <p className="muted">{datasetName} · {rows.length} of {dataset.length} projects. Counts update with the selected rows. Imported files stay in this browser session.</p>
        <div className="data-controls">
          <label>Find project <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, identifier, methodology…" /></label>
          <label>Country <select value={country} onChange={(event) => setCountry(event.target.value)}><option value="all">All countries</option>{countries.map((name) => <option key={name}>{name}</option>)}</select></label>
          <label><input type="checkbox" checked={onlyMissing} onChange={(event) => setOnlyMissing(event.target.checked)} />Only fields with missing data</label>
          <label>Import project JSON <input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => void upload(event)} /></label>
          <button type="button" disabled={busy || rows.length === 0} onClick={() => void recordAudit()}>{busy ? 'Processing…' : 'Record current audit'}</button>
          <button type="button" disabled={busy} onClick={() => { setDataset(parseBenchmark(benchmark)); setDatasetName('Bundled research benchmark'); setQuery(''); setCountry('all'); try { sessionStorage.removeItem(DATASET_KEY); setNotice('Research benchmark restored.'); } catch { setNotice('Research benchmark restored on this screen; session storage could not be cleared.'); } }}>Reset benchmark</button>
        </div>
        {notice && <p className="data-feedback" role="status">{notice}</p>}
        {rows.length === 0 && <p role="status">No projects match these filters.</p>}
      </Card>

      <div className="m-carbonshield-stats">
        <Card>
          <Stat label="Leakage rules passing" value={`${passing} of ${rules.length}`} />
        </Card>
        <Card>
          <Stat label="Eligible projects" value={rows.length} />
        </Card>
        <Card>
          <Stat label="Projects with a blank" value={projects.length} />
        </Card>
        <Card>
          <Stat label="Blank cells" value={blankCells} />
        </Card>
      </div>

      <Card>
        <h3>Leakage audit</h3>
        <p className="m-carbonshield-note">
          Ex-post evaluation fields must not be model inputs. These rules check the ex-ante and ex-post partition that
          leakage_audit.json records.
        </p>
        <div className="m-carbonshield-scroll">
          <table className="m-carbonshield-table">
            <thead>
              <tr>
                <th scope="col">Rule</th>
                <th scope="col">Result</th>
                <th scope="col">Fields</th>
                <th scope="col">Source</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>{r.rule}</td>
                  <td className={r.passed ? 'm-carbonshield-ok' : 'm-carbonshield-bad'}>{r.passed ? 'pass' : 'fail'}</td>
                  <td>{r.detail.length ? r.detail.join(', ') : '—'}</td>
                  <td className="m-carbonshield-muted">{r.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="m-carbonshield-note">
          The source records the same two results as false in its own checks: column_sets_disjoint and
          ex_ante_partition_matches_benchmark.
        </p>
      </Card>

      <Card>
        <h3>Missing values per field</h3>
        <p className="m-carbonshield-note">
          MISSING_DATA_REPORT.md policy: missing values are counted and listed, and none are imputed.
        </p>
        <div className="m-carbonshield-scroll">
          <table className="m-carbonshield-table">
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Missing</th>
                <th scope="col">Of records</th>
                <th scope="col">Share</th>
              </tr>
            </thead>
            <tbody>
              {visibleFields.map((f) => (
                <tr key={f.field}>
                  <td className="m-carbonshield-hash">{f.field}</td>
                  <td className={f.missing ? 'm-carbonshield-bad' : undefined}>{f.missing}</td>
                  <td>{f.total}</td>
                  <td>{(f.pct * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h3>Projects with a missing field</h3>
        <ul className="m-carbonshield-list">
          {projects.map((p) => (
            <li key={p.project_id}>
              <strong>{p.project_id}</strong>: {p.missing.join(', ')}
            </li>
          ))}
          {projects.length === 0 && <li>No missing fields in the selected projects.</li>}
        </ul>
      </Card>

      <p className="m-carbonshield-note">
        Not ported: the stress tests for baselines and leakage, the ML pipeline in outputs/phase2, the measurement and
        carbon-stock challenges, the audit API and React auditor, and the contract anchor. The source also hardcodes
        private keys in scripts/verify_contract.py and src/carbonshield/blockchain/contract.py. Neither file is read
        or copied here.
      </p>
    </div>
  );
}

const climateModule: ClimateModule = {
  id: 'carbonshield',
  name: 'CarbonShield',
  tagline: 'REDD+ claims under red-team review, with leakage and missing-data audit rules on the benchmark outputs.',
  stages: ['verify', 'prove'],
  tone: 'carbon',
  mode: 'RESEARCH',
  features: [
    'Leakage audit rules over the ex-ante and ex-post column partition',
    'Forbidden ex-post field names checked against ex-ante columns',
    'Per-field and per-project missing-value counts, with no imputation',
  ],
  source: {
    folder: 'carbonshield-main',
    files: [
      'carbonshield-main/docs/LEAKAGE_AUDIT.md',
      'carbonshield-main/docs/MISSING_DATA_REPORT.md',
      'carbonshield-main/data/benchmark/leakage_audit.json',
      'carbonshield-main/data/benchmark/benchmark_projects.csv',
    ],
  },
  Page: CarbonShieldPage,
};

export default climateModule;
