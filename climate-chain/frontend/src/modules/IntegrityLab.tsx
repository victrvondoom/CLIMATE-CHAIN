// Climate Integrity Lab: one guided path from a real air-quality signal to an on-chain proof a
// reviewer can check without trusting this app, then through tamper, replay, duplicate-claim,
// challenge and correction tests. Every hash, receipt and rejection shown here comes back from
// the gateway or straight from the chain RPC; the page never draws a result it did not receive.

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  IntegrityApiError, integrityApi,
  type ChallengeResponse, type ClaimResponse, type CorrectionResponse, type DuplicateResponse, type EvidenceBundle,
  type EvidenceProof, type EvidenceResponse, type HistoryResponse, type RejectionResponse, type ResolveResponse,
  type SitesResponse, type SourceMode, type StatusResponse, type TamperResponse, type VerifyResponse,
  type FirewallEvaluationResult, type FirewallBenchmarkResponse,
} from '../integrity/api';
import { curlEvidenceCall, digestOf, verifyIndependently, type IndependentResult } from '../integrity/verify';
import './integrity.css';

const STEPS = [
  { id: 'signal', title: 'Signal', short: 'Choose a real signal' },
  { id: 'packet', title: 'Evidence', short: 'Inspect the packet' },
  { id: 'anchor', title: 'Anchor', short: 'Write and verify on-chain' },
  { id: 'attack', title: 'Tamper', short: 'Tamper and replay' },
  { id: 'firewall', title: 'Trust Firewall', short: 'Policy & benchmarks' },
  { id: 'claim', title: 'Claim', short: 'Claim once only' },
  { id: 'challenge', title: 'Challenge', short: 'Challenge and correct' },
  { id: 'next', title: 'Next steps', short: 'What to do next' },
] as const;
type StepId = typeof STEPS[number]['id'];

const MODES: { id: SourceMode; label: string; detail: string }[] = [
  { id: 'live-or-cached', label: 'Live, with a labelled fallback', detail: 'Fetches Open-Meteo now. If that fails, uses the stored example and says so.' },
  { id: 'live', label: 'Live only', detail: 'Fails visibly if Open-Meteo cannot be reached.' },
  { id: 'cached', label: 'Cached historical example', detail: 'A real response captured on 23 Oct 2026, always labelled as cached.' },
];

const REASONS = [
  { code: 'MODEL_NOT_OBSERVATION', label: 'Model value used as if observed', detail: 'The claim relies on a 45 km CAMS model value, not a ground monitor reading.' },
  { code: 'STALE_SOURCE', label: 'Stale or cached source', detail: 'The evidence uses a cached example or old model hours, not a fresh retrieval.' },
  { code: 'WRONG_UNIT', label: 'Wrong unit or averaging period', detail: 'The statement compares values with a different unit or averaging period than the source.' },
  { code: 'INCONSISTENT_SOURCES', label: 'Sources disagree', detail: 'A station measurement for the same hours disagrees with the model value.' },
  { code: 'EVIDENCE_REUSED', label: 'Evidence reused', detail: 'The same evidence appears to back another claim.' },
  { code: 'CONFLICTING_REGISTRY', label: 'Conflicting registry', detail: 'Another registry lists a claim for the same scope and period.' },
  { code: 'OTHER', label: 'Other', detail: 'Describe the problem with this claim in your own words.' },
];

const DEFAULT_NOTE = 'Re-retrieved the source; the statement now names the model basis and grid size explicitly.';
const DEFAULT_SITES = [{ id: 'new-delhi', label: 'New Delhi' }, { id: 'chennai', label: 'Chennai' }];
const DEFAULT_ANALYTES = [{ id: 'pm2_5', label: 'PM2.5' }, { id: 'pm10', label: 'PM10' }, { id: 'nitrogen_dioxide', label: 'NO₂' }, { id: 'ozone', label: 'O₃' }, { id: 'sulphur_dioxide', label: 'SO₂' }, { id: 'carbon_monoxide', label: 'CO' }];

// Only the ids of the current run are kept, so a reload or a pinned panel can pick it up again.
const SAVED_KEY = 'climate-chain-integrity-lab-v1';
interface SavedRun { evidenceId: string | null; claimId: string | null }
const EMPTY_RUN: SavedRun = { evidenceId: null, claimId: null };

function readSavedRun(): SavedRun {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SAVED_KEY) ?? 'null');
    if (!parsed || typeof parsed !== 'object') return EMPTY_RUN;
    const { evidenceId, claimId } = parsed as Record<string, unknown>;
    return {
      evidenceId: typeof evidenceId === 'string' && /^ev-[a-f0-9]{24}$/.test(evidenceId) ? evidenceId : null,
      claimId: typeof claimId === 'string' && /^cl-[a-f0-9]{24}$/.test(claimId) ? claimId : null,
    };
  } catch {
    return EMPTY_RUN;
  }
}

function saveRun(run: SavedRun) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(run)); } catch { /* storage blocked: the run lasts for this visit */ }
}

function formatUtc(value?: string | null) {
  if (!value) return '—';
  const time = Date.parse(value);
  return Number.isFinite(time) ? `${new Date(time).toISOString().slice(0, 16).replace('T', ' ')} UTC` : value;
}

const short = (hash?: string | null) => (hash ? `${hash.slice(0, 12)}…${hash.slice(-6)}` : '—');

function errorMessage(error: unknown) {
  if (error instanceof IntegrityApiError) {
    return `${error.message}${error.errorName ? ` Contract error: ${error.errorName}.` : ''}${error.retryAfterSeconds ? ` Retry after ${error.retryAfterSeconds} s.` : ''}`;
  }
  return error instanceof Error ? error.message : 'The request failed.';
}

type Tone = 'model' | 'live' | 'cached' | 'derived' | 'chain' | 'pass' | 'fail' | 'demo' | 'offline' | 'test';

function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`il-badge il-badge-${tone}`}>{children}</span>;
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="il-facts">
      {rows.map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}
    </dl>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="il-code">{children}</code>;
}

