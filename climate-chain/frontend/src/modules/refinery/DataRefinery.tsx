import { useMemo, useRef, useState } from 'react';
import { refineCsv, sha256Hex, toCleanedCsv, type RefineryResult } from './refinery';
import './refinery.css';

const SAMPLE_CSV = [
  'Date,Time,Temperature_F,PM2.5,NO2_ppb,Wind_kmph,Station',
  '01/15/2024,06:00,41.2,18.4,12.0,4.2,Anand Vihar',
  '01/15/2024,06:00,41.2,18.4,12.0,4.2,Anand Vihar',
  '01/15/2024,07:00,43.5,22.1,15.2,5.0,Anand Vihar',
  '01/15/2024,08:00,45.1,NA,17.8,NA,Anand Vihar',
  '01/15/2024,09:00,47.0,31.6,20.4,6.1,Anand Vihar',
  '01/15/2024,10:00,49.2,8840.0,19.0,5.8,Anand Vihar',
].join('\n');

const PREVIEW_ROWS = 12;

export function DataRefinery() {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<RefineryResult | null>(null);
  const [digest, setDigest] = useState('');
  const [digestPending, setDigestPending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const cleaned = useMemo(() => (result && result.outputRows > 0 ? toCleanedCsv(result) : ''), [result]);

  const refine = (text: string) => {
    setInput(text);
    setResult(refineCsv(text));
    setDigest('');
  };

  const computeDigest = async () => {
    if (!cleaned) return;
    setDigestPending(true);
    try {
      setDigest(await sha256Hex(cleaned));
    } finally {
      setDigestPending(false);
    }
  };

  const download = () => {
    if (!cleaned) return;
    const blob = new Blob([cleaned], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'refined-dataset.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    refine(await file.text());
  };

  return (
    <div className="refinery module-screen">
      <header className="refinery-header">
        <h1>Data Refinery</h1>
        <p>
          Paste any messy climate dataset — CSV, semicolon CSV, or JSON. The refinery normalizes
          timestamps to ISO 8601, harmonizes units (°F→°C, ppb→µg/m³, km/h→m/s…), removes duplicate
          rows, interpolates interior gaps and flags outliers, so analysis can start in seconds
          instead of hours. Everything runs locally in your browser; no data is uploaded.
        </p>
      </header>

      <section className="refinery-input card">
        <div className="refinery-input-actions">
          <button type="button" onClick={() => refine(SAMPLE_CSV)}>Load sample</button>
          <button type="button" onClick={() => fileInput.current?.click()}>Upload file</button>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.json,.txt,text/csv,application/json"
            className="sr-only"
            onChange={(event) => void onFile(event.target.files?.[0])}
          />
          <button type="button" className="refinery-run" onClick={() => refine(input)} disabled={input.trim() === ''}>Refine</button>
        </div>
        <textarea
          className="refinery-textarea"
          spellCheck={false}
          placeholder={'date,time,temperature_f,pm2.5\n12/31/2023,09:00,32.0,55.1\n…'}
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
      </section>

      {result && (
        <section className="refinery-summary">
          <div className="refinery-chips">
            <div className="refinery-chip"><strong>{result.inputRows}</strong><span>rows in</span></div>
            <div className="refinery-chip"><strong>{result.outputRows}</strong><span>rows out</span></div>
            <div className="refinery-chip"><strong>{result.removedDuplicates}</strong><span>duplicates removed</span></div>
            <div className="refinery-chip"><strong>{result.missingCells}</strong><span>missing cells</span></div>
            <div className="refinery-chip"><strong>{result.interpolatedCells}</strong><span>gaps interpolated</span></div>
            <div className="refinery-chip"><strong>{result.flaggedOutliers}</strong><span>outliers flagged</span></div>
            <div className="refinery-chip"><strong>{result.unitChanges.length}</strong><span>units harmonized</span></div>
          </div>

          <div className="refinery-columns">
            {result.stats.length > 0 && (
              <table className="refinery-table">
                <thead>
                  <tr><th>column</th><th>count</th><th>missing</th><th>outliers</th><th>mean</th><th>min</th><th>max</th></tr>
                </thead>
                <tbody>
                  {result.stats.map((stat) => (
                    <tr key={stat.column}>
                      <td>{stat.column}</td>
                      <td>{stat.count || '—'}</td>
                      <td>{stat.missing}</td>
                      <td>{stat.outliers > 0 ? stat.outliers : '—'}</td>
                      <td>{stat.count ? stat.mean.toFixed(2) : '—'}</td>
                      <td>{stat.count ? stat.min : '—'}</td>
                      <td>{stat.count ? stat.max : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <ul className="refinery-issues">
            {result.issues.slice(0, 40).map((issue, index) => (
              <li key={index} className={'refinery-issue refinery-issue-' + issue.kind}>{issue.message}</li>
            ))}
            {result.issues.length > 40 && <li className="refinery-issue">…and {result.issues.length - 40} more.</li>}
          </ul>

          {result.outputRows > 0 && (
            <div className="refinery-output">
              <div className="refinery-output-actions">
                <button type="button" className="refinery-run" onClick={download}>Download cleaned CSV</button>
                <button type="button" onClick={() => void computeDigest()} disabled={digestPending}>
                  {digestPending ? 'Hashing…' : 'Compute SHA-256 digest'}
                </button>
                {digest && <code className="refinery-digest" title={digest}>{digest.slice(0, 32)}…</code>}
              </div>
              <table className="refinery-table refinery-preview">
                <thead>
                  <tr>{result.columns.map((column) => <th key={column}>{column}</th>)}</tr>
                </thead>
                <tbody>
                  {result.rows.slice(0, PREVIEW_ROWS).map((row, rowIndex) => (
                    <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
                  ))}
                </tbody>
              </table>
              {result.rows.length > PREVIEW_ROWS && (
                <p className="refinery-more">Showing {PREVIEW_ROWS} of {result.rows.length} rows.</p>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
