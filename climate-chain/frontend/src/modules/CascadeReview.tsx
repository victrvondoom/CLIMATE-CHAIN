import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { anchorCascadeManifest, fetchCascade, fetchEvidenceAnchorStatus, type EvidenceAnchorProof, type EvidenceAnchorStatus } from '../api';
import { Card, ExternalLink } from '../components/Ui';
import type { CascadeResponse, Overview } from '../types';
import { useLiveQuery } from '../hooks/useLiveQuery';
import './signals.css';

const Globe3D = lazy(() => import('../components/Globe3D').then((module) => ({ default: module.Globe3D })));

const RADII = [1, 3, 5, 10];
const WINDOWS = [6, 12, 24, 48];

function Check({ label, value }: { label: string; value: boolean | null }) {
  const text = value === null ? 'Unknown' : value ? 'Pass' : 'Does not pass';
  return (
    <div className="cascade-check">
      <span>{label}</span>
      <strong className={value === true ? 'cascade-pass' : value === false ? 'cascade-fail' : 'muted'}>{text}</strong>
    </div>
  );
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    ready_for_human_review: 'Candidate for human review',
    source_not_observed: 'Observed evidence unavailable',
    outside_radius: 'Monitor is outside the selected radius',
    outside_time_window: 'Observations fall outside the selected time window',
    missing_time_provenance: 'Timestamp evidence is incomplete',
    missing_spatial_provenance: 'Monitor distance is unavailable',
    missing_location: 'Waste site location is unavailable',
    site_not_open: 'Waste site is no longer open',
  };
  return labels[status] ?? 'Not evaluated';
}

