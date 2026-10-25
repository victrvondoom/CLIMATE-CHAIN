import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Card, Stat } from '../../components/Ui';
import { appendLedger, createEvidence } from '../../core/evidence';
import type { ClimateModule } from '../../core/module';
import { analyzeTable, MissingColumnsError, NUMERIC_COLUMNS, REQUIRED_COLUMNS, type Analysis } from './domain/analyze';
import { CsvParseError, decodeUtf8, parseCsv } from './domain/csv';
import {
  buildIntegrityReport,
  checkContent,
  checkUpload,
  hashesMatch,
  normalizeExpectedHash,
} from './domain/integrity';
import sampleFixture from './fixtures/environmental-sample.json';
import './module.css';

interface SampleFixture {
  readonly note: string;
  readonly source: string;
  readonly sha256: string;
  readonly csv: string;
}

const SAMPLE = sampleFixture as SampleFixture;
const SAMPLE_NAME = 'environmental_sample.csv';

interface Dataset {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly simulated: boolean;
}

type Outcome = { readonly kind: 'ok'; readonly analysis: Analysis } | { readonly kind: 'error'; readonly message: string };

const SAMPLE_DATASET: Dataset = { name: SAMPLE_NAME, bytes: new TextEncoder().encode(SAMPLE.csv), simulated: true };

