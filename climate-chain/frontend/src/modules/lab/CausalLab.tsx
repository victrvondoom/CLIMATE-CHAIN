import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fetchClimateNews, fetchEnso, fetchHistoricalTimeline, fetchIndiaInflation } from '../../api';
import { appendLedger, createEvidence } from '../../core/evidence';
import type { WorkspaceView } from '../../data/capabilities';
import { useLiveQuery } from '../../hooks/useLiveQuery';
import { trainEnsoForecaster, trainWarmingTrend } from './ml';
import { CAUSAL_LINKS, MOLECULES, NEUTRAL_SCENARIO, PRESENT, earthSun, forcing, massFractions, orbitContext, runScenario, type ScenarioInput } from './physics';
import { ThreeCanvas, moleculeSetup, solarSetup } from './three-scenes';
import { listen, parseVoiceCommand, speak, voiceSupported, type VoiceCommand } from './voice';
import './lab.css';

const LedgerChain3D = lazy(() => import('./LedgerChain3D').then((m) => ({ default: m.LedgerChain3D })));

const f1 = (v: number, d = 1) => v.toFixed(d);
const signed = (v: number, d = 1) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}`;
const errText = (e: string | null) => e ?? 'Unavailable';

function Section({ title, hint, open = true, children }: { title: string; hint: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="lab-card" open={open}>
      <summary><h2>{title}</h2><span>{hint}</span></summary>
      <div className="lab-body">{children}</div>
    </details>
  );
}

function Badge({ status, error }: { status?: 'live' | 'stale'; error?: string | null }) {
  if (status === 'live') return <span className="lab-badge live">LIVE</span>;
  if (status === 'stale') return <span className="lab-badge stale">STALE · last good copy</span>;
  return <span className="lab-badge off" title={error ?? ''}>{error ? 'UNAVAILABLE' : 'LOADING'}</span>;
}

interface Series { name: string; color: string; dashed?: boolean; pts: { x: number; y: number }[] }
function Chart({ lines, band, unit, summary }: { lines: Series[]; band?: { x: number; lo: number; hi: number }[]; unit: string; summary: string }) {
  const W = 640; const H = 200; const P = 34;
  const xs = lines.flatMap((l) => l.pts.map((p) => p.x));
  const ys = [...lines.flatMap((l) => l.pts.map((p) => p.y)), ...(band ?? []).flatMap((b) => [b.lo, b.hi])];
  if (!xs.length) return <p className="lab-note">No points to chart.</p>;
  const x0 = Math.min(...xs); const x1 = Math.max(...xs); const y0 = Math.min(...ys); const y1 = Math.max(...ys);
  const sx = (x: number) => P + ((x - x0) / Math.max(1e-9, x1 - x0)) * (W - P - 8);
  const sy = (y: number) => H - P / 1.4 - ((y - y0) / Math.max(1e-9, y1 - y0)) * (H - P * 1.2);
  const path = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
  const bandPath = band?.length ? `${band.map((b, i) => `${i ? 'L' : 'M'}${sx(b.x).toFixed(1)},${sy(b.hi).toFixed(1)}`).join('')}${band.slice().reverse().map((b) => `L${sx(b.x).toFixed(1)},${sy(b.lo).toFixed(1)}`).join('')}Z` : '';
  return (
    <figure style={{ margin: 0 }}>
      <svg className="lab-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
        <title>{summary}</title>
        {y0 < 0 && y1 > 0 ? <line x1={P} x2={W - 8} y1={sy(0)} y2={sy(0)} stroke="#b9b0a0" strokeDasharray="3 4" /> : null}
        {bandPath ? <path d={bandPath} fill="#c9a24a" opacity="0.22" /> : null}
        {lines.map((l) => <path key={l.name} d={path(l.pts)} fill="none" stroke={l.color} strokeWidth="2" strokeDasharray={l.dashed ? '6 4' : undefined} strokeLinejoin="round" />)}
        <text x={P} y={H - 6} fontSize="11" fill="#64615C">{Math.round(x0)}</text>
        <text x={W - 8} y={H - 6} fontSize="11" fill="#64615C" textAnchor="end">{Math.round(x1)}</text>
        <text x={4} y={sy(y1) + 4} fontSize="11" fill="#64615C">{f1(y1, 2)}</text>
        <text x={4} y={sy(y0)} fontSize="11" fill="#64615C">{f1(y0, 2)}</text>
      </svg>
      <figcaption className="lab-caption">{lines.map((l) => <span key={l.name} style={{ color: l.color, marginRight: 14 }}>● {l.name}</span>)} Unit: {unit}</figcaption>
    </figure>
  );
}

const PRESETS: Record<string, Partial<ScenarioInput>> = {
  'net-zero': { fossilCo2ChangePct: -100, methaneChangePct: -60, horizonYears: 30, elNinoOni: 0 },
  'business-as-usual': { fossilCo2ChangePct: 0, methaneChangePct: 0, elNinoOni: 0 },
  'high-emissions': { fossilCo2ChangePct: 40, methaneChangePct: 30, elNinoOni: 0 },
  'el-nino': { elNinoOni: 1.5 },
  'la-nina': { elNinoOni: -1.5 },
  reset: NEUTRAL_SCENARIO,
};

export function CausalLab({ onNavigate }: { onNavigate: (view: WorkspaceView) => void }) {
  const [scenario, setScenario] = useState<ScenarioInput>(NEUTRAL_SCENARIO);
  const [molId, setMolId] = useState('co2');
  const [pickNote, setPickNote] = useState('');
  const [newsTopic, setNewsTopic] = useState<'climate' | 'india' | 'enso'>('india');
  const [dayIdx, setDayIdx] = useState(() => Math.floor((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 1)) / 86_400_000));
  const [sealNote, setSealNote] = useState('');
  const [voice, setVoice] = useState<{ state: 'idle' | 'listening' | 'error'; detail?: string }>({ state: 'idle' });
  const [heard, setHeard] = useState<{ text: string; outcome: string }[]>([]);
  const stopVoice = useRef<() => void>(() => undefined);

  const ensoQ = useLiveQuery(fetchEnso, { key: 'enso', intervalMs: 3_600_000, allowOffline: true });
  const inflQ = useLiveQuery(fetchIndiaInflation, { key: 'infl', intervalMs: 3_600_000, allowOffline: true });
  const newsLoader = useCallback((signal: AbortSignal) => fetchClimateNews(newsTopic, signal), [newsTopic]);
  const newsQ = useLiveQuery(newsLoader, { key: `news-${newsTopic}`, intervalMs: 600_000, allowOffline: true });
  const tempLoader = useCallback((signal: AbortSignal) => fetchHistoricalTimeline('temperature_anomaly', 1950, 2026, signal), []);
  const tempQ = useLiveQuery(tempLoader, { key: 'temp', intervalMs: 3_600_000, allowOffline: true });

  const result = useMemo(() => runScenario(scenario), [scenario]);
  const mol = MOLECULES.find((m) => m.id === molId) ?? MOLECULES[0];
  const molFractions = useMemo(() => massFractions(mol), [mol]);
  const molSetup = useMemo(() => moleculeSetup(mol), [mol]);
  const solarDate = useMemo(() => new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1 + dayIdx, 12)), [dayIdx]);
  const sun = useMemo(() => earthSun(solarDate), [solarDate]);
  const solarScene = useMemo(() => solarSetup(solarDate, 20), [solarDate]);
  const orbit = useMemo(() => orbitContext(forcing({ ...PRESENT }).total), []);

  const ensoModel = useMemo(() => {
    if (!ensoQ.data) return { model: null, error: null as string | null };
    try { return { model: trainEnsoForecaster(ensoQ.data.series), error: null }; }
    catch (e) { return { model: null, error: e instanceof Error ? e.message : 'Training failed.' }; }
  }, [ensoQ.data]);
  const trend = useMemo(() => {
    const obs = (tempQ.data?.observations ?? []).filter((o) => !o.is_gap && o.value !== null).map((o) => ({ year: o.year, value: o.value as number }));
    if (!obs.length) return { model: null, error: null as string | null, obs };
    try { return { model: trainWarmingTrend(obs, 2050), error: null, obs }; }
    catch (e) { return { model: null, error: e instanceof Error ? e.message : 'Training failed.', obs }; }
  }, [tempQ.data]);

  const set = <K extends keyof ScenarioInput>(key: K, value: ScenarioInput[K]) => setScenario((s) => ({ ...s, [key]: value }));

  const summaryText = `Scenario over ${scenario.horizonYears} years. Fossil CO2 ${signed(scenario.fossilCo2ChangePct, 0)} percent, methane ${signed(scenario.methaneChangePct, 0)} percent. Carbon dioxide reaches ${f1(result.gas.co2, 0)} parts per million. Warming versus today is ${signed(result.warmingVsTodayC, 2)} degrees Celsius. Wheat yield changes by ${signed(result.cropYieldChangePct.wheat)} percent. This is a simulation, not an observation.`;

  const apply = useCallback((cmd: VoiceCommand): string => {
    switch (cmd.type) {
      case 'goto': if (cmd.view === 'lab') return 'Already in the Causal Lab.'; onNavigate(cmd.view); return `Opened ${cmd.view}.`;
      case 'set': setScenario((s) => ({ ...s, [cmd.key]: cmd.value })); return `Set ${cmd.key} to ${cmd.value}.`;
      case 'preset': setScenario((s) => ({ ...s, ...PRESETS[cmd.id] })); return `Applied ${cmd.id}.`;
      case 'speak': return speak(summaryText) ? 'Reading the scenario summary.' : 'Speech output is not available in this browser.';
      default: return 'Not understood - nothing was changed.';
    }
  }, [onNavigate, summaryText]);
  const applyRef = useRef(apply);
  applyRef.current = apply;

  const toggleVoice = () => {
    if (voice.state === 'listening') { stopVoice.current(); setVoice({ state: 'idle' }); return; }
    stopVoice.current = listen(
      (text) => { const outcome = applyRef.current(parseVoiceCommand(text)); setHeard((h) => [{ text, outcome }, ...h].slice(0, 5)); },
      (state, detail) => setVoice({ state, detail }),
    );
  };
  useEffect(() => () => stopVoice.current(), []);

  const seal = async () => {
    setSealNote('');
    try {
      const record = await createEvidence({ moduleId: 'causal-lab', kind: 'scenario', mode: 'SIMULATED', summary: `Scenario: fossil CO2 ${signed(scenario.fossilCo2ChangePct, 0)}%, methane ${signed(scenario.methaneChangePct, 0)}%, ${scenario.horizonYears} y -> ${signed(result.warmingVsTodayC, 2)} C vs today`, payload: { input: scenario, output: result } });
      setSealNote(appendLedger(record) ? `Sealed as SIMULATED evidence ${record.sha256.slice(0, 12)}… — it can never be presented as an observation.` : 'Browser storage is unavailable, so the scenario could not be saved.');
    } catch { setSealNote('The scenario could not be hashed in this browser.'); }
  };

  const ensoSeries = ensoQ.data?.series ?? [];
  const recentEnso = ensoSeries.slice(-180);
  const latestEnso = ensoSeries[ensoSeries.length - 1];
  const infl = inflQ.data?.series ?? [];

  return (
    <div className="lab">
      <header className="lab-head">
        <div>
          <h1>Causal Lab — how people and climate act on each other</h1>
          <p>Build a scenario, see which gases and molecules carry the effect, and follow it both ways: human actions into the climate, and climate back into daily life. Every number is labelled live, stale, simulated or unavailable. Nothing is invented.</p>
        </div>
        <div className="lab-controls" style={{ minWidth: 260 }}>
          <button type="button" className={`lab-btn ${voice.state === 'listening' ? 'voice-on' : 'primary'}`} onClick={toggleVoice} disabled={!voiceSupported()} aria-pressed={voice.state === 'listening'}>
            {voice.state === 'listening' ? 'Stop listening' : 'Speak to the platform'}
          </button>
          {!voiceSupported() ? <p className="lab-note">Voice needs Chrome or Edge. Every control also works by mouse and keyboard.</p> : <p className="lab-caption">Try: “cut fossil emissions by 40 percent”, “run the El Niño scenario”, “show the blockchain ledger”, “read the summary”.</p>}
          {voice.detail ? <p className="lab-note error" role="alert">{voice.detail}</p> : null}
          <ul className="lab-voice-log" aria-live="polite">{heard.map((h, i) => <li key={`${h.text}-${i}`}>“{h.text}” → {h.outcome}</li>)}</ul>
        </div>
      </header>

      <Section title="Scenario builder" hint="SIMULATED · first-order physics">
        <div className="lab-grid">
          <div className="lab-controls">
            <div className="lab-chips" role="group" aria-label="Scenario presets">
              {Object.keys(PRESETS).map((id) => <button key={id} type="button" className="lab-chip" onClick={() => setScenario((s) => ({ ...s, ...PRESETS[id] }))}>{id.replace(/-/g, ' ')}</button>)}
            </div>
            {([
              ['fossilCo2ChangePct', 'Fossil CO₂ emissions vs today', -100, 60, 5, '%'],
              ['methaneChangePct', 'Human methane emissions vs today', -100, 60, 5, '%'],
              ['horizonYears', 'Years ahead', 5, 80, 1, ' y'],
              ['sensitivity', 'Climate sensitivity per CO₂ doubling', 2, 5, 0.1, ' °C'],
              ['elNinoOni', 'ENSO overlay (ONI: + El Niño, − La Niña)', -2.5, 3, 0.1, ''],
            ] as const).map(([key, label, min, max, step, unit]) => (
              <div className="lab-field" key={key}>
                <label htmlFor={`sc-${key}`}>{label}<output>{key === 'fossilCo2ChangePct' || key === 'methaneChangePct' ? signed(scenario[key], 0) : f1(scenario[key], key === 'horizonYears' ? 0 : 1)}{unit}</output></label>
                <input id={`sc-${key}`} type="range" min={min} max={max} step={step} value={scenario[key]} onChange={(e) => set(key, Number(e.target.value))} />
              </div>
            ))}
            <button type="button" className="lab-btn primary" onClick={seal}>Seal scenario to evidence ledger</button>
            {sealNote ? <p className="lab-note" role="status">{sealNote}</p> : null}
          </div>
          <div className="lab-controls">
            <div className="lab-results" aria-live="polite">
              <div className="lab-metric"><b>{f1(result.gas.co2, 0)} ppm</b><span>CO₂ in {scenario.horizonYears} y (now {PRESENT.co2})</span></div>
              <div className="lab-metric"><b>{f1(result.gas.ch4, 0)} ppb</b><span>CH₄ (now {PRESENT.ch4})</span></div>
              <div className="lab-metric"><b>{f1(result.forcing.total, 2)} W/m²</b><span>gas forcing since 1750 (overlap term omitted)</span></div>
              <div className="lab-metric"><b>{signed(result.warmingVsTodayC, 2)} °C</b><span>vs today incl. ENSO ({signed(result.ensoContributionC, 2)})</span></div>
              <div className="lab-metric"><b>{signed(result.warmingVsBauC, 2)} °C</b><span>vs “emissions stay as today”</span></div>
              <div className="lab-metric"><b>{signed(result.extremeRainIntensityPct, 0)}%</b><span>extreme-rain intensity</span></div>
            </div>
            <p className="lab-caption">Crop yield change (global, Zhao 2017): {Object.entries(result.cropYieldChangePct).map(([k, v]) => `${k} ${signed(v)}%`).join(' · ')}.</p>
            <p className="lab-caption"><span className="lab-badge sim">SIMULATED</span> One-box model: ~45% of CO₂ stays airborne, methane decays with a 11.8-year lifetime, {Math.round(result.realisedFraction * 100)}% of equilibrium warming is realised by the horizon. It ignores aerosols, so read it as a sensitivity tool, not a forecast.</p>
          </div>
        </div>
      </Section>

      <Section title="Two-way causal map" hint="humans → climate → humans">
        <div className="lab-causal">
          {(['human-to-climate', 'climate-to-human'] as const).map((dir) => (
            <div key={dir}>
              <h3>{dir === 'human-to-climate' ? 'What people do to the climate' : 'What the climate does to daily life'}</h3>
              {CAUSAL_LINKS.filter((l) => l.direction === dir).map((l) => (
                <div key={l.id} className={`lab-link ${dir === 'climate-to-human' ? 'c2h' : ''}`}>
                  <strong>{l.from} → {l.to}</strong>
                  <span>{l.mechanism}</span><br /><small>Evidence: {l.evidence}</small>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Molecules behind the warming" hint="drag to rotate · click an atom">
        <div className="lab-chips" role="group" aria-label="Molecule">
          {MOLECULES.map((m) => <button key={m.id} type="button" className="lab-chip" aria-pressed={m.id === molId} onClick={() => { setMolId(m.id); setPickNote(''); }}>{m.formula} · {m.name}</button>)}
        </div>
        <div className="lab-grid">
          <ThreeCanvas setup={molSetup} label={`3D ball-and-stick model of ${mol.name}`} height={320} distance={6} onPick={(v) => setPickNote(typeof v === 'string' ? `Atom ${v}: ${(molFractions.fractions[v] * 100).toFixed(1)}% of ${mol.formula} by mass.` : '')} />
          <div className="lab-split">
            <p className="lab-caption">{mol.role}</p>
            <table className="lab-table"><tbody>
              <tr><th>Molar mass</th><td>{f1(molFractions.total, 2)} g/mol</td></tr>
              {Object.entries(molFractions.fractions).map(([el, fr]) => <tr key={el}><th>{el} by mass</th><td>{f1(fr * 100, 1)}%</td></tr>)}
              <tr><th>GWP-100</th><td>{mol.gwp100}</td></tr>
              <tr><th>Lifetime</th><td>{mol.lifetime}</td></tr>
            </tbody></table>
            {pickNote ? <p className="lab-note" role="status">{pickNote}</p> : null}
            <h3 style={{ margin: '8px 0 0', fontSize: '1rem' }}>Share of scenario forcing by gas</h3>
            {result.shares.map((s) => <div className="lab-bar" key={s.id}><span>{s.id.toUpperCase()}</span><i style={{ width: `${Math.max(1, s.share * 100)}%` }} /><span>{f1(s.share * 100, 0)}% · {f1(s.wm2, 2)}</span></div>)}
          </div>
        </div>
      </Section>

      <Section title="Sun–Earth distance" hint="computed from Kepler orbit · eccentricity drawn 20×">
        <div className="lab-grid">
          <ThreeCanvas setup={solarScene} label="3D Sun and Earth orbit with perihelion and aphelion markers" height={340} distance={9} onPick={(v) => setPickNote(v === 'perihelion' ? 'Perihelion: closest point, about 3 January (0.983 AU).' : v === 'aphelion' ? 'Aphelion: farthest point, about 4–6 July (1.017 AU).' : v === 'sun' ? 'Sun: delivers ~1361 W/m² at 1 AU.' : v === 'earth' ? 'Earth, tilted 23.4°.' : '')} />
          <div className="lab-controls">
            <div className="lab-field"><label htmlFor="day">Day of year<output>{solarDate.toISOString().slice(0, 10)}</output></label><input id="day" type="range" min={0} max={364} value={dayIdx} onChange={(e) => setDayIdx(Number(e.target.value))} /></div>
            <div className="lab-results">
              <div className="lab-metric"><b>{sun.km.toLocaleString('en-IN', { maximumFractionDigits: 0 })} km</b><span>{f1(sun.au, 4)} AU · light takes {f1(sun.lightMinutes, 2)} min</span></div>
              <div className="lab-metric"><b>{signed(sun.dailyDeltaKm, 0)} km/day</b><span>{sun.dailyDeltaKm >= 0 ? 'moving away' : 'moving closer'}</span></div>
              <div className="lab-metric"><b>{f1(sun.irradiance, 0)} W/m²</b><span>sunlight at Earth today</span></div>
            </div>
            <p className="lab-caption">{orbit.note} Seasonal orbit swing ≈ {f1(orbit.orbitSwingWm2, 1)} W/m² of absorbed sunlight and averages to zero; human gas forcing is ≈ {f1(orbit.humanForcingWm2, 1)} W/m² and persists. {pickNote}</p>
          </div>
        </div>
      </Section>

      <Section title="El Niño and the warming trend" hint="NOAA ONI · models trained in your browser">
        <div className="lab-grid">
          <div className="lab-split">
            <p><Badge status={ensoQ.data && ensoQ.error ? 'stale' : ensoQ.data?.status} error={ensoQ.error} /> {ensoQ.data ? <span className="lab-caption">{ensoQ.data.source} · fetched {ensoQ.data.fetchedAt.slice(0, 16).replace('T', ' ')} UTC</span> : <span className="lab-caption">{errText(ensoQ.error)}</span>}</p>
            {recentEnso.length ? <Chart unit="ONI (°C anomaly, Niño-3.4)" summary={`Oceanic Niño Index for the last 15 years; latest ${latestEnso?.season} ${latestEnso?.year} is ${latestEnso?.oni}, a ${latestEnso?.phase} state.`}
              lines={[{ name: 'ONI', color: '#8a6d2f', pts: recentEnso.map((r) => ({ x: r.year + (r.month - 1) / 12, y: r.oni })) }, { name: '+0.5 El Niño', color: '#d9483b', dashed: true, pts: [{ x: recentEnso[0].year, y: 0.5 }, { x: latestEnso.year + 1, y: 0.5 }] }, { name: '−0.5 La Niña', color: '#3f6fd1', dashed: true, pts: [{ x: recentEnso[0].year, y: -0.5 }, { x: latestEnso.year + 1, y: -0.5 }] }]} /> : null}
            {latestEnso ? <p className="lab-stat">Now: {latestEnso.phase} (ONI {signed(latestEnso.oni, 2)}, {latestEnso.season} {latestEnso.year})</p> : null}
            {ensoModel.error ? <p className="lab-note error" role="alert">{ensoModel.error}</p> : null}
            {ensoModel.model ? (
              <>
                <table className="lab-table"><thead><tr><th>Lead</th><th>Forecast for</th><th>ONI</th><th>Phase</th><th>Skill vs persistence</th></tr></thead><tbody>
                  {ensoModel.model.forecast.map((f, i) => { const h = ensoModel.model!.horizons[i]; return <tr key={f.horizon}><td>{f.horizon} mo</td><td>{f.month}</td><td>{signed(f.oni, 2)}</td><td>{f.phase}</td><td>{signed(h.skillVsPersistence * 100, 0)}% (RMSE {f1(h.rmse, 2)} vs {f1(h.persistenceRmse, 2)})</td></tr>; })}
                </tbody></table>
                <p className="lab-caption">Ridge autoregression on 12 monthly lags + season, one model per lead, trained to {ensoModel.model.testFrom} and scored on the unseen months after it. Positive skill means it beat “tomorrow equals today”. ENSO forecasts beyond ~6 months are intrinsically uncertain (spring barrier).</p>
                <button type="button" className="lab-btn" onClick={() => set('elNinoOni', Math.round(ensoModel.model!.forecast[ensoModel.model!.forecast.length - 1].oni * 10) / 10)}>Use the 6-month forecast as the ENSO overlay</button>
              </>
            ) : null}
          </div>
          <div className="lab-split">
            <p><Badge status={tempQ.data ? (tempQ.error ? 'stale' : 'live') : undefined} error={tempQ.error} /> <span className="lab-caption">{tempQ.data ? 'Observed global temperature anomaly from the audited gateway dataset (gaps preserved).' : errText(tempQ.error)}</span></p>
            {trend.model ? (
              <>
                <Chart unit="°C vs 1901–2000" summary={`Observed global temperature anomaly with a fitted trend and 95% band projected to 2050, reaching ${f1(trend.model.predict(2050), 2)} degrees.`}
                  lines={[{ name: 'Observed', color: '#2b2620', pts: trend.obs.filter((o) => o.year >= 1970).map((o) => ({ x: o.year, y: o.value })) }, { name: 'Trend → 2050', color: '#b3412f', dashed: true, pts: trend.model.projection.map((p) => ({ x: p.year, y: p.value })) }]}
                  band={trend.model.projection.map((p) => ({ x: p.year, lo: p.low, hi: p.high }))} />
                <p className="lab-caption">Quadratic trend with a heuristic ±1.96σ band (σ = the larger of fit and backtest error, widened with distance), backtested on {trend.model.n} points: error after {trend.model.cutoff} is {f1(trend.model.backtestRmse, 3)} °C vs {f1(trend.model.linearBacktestRmse, 3)} °C for a straight line. This is a statistical extrapolation of the measured record, not a physical projection; the band widens with distance.</p>
              </>
            ) : <p className="lab-note">{trend.error ?? 'Waiting for the observed record.'}</p>}
          </div>
        </div>
      </Section>

      <Section title="What is happening now" hint="live headlines & India inflation">
        <div className="lab-grid">
          <div className="lab-split">
            <div className="lab-chips" role="group" aria-label="News topic">
              {([['india', 'India'], ['climate', 'World'], ['enso', 'El Niño / La Niña']] as const).map(([id, label]) => <button key={id} type="button" className="lab-chip" aria-pressed={newsTopic === id} onClick={() => setNewsTopic(id)}>{label}</button>)}
            </div>
            <p><Badge status={newsQ.data && newsQ.error ? 'stale' : newsQ.data?.status} error={newsQ.error} /> <span className="lab-caption">{newsQ.data ? `${newsQ.data.outlets.join(' · ')}${newsQ.data.failedOutlets.length ? ` (unreachable: ${newsQ.data.failedOutlets.join(', ')})` : ''}` : errText(newsQ.error)}</span></p>
            {newsQ.data && !newsQ.data.articles.length ? <p className="lab-note">The index returned no headlines for this topic right now.</p> : null}
            <ul className="lab-news">{(newsQ.data?.articles ?? []).slice(0, 8).map((a) => <li key={a.url}><a href={a.url} target="_blank" rel="noopener noreferrer">{a.title}<br /><small>{a.outlet}{a.seenAt ? ` · ${a.seenAt.slice(0, 10)}` : ''}</small></a></li>)}</ul>
            <p className="lab-caption">Headlines are an index of what outlets published, not verified claims.</p>
          </div>
          <div className="lab-split">
            <p><Badge status={inflQ.data && inflQ.error ? 'stale' : inflQ.data?.status} error={inflQ.error} /> <span className="lab-caption">{inflQ.data ? inflQ.data.source : errText(inflQ.error)}</span></p>
            {infl.length ? <>
              <p className="lab-stat">India CPI inflation {infl[infl.length - 1].year}: {f1(infl[infl.length - 1].inflationPct, 2)}%</p>
              <Chart unit="% per year" summary={`India annual consumer price inflation from ${infl[0].year} to ${infl[infl.length - 1].year}; latest ${f1(infl[infl.length - 1].inflationPct, 2)} percent.`} lines={[{ name: 'Inflation', color: '#8a6d2f', pts: infl.map((p) => ({ x: p.year, y: p.inflationPct })) }]} />
              <p className="lab-caption">Food is a large share of India’s price basket, so monsoon shocks can pass into prices. This panel shows the published series only; it does not attribute any year’s inflation to climate.</p>
            </> : null}
          </div>
        </div>
      </Section>

      <Section title="Transparency ledger in 3D" hint="every record, hashed and verifiable" open={false}>
        <Suspense fallback={<p className="lab-note">Loading 3D ledger…</p>}><LedgerChain3D /></Suspense>
        <div className="lab-chips">
          <button type="button" className="lab-btn" onClick={() => onNavigate('ledger')}>Open full evidence ledger</button>
          <button type="button" className="lab-btn" onClick={() => onNavigate('timeline')}>200-year timeline</button>
          <button type="button" className="lab-btn" onClick={() => onNavigate('earth')}>Monitor any place on Earth</button>
        </div>
      </Section>
    </div>
  );
}