function saveManifest(result: CascadeResponse) {
  const blob = new Blob([JSON.stringify(result.manifest, null, 2) + '\n'], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = result.manifest.id.replace(/[^a-z0-9_-]/gi, '-') + '.json';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
}

export function CascadeReview({ data, siteId, onBack }: { data: Overview; siteId: string | null; onBack: () => void }) {
  const availableSites = data.waste.sites.filter((site) => site.status === 'open' && site.lat != null && site.lng != null);
  const [selectedSiteId, setSelectedSiteId] = useState(siteId ?? '');
  const [radiusKm, setRadiusKm] = useState(5);
  const [timeWindowHours, setTimeWindowHours] = useState(24);
  const [demoMode, setDemoMode] = useState(false);
  const [chainStatus, setChainStatus] = useState<EvidenceAnchorStatus | null>(null);
  const [anchorProof, setAnchorProof] = useState<EvidenceAnchorProof | null>(null);
  const [anchoring, setAnchoring] = useState(false);
  const [anchorError, setAnchorError] = useState('');
  const activeSiteId = selectedSiteId || availableSites[0]?.id || '';

  useEffect(() => setSelectedSiteId(siteId ?? ''), [siteId]);

  const query = useCallback((signal: AbortSignal) => activeSiteId
    ? fetchCascade(activeSiteId, radiusKm, timeWindowHours, signal, demoMode)
    : Promise.resolve(null), [activeSiteId, radiusKm, timeWindowHours, demoMode]);
  const { data: result, error, loading, refreshing, updatedAt, refresh } = useLiveQuery(query, {
    key: `${activeSiteId}:${radiusKm}:${timeWindowHours}:${demoMode}`, intervalMs: demoMode ? 0 : 30_000,
  });

  useEffect(() => {
    const controller = new AbortController();
    void fetchEvidenceAnchorStatus(controller.signal).then(setChainStatus).catch(() => setChainStatus(null));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setAnchorProof(null);
    setAnchorError('');
  }, [result?.manifest.integrity.digest]);

  async function anchorCurrentManifest() {
    if (!result || !chainStatus?.available || refreshing || error) return;
    setAnchoring(true);
    setAnchorError('');
    try {
      setAnchorProof(await anchorCascadeManifest(result.manifest));
      setChainStatus(await fetchEvidenceAnchorStatus());
    } catch (cause) {
      setAnchorError(cause instanceof Error ? cause.message : 'The manifest could not be anchored.');
    } finally {
      setAnchoring(false);
    }
  }

  const lensData = useMemo(() => {
    if (!result) return data;
    const queryPlace = result.evidence.air.queryPlace;
    return {
      ...data,
      waste: { ...data.waste, sites: [] },
      air: { ...data.air, place: queryPlace },
      sources: {
        ...data.sources,
        junksnap: { ...data.sources.junksnap, mode: result.sources.junksnap === 'live' ? 'live' as const : 'mock' as const },
        vayu: { ...data.sources.vayu, mode: result.sources.vayu === 'live' ? 'live' as const : 'mock' as const },
      },
    };
  }, [data, result]);

  return (
    <div className="stack cascade-page signal-page">
      <div className="cascade-heading">
        <button className="text-action" onClick={onBack}>← Waste sites</button>
        <div>
          <p className="eyebrow">One place · two evidence sources · human review</p>
          <h2>Climate Cascade Review</h2>
          <p className="muted">Check whether an open DumpWatch site and a nearby AirPulse monitor have recent observations in common.</p>
        </div>
      </div>

      <div className="cascade-controls">
        <label>Open waste site
          <select value={activeSiteId} onChange={(event) => { setSelectedSiteId(event.target.value); setDemoMode(event.target.value === 'site_mock_1'); }}>
            {!activeSiteId && <option value="">No available site</option>}
            {selectedSiteId && selectedSiteId !== 'site_mock_1' && !availableSites.some((site) => site.id === selectedSiteId) && <option value={selectedSiteId}>Selected site · {selectedSiteId}</option>}
            {demoMode && <option value="site_mock_1">Simulated walkthrough site</option>}
            {availableSites.map((site) => <option value={site.id} key={site.id}>{site.id} · {site.reportCount} report{site.reportCount === 1 ? '' : 's'}</option>)}
          </select>
        </label>
        <label>Monitor radius
          <select value={radiusKm} onChange={(event) => setRadiusKm(Number(event.target.value))}>
            {RADII.map((radius) => <option value={radius} key={radius}>{radius} km</option>)}
          </select>
        </label>
        <label>Time window
          <select value={timeWindowHours} onChange={(event) => setTimeWindowHours(Number(event.target.value))}>
            {WINDOWS.map((hours) => <option value={hours} key={hours}>{hours} hours</option>)}
          </select>
        </label>
        <button className="text-action" disabled={!activeSiteId || refreshing} onClick={() => void refresh()}>{refreshing && activeSiteId ? 'Refreshing evidence…' : 'Refresh evidence'}</button>
        <button className="text-action" onClick={() => {
          if (demoMode) {
            setDemoMode(false);
            setSelectedSiteId(availableSites[0]?.id ?? '');
          } else {
            setSelectedSiteId('site_mock_1');
            setDemoMode(true);
          }
        }}>{demoMode ? 'Return to source-backed review' : 'Load simulated walkthrough'}</button>
      </div>

      {updatedAt && activeSiteId && <p className="muted small" role="status">Review fetched {new Date(updatedAt).toLocaleTimeString()}{demoMode ? ' · simulated walkthrough' : ' · automatically refreshed every 30 seconds while visible'}.{error && result ? ' Refresh failed; the last successful evidence remains visible and cannot be exported until refreshed.' : ''}</p>}

      {!activeSiteId && <Card><h3>No open, located sites are available</h3><p className="muted">Open the Waste view when DumpWatch returns a public site with a location, or use the local walkthrough to explore the review steps.</p><button className="text-action" onClick={() => { setSelectedSiteId('site_mock_1'); setDemoMode(true); }}>Load simulated walkthrough</button></Card>}
      {loading && activeSiteId && <Card><p role="status">Loading the selected site and querying AirPulse near its public location…</p></Card>}
      {error && (
        <Card className="cascade-error">
          <h3>Evidence could not be loaded</h3>
          <p>{error}</p>
          <p className="muted">No simulated readings are substituted into a live review. You can retry the live sources or open a clearly labeled local walkthrough.</p>
          <div className="cascade-error-actions">
            <button className="text-action" disabled={refreshing} onClick={() => { if (demoMode) { setDemoMode(false); setSelectedSiteId(availableSites[0]?.id ?? ''); } else { void refresh(); } }}>Try live sources again</button>
            <button className="text-action" onClick={() => { setSelectedSiteId('site_mock_1'); setDemoMode(true); }}>Load simulated walkthrough</button>
          </div>
        </Card>
      )}

      {result && (
        <>
          {result.demo && <div className="cascade-demo-banner" role="note">SIMULATED WALKTHROUGH · No public API was queried, and the example cannot qualify as live evidence.</div>}
          <div className="cascade-status-card" data-state={result.assessment.candidate ? 'candidate' : 'incomplete'}>
            <div>
              <span className="eyebrow">Assessment · {result.assessment.status.replace(/_/g, ' ')}</span>
              <h3>{statusLabel(result.assessment.status)}</h3>
              <p>{result.assessment.explanation}</p>
            </div>
            <div className="cascade-source-modes">
              <span>DumpWatch <b>{result.demo ? 'SIMULATED' : result.sources.junksnap.toUpperCase()}</b></span>
              <span>AirPulse <b>{result.demo ? 'SIMULATED' : result.sources.vayu.toUpperCase()}</b></span>
            </div>
            <div className="cascade-coverage" aria-label={`Evidence coverage ${result.assessment.coverage.score} percent`}>
              <div className="cascade-coverage-topline">
                <span>Evidence coverage</span>
                <strong>{result.assessment.coverage.score}%</strong>
              </div>
              <progress max={result.assessment.coverage.totalDimensions} value={result.assessment.coverage.availableDimensions} aria-label="Evidence dimensions available" />
              <span className="muted small">{result.assessment.coverage.availableDimensions} of {result.assessment.coverage.totalDimensions} evidence dimensions available · coverage only, not a pass score</span>
            </div>
          </div>

          <div className="cascade-grid">
            <Card className="cascade-globe-card">
              <h3>3D place lens</h3>
              <div className="cascade-globe"><Suspense fallback={<div className="globe-loading">Rendering the 3D place view…</div>}><Globe3D data={lensData} showPilotBeacons={false} showSchematicLinks={false} showWasteSites={false} reviewSite={result.evidence.site.location} /></Suspense></div>
              <p className="muted small">Gold marks the selected public DumpWatch site. Violet marks the AirPulse query location; the monitor itself is not plotted because its exact coordinates are not returned by this API.</p>
            </Card>

            <Card>
              <h3>Review checks</h3>
              <div className="cascade-checks">
                <Check label="Both sources report observed data" value={result.assessment.checks.bothSourcesObserved} />
                <Check label={'Nearest monitor within ' + radiusKm + ' km'} value={result.assessment.checks.nearestMonitorWithinRadius} />
                <Check label={'Report and reading within ' + timeWindowHours + ' h'} value={result.assessment.checks.observationsWithinTimeWindow} />
              </div>
              <p className="muted small">{result.assessment.coverage.meaning}</p>
              <p className="cascade-caution">Passing these checks creates a proximity lead. Geographic and temporal overlap does not show that one condition caused the other.</p>
              <button className="primary-action" disabled={refreshing || !!error} onClick={() => saveManifest(result)}>Download evidence manifest</button>
              <p className="muted small">The SHA-256 digest covers the exported JSON. It detects later changes relative to this digest, but is not an independent audit log or immutable storage.</p>
            </Card>
          </div>

          <Card className="cascade-chain-card">
            <div className="cascade-chain-heading">
              <div>
                <span className="eyebrow">BLOCKCHAIN PROOF · EVIDENCE INTEGRITY</span>
                <h3>Anchor this review manifest</h3>
              </div>
              <span className={`chain-state ${chainStatus?.available ? 'chain-state-ready' : 'chain-state-offline'}`} role="status">
                {chainStatus?.available ? 'LOCAL CHAIN CONNECTED' : 'LOCAL CHAIN OFFLINE'}
              </span>
            </div>
            <p className="muted">Commit the manifest SHA-256 digest to the EVM chain. The contract stores the digest, hashed identifiers, and minimal receipt metadata; the source payload stays in your downloaded manifest. This proves that the same bytes match a recorded block, not that the sources are accurate or causally related.</p>
            <div className="cascade-chain-meta">
              <span>{chainStatus?.network ?? 'Hardhat local development chain'} · chain ID {chainStatus?.chainId ?? 31337}</span>
              {chainStatus?.contractAddress && <code title={chainStatus.contractAddress}>Contract {chainStatus.contractAddress}</code>}
              {result.demo && <span className="mode-pill mode-simulated">SIMULATED INPUT</span>}
            </div>
            {!chainStatus?.available && <p className="cascade-chain-note">{chainStatus?.message ?? 'Start Climate Chain with .\\start.ps1 to run and deploy the local proof chain.'}</p>}
            <button className="primary-action" disabled={!chainStatus?.available || anchoring || refreshing || !!error} onClick={() => void anchorCurrentManifest()}>
              {anchoring ? 'Writing and confirming transaction…' : 'Anchor manifest on the chain'}
            </button>
            {anchorError && <p className="cascade-chain-error" role="alert">{anchorError}</p>}
            {anchorProof?.anchored && (
              <div className={`cascade-chain-proof ${anchorProof.proofVerified ? 'cascade-chain-proof-ok' : 'cascade-chain-proof-error'}`} role={anchorProof.proofVerified ? 'status' : 'alert'}>
                <strong>{anchorProof.proofVerified ? (anchorProof.alreadyAnchored ? 'Existing on-chain proof verified' : 'On-chain proof verified') : 'Transaction found, but proof verification needs review'}</strong>
                <span>Block {anchorProof.blockNumber} · {anchorProof.anchoredAt ? new Date(anchorProof.anchoredAt).toLocaleString() : 'time unavailable'} · chain {anchorProof.chainId}</span>
                <code className="cascade-chain-digest">SHA-256 {anchorProof.digest.replace(/^0x/, '')}</code>
                {anchorProof.transactionHash && <code className="cascade-chain-digest">Transaction {anchorProof.transactionHash}</code>}
                {anchorProof.contractAddress && <code className="cascade-chain-digest">Contract {anchorProof.contractAddress}</code>}
                <span className="muted small">Digest, hashed identifiers, and receipt metadata are on-chain; source readings and site details stay in the manifest. This is a development chain, not a public testnet.</span>
              </div>
            )}
          </Card>

          <div className="grid-2">
            <Card accent="waste">
              <h3>Waste evidence · {result.evidence.site.sourceId}</h3>
              <dl className="cascade-facts">
                <div><dt>Status</dt><dd>{result.evidence.site.status ?? 'Unknown'} · {result.evidence.site.verification ?? 'verification unknown'}</dd></div>
                <div><dt>Reports</dt><dd>{result.evidence.site.reportCount ?? 'Unknown'}</dd></div>
                <div><dt>Last report</dt><dd>{result.evidence.site.lastReportedAt ? new Date(result.evidence.site.lastReportedAt).toLocaleString() : 'Timestamp unavailable'}</dd></div>
                <div><dt>Public point</dt><dd>{result.evidence.site.location ? result.evidence.site.location.lat.toFixed(4) + '°N, ' + result.evidence.site.location.lng.toFixed(4) + '°E' : 'Location unavailable'}</dd></div>
              </dl>
              {result.evidence.site.sourceUrl && <ExternalLink href={result.evidence.site.sourceUrl}>Open DumpWatch source response</ExternalLink>}
              <ExternalLink href="https://junksnap.coehemang.dev">Continue the site workflow in DumpWatch</ExternalLink>
            </Card>

            <Card accent="air">
              <h3>Air evidence · {result.evidence.air.provenance?.stationName ?? 'Monitor not identified'}</h3>
              <dl className="cascade-facts">
                <div><dt>PM2.5</dt><dd>{result.evidence.air.pm25 == null ? 'No reading' : result.evidence.air.pm25 + ' ' + result.evidence.air.unit}</dd></div>
                <div><dt>Reading time</dt><dd>{result.evidence.air.provenance?.observedAt ? new Date(result.evidence.air.provenance.observedAt).toLocaleString() : 'Timestamp unavailable'}</dd></div>
                <div><dt>Monitor distance</dt><dd>{result.evidence.air.provenance?.distanceKm == null ? 'Unknown' : result.evidence.air.provenance.distanceKm.toFixed(1) + ' km from rounded query point'}</dd></div>
                <div><dt>Reading age</dt><dd>{result.evidence.air.provenance?.ageMinutes == null ? 'Unknown' : Math.round(result.evidence.air.provenance.ageMinutes) + ' minutes'}</dd></div>
              </dl>
              {result.evidence.air.sourceUrl && <ExternalLink href={result.evidence.air.sourceUrl}>Open AirPulse source response</ExternalLink>}
            </Card>
          </div>

          <Card className="cascade-next">
            <h3>Next step: a person reviews the source evidence</h3>
            <p className="muted">Climate Chain does not approve municipal action or mark the site resolved. Continue in DumpWatch, which owns report verification and clearance. This central review is read-only.</p>
            <button className="text-action" onClick={onBack}>Return to the waste site list</button>
          </Card>
        </>
      )}
    </div>
  );
}
