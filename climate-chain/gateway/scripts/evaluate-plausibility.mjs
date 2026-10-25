// Time-split hold-out evaluation of the plausibility envelope.
//   node scripts/evaluate-plausibility.mjs            -> prints a table and writes fixtures/plausibility-eval.json
//
// Train: rows before 2026-03-01 (16 months). Test: 2026-03-01..2026-07-31 (5 months) = real data the model never saw.
// - FALSE ALARM RATE is measured on that REAL held-out data (an unusual-but-genuine value flagged for review).
// - DETECTION RATE uses SYNTHETIC injected anomalies (value x factor, or temperature + offset). It measures how
//   large a fabricated deviation must be to be noticed; it says nothing about real-world fraud prevalence.
// Source data is modelled/reanalysis (CAMS, ERA5), not station observation.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { COLUMNS, checkValue, fitEnvelope, loadClimateHourly } from '../plausibility.mjs';

const TRAIN_END = Date.parse('2026-03-01T00:00:00Z');
const FACTORS = [1.5, 2, 3, 5, 10];
const TEMP_OFFSETS = [5, 10, 15, 25];
const MARGINS = [0, 0.1, 0.25, 0.5];

export function evaluate(rows) {
  const test = rows.filter((r) => r.t >= TRAIN_END);
  const out = { dataset: { rows: rows.length, trainRows: rows.length - test.length, testRows: test.length, trainEnd: '2026-03-01', testEnd: '2026-07-31' }, byMargin: {} };
  for (const margin of MARGINS) {
    const model = fitEnvelope(rows, { trainEndMs: TRAIN_END, margin });
    const perColumn = {};
    for (const col of COLUMNS) {
      let n = 0; let alarms = 0; const det = Object.fromEntries([...FACTORS, ...TEMP_OFFSETS.map((o) => `+${o}`)].map((k) => [k, [0, 0]]));
      for (let i = 0; i < test.length; i++) {
        const r = test[i];
        const v = r[col];
        if (v === null || !Number.isFinite(v)) continue;
        const base = checkValue(model, r.city, col, r.t, v);
        if (!base.covered) continue;
        n += 1;
        if (!base.inside) alarms += 1;
        if (i % 7 !== 0) continue; // inject into every 7th row to keep the run quick; deterministic
        if (col === 'era5_temperature_2m') {
          for (const o of TEMP_OFFSETS) { const c = checkValue(model, r.city, col, r.t, v + o); det[`+${o}`][1] += 1; if (c.covered && !c.inside) det[`+${o}`][0] += 1; }
        } else if (v > 0) {
          for (const f of FACTORS) { const c = checkValue(model, r.city, col, r.t, v * f); det[f][1] += 1; if (c.covered && !c.inside) det[f][0] += 1; }
        }
      }
      const rate = (a, b) => (b ? Math.round((a / b) * 10000) / 10000 : null);
      perColumn[col] = {
        heldOutValues: n,
        falseAlarmRate: rate(alarms, n),
        detection: Object.fromEntries(Object.entries(det).filter(([, [, d]]) => d > 0).map(([k, [a, d]]) => [k, rate(a, d)])),
      };
    }
    const totalN = Object.values(perColumn).reduce((a, c) => a + c.heldOutValues, 0);
    const totalAlarms = Object.values(perColumn).reduce((a, c) => a + Math.round(c.falseAlarmRate * c.heldOutValues), 0);
    out.byMargin[margin] = { overallFalseAlarmRate: Math.round((totalAlarms / totalN) * 10000) / 10000, perColumn };
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rows = loadClimateHourly();
  if (!rows) { console.error('climate-hourly dataset not found. Run scripts/fetch-climate-hourly.mjs first.'); process.exit(1); }
  const report = evaluate(rows);
  report.note = 'Time-split hold-out on real CAMS/ERA5 data (modelled/reanalysis, not stations). False-alarm rate is on real held-out values; detection rate uses SYNTHETIC injected anomalies.';
  writeFileSync(fileURLToPath(new URL('../fixtures/plausibility-eval.json', import.meta.url)), JSON.stringify(report, null, 2));
  console.log(`rows=${report.dataset.rows} train=${report.dataset.trainRows} test=${report.dataset.testRows}`);
  for (const [m, r] of Object.entries(report.byMargin)) {
    console.log(`\nmargin=${m}  overall held-out false-alarm rate = ${(r.overallFalseAlarmRate * 100).toFixed(2)}%`);
    for (const [c, v] of Object.entries(r.perColumn)) {
      console.log(`  ${c.padEnd(28)} FA=${(v.falseAlarmRate * 100).toFixed(2).padStart(6)}%  detect: ${Object.entries(v.detection).map(([k, x]) => `${k}:${(x * 100).toFixed(0)}%`).join(' ')}`);
    }
  }
}
