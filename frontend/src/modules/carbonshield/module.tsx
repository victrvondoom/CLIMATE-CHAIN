import { useMemo } from 'react';
import type { ClimateModule } from '../../core/module';
import { Card, Stat } from '../../components/Ui';
import { auditLeakage } from './domain/leakage';
import { missingByField, missingByProject } from './domain/missingness';
import leakage from './fixtures/leakage_audit.json';
import benchmark from './fixtures/benchmark_projects.json';
import './module.css';

function CarbonShieldPage() {
  const rules = useMemo(() => auditLeakage(leakage), []);
  const rows = benchmark.rows;
  const fields = useMemo(() => missingByField(rows), [rows]);
  const projects = useMemo(() => missingByProject(rows), [rows]);
  const blankCells = fields.reduce((sum, f) => sum + f.missing, 0);
  const passing = rules.filter((r) => r.passed).length;

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
        <span className="m-carbonshield-mode" title="Measured results copied from the project's own outputs">
          RESEARCH
        </span>
      </header>

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
              {fields.map((f) => (
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
