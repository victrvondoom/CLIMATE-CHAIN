import { useMemo, useState } from 'react';
import type { ClimateModule } from '../../core/module';
import { appendLedger, createEvidence } from '../../core/evidence';
import { Card, Stat } from '../../components/Ui';
import reference from './fixtures/ausgrid-reference-summary.json';
import { simulateDispatch, type DispatchStep } from './domain/dispatch';
import { DEFAULT_CONFIG, DT, LOCATIONS, PRESETS, PRESET_ORDER, type LocationId, type PresetId } from './domain/params';
import { seedFor } from './domain/random';
import './module.css';

const MODULE_ID = 'grounded';

function fmtKwh(v: number) {
  return `${v.toLocaleString('en-US', { maximumFractionDigits: 0 })} kWh`;
}

function fmtMwh(kwh: number) {
  return `${(kwh / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} MWh`;
}

function Trace({ steps }: { steps: DispatchStep[] }) {
  const W = 640;
  const H = 160;
  const maxGrid = Math.max(1, ...steps.map((s) => s.gridUsedKW));
  const x = (i: number) => ((i / (steps.length - 1)) * W).toFixed(1);
  const soc = steps.map((s, i) => `${x(i)},${(H - (s.socPct / 100) * H).toFixed(1)}`).join(' ');
  const grid = steps.map((s, i) => `${x(i)},${(H - (s.gridUsedKW / maxGrid) * H * 0.9).toFixed(1)}`).join(' ');
  return (
    <svg className="m-grounded-trace" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Battery state of charge and grid import over 72 hours">
      <polyline className="m-grounded-trace-grid" points={grid} />
      <polyline className="m-grounded-trace-soc" points={soc} />
    </svg>
  );
}

