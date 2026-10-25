import { useEffect, useState } from 'react';
import { fetchIntegrationEvidence, type IntegrationEvidence } from '../api';
import { downloadSnapshot } from './SignalSnapshot';
import { hashValue } from '../core/evidence';
import { displayEndpoint, displayText } from '../core/displayNames';
import { useLiveQuery } from '../hooks/useLiveQuery';
import type { Overview, SourceStatus } from '../types';
import type { WorkspaceView } from '../data/capabilities';
import './connections.css';

const SOURCE_LABELS: Record<keyof Overview['sources'], string> = {
  junksnap: 'DumpWatch · Waste',
  clearsky: 'AshAlert · Fire',
  teesri: 'TapAlert · Water',
  vayu: 'AirPulse · Air',
};

function formatTime(value?: string | null) {
  if (!value) return 'Not recorded';
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(time);
}

export function ConnectionEvidence({ data, services, servicesError, onRefresh, onOpen }: {
  data: Overview | null;
  services: SourceStatus[];
  servicesError: string | null;
  onRefresh: () => void;
  onOpen: (view: WorkspaceView) => void;
}) {
  const inventoryQuery = useLiveQuery<IntegrationEvidence>(fetchIntegrationEvidence, { intervalMs: 60_000, allowOffline: true });
  const inventory = inventoryQuery.data;
  const [snapshotDigest, setSnapshotDigest] = useState<string | null>(null);
  const [digestError, setDigestError] = useState('');
  const cesiumTokenConfigured = Boolean(import.meta.env.VITE_CESIUM_ION_TOKEN);

  useEffect(() => {
    let current = true;
    setDigestError('');
    if (!data) { setSnapshotDigest(null); return () => { current = false; }; }
    void hashValue(data).then((digest) => {
      if (current) setSnapshotDigest(digest);
    }).catch(() => {
      if (current) { setSnapshotDigest(null); setDigestError('This browser could not compute a SHA-256 digest.'); }
    });
    return () => { current = false; };
  }, [data]);

  const downloadEvidence = () => {
    if (!data || !snapshotDigest) return;
    downloadSnapshot('live-data-evidence', {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      sourceHealth: services,
      snapshot: data,
      snapshotIntegrity: {
        algorithm: 'SHA-256',
        digest: snapshotDigest,
        scope: 'Canonical JSON bytes of snapshot only.',
        limitation: 'The digest detects byte changes after capture. It does not authenticate a provider or prove the source values are true.',
      },
      credentialEvidence: inventory?.credentials ?? [],
    });
  };

  return (
    <div className="connection-evidence">
      <header className="connection-hero">
        <div>
          <span className="eyebrow">DATA PROVENANCE · CREDENTIALS · MCP</span>
          <h2>Show what was fetched, from where, and with which access.</h2>
          <p>Each live label is tied to a source response and fetch receipt. Key values are never shown here.</p>
        </div>
        <div className="connection-actions">
          <button type="button" onClick={() => { onRefresh(); void inventoryQuery.refresh(); }} disabled={inventoryQuery.refreshing}>
            {inventoryQuery.refreshing ? 'Refreshing…' : 'Refresh evidence'}
          </button>
          <button type="button" className="primary-action" onClick={downloadEvidence} disabled={!data || !snapshotDigest}>
            Download evidence JSON
          </button>
        </div>
      </header>

      <div className="connection-explainer">
        <strong>How to read this</strong>
        <span><b>LIVE</b> means a source response was received. Check the observation type and timestamp before treating it as measured evidence.</span>
        <span><b>SIMULATED</b> is a fallback snapshot and is not evidence of current conditions.</span>
        <span>SHA-256 confirms the exported snapshot bytes; it does not prove provider identity, accuracy, causality, or impact.</span>
      </div>

      {inventoryQuery.error && <div className="error" role="alert">Credential and MCP inventory unavailable: {inventoryQuery.error} <button type="button" onClick={() => void inventoryQuery.refresh()}>Retry</button></div>}
      {servicesError && <div className="error" role="alert">Source health check failed: {servicesError}. The last overview snapshot remains shown.</div>}

      <section className="connection-section" aria-labelledby="connection-source-heading">
        <div className="connection-section-head">
          <div><span className="eyebrow">FOUR SHARED READ SOURCES</span><h3 id="connection-source-heading">Provider evidence</h3></div>
          <span className="muted small">Snapshot captured {formatTime(data?.asOf)}</span>
        </div>
        <div className="connection-source-grid">
          {(Object.keys(SOURCE_LABELS) as (keyof Overview['sources'])[]).map((name) => {
            const source = data?.sources[name];
            const config = inventory?.upstreams.find((item) => item.name === name);
            const health = services.find((item) => item.name === name);
            const mode = source?.mode;
            const provenance = source?.provenance;
            return (
              <article className="connection-source-card" key={name}>
                <div className="connection-card-heading">
                  <div><span className="eyebrow">{config?.domain ?? (SOURCE_LABELS[name]?.split(' · ')[1] ?? 'Source').toUpperCase()}</span><h4>{SOURCE_LABELS[name]}</h4></div>
                  <span className={`connection-mode ${mode === 'live' ? 'is-live' : mode === 'mock' ? 'is-simulated' : ''}`}>{mode === 'live' ? 'LIVE' : mode === 'mock' ? 'SIMULATED' : 'WAITING'}</span>
                </div>
                <p className="connection-auth">{config?.apiKeyRequired ? 'API key required' : 'Shared GET: no API key required'}</p>
                {source?.error && <p className="connection-error">{source.error.code}: {source.error.message}</p>}
                <dl>
                  <div><dt>Health probe</dt><dd>{health?.status ?? 'Not checked'}</dd></div>
                  <div><dt>Public endpoint</dt><dd>{displayEndpoint(name, provenance?.url ?? config?.endpoint)}</dd></div>
                  <div><dt>Operation / schema</dt><dd>{displayText(provenance ? `${provenance.operation} / ${provenance.schema}` : config?.operations.map((item) => `${item.operation} / ${item.schema}`).join(', ') ?? 'No source receipt')}</dd></div>
                  <div><dt>Fetched</dt><dd>{formatTime(provenance?.fetchedAt)}</dd></div>
                  <div><dt>Request evidence</dt><dd>{provenance ? `${provenance.elapsedMs} ms · ${provenance.attempts} attempt(s)${provenance.cacheHit ? ' · cache hit' : ''}` : 'No live response in this snapshot'}</dd></div>
                  {provenance?.requestId && <div><dt>Request ID</dt><dd>{provenance.requestId}</dd></div>}
                </dl>
                {name === 'vayu' && data?.air.provenance && <p className="connection-footnote">Air provenance: {displayText(data.air.provenance.source)}; {data.air.provenance.mode}; {data.air.provenance.simulated ? 'simulated' : 'not marked simulated'}; observation {formatTime(data.air.provenance.observedAt)}.</p>}
              </article>
            );
          })}
        </div>
      </section>

      <section className="connection-section" aria-labelledby="connection-keys-heading">
        <div className="connection-section-head">
          <div><span className="eyebrow">SECRET VALUES HIDDEN</span><h3 id="connection-keys-heading">API key evidence</h3></div>
          <span className="muted small">Checked {formatTime(inventory?.checkedAt)}</span>
        </div>
        <div className="connection-key-grid">
          <article className="connection-key-card">
            <div className="connection-card-heading"><div><h4>Shared project APIs</h4><p>DumpWatch, AshAlert, TapAlert, and AirPulse</p></div><span className="connection-mode is-live">NO KEY REQUIRED</span></div>
            <p>The central gateway uses public read-only GET operations. It does not need or issue credentials for these four reads. Source health and response provenance above are the evidence of each fetch.</p>
          </article>
          {inventory?.credentials.map((credential) => (
            <article className="connection-key-card" key={credential.variable}>
              <div className="connection-card-heading"><div><h4>{credential.provider}</h4><code>{credential.variable}</code></div><span className={`connection-mode ${credential.configured ? 'is-simulated' : ''}`}>{credential.configured ? 'CONFIGURED' : 'NOT CONFIGURED'}</span></div>
              <p>{credential.evidence}</p>
              <dl><div><dt>Required</dt><dd>{credential.required ? 'Yes' : 'No'}</dd></div><div><dt>Provider validated</dt><dd>{credential.validated ? 'Yes' : 'No'}</dd></div><div><dt>Used by gateway</dt><dd>{credential.usedByGateway ? 'Yes' : 'No'}</dd></div></dl>
            </article>
          ))}
          <article className="connection-key-card">
            <div className="connection-card-heading"><div><h4>Cesium ion terrain token</h4><code>VITE_CESIUM_ION_TOKEN</code></div><span className={`connection-mode ${cesiumTokenConfigured ? 'is-simulated' : ''}`}>{cesiumTokenConfigured ? 'PRESENT AT BUILD' : 'NOT CONFIGURED'}</span></div>
            <p>{cesiumTokenConfigured ? 'This is a browser-visible client token for optional World Terrain only. Presence is verified; provider validity is not checked here.' : 'Optional browser token for World Terrain only. Satellite imagery and the source APIs work without it.'}</p>
            <dl><div><dt>Secret?</dt><dd>No · public client token</dd></div><div><dt>Provider validated</dt><dd>No</dd></div><div><dt>Source data use</dt><dd>None</dd></div></dl>
          </article>
        </div>
        <p className="connection-scope">{inventory?.scope ?? 'Specialist projects keep their own keys and secret stores; this gateway does not claim they are configured or validated.'}</p>
      </section>

      <section className="connection-mcp" aria-labelledby="connection-mcp-heading">
        <div>
          <span className="eyebrow">PROJECT MCP</span>
          <h3 id="connection-mcp-heading">{inventory?.mcp.name ?? 'Climate Chain live-data MCP'}</h3>
          <p>{inventory?.mcp.access ?? 'Local read-only MCP tools call the loopback gateway; no public listener or source credentials are used.'}</p>
          <p className="muted small">No remote HTTP MCP endpoint is declared in this project. This local MCP uses the project’s public upstream APIs through the gateway.</p>
          <ul>{(inventory?.mcp.tools ?? ['climate_chain_get_live_overview', 'climate_chain_check_public_sources', 'climate_chain_fetch_cascade_evidence']).map((tool) => <li key={tool}><code>{tool}</code></li>)}</ul>
        </div>
        <div className="connection-mcp-actions">
          <span className="connection-mode is-live">{inventory?.mcp.transport ?? 'stdio'} · READ ONLY</span>
          <button type="button" onClick={() => onOpen('memory')}>Open MCP setup</button>
          <span className="muted small">The setup export now includes both live-data and engineering-memory MCP servers. Install it in each agent and restart that session.</span>
        </div>
      </section>

      <section className="connection-digest" aria-label="Snapshot integrity">
        <div><span className="eyebrow">LOCAL SNAPSHOT INTEGRITY</span><strong>{snapshotDigest ? `SHA-256 ${snapshotDigest}` : digestError || 'Waiting for a source snapshot'}</strong><p>This digest covers the latest overview JSON only; it is not a provider signature.</p></div>
        <div><span className="eyebrow">SOURCE HEALTH CHECK</span><strong>{services.filter((item) => item.status === 'connected' || item.status === 'live').length} / {services.length || 4} connected</strong><p>Last health probe: {formatTime(services.reduce<string | null>((latest, item) => !item.checkedAt ? latest : !latest || Date.parse(item.checkedAt) > Date.parse(latest) ? item.checkedAt : latest, null))}</p></div>
      </section>
    </div>
  );
}