function CheckList({ title, checks }: { title: string; checks: { id: string; label: string; ok: boolean; detail: string }[] }) {
  return (
    <div className="il-checks">
      <h4>{title}</h4>
      <ul>
        {checks.map((check) => (
          <li key={check.id} className={check.ok ? 'ok' : 'bad'}>
            <span className="il-mark" aria-hidden="true">{check.ok ? '✓' : '✕'}</span>
            <span><strong>{check.label}</strong><Code>{check.detail}</Code></span>
            <span className="sr-only">{check.ok ? 'passed' : 'failed'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Rejection({ result, expected }: { result: RejectionResponse; expected: string }) {
  return (
    <div className="il-result" role="status">
      <div className="il-badges">
        <Badge tone="test">CONTROLLED TEST DATA</Badge>
        <Badge tone={result.errorName === expected ? 'pass' : 'fail'}>REJECTED BY CONTRACT · {result.errorName}</Badge>
      </div>
      <Facts rows={[
        ['Call', `${result.method} from ${short(result.from)}`],
        ['Transaction', result.transactionHash ? <Code>{result.transactionHash}</Code> : 'Not mined'],
        ['Receipt', result.mined ? `status ${result.receiptStatus} in block ${result.blockNumber} · gas used ${result.gasUsed}` : 'Refused by the node before mining'],
        ['Meaning', result.note],
      ]} />
    </div>
  );
}

// initialSiteId is the site for the shared air location. It only sets the starting selection.
export function IntegrityLab({ initialSiteId }: { initialSiteId?: string } = {}) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<SitesResponse | null>(null);
  const [step, setStep] = useState<StepId>('signal');
  const [siteId, setSiteId] = useState(initialSiteId ?? 'new-delhi');
  const [analyte, setAnalyte] = useState('pm2_5');
  const [mode, setMode] = useState<SourceMode>('live-or-cached');
  const [evidence, setEvidence] = useState<EvidenceResponse | null>(null);
  const [proof, setProof] = useState<EvidenceProof | null>(null);
  const [browserDigest, setBrowserDigest] = useState<string | null>(null);
  const [gatewayCheck, setGatewayCheck] = useState<VerifyResponse | null>(null);
  const [browserCheck, setBrowserCheck] = useState<IndependentResult | null>(null);
  const [tamper, setTamper] = useState<TamperResponse | null>(null);
  const [browserTamperDigest, setBrowserTamperDigest] = useState<string | null>(null);
  const [replay, setReplay] = useState<RejectionResponse | null>(null);
  const [claim, setClaim] = useState<ClaimResponse | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateResponse | null>(null);
  const [challenge, setChallenge] = useState<ChallengeResponse | null>(null);
  const [resolution, setResolution] = useState<ResolveResponse | null>(null);
  const [correction, setCorrection] = useState<CorrectionResponse | null>(null);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [reason, setReason] = useState(REASONS[0].code);
  const [detail, setDetail] = useState(REASONS[0].detail);
  const [note, setNote] = useState(DEFAULT_NOTE);
  const [firewallClaimType, setFirewallClaimType] = useState('ENVIRONMENTAL_OBSERVATION');
  const [firewallSubtype, setFirewallSubtype] = useState('');
  const [claimedValue, setClaimedValue] = useState('');
  const [firewallResult, setFirewallResult] = useState<FirewallEvaluationResult | null>(null);
  const [benchmarkResult, setBenchmarkResult] = useState<FirewallBenchmarkResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ action: string; message: string; errorName: string | null; retry: () => void } | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await integrityApi.status();
      setStatus(next);
      setStatusError(null);
    } catch (error) {
      setStatusError(errorMessage(error));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await refreshStatus();
      try {
        const sites = await integrityApi.sites();
        if (!cancelled) setCatalog(sites);
      } catch { /* the defaults below still work */ }
      const saved = readSavedRun();
      if (!saved.evidenceId) return;
      try {
        const restored = await integrityApi.getEvidence(saved.evidenceId);
        if (cancelled) return;
        setEvidence(restored);
        setProof(restored.proof?.anchored ? restored.proof : null);
        setSiteId(restored.bundle.location.siteId);
        setAnalyte(restored.bundle.focusAnalyte);
        if (saved.claimId) {
          const stored = await integrityApi.getClaim(saved.claimId);
          if (!cancelled && stored.proof?.recorded) setClaim({ claim: stored.claim, claimHash: stored.claimHash, proof: stored.proof });
        }
      } catch {
        saveRun(EMPTY_RUN);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshStatus]);

  async function run<T>(action: string, task: () => Promise<T>, onDone: (value: T) => void) {
    setBusy(action);
    setFailure(null);
    try {
      onDone(await task());
    } catch (error) {
      setFailure({ action, message: errorMessage(error), errorName: error instanceof IntegrityApiError ? error.errorName : null, retry: () => { void run(action, task, onDone); } });
    } finally {
      setBusy(null);
    }
  }

  function clearAfterEvidence() {
    setProof(null); setBrowserDigest(null); setGatewayCheck(null); setBrowserCheck(null);
    setTamper(null); setBrowserTamperDigest(null); setReplay(null); setClaim(null); setDuplicate(null);
    setChallenge(null); setResolution(null); setCorrection(null); setHistory(null);
    setFirewallResult(null); setBenchmarkResult(null);
  }

  const buildEvidence = () => run('Build evidence', () => integrityApi.buildEvidence({ siteId, analyte, mode }), (result) => {
    clearAfterEvidence();
    setEvidence(result);
    setProof(result.proof?.anchored ? result.proof : null);
    saveRun({ evidenceId: result.evidenceId, claimId: null });
  });

  const recompute = () => {
    if (evidence) void run('Recompute digest', () => digestOf(evidence.bundle), setBrowserDigest);
  };

  const anchor = () => {
    if (evidence) void run('Anchor evidence', () => integrityApi.anchor(evidence.evidenceId), (result) => { setProof(result); void refreshStatus(); });
  };

  const verify = () => {
    const contracts = status?.contracts;
    if (!evidence || !proof || !status || !contracts) return;
    void run('Verify independently', () => Promise.all([
      integrityApi.verify(evidence.evidenceId),
      verifyIndependently({ rpcUrl: status.rpcUrl, contractAddress: contracts.evidenceRegistry.address, evidenceId: evidence.evidenceId, bundle: evidence.bundle, expectedDigest: evidence.digest, transactionHash: proof.transactionHash }),
    ]), ([gateway, browser]) => { setGatewayCheck(gateway); setBrowserCheck(browser); });
  };

  const runTamper = () => {
    if (!evidence) return;
    void run('Tamper test', async () => {
      const result = await integrityApi.tamper(evidence.evidenceId);
      // Apply the same change to this browser's copy and hash it here too.
      const copy = structuredClone(evidence.bundle) as EvidenceBundle;
      const index = Number(/\[(\d+)\]/.exec(result.change.path)?.[1] ?? -1);
      if (copy.measurements[index]) copy.measurements[index].value = result.change.after;
      return { result, digest: await digestOf(copy) };
    }, ({ result, digest }) => { setTamper(result); setBrowserTamperDigest(digest); });
  };

  const runReplay = () => {
    if (evidence) void run('Replay evidence', () => integrityApi.replay(evidence.evidenceId), setReplay);
  };

  const runFirewall = () => {
    if (!evidence) return;
    // With the air-quality profile the claim states a value and unit that must match the evidence. The default is the
    // latest value in the bundle; type a different number to watch claim-type-aware sufficiency reject it.
    const focus = evidence.bundle.focusAnalyte;
    const series = evidence.bundle.measurements.filter((m) => m.analyte === focus && typeof m.value === 'number');
    const latest = series[series.length - 1];
    const typed = Number(claimedValue);
    const stated = claimedValue.trim() !== '' && Number.isFinite(typed) ? typed : latest?.value;
    const testClaim = {
      claimId: `cl-firewall-test-${evidence.evidenceId.slice(3, 15)}`,
      claimType: firewallClaimType,
      scope: {
        domain: 'air_quality',
        boundary: evidence.bundle.location.siteId,
        timeEpoch: evidence.bundle.timeframe.endUtc.slice(0, 10),
        activityType: evidence.bundle.focusAnalyte,
        lat: evidence.bundle.location.lat,
        lon: evidence.bundle.location.lon,
      },
      evidence: [{ evidenceId: evidence.evidenceId, digest: evidence.digest }],
      result: {
        statement: `Claim submitted for evaluation under tier ${firewallClaimType}`,
        analyte: focus,
        value: stated,
        unit: latest?.unit,
        aggregation: 'latest',
      },
    };
    void run('Firewall evaluation', () => integrityApi.evaluateFirewall({
      claim: testClaim,
      evidence: evidence.bundle,
      expectedDigest: evidence.digest,
      claimType: firewallClaimType,
      ...(firewallSubtype ? { claimSubtype: firewallSubtype } : {}),
    }), setFirewallResult);
  };

  const runAdversarialBenchmark = () => {
    void run('Adversarial benchmark', () => integrityApi.benchmarkFirewall(), setBenchmarkResult);
  };

  const submitClaim = () => {
    if (evidence) void run('Submit claim', () => integrityApi.submitClaim(evidence.evidenceId), (result) => {
      setClaim(result); setDuplicate(null); setChallenge(null); setResolution(null); setCorrection(null);
      saveRun({ evidenceId: evidence.evidenceId, claimId: result.claim.claimId });
    });
  };

  const submitDuplicate = () => {
    if (claim) void run('Duplicate claim', () => integrityApi.duplicateClaim(claim.claim.claimId), setDuplicate);
  };

  const submitChallenge = () => {
    if (claim) void run('Challenge claim', () => integrityApi.challenge(claim.claim.claimId, { reasonCode: reason, detail }), (result) => {
      setChallenge(result);
      setClaim({ ...claim, proof: result.proof });
    });
  };

  const decide = (upheld: boolean) => {
    if (claim) void run(upheld ? 'Uphold challenge' : 'Dismiss challenge', () => integrityApi.resolve(claim.claim.claimId, upheld), (result) => {
      setResolution(result);
      setClaim({ ...claim, proof: result.proof });
    });
  };

  const approveCorrection = () => {
    if (claim) void run('Approve correction', () => integrityApi.correct(claim.claim.claimId, note), (result) => {
      setCorrection(result);
      setClaim({ ...claim, proof: result.originalClaim.proof });
    });
  };

  const loadHistory = () => { void run('Load history', () => integrityApi.history(), setHistory); };

  // A new demo scope keeps the anchored evidence and only starts a fresh claim scope on-chain.
  const openNewScope = () => {
    void run('Open a new demo scope', () => integrityApi.reset(), () => {
      setClaim(null); setDuplicate(null); setChallenge(null); setResolution(null); setCorrection(null); setHistory(null);
      if (evidence) saveRun({ evidenceId: evidence.evidenceId, claimId: null });
      void refreshStatus();
    });
  };

  const startNewRun = () => {
    void run('Start a new demo run', async () => { if (status?.ledgerMode === 'LOCAL_EVM') await integrityApi.reset(); }, () => {
      clearAfterEvidence();
      setEvidence(null);
      saveRun(EMPTY_RUN);
      setStep('signal');
      void refreshStatus();
    });
  };

  const anchored = Boolean(proof?.anchored);
  const ledgerReady = status?.ledgerMode === 'LOCAL_EVM';
  const bundle = evidence?.bundle ?? null;
  const source = bundle?.sources[0] ?? null;
  const derived = bundle?.derived[0] ?? null;
  const definition = bundle?.analyteDefinitions.find((item) => item.id === bundle.focusAnalyte) ?? null;
  const latest = bundle?.measurements.filter((item) => item.series).at(-1) ?? null;
  const claimStatus = claim?.proof.status ?? null;
  const available: Record<StepId, boolean> = {
    signal: true, packet: Boolean(evidence), anchor: Boolean(evidence), attack: anchored, firewall: Boolean(evidence), claim: anchored, challenge: Boolean(claim), next: Boolean(evidence),
  };
  const done: Record<StepId, boolean> = {
    signal: Boolean(evidence), packet: Boolean(browserDigest), anchor: Boolean(browserCheck?.verified), attack: Boolean(tamper && replay),
    firewall: Boolean(firewallResult || benchmarkResult),
    claim: Boolean(claim && duplicate), challenge: Boolean(correction || resolution), next: false,
  };
  const sites = catalog?.sites ?? DEFAULT_SITES;
  const analytes = catalog?.analytes ?? DEFAULT_ANALYTES;
  const stepIndex = STEPS.findIndex((item) => item.id === step);
  const nextStep = STEPS[stepIndex + 1];
  const continueButton = nextStep && available[nextStep.id]
    ? <button type="button" className="primary-action" onClick={() => setStep(nextStep.id)}>Continue to {nextStep.title.toLowerCase()} <span aria-hidden="true">→</span></button>
    : null;

  return (
    <div className="il" aria-busy={busy !== null}>
      <section className="il-panel il-head" aria-labelledby="il-title">
        <div className="il-head-copy">
          <span className="eyebrow">CLIMATE INTEGRITY LAB · PROOF OF ENVIRONMENTAL INTEGRITY</span>
          <h2 id="il-title">From a real air-quality signal to a proof you can check yourself</h2>
          <p className="muted">Each step calls the gateway and its EVM chain. Hashes, receipts and rejections on this page are read back from the chain, not drawn by the page. A digest proves these bytes have not changed since anchoring; it does not prove the measurement is true.</p>
        </div>
        <div className="il-ledger" role="status">
          {ledgerReady && status?.contracts ? (
            <>
              <Badge tone="chain">{status.chainMode === 'in-process' ? 'IN-PROCESS EVM' : 'LOCAL EVM'} · CHAIN {status.chainId} · BLOCK {status.latestBlock}</Badge>
              <Facts rows={[
                ['Evidence registry', <Code key="e">{status.contracts.evidenceRegistry.address}</Code>],
                ['Claim registry', <Code key="c">{status.contracts.claimRegistry.address}</Code>],
                ['Records', `${status.evidenceCount} evidence · ${status.claimCount} claims · demo run ${status.demoRun}`],
                ...(status.ledger?.journal ? [['Ledger', `${status.ledger.sharedAcrossInstances ? 'Shared journal (Vercel Blob)' : status.ledger.persistence === 'file' ? 'Journal on this server’s disk' : 'In memory only'} · ${status.ledger.journal.entries} signed transactions · ${status.ledger.replayedOnBoot ?? 0} replayed at start`] as [string, string]] : []),
              ]} />
              <p className="muted small">{status.accountsNote}</p>
            </>
          ) : (
            <>
              <Badge tone="offline">OFFLINE · NOT ANCHORED</Badge>
              <p className="small">{status?.problem?.message ?? statusError ?? 'Checking the local chain…'}</p>
              <p className="muted small">Start everything with <Code>start.ps1</Code>, or run <Code>npm run node</Code> and then <Code>npm run deploy:local</Code> in <Code>blockchain/</Code>. Evidence can still be built and inspected while offline.</p>
            </>
          )}
          <p className="muted small">Sources: Open-Meteo {status?.sources.openMeteo.status === 'NO_KEY_REQUIRED' ? 'needs no key' : 'status unknown'}. OpenAQ {status?.sources.openAq.status === 'NOT_CONFIGURED' ? 'not configured, so no station comparison is made' : 'key set but not used in this build'}.</p>
          <div className="il-actions">
            <button type="button" onClick={() => void refreshStatus()}>Recheck chain</button>
            <button type="button" onClick={startNewRun} disabled={busy !== null}>Start a new demo run</button>
          </div>
        </div>
      </section>

      <nav className="il-steps" aria-label="Integrity lab steps">
        {STEPS.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={'il-step' + (step === item.id ? ' active' : '') + (done[item.id] ? ' done' : '')}
            aria-current={step === item.id ? 'step' : undefined}
            disabled={!available[item.id]}
            onClick={() => setStep(item.id)}
          >
            <span className="il-step-number">{done[item.id] ? '✓' : index + 1}</span>
            <span><strong>{item.title}</strong><small>{item.short}</small></span>
          </button>
        ))}
      </nav>

      <p className="sr-only" aria-live="polite">{busy ? `${busy} in progress` : ''}</p>
      {failure && (
        <div className="il-error" role="alert">
          <strong>{failure.action} failed.</strong> <span>{failure.message}</span>
          <div className="il-actions">
            <button type="button" onClick={failure.retry} disabled={busy !== null}>Retry</button>
            <button type="button" onClick={() => setFailure(null)}>Dismiss</button>
          </div>
        </div>
      )}

      {step === 'signal' && (
        <section className="il-panel" aria-labelledby="il-signal">
          <h3 id="il-signal">1 · Choose a real environmental signal</h3>
          <p className="muted">Open-Meteo serves CAMS global model forecasts for any coordinate. These are modelled concentrations for a ~45 km grid cell, not readings from a monitor.</p>
          <div className="il-form">
            <label>Place<select value={siteId} onChange={(event) => setSiteId(event.target.value)}>{sites.map((site) => <option key={site.id} value={site.id}>{site.label}</option>)}</select></label>
            <label>Pollutant<select value={analyte} onChange={(event) => setAnalyte(event.target.value)}>{analytes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          </div>
          <fieldset className="il-modes">
            <legend>Source mode</legend>
            {MODES.map((item) => (
              <label key={item.id} className={mode === item.id ? 'active' : ''}>
                <input type="radio" name="il-mode" value={item.id} checked={mode === item.id} onChange={() => setMode(item.id)} />
                <span><strong>{item.label}</strong><small>{item.detail}</small></span>
              </label>
            ))}
          </fieldset>
          <button type="button" className="primary-action" onClick={() => void buildEvidence()} disabled={busy !== null}>{busy === 'Build evidence' ? 'Fetching and hashing…' : 'Fetch the signal and build evidence'}</button>

          {bundle && source && (
            <div className="il-result">
              <div className="il-badges">
                <Badge tone="model">MODEL FORECAST</Badge>
                {source.retrievalMode === 'LIVE_FETCH' ? <Badge tone="live">LIVE FETCH · {formatUtc(source.retrievedAt)}</Badge> : <Badge tone="cached">CACHED HISTORICAL EXAMPLE · captured {formatUtc(source.capturedAt)}</Badge>}
                {source.freshness.stale && <Badge tone="fail">STALE</Badge>}
              </div>
              {source.liveError && <p className="il-warning">Live fetch failed ({source.liveError.code}): {source.liveError.message} This bundle uses the cached example instead.</p>}
              {source.reusedRecentResponse && <p className="muted small">Reused the response fetched within the last minute, to respect the provider's rate limits.</p>}
              <Facts rows={[
                ['Place', `${bundle.location.label} · ${bundle.location.lat}, ${bundle.location.lon} (WGS84)`],
                ['Model grid cell', `${source.grid.lat}, ${source.grid.lon} · ${source.spatialResolution}`],
                ['Valid hours', `${formatUtc(bundle.timeframe.startUtc)} to ${formatUtc(bundle.timeframe.endUtc)}`],
                ['Latest value', latest ? `${latest.value ?? 'missing'} ${latest.unit} at ${formatUtc(latest.validTimeUtc)}` : '—'],
                ['24-hour mean', derived ? <span key="d"><Badge tone="derived">DERIVED ESTIMATE</Badge> {derived.value} {derived.unit} from {derived.hoursUsed} hours. {derived.guidelineComparison.note}</span> : '—'],
                ['Guideline', derived ? `${derived.guidelineComparison.guideline.source}: ${derived.guidelineComparison.guideline.value} ${derived.guidelineComparison.guideline.unit}, ${derived.guidelineComparison.guideline.averaging}${derived.guidelineComparison.exceeds === null ? '' : derived.guidelineComparison.exceeds ? ' · modelled mean is above it' : ' · modelled mean is at or below it'}. ${derived.guidelineComparison.guideline.exceedanceBasis ?? ''}` : '—'],
                ['Source', `${source.provider} · ${source.dataProvider}`],
                ['Request', <a key="r" href={source.sourceUrl} target="_blank" rel="noreferrer noopener">{source.sourceUrl}</a>],
                ['Freshness', `${source.freshness.ageHoursAtRetrieval} h old at retrieval. ${source.freshness.rule}`],
                ['Licence', source.license],
              ]} />
              {definition && (
                <div className="il-note">
                  <strong>{definition.label} · {definition.name}</strong>
                  <p>{definition.identity}</p>
                  <p>{definition.relevance} {definition.distinctFrom}</p>
                </div>
              )}
              {continueButton}
            </div>
          )}
        </section>
      )}

      {step === 'packet' && bundle && evidence && source && (
        <section className="il-panel" aria-labelledby="il-packet">
          <h3 id="il-packet">2 · The evidence packet and its digest</h3>
          <p className="muted">The bundle is serialised as {bundle.canonicalization} and hashed with SHA-256. The raw provider response is hashed separately, so the chain of custody runs from the exact bytes received to the anchored digest.</p>
          <Facts rows={[
            ['Evidence id', <Code key="i">{evidence.evidenceId}</Code>],
            ['Bundle SHA-256', <Code key="d">{evidence.digest}</Code>],
            ['Metadata SHA-256', <Code key="m">{evidence.metadataHash}</Code>],
            ['Raw response SHA-256', <span key="r"><Code>{source.rawPayloadSha256}</Code> · {source.rawPayloadBytes} bytes</span>],
            ['Normalised data SHA-256', <Code key="n">{source.normalizedPayloadSha256}</Code>],
            ['Schema and method', `${bundle.schema} · ${bundle.methodVersion}`],
          ]} />
          <div className="il-actions">
            <button type="button" onClick={recompute} disabled={busy !== null}>Recompute the digest in this browser</button>
            <a className="il-link" download={`${evidence.evidenceId}.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(bundle, null, 2))}`}>Download the bundle JSON</a>
          </div>
          {browserDigest && (
            <p className={browserDigest === evidence.digest ? 'il-ok' : 'il-bad'} role="status">
              {browserDigest === evidence.digest ? '✓ This browser computed the same SHA-256: ' : '✕ This browser computed a different SHA-256: '}<Code>{browserDigest}</Code>
            </p>
          )}
          <div className="il-columns">
            <div className="il-note"><strong>This evidence can prove</strong><ul>{bundle.canProve.map((line) => <li key={line}>{line}</li>)}</ul></div>
            <div className="il-note"><strong>It cannot prove</strong><ul>{bundle.cannotProve.map((line) => <li key={line}>{line}</li>)}</ul></div>
          </div>
          <div className="il-note"><strong>Uncertainty</strong><ul>{bundle.uncertainty.map((line) => <li key={line}>{line}</li>)}</ul></div>
          <div className="il-note"><strong>Second source</strong><p>{bundle.comparisons[0]?.with}: {bundle.comparisons[0]?.status}. {bundle.comparisons[0]?.reason}</p></div>
          <div className="il-note"><strong>Chain of custody</strong><ol>{bundle.custody.map((item) => <li key={item.step}>{item.step} · {item.actor}{item.outputSha256 ? <> · <Code>{short(item.outputSha256)}</Code></> : null}</li>)}</ol></div>
          <details className="il-details"><summary>Inspect the full bundle JSON</summary><pre>{JSON.stringify(bundle, null, 2)}</pre></details>
          {continueButton}
        </section>
      )}

      {step === 'anchor' && evidence && (
        <section className="il-panel" aria-labelledby="il-anchor">
          <h3 id="il-anchor">3 · Anchor the digest on the chain</h3>
          <p className="muted">The registry stores the digest, the evidence id, a parent link and a metadata hash. The raw data stays off-chain.</p>
          {!anchored && (
            <>
              <button type="button" className="primary-action" onClick={anchor} disabled={busy !== null || !ledgerReady}>{busy === 'Anchor evidence' ? 'Sending the transaction…' : 'Anchor evidence on the chain'}</button>
              {!ledgerReady && <p className="il-warning">OFFLINE · NOT ANCHORED. The chain is not reachable, so nothing can be anchored. No receipt is shown until a real transaction succeeds.</p>}
            </>
          )}
          {anchored && proof && (
            <div className="il-result">
              <div className="il-badges"><Badge tone="chain">ON-CHAIN ANCHORED PROOF</Badge>{proof.alreadyAnchored && <Badge tone="test">ALREADY ANCHORED · NO NEW TRANSACTION</Badge>}{proof.current === false && <Badge tone="cached">SUPERSEDED BY A CORRECTION</Badge>}</div>
              <Facts rows={[
                ['Network', `${proof.network} · chain ${proof.chainId}`],
                ['Contract', <Code key="c">{proof.contractAddress}</Code>],
                ['Transaction', <Code key="t">{proof.transactionHash ?? '—'}</Code>],
                ['Block', `${proof.blockNumber} · ${short(proof.blockHash)}`],
                ['Receipt', `status ${proof.receiptStatus} · ${proof.confirmations} confirmation(s) · gas used ${proof.gasUsed}`],
                ['Attester', `${proof.attester} (internal test actor)`],
                ['On-chain digest', <Code key="d">{proof.onChainDigest}</Code>],
                ['Anchored at', formatUtc(proof.anchoredAt)],
              ]} />
              <p className="muted small">This proves the bundle bytes existed unchanged at block {proof.blockNumber}. It does not prove the modelled value is correct.</p>
              <button type="button" className="primary-action il-verify" onClick={verify} disabled={busy !== null || !status?.contracts}>{busy === 'Verify independently' ? 'Re-reading the chain…' : 'Verify independently'}</button>
              {browserCheck && gatewayCheck && (
                <>
                  <p className={browserCheck.verified ? 'il-verdict ok' : 'il-verdict bad'} role="status">{browserCheck.verified ? 'VERIFIED: this browser re-hashed the bundle and read the same digest from the chain.' : browserCheck.reachable ? 'NOT VERIFIED: at least one check failed.' : 'INDEPENDENT CHECK UNAVAILABLE: this browser could not reach the chain RPC.'}</p>
                  <div className="il-columns">
                    <CheckList title="This browser, straight to the chain RPC" checks={browserCheck.checks} />
                    <CheckList title="Gateway re-check" checks={gatewayCheck.checks} />
                  </div>
                </>
              )}
              {status?.contracts && (
                <details className="il-details">
                  <summary>Reproduce from a terminal</summary>
                  <p className="small">Read the record straight from the chain. The first 32-byte word of the result is the anchored digest.</p>
                  <pre>{curlEvidenceCall(new URL(status.rpcUrl, window.location.origin).href, status.contracts.evidenceRegistry.address, evidence.evidenceId)}</pre>
                  <p className="small">Ask the gateway to recompute and compare:</p>
                  <pre>{`curl -s ${window.location.origin}/api/v1/integrity/evidence/${evidence.evidenceId}/verify`}</pre>
                </details>
              )}
              {continueButton}
            </div>
          )}
        </section>
      )}

      {step === 'attack' && evidence && (
        <section className="il-panel" aria-labelledby="il-attack">
          <h3 id="il-attack">4 · Tamper with a copy, then replay the original</h3>
          <p className="il-warning">CONTROLLED TEST DATA. The tamper test edits a copy of the bundle. The stored and anchored evidence is never changed, and no real-world fraud is alleged.</p>
          <div className="il-actions">
            <button type="button" onClick={runTamper} disabled={busy !== null}>{busy === 'Tamper test' ? 'Hashing the altered copy…' : 'Run the tamper test'}</button>
            <button type="button" onClick={runReplay} disabled={busy !== null || !ledgerReady}>{busy === 'Replay evidence' ? 'Sending the replay…' : 'Replay the same evidence'}</button>
          </div>
          {tamper && (
            <div className="il-result" role="status">
              <div className="il-badges"><Badge tone="test">CONTROLLED TEST DATA</Badge><Badge tone={tamper.result === 'FAIL' ? 'pass' : 'fail'}>VERIFICATION {tamper.result}</Badge></div>
              <Facts rows={[
                ['Change', `${tamper.change.path} (${tamper.change.measurementId}): ${tamper.change.before} → ${tamper.change.after}`],
                ['Original digest', <Code key="o">{tamper.originalDigest}</Code>],
                ['Altered digest (gateway)', <Code key="g">{tamper.tamperedDigest}</Code>],
                ['Altered digest (this browser)', <Code key="b">{browserTamperDigest ?? '—'}</Code>],
                ['On-chain digest', <Code key="c">{tamper.onChainDigest ?? 'not anchored'}</Code>],
                ['Contract verifyDigest', `altered copy: ${String(tamper.contractAcceptsTampered)} · original: ${String(tamper.contractAcceptsOriginal)}`],
              ]} />
              <p className="muted small">A change of {Math.abs(tamper.change.after - tamper.change.before).toFixed(1)} in one value gives a completely different digest, so the altered copy cannot pass as the anchored evidence.</p>
            </div>
          )}
          {replay && <Rejection result={replay} expected="EvidenceIdTaken" />}
          {continueButton}
        </section>
      )}

      {step === 'firewall' && evidence && (
        <section className="il-panel" aria-labelledby="il-firewall">
          <h3 id="il-firewall">5 · Evidence-to-Claim Trust Firewall & Benchmarks</h3>
          <p className="il-warning">POLICY INTEGRITY ENGINE. Evaluates whether an environmental claim can be accepted when the underlying evidence is duplicated, altered, outdated, contradictory, derived only from a model, or insufficient to establish the claimed outcome.</p>
          
          <div className="il-actions" style={{ flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-bright)' }}>
              <span>Test Claim Tier:</span>
              <select
                value={firewallClaimType}
                onChange={(e) => setFirewallClaimType(e.target.value)}
                style={{ background: 'var(--bg-layer-2)', color: 'var(--text-bright)', border: '1px solid var(--border)', padding: '0.4rem', borderRadius: '4px' }}
              >
                <option value="ENVIRONMENTAL_OBSERVATION">1. Physical Observation (Must reject model forecast)</option>
                <option value="ENVIRONMENTAL_RISK_ALERT">2. Environmental Risk Alert (Allows model with uncertainty)</option>
                <option value="INTERVENTION_COMPLETION">3. Intervention Completion (Requires manifest/attestation)</option>
                <option value="QUANTIFIED_EMISSIONS_REDUCTION">4. Quantified Emissions Reduction (Must reject pure model)</option>
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-bright)' }}>
              <span>Evidence profile:</span>
              <select
                value={firewallSubtype}
                onChange={(e) => setFirewallSubtype(e.target.value)}
                style={{ background: 'var(--bg-layer-2)', color: 'var(--text-bright)', border: '1px solid var(--border)', padding: '0.4rem', borderRadius: '4px' }}
              >
                <option value="">None (tier rules only)</option>
                <option value="air-quality">Air quality (claimed value must match the evidence)</option>
                <option value="methane-response">Methane response (needs a measured before/after drop)</option>
                <option value="livestock-traceability">Livestock traceability (needs custody events)</option>
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-bright)' }}>
              <span>Claimed value:</span>
              <input
                type="number"
                inputMode="decimal"
                placeholder="latest measured"
                value={claimedValue}
                onChange={(e) => setClaimedValue(e.target.value)}
                style={{ width: '9rem', background: 'var(--bg-layer-2)', color: 'var(--text-bright)', border: '1px solid var(--border)', padding: '0.4rem', borderRadius: '4px' }}
              />
            </label>
            <button
              type="button"
              className="primary-action"
              onClick={runFirewall}
              disabled={busy !== null}
            >
              {busy === 'Firewall evaluation' ? 'Evaluating policy rules…' : 'Evaluate through Trust Firewall'}
            </button>
            <button
              type="button"
              onClick={runAdversarialBenchmark}
              disabled={busy !== null}
            >
              {busy === 'Adversarial benchmark' ? 'Running synthetic test suites…' : 'Run synthetic regression + adversarial suites'}
            </button>
          </div>

          {firewallResult && (
            <div className="il-result" role="status" style={{ marginTop: '1rem' }}>
              <div className="il-badges">
                <Badge tone={firewallResult.verdict === 'ACCEPTED' ? 'pass' : firewallResult.verdict === 'REJECTED' ? 'fail' : 'cached'}>
                  FIREWALL VERDICT · {firewallResult.verdict}
                </Badge>
                {firewallResult.eligibleForOnChainSubmission && (
                  <Badge tone="chain">ELIGIBLE FOR ON-CHAIN ANCHORING</Badge>
                )}
              </div>
              <Facts rows={[
                ['Receipt ID', <Code key="r">{firewallResult.receiptId}</Code>],
                ['Receipt SHA-256', <Code key="h">{firewallResult.receipt.firewallReceiptHash}</Code>],
                ['Composite Scope Key', <Code key="s">{firewallResult.scopeKey ?? '—'}</Code>],
                ['Claim Type Tested', firewallClaimType],
                ['Rules Evaluated', `${firewallResult.receipt.ruleSummary.passed} passed / ${firewallResult.receipt.ruleSummary.failed} failed`],
              ]} />
              {firewallResult.errors.length > 0 && (
                <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '4px' }}>
                  <strong style={{ color: '#ef4444' }}>Violations Detected:</strong>
                  <ul style={{ margin: '0.5rem 0 0 1.25rem', padding: 0 }}>
                    {firewallResult.errors.map((err, idx) => (
                      <li key={idx} style={{ color: '#fca5a5' }}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
              {firewallResult.notes && firewallResult.notes.length > 0 && (
                <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.3)', borderRadius: '4px' }}>
                  <strong>Not accepted yet (needs more evidence or a human):</strong>
                  <ul style={{ margin: '0.5rem 0 0 1.25rem', padding: 0 }}>
                    {firewallResult.notes.map((note, idx) => <li key={idx}>{note}</li>)}
                  </ul>
                </div>
              )}
              <p className="muted small" style={{ marginTop: '0.5rem' }}>{firewallResult.limitsNotice}</p>
              {firewallResult.knownLimitations && firewallResult.knownLimitations.length > 0 && (
                <details className="small muted" style={{ marginTop: '0.5rem' }}>
                  <summary>What this firewall cannot detect ({firewallResult.knownLimitations.length})</summary>
                  <ul style={{ margin: '0.5rem 0 0 1.25rem', padding: 0 }}>
                    {firewallResult.knownLimitations.map((item, idx) => <li key={idx}>{item}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}

          {benchmarkResult && (
            <div className="il-result" role="status" style={{ marginTop: '1rem' }}>
              <div className="il-badges">
                <Badge tone="demo">SYNTHETIC REGRESSION SUITE</Badge>
              </div>
              <p className="small muted">{benchmarkResult.label ?? '55 author-written synthetic regression cases.'} The perfect score is by construction: the cases were written around the firewall&apos;s own rule categories. It is a regression check, not evidence of real-world fraud detection.</p>
              <div style={{ overflowX: 'auto', marginTop: '0.5rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '0.5rem' }}>System</th>
                      <th style={{ padding: '0.5rem' }}>TP / FP / TN / FN</th>
                      <th style={{ padding: '0.5rem' }}>Precision</th>
                      <th style={{ padding: '0.5rem' }}>Recall</th>
                      <th style={{ padding: '0.5rem' }}>F1</th>
                      <th style={{ padding: '0.5rem' }}>Unsafe Acceptance</th>
                      <th style={{ padding: '0.5rem' }}>Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(benchmarkResult.results).map(([name, stats]) => (
                      <tr key={name} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: name.includes('Trust Firewall') ? 'rgba(34, 197, 94, 0.08)' : 'transparent' }}>
                        <td style={{ padding: '0.5rem', fontWeight: name.includes('Trust Firewall') ? 600 : 400 }}>{name}</td>
                        <td style={{ padding: '0.5rem' }}>{stats.truePositives} / {stats.falsePositives} / {stats.trueNegatives} / {stats.falseNegatives}</td>
                        <td style={{ padding: '0.5rem', color: stats.precision === 1 ? '#22c55e' : 'inherit' }}>{(stats.precision * 100).toFixed(1)}%</td>
                        <td style={{ padding: '0.5rem' }}>{(stats.recall * 100).toFixed(1)}%</td>
                        <td style={{ padding: '0.5rem' }}>{stats.f1Score.toFixed(3)}</td>
                        <td style={{ padding: '0.5rem', color: stats.unsafeAcceptanceRate === 0 ? '#22c55e' : '#ef4444' }}>{(stats.unsafeAcceptanceRate * 100).toFixed(1)}%</td>
                        <td style={{ padding: '0.5rem' }}>{stats.avgLatencyMs.toFixed(3)} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {benchmarkResult.adversarialV2 && (
                <div style={{ marginTop: '1rem' }}>
                  <strong>Adversarial suite v2 (synthetic, written after probing the v1 blind spots)</strong>
                  <p className="small muted">
                    {benchmarkResult.adversarialV2.passed}/{benchmarkResult.adversarialV2.scoredCases} scored cases match both the expected verdict and the expected rule.
                    {' '}{benchmarkResult.adversarialV2.label}
                  </p>
                  <ul className="small" style={{ margin: '0 0 0.5rem 1.25rem', padding: 0 }}>
                    {Object.entries(benchmarkResult.adversarialV2.byGroup).map(([group, v]) => (
                      <li key={group}>{group.replace(/_/g, ' ').toLowerCase()}: {v.passed}/{v.cases}</li>
                    ))}
                  </ul>
                  <div style={{ padding: '0.75rem', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '4px' }}>
                    <strong>Known limitations: unsafe claims this firewall does NOT catch ({benchmarkResult.adversarialV2.knownLimitations.filter((k) => k.missedByDesign).length}/{benchmarkResult.adversarialV2.knownLimitations.length})</strong>
                    <ul className="small" style={{ margin: '0.5rem 0 0 1.25rem', padding: 0 }}>
                      {benchmarkResult.adversarialV2.knownLimitations.map((k) => (
                        <li key={k.id}>{k.name} <em>(firewall verdict: {k.firewallVerdict})</em></li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}
          {continueButton}
        </section>
      )}

      {step === 'claim' && evidence && (
        <section className="il-panel" aria-labelledby="il-claim">
          <h3 id="il-claim">6 · Record a demo claim, then try to claim it twice</h3>
          <p className="il-warning">DEMO / NOT A CERTIFIED CREDIT. This records an information claim with no baseline and no independent verifier. Nothing is issued, transferred or sold.</p>
          <p className="muted">The claim scope is the project, boundary, monitoring day, method and benefit type. Evidence is not part of the scope, so swapping in different evidence cannot claim the same benefit again.</p>
          <div className="il-actions">
            <button type="button" className="primary-action" onClick={submitClaim} disabled={busy !== null || !ledgerReady || Boolean(claim)}>{busy === 'Submit claim' ? 'Submitting…' : claim ? 'Claim submitted' : 'Submit the demo claim'}</button>
            <button type="button" onClick={submitDuplicate} disabled={busy !== null || !claim}>{busy === 'Duplicate claim' ? 'Sending the duplicate…' : 'Submit the same claim again'}</button>
          </div>
          {!claim && failure?.action === 'Submit claim' && failure.errorName === 'DuplicateClaim' && (
            <div className="il-warning" role="status">
              <p>An earlier run on this chain already holds an active claim for this place, day, method and benefit type, so the registry refused a second one. That is the duplicate protection working, even though this claim used different evidence.</p>
              <button type="button" onClick={openNewScope} disabled={busy !== null}>Open a new demo scope and keep this evidence</button>
            </div>
          )}
          {claim && (
            <div className="il-result">
              <div className="il-badges"><Badge tone="demo">{claim.claim.label}</Badge><Badge tone="cached">UNVERIFIED CLAIM</Badge><Badge tone="chain">STATUS {claim.proof.status.toUpperCase()}</Badge></div>
              <p>{claim.claim.result.statement}</p>
              <Facts rows={[
                ['Claim id', <Code key="i">{claim.claim.claimId}</Code>],
                ['Transaction', <Code key="t">{claim.proof.transactionHash ?? '—'}</Code>],
                ['Exclusivity key', <Code key="k">{claim.claim.exclusivityKey}</Code>],
                ['Scope', Object.entries(claim.claim.scope).map(([key, value]) => `${key}: ${value}`).join(' · ')],
                ['Baseline', claim.claim.baseline],
                ['Verification', claim.claim.verificationState],
              ]} />
            </div>
          )}
          {duplicate && (
            <>
              <Rejection result={duplicate} expected="DuplicateClaim" />
              <p className="muted small">The second attempt had a new claim id but {duplicate.sameExclusivityKey ? 'the same' : 'a different'} exclusivity key. Duplicate protection covers this registry only; it cannot see other registries or chains.</p>
            </>
          )}
          {continueButton}
        </section>
      )}

      {step === 'challenge' && claim && (
        <section className="il-panel" aria-labelledby="il-challenge">
          <h3 id="il-challenge">7 · Challenge the claim and correct it</h3>
          <p className="muted">Anyone can challenge. Only a reviewer account that did not submit the claim can decide. A correction adds new records and never overwrites the old ones.</p>
          <p><Badge tone="chain">CLAIM STATUS {claimStatus?.toUpperCase()}</Badge></p>
          {claimStatus === 'Submitted' && (
            <div className="il-form il-form-wide">
              <label>Reason<select value={reason} onChange={(event) => { setReason(event.target.value); setDetail(REASONS.find((item) => item.code === event.target.value)?.detail ?? ''); }}>{REASONS.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
              <label>What is wrong<textarea value={detail} onChange={(event) => setDetail(event.target.value)} rows={3} maxLength={600} /></label>
              <button type="button" className="primary-action" onClick={submitChallenge} disabled={busy !== null || detail.trim().length < 10}>{busy === 'Challenge claim' ? 'Submitting the challenge…' : 'Submit the challenge (challenger account)'}</button>
            </div>
          )}
          {challenge && <p className="small">Challenge recorded in block {challenge.blockNumber}: <Code>{challenge.transactionHash}</Code></p>}
          {claimStatus === 'Challenged' && (
            <div className="il-form il-form-wide">
              <label>Correction note<textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={600} /></label>
              <div className="il-actions">
                <button type="button" className="primary-action" onClick={approveCorrection} disabled={busy !== null || note.trim().length < 10}>{busy === 'Approve correction' ? 'Re-fetching, anchoring and approving…' : 'Approve a correction (reviewer account)'}</button>
                <button type="button" onClick={() => decide(true)} disabled={busy !== null}>Uphold: reject the claim</button>
                <button type="button" onClick={() => decide(false)} disabled={busy !== null}>Dismiss the challenge</button>
              </div>
            </div>
          )}
          {resolution && <p className="small" role="status">Reviewer {resolution.upheld ? 'upheld the challenge; the claim is rejected and its scope released' : 'dismissed the challenge; the claim is active again'}. Block {resolution.blockNumber}: <Code>{resolution.transactionHash}</Code></p>}
          {correction && (
            <div className="il-result" role="status">
              <div className="il-badges"><Badge tone="pass">CORRECTION APPROVED</Badge><Badge tone="test">ORIGINALS KEPT ON-CHAIN</Badge></div>
              <div className="il-lineage">
                <div className="il-lineage-row">
                  <span className="il-node old"><small>Original evidence · superseded, still verifies</small><Code>{correction.originalEvidence.proof.evidenceId}</Code></span>
                  <span className="il-arrow" aria-hidden="true">→</span>
                  <span className="il-node"><small>Revised evidence · parent is the original</small><Code>{correction.revisedEvidence.evidenceId}</Code><small>tx {short(correction.revisedEvidence.anchorTransactionHash)}</small></span>
                </div>
                <div className="il-lineage-row">
                  <span className="il-node old"><small>Original claim · {correction.originalClaim.proof.status}</small><Code>{correction.originalClaimId}</Code></span>
                  <span className="il-arrow" aria-hidden="true">→</span>
                  <span className="il-node"><small>Corrected claim · {correction.correctedClaim.proof.status}, supersedes the original</small><Code>{correction.correctedClaim.claim.claimId}</Code><small>tx {short(correction.correctedClaim.approvalTransactionHash)}</small></span>
                </div>
              </div>
              <p className="muted small">The revised evidence came from a {correction.revisedEvidence.bundle.sources[0]?.retrievalMode === 'LIVE_FETCH' ? 'live' : 'cached'} retrieval. The reviewer is an internal test account: an internal review, not an independent verification.</p>
            </div>
          )}
          <div className="il-actions">
            <button type="button" onClick={loadHistory} disabled={busy !== null || !ledgerReady}>{busy === 'Load history' ? 'Reading events…' : 'Load the on-chain history'}</button>
          </div>
          {history && (
            <div className="il-table-wrap">
              <table className="il-table">
                <caption>Events read from both registries, oldest first. Rejected attempts appear as receipts with status 0.</caption>
                <thead><tr><th scope="col">Block</th><th scope="col">Event</th><th scope="col">Record</th><th scope="col">Transaction</th></tr></thead>
                <tbody>
                  {history.events.map((event) => {
                    const readable = ['evidenceReadable', 'claimReadable', 'correctedClaimReadable', 'parentEvidenceReadable'].map((key) => event.details[key]).find((value) => typeof value === 'string');
                    return <tr key={`${event.transactionHash}-${event.logIndex}`}><td>{event.blockNumber}</td><td>{event.event}<small>{event.contract}</small></td><td>{typeof readable === 'string' ? readable : '—'}</td><td><Code>{short(event.transactionHash)}</Code></td></tr>;
                  })}
                  {history.timeline.filter((entry) => entry.kind.endsWith('rejected')).map((entry) => (
                    <tr key={`${entry.kind}-${entry.at}`} className="il-row-rejected"><td>{String(entry.blockNumber ?? '—')}</td><td>{entry.kind}<small>{String(entry.errorName ?? '')}</small></td><td>{String(entry.evidenceId ?? entry.duplicateOf ?? '—')}</td><td><Code>{short(typeof entry.transactionHash === 'string' ? entry.transactionHash : null)}</Code></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {continueButton}
        </section>
      )}

      {step === 'next' && evidence && (
        <section className="il-panel" aria-labelledby="il-next">
          <h3 id="il-next">8 · What to do next</h3>
          <p className="muted">Bounded actions drawn from this evidence. None of them claims a cause or an impact.</p>
          <ol className="il-steps-list">
            {evidence.recommendations.map((item) => <li key={item.action}><strong>{item.action}</strong><span>{item.why}</span><small>Evidence needed: {item.evidenceNeeded}</small></li>)}
            {claimStatus === 'Challenged' && <li><strong>Resolve the open challenge before using this claim.</strong><span>A challenged claim is disputed.</span><small>Evidence needed: a reviewer decision or an approved correction.</small></li>}
          </ol>
          <div className="il-columns">
            <div className="il-note">
              <strong>Labels used on this page</strong>
              <ul>
                <li><Badge tone="model">MODEL FORECAST</Badge> CAMS values for a grid cell. No LIVE OBSERVATION is used here.</li>
                <li><Badge tone="derived">DERIVED ESTIMATE</Badge> The 24-hour mean computed from model hours.</li>
                <li><Badge tone="cached">CACHED HISTORICAL EXAMPLE</Badge> A stored real response, never shown as live.</li>
                <li><Badge tone="demo">DEMO / NOT A CERTIFIED CREDIT</Badge> An unverified information claim.</li>
                <li><Badge tone="chain">ON-CHAIN ANCHORED PROOF</Badge> The digest is on the chain. It proves integrity, not truth.</li>
              </ul>
            </div>
            <div className="il-note">
              <strong>Before any verified impact claim</strong>
              <ul>
                <li>A stated baseline and counterfactual.</li>
                <li>Observed measurements from calibrated instruments, with a monitoring plan.</li>
                <li>Leakage, permanence and double-counting checks across registries.</li>
                <li>An independent verifier and a registry reference.</li>
              </ul>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