function GroundedPage() {
  const [presetId, setPresetId] = useState<PresetId>('extreme');
  const [locationId, setLocationId] = useState<LocationId>('jaipur');
  const [seedIndex, setSeedIndex] = useState(1);
  const [reservePct, setReservePct] = useState(0);
  const [recorded, setRecorded] = useState('');

  const run = useMemo(
    () => simulateDispatch(seedFor(seedIndex), LOCATIONS[locationId], presetId, DEFAULT_CONFIG, { reservePct, evDelayMin: 0, precoolHour: null }),
    [seedIndex, locationId, presetId, reservePct],
  );
  const s = run.summary;

  async function record() {
    try {
      const record = await createEvidence({
        moduleId: MODULE_ID,
        kind: 'dispatch-run',
        mode: 'SIMULATED',
        summary: `${PRESETS[presetId].label} at ${LOCATIONS[locationId].label}, seed ${s.seed}: ${s.bucket}`,
        payload: {
          seed: s.seed,
          preset: presetId,
          location: locationId,
          reservePct,
          bucket: s.bucket,
          failStep: s.failStep,
          minSocPct: s.minSocPct,
          gridEnergyKWh: s.gridEnergyKWh,
          solarCurtailedKWh: s.solarCurtailedKWh,
          criticalEnergyUnservedKWh: s.criticalEnergyUnservedKWh,
          energyBalanceMaxErrorKWh: s.energyBalanceMaxErrorKWh,
        },
      });
      appendLedger(record);
      setRecorded(`Recorded ${record.sha256.slice(0, 12)} in the evidence ledger.`);
    } catch {
      setRecorded('This browser could not compute the evidence hash.');
    }
  }

  return (
    <div className="m-grounded-root">
      <Card className="m-grounded-head">
        <div className="m-grounded-title-row">
          <h2>grounded</h2>
          <span className="m-grounded-mode">SIMULATED</span>
          <span className="m-grounded-chip">synthetic profiles, 72 h, 15-minute steps</span>
        </div>
        <p>
          The dispatch rules from packages/sim, run over a synthetic scenario. Hospital load is served first, then
          residential and EV load. Surplus solar charges the battery, and the rest is curtailed.
        </p>
      </Card>

      <Card>
        <div className="m-grounded-controls">
          <label className="m-grounded-field">
            Scenario
            <select value={presetId} onChange={(e) => setPresetId(e.target.value as PresetId)}>
              {PRESET_ORDER.map((id) => (
                <option key={id} value={id}>
                  {PRESETS[id].label}
                </option>
              ))}
            </select>
          </label>
          <label className="m-grounded-field">
            Location profile
            <select value={locationId} onChange={(e) => setLocationId(e.target.value as LocationId)}>
              {Object.values(LOCATIONS).map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.label}
                </option>
              ))}
            </select>
          </label>
          <label className="m-grounded-field">
            Seed (0 to 99)
            <input type="number" min={0} max={99} value={seedIndex} onChange={(e) => setSeedIndex(Math.min(99, Math.max(0, Number(e.target.value) || 0)))} />
          </label>
          <label className="m-grounded-field">
            Battery reserve for flexible load: {reservePct}%
            <input type="range" min={0} max={30} step={5} value={reservePct} onChange={(e) => setReservePct(Number(e.target.value))} />
          </label>
        </div>
        <p className="m-grounded-meta">{PRESETS[presetId].blurb}</p>
      </Card>

      <div className="m-grounded-stats">
        <Stat label="Risk bucket" value={s.bucket} hint={s.failed ? `critical load lost from hour ${(s.failStep * DT).toFixed(2)}` : 'no critical load lost'} />
        <Stat label="Lowest battery state" value={s.minSocPct.toFixed(1)} unit="%" hint="floor is 5% of capacity" />
        <Stat label="Grid import" value={fmtMwh(s.gridEnergyKWh)} hint="over 72 hours" />
        <Stat label="Solar curtailed" value={fmtMwh(s.solarCurtailedKWh)} hint="surplus that could not be used or stored" />
        <Stat label="Critical load unserved" value={fmtKwh(s.criticalEnergyUnservedKWh)} hint="hospital tiers 0 and 1" />
        <Stat label="Energy balance" value={s.energyBalanceMaxErrorKWh < 1e-8 ? 'closed' : 'open'} hint={`max step error ${s.energyBalanceMaxErrorKWh.toExponential(1)} kWh`} />
      </div>

      <Card>
        <h3>Battery state (line) and grid import (dashed), 72 hours</h3>
        <Trace steps={run.steps} />
        <p className="m-grounded-meta">
          Grid outage: {s.outageStartHour == null ? 'none in this draw' : `from hour ${s.outageStartHour.toFixed(2)} for ${s.outageDurationHours.toFixed(2)} h`}.
          Lowest state {s.minSocPct.toFixed(1)}%.
        </p>
        <div className="m-grounded-actions">
          <button type="button" onClick={() => void record()}>
            Record this run in the evidence ledger
          </button>
          {recorded ? <span className="m-grounded-meta">{recorded}</span> : null}
        </div>
      </Card>

      <Card>
        <h3>Measured reference (RESEARCH)</h3>
        <p className="m-grounded-meta">
          {reference.name}. Public Ausgrid data, {reference.demand.station}, {reference.demand.firstDate} to {reference.demand.lastDate}.
          It is not Jaipur telemetry and is not used to drive the runs above.
        </p>
        <div className="m-grounded-stats">
          <Stat label="Mean demand" value={reference.demand.meanMW} unit="MW" hint={`peak ${reference.demand.peakMW} MW`} />
          <Stat label="Outage frequency" value={reference.reliability.saifiInterruptionsPerCustomerYear} unit="per customer-year" hint={`SAIDI ${reference.reliability.saidiMinutesPerCustomerYear} min`} />
          <Stat label="Median restoration" value={reference.reliability.medianRestorationHours} unit="h" hint={`p95 ${reference.reliability.p95RestorationHours} h`} />
          <Stat label="Holdout check" value={reference.validation.status} hint={`outage KS ${reference.validation.outage.ksStatistic}`} />
        </div>
      </Card>

      <Card>
        <h3>Not ported</h3>
        <ul className="m-grounded-list">
          <li>The 245-policy search, the critical-load investment search and the Monte Carlo and surrogate layers.</li>
          <li>The generator, measured site-data profiles and paired-day sampling, which need site telemetry.</li>
          <li>The renewable provenance accounting and the failure cause text.</li>
          <li>The seed-to-seed reliability intervals and the decision readiness views.</li>
        </ul>
      </Card>
    </div>
  );
}

const climateModule: ClimateModule = {
  id: 'grounded',
  name: 'grounded',
  tagline: 'Hour-by-hour microgrid dispatch: solar, battery and grid through a 72-hour outage.',
  stages: ['sense', 'act', 'prove'],
  tone: 'energy',
  mode: 'SIMULATED',
  features: [
    '72-hour dispatch of solar, battery and grid in 288 fifteen-minute steps',
    'Battery state of charge with a physical floor, a reserve for flexible load and round-trip efficiency',
    'Grid import capped by the outage window, with hospital load served first',
    'Surplus solar charges the battery up to its limits; the rest is curtailed and counted',
    'Tiered hospital shed, critical-loss streaks and a risk bucket for each run',
    'Recording a run writes a hashed evidence record',
    'Ausgrid measured reference summary shown as RESEARCH beside the runs',
  ],
  source: {
    folder: 'grounded-main',
    files: ['packages/sim/src/index.ts', 'packages/sim/test/sim.test.ts', 'data/ausgrid-measured-reference.json'],
  },
  Page: GroundedPage,
};

export default climateModule;