/** The upload checks in the order app/main.py makes them: name and size, then bytes, then content, then parse. */
function analyzeBytes(name: string, bytes: Uint8Array): Outcome {
  const uploadProblem = checkUpload(name, bytes.byteLength);
  if (uploadProblem) return { kind: 'error', message: uploadProblem };
  try {
    const text = decodeUtf8(bytes);
    const emptyProblem = checkContent(text);
    if (emptyProblem) return { kind: 'error', message: emptyProblem };
    return { kind: 'ok', analysis: analyzeTable(parseCsv(text), name) };
  } catch (error) {
    if (error instanceof CsvParseError || error instanceof MissingColumnsError) {
      return { kind: 'error', message: error.message };
    }
    throw error;
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const formatBytes = (bytes: number): string => (bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(1)} KiB`);

const isNumeric = (name: string): boolean => (NUMERIC_COLUMNS as readonly string[]).includes(name);

function ModeTag({ mode }: { mode: string }) {
  return <span className={`m-climateproof-mode m-climateproof-mode-${mode.toLowerCase()}`}>{mode}</span>;
}

function ClimateProofPage() {
  const [dataset, setDataset] = useState<Dataset>(SAMPLE_DATASET);
  const [digest, setDigest] = useState<{ readonly for: Uint8Array; readonly hex: string } | null>(null);
  const [expected, setExpected] = useState('');
  const [recorded, setRecorded] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);

  const outcome = useMemo(() => analyzeBytes(dataset.name, dataset.bytes), [dataset]);
  const analysis = outcome.kind === 'ok' ? outcome.analysis : null;
  const currentDigest = digest !== null && digest.for === dataset.bytes ? digest.hex : null;

  useEffect(() => {
    let cancelled = false;
    const bytes = dataset.bytes;
    sha256Hex(bytes).then((hex) => {
      if (!cancelled) setDigest({ for: bytes, hex });
    });
    return () => {
      cancelled = true;
    };
  }, [dataset]);

  const expectedCheck = expected.trim() === '' ? null : normalizeExpectedHash(expected);
  const verification =
    expectedCheck?.ok && currentDigest !== null ? hashesMatch(expectedCheck.hash, currentDigest) : null;

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const problem = checkUpload(file.name, file.size);
    if (problem) {
      setUploadError(problem);
      return;
    }
    setUploadError(null);
    const bytes = new Uint8Array(await file.arrayBuffer());
    setDataset({ name: file.name, bytes, simulated: false });
  }

  function downloadReport() {
    if (analysis === null || currentDigest === null) return;
    const report = buildIntegrityReport({ filename: dataset.name, sha256: currentDigest, analysis });
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'integrity_report.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function recordCheck() {
    if (analysis === null || currentDigest === null) return;
    const payload = {
      filename: dataset.name,
      sha256: currentDigest,
      row_count: analysis.row_count,
      duplicate_rows: analysis.duplicate_rows,
      invalid_timestamps: analysis.invalid_timestamps,
      invalid_numeric_values: analysis.invalid_numeric_values,
      domain_violations: analysis.domain_violations,
      anomaly_counts: analysis.anomaly_counts,
      simulated: dataset.simulated,
    };
    try {
      const record = await createEvidence({
        moduleId: 'climateproof',
        kind: 'csv-integrity-check',
        mode: 'SIMULATED',
        summary: `${dataset.name}: ${analysis.row_count} rows, ${analysis.duplicate_rows} duplicate row(s)`,
        payload,
      });
      const kept = appendLedger(record);
      setRecorded(
        kept
          ? `Recorded. sha256 ${record.sha256.slice(0, 16)}..., kept in this browser's ledger.`
          : `Hashed (sha256 ${record.sha256.slice(0, 16)}...), but browser storage is blocked, so it is not kept.`,
      );
    } catch {
      setRecorded('This browser could not hash the check.');
    }
  }

  return (
    <div className="m-climateproof-root">
      <header className="m-climateproof-head">
        <div className="m-climateproof-kicker">ClaimGuard AI · Climate data</div>
        <h2 className="m-climateproof-title">Check an environmental dataset before anyone trusts it</h2>
        <p className="m-climateproof-lede">
          The rules are the ones in the project's API: required columns, blank cells, duplicate rows, timestamps, numeric
          values, humidity and PM2.5 ranges, and IQR outlier signals. Mode: <ModeTag mode="SIMULATED" />. The sample is
          synthetic, and an outlier is an exploratory signal, not proof of manipulation.
        </p>
      </header>

      <Card className="m-climateproof-card">
        <h3>Dataset</h3>
        <div className="m-climateproof-dataset">
          <div>
            <strong>{dataset.name}</strong> · {formatBytes(dataset.bytes.byteLength)}
            {dataset.simulated ? <ModeTag mode="SIMULATED" /> : null}
          </div>
          <code className="m-climateproof-hash">{currentDigest ?? 'computing SHA-256...'}</code>
        </div>
        <div className="m-climateproof-actions">
          <label className="m-climateproof-btn">
            Upload a CSV
            <input type="file" accept=".csv,text/csv" onChange={(event) => void handleFile(event)} hidden />
          </label>
          <button type="button" className="m-climateproof-btn is-ghost" onClick={() => setDataset(SAMPLE_DATASET)}>
            Use the sample
          </button>
          <span className="m-climateproof-note">.csv only, up to 5 MiB. Nothing is sent to a server.</span>
        </div>
        {uploadError ? (
          <p role="alert" className="m-climateproof-error">
            {uploadError}
          </p>
        ) : null}
        {outcome.kind === 'error' ? (
          <p role="alert" className="m-climateproof-error">
            {outcome.message}
          </p>
        ) : null}
      </Card>

      {analysis ? (
        <>
          <div className="m-climateproof-grid">
            <Card className="m-climateproof-card">
              <h3>Schema</h3>
              <ul className="m-climateproof-schema">
                {REQUIRED_COLUMNS.map((name) => {
                  const present = analysis.columns.includes(name);
                  return (
                    <li key={name} className={present ? 'is-ok' : 'is-missing'}>
                      {present ? 'Present' : 'Missing'} · {name}
                    </li>
                  );
                })}
              </ul>
              <div className="m-climateproof-stats">
                <Stat label="Rows" value={analysis.row_count} />
                <Stat label="Duplicate rows" value={analysis.duplicate_rows} />
                <Stat label="Bad timestamps" value={analysis.invalid_timestamps} />
              </div>
            </Card>

            <Card className="m-climateproof-card">
              <h3>Cell checks</h3>
              <table className="m-climateproof-table">
                <thead>
                  <tr>
                    <th>Column</th>
                    <th>Missing</th>
                    <th>Not a number</th>
                    <th>Out of range</th>
                    <th>Outlier signal</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.columns.map((name) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td>{analysis.missing_values[name]}</td>
                      <td>{isNumeric(name) ? analysis.invalid_numeric_values[name] : '·'}</td>
                      <td>{isNumeric(name) ? analysis.domain_violations[name] : '·'}</td>
                      <td>{isNumeric(name) ? analysis.anomaly_counts[name] : '·'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="m-climateproof-warnings">
                {analysis.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </Card>
          </div>

          <Card className="m-climateproof-card">
            <h3>Numeric summary</h3>
            <table className="m-climateproof-table">
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Count</th>
                  <th>Mean</th>
                  <th>Min</th>
                  <th>Max</th>
                  <th>Std</th>
                </tr>
              </thead>
              <tbody>
                {NUMERIC_COLUMNS.map((name) => {
                  const summary = analysis.numeric_summary[name];
                  return (
                    <tr key={name}>
                      <td>{name}</td>
                      <td>{summary.count}</td>
                      <td>{summary.mean ?? '·'}</td>
                      <td>{summary.min ?? '·'}</td>
                      <td>{summary.max ?? '·'}</td>
                      <td>{summary.std ?? '·'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="m-climateproof-note">{analysis.note}</p>
          </Card>
        </>
      ) : null}

      <Card className="m-climateproof-card">
        <h3>Integrity</h3>
        <p className="m-climateproof-note">
          The SHA-256 identifies these exact bytes. It does not prove where the file came from. Paste a trusted hash to check
          it.
        </p>
        <label className="m-climateproof-field">
          Expected SHA-256
          <input
            type="text"
            spellCheck={false}
            placeholder="64 hexadecimal characters"
            value={expected}
            onChange={(event) => setExpected(event.target.value)}
          />
        </label>
        {expectedCheck && !expectedCheck.ok ? <p className="m-climateproof-error">{expectedCheck.message}</p> : null}
        {verification !== null ? (
          <p className={verification ? 'm-climateproof-ok' : 'm-climateproof-error'}>
            {verification
              ? 'The file bytes match the expected hash.'
              : 'The file bytes do not match the expected hash.'}
          </p>
        ) : null}
        <div className="m-climateproof-actions">
          <button type="button" className="m-climateproof-btn" disabled={!analysis || !currentDigest} onClick={downloadReport}>
            Download integrity report (JSON)
          </button>
          <button type="button" className="m-climateproof-btn is-ghost" disabled={!analysis || !currentDigest} onClick={() => void recordCheck()}>
            Record this check
          </button>
        </div>
        {recorded ? <p className="m-climateproof-note">{recorded}</p> : null}
      </Card>

      <footer className="m-climateproof-foot">
        <p>
          <strong>Not ported:</strong> the FastAPI routes and the Streamlit dashboard (the same rules run in the browser, with
          no server and no upload), the Render deployment, and pandas' full type inference. Timestamps are read with the
          browser's date parser, and duplicate rows compare the cell text, so "12" and "12.0" differ here.
        </p>
      </footer>
    </div>
  );
}

const climateModule: ClimateModule = {
  id: 'climateproof',
  name: 'ClaimGuard AI',
  tagline: 'Check a CSV of environmental readings for schema, blank cells, duplicates, ranges and outliers, and fingerprint it.',
  stages: ['verify', 'prove'],
  tone: 'air',
  mode: 'SIMULATED',
  features: [
    'CSV upload with a required-column schema check',
    'Missing-value and whitespace-only detection for location and source_id',
    'Duplicate row count',
    'Invalid timestamp and numeric checks',
    'Humidity (0 to 100) and PM2.5 (0 or more) range checks',
    'IQR outlier signals, labelled as exploratory',
    'SHA-256 fingerprint, expected-hash check and integrity report download',
    'Evidence record for each check',
  ],
  source: {
    folder: 'ClimateProof-AI-main',
    files: ['app/main.py', 'tests/test_api.py', 'sample_data/environmental_sample.csv'],
  },
  Page: ClimateProofPage,
};

export default climateModule;
