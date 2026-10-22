import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { fetchCascade } from '../api';
import { Card, ExternalLink } from '../components/Ui';
import type { CascadeResponse, Overview } from '../types';

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
  const [reload, setReload] = useState(0);
  const [demoMode, setDemoMode] = useState(false);
  const [result, setResult] = useState<CascadeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const activeSiteId = selectedSiteId || availableSites[0]?.id || '';

  useEffect(() => setSelectedSiteId(siteId ?? ''), [siteId]);

  useEffect(() => {
    const controller = new AbortController();
    if (!activeSiteId) {
      setLoading(false);
      setError(null);
      setResult(null);
      return () => controller.abort();
    }
    setLoading(true);
    setError(null);
    setResult(null);
    fetchCascade(activeSiteId, radiusKm, timeWindowHours, controller.signal, demoMode)
      .then(setResult)
      .catch((cause: unknown) => {
        if (cause instanceof Error && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : 'Unable to load source evidence.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [activeSiteId, radiusKm, timeWindowHours, reload, demoMode]);

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
    <div className="stack cascade-page">
      <div className="cascade-heading">
        <button className="text-action" onClick={onBack}>← Waste sites</button>
        <div>
          <p className="eyebrow">One place · two evidence sources · human review</p>
          <h2>Climate Cascade Review</h2>
          <p className="muted">Check whether an open JunkSnap site and a nearby Vayu monitor have recent observations in common.</p>
        </div>
      </div>

      <div className="cascade-controls">
        <label>Open waste site
          <select value={activeSiteId} onChange={(event) => setSelectedSiteId(event.target.value)}>
            {siteId && !availableSites.some((site) => site.id === siteId) && <option value={siteId}>Selected site · {siteId}</option>}
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
      </div>

      {!activeSiteId && <Card><h3>No open, located sites are available</h3><p className="muted">Open the Waste view when JunkSnap returns a public site with a location, or use the local walkthrough to explore the review steps.</p><button className="text-action" onClick={() => { setSelectedSiteId('site_mock_1'); setDemoMode(true); }}>Load simulated walkthrough</button></Card>}
      {loading && <Card><p role="status">Loading the selected site and querying Vayu near its public location…</p></Card>}
      {error && (
        <Card className="cascade-error">
          <h3>Evidence could not be loaded</h3>
          <p>{error}</p>
          <p className="muted">No simulated readings are substituted into a live review. You can retry the live sources or open a clearly labeled local walkthrough.</p>
          <div className="cascade-error-actions">
            <button className="text-action" onClick={() => { setDemoMode(false); setSelectedSiteId(availableSites[0]?.id ?? ''); setReload((value) => value + 1); }}>Try live sources again</button>
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
              <span>JunkSnap <b>{result.demo ? 'SIMULATED' : result.sources.junksnap.toUpperCase()}</b></span>
              <span>Vayu <b>{result.demo ? 'SIMULATED' : result.sources.vayu.toUpperCase()}</b></span>
            </div>
          </div>

          <div className="cascade-grid">
            <Card className="cascade-globe-card">
              <h3>3D place lens</h3>
              <div className="cascade-globe"><Suspense fallback={<div className="globe-loading">Rendering the 3D place view…</div>}><Globe3D data={lensData} showPilotBeacons={false} showSchematicLinks={false} showWasteSites={false} reviewSite={result.evidence.site.location} /></Suspense></div>
              <p className="muted small">Gold marks the selected public JunkSnap site. Violet marks the Vayu query location; the monitor itself is not plotted because its exact coordinates are not returned by this API.</p>
            </Card>

            <Card>
              <h3>Review checks</h3>
              <div className="cascade-checks">
                <Check label="Both sources report observed data" value={result.assessment.checks.bothSourcesObserved} />
                <Check label={'Nearest monitor within ' + radiusKm + ' km'} value={result.assessment.checks.nearestMonitorWithinRadius} />
                <Check label={'Report and reading within ' + timeWindowHours + ' h'} value={result.assessment.checks.observationsWithinTimeWindow} />
              </div>
              <p className="cascade-caution">Passing these checks creates a proximity lead. Geographic and temporal overlap does not show that one condition caused the other.</p>
              <button className="primary-action" onClick={() => saveManifest(result)}>Download evidence manifest</button>
              <p className="muted small">The SHA-256 digest covers the exported JSON. It detects later changes relative to this digest, but is not an independent audit log or immutable storage.</p>
            </Card>
          </div>

          <div className="grid-2">
            <Card accent="waste">
              <h3>Waste evidence · {result.evidence.site.sourceId}</h3>
              <dl className="cascade-facts">
                <div><dt>Status</dt><dd>{result.evidence.site.status ?? 'Unknown'} · {result.evidence.site.verification ?? 'verification unknown'}</dd></div>
                <div><dt>Reports</dt><dd>{result.evidence.site.reportCount ?? 'Unknown'}</dd></div>
                <div><dt>Last report</dt><dd>{result.evidence.site.lastReportedAt ? new Date(result.evidence.site.lastReportedAt).toLocaleString() : 'Timestamp unavailable'}</dd></div>
                <div><dt>Public point</dt><dd>{result.evidence.site.location ? result.evidence.site.location.lat.toFixed(4) + '°N, ' + result.evidence.site.location.lng.toFixed(4) + '°E' : 'Location unavailable'}</dd></div>
              </dl>
              {result.evidence.site.sourceUrl && <ExternalLink href={result.evidence.site.sourceUrl}>Open JunkSnap source response</ExternalLink>}
              <ExternalLink href="https://junksnap.coehemang.dev">Continue the site workflow in JunkSnap</ExternalLink>
            </Card>

            <Card accent="air">
              <h3>Air evidence · {result.evidence.air.provenance?.stationName ?? 'Monitor not identified'}</h3>
              <dl className="cascade-facts">
                <div><dt>PM2.5</dt><dd>{result.evidence.air.pm25 == null ? 'No reading' : result.evidence.air.pm25 + ' ' + result.evidence.air.unit}</dd></div>
                <div><dt>Reading time</dt><dd>{result.evidence.air.provenance?.observedAt ? new Date(result.evidence.air.provenance.observedAt).toLocaleString() : 'Timestamp unavailable'}</dd></div>
                <div><dt>Monitor distance</dt><dd>{result.evidence.air.provenance?.distanceKm == null ? 'Unknown' : result.evidence.air.provenance.distanceKm.toFixed(1) + ' km from rounded query point'}</dd></div>
                <div><dt>Reading age</dt><dd>{result.evidence.air.provenance?.ageMinutes == null ? 'Unknown' : Math.round(result.evidence.air.provenance.ageMinutes) + ' minutes'}</dd></div>
              </dl>
              {result.evidence.air.sourceUrl && <ExternalLink href={result.evidence.air.sourceUrl}>Open Vayu source response</ExternalLink>}
            </Card>
          </div>

          <Card className="cascade-next">
            <h3>Next step: a person reviews the source evidence</h3>
            <p className="muted">Climate Chain does not approve municipal action or mark the site resolved. Continue in JunkSnap, which owns report verification and clearance. This central review is read-only.</p>
            <button className="text-action" onClick={onBack}>Return to the waste site list</button>
          </Card>
        </>
      )}
    </div>
  );
}
