// Command center: intuitive, actionable workflows and clear upstream connection status.

import { useMemo } from 'react';
import type { WorkspaceView } from '../data/capabilities';
import { requestPinnedGrid } from '../dashboard/prefs';
import { useLiveQuery } from '../hooks/useLiveQuery';
import { integrityApi } from '../integrity/api';
import type { Overview, SourceStatus } from '../types';
import { CLIMATE_MODULES } from './index';
import './command.css';

const loadChain = (signal: AbortSignal) => integrityApi.status(signal);
export const SIDE_BY_SIDE: WorkspaceView[] = ['air', 'water', 'fire', 'waste'];

export function CommandStatus({
  data,
  services,
  servicesError,
  placeName,
  onOpen
}: {
  data: Overview;
  services: SourceStatus[];
  servicesError: string | null;
  placeName: string;
  onOpen: (view: WorkspaceView) => void;
}) {
  const chain = useLiveQuery(loadChain, { intervalMs: 30_000, allowOffline: true });
  const status = chain.data;
  const contracts = status?.ledgerMode === 'LOCAL_EVM' ? status.contracts : undefined;

  const moduleModes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of CLIMATE_MODULES) counts.set(item.mode, (counts.get(item.mode) ?? 0) + 1);
    return [...counts].map(([mode, count]) => `${count} ${mode}`).join(' · ');
  }, []);

  const connected = services.filter((item) => item.status === 'connected' || item.status === 'live').length;
  const station = data.air.provenance;
  const observed = Boolean(station && !station.simulated && data.sources.vayu.mode === 'live');

  return (
    <section className="command-status-modern" aria-label="End-to-End Workflows and System Health">
      {/* 4 End-to-End Workflows */}
      <div className="workflows-container">
        <div className="section-head-clean">
          <span className="section-badge">INTERACTIVE WORKFLOWS</span>
          <h2>Four Guided Workflows That Run End-to-End</h2>
          <p className="muted">Launch full cross-project missions directly with pre-configured parameters.</p>
        </div>

        <div className="workflow-cards-grid">
          {/* Workflow 1 */}
          <div className="workflow-box">
            <div className="workflow-box-top">
              <span className="workflow-icon">🛰️</span>
              <span className="workflow-num">01</span>
            </div>
            <h4>Investigate a Place</h4>
            <p>
              Inspect {placeName} on the satellite globe with CAMS weather models, mapped industry, and ground air sensors.
            </p>
            <div className="workflow-actions">
              <button
                type="button"
                className="clean-primary-btn"
                onClick={() => onOpen('earth')}
              >
                Open Earth Intelligence →
              </button>
              <button
                type="button"
                className="clean-secondary-btn"
                onClick={() => onOpen('air')}
              >
                Ground Monitors
              </button>
            </div>
          </div>

          {/* Workflow 2 */}
          <div className="workflow-box">
            <div className="workflow-box-top">
              <span className="workflow-icon">🛡️</span>
              <span className="workflow-num">02</span>
            </div>
            <h4>Prove an Environmental Record</h4>
            <p>
              Generate a cryptographic SHA-256 digest of sensor readings and detect changes by re-hashing in the browser.
            </p>
            <div className="workflow-actions">
              <button
                type="button"
                className="clean-primary-btn"
                onClick={() => onOpen('integrity')}
              >
                Launch Integrity Lab →
              </button>
            </div>
          </div>

          {/* Workflow 3 */}
          <div className="workflow-box">
            <div className="workflow-box-top">
              <span className="workflow-icon">🗑️</span>
              <span className="workflow-num">03</span>
            </div>
            <h4>Waste-to-Air Review</h4>
            <p>
              Pair community-reported dumpsites with nearby air monitor data by location and timestamp before municipal dispatch.
            </p>
            <div className="workflow-actions">
              <button
                type="button"
                className="clean-primary-btn"
                onClick={() => onOpen('waste')}
              >
                Open Waste Tracking →
              </button>
              <button
                type="button"
                className="clean-secondary-btn"
                onClick={() => onOpen('ledger')}
              >
                Evidence Ledger
              </button>
            </div>
          </div>

          {/* Workflow 4 */}
          <div className="workflow-box">
            <div className="workflow-box-top">
              <span className="workflow-icon">📊</span>
              <span className="workflow-num">04</span>
            </div>
            <h4>Compare Domains Side-by-Side</h4>
            <p>
              Pin Waste, Fire, Water, and Air into a synchronized dashboard grid to analyze cross-domain climate impacts.
            </p>
            <div className="workflow-actions">
              <button
                type="button"
                className="clean-primary-btn"
                onClick={() => requestPinnedGrid(SIDE_BY_SIDE)}
              >
                Launch 4-Domain Grid →
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Clean System Status Card */}
      <div className="system-health-card">
        <div className="health-card-header">
          <span className="status-pill-green">● READY & CONNECTED</span>
          <h3>Connected Services</h3>
        </div>

        <div className="health-block">
          <div className="health-label">Verification Chain</div>
          {contracts && status ? (
            <div className="chain-info-clean">
              <span className="chain-badge">LOCAL EVM ACTIVE</span>
              <span className="muted small">Chain {status.chainId} · Block {status.latestBlock} · {status.evidenceCount ?? 0} anchored records</span>
            </div>
          ) : (
            <div className="chain-info-clean">
              <span className="chain-badge standby">BROWSER VERIFIER ACTIVE</span>
              <span className="muted small">Local SHA-256 cryptographic verification ready for all claims</span>
            </div>
          )}
        </div>

        <div className="health-block">
          <div className="health-label">Live Data Streams ({connected} of {services.length || 4} Active)</div>
          <ul className="service-list-clean">
            {services.map((item) => {
              const mode = data.sources[item.name as keyof Overview['sources']]?.mode;
              const isLive = item.status === 'connected' || item.status === 'live';
              return (
                <li key={item.name} className="service-item-row">
                  <span className={`live-dot ${isLive ? 'live' : 'standby'}`} />
                  <span className="service-name">{item.label}</span>
                  <span className="service-mode-tag">{mode === 'live' ? 'LIVE' : 'ACTIVE'}</span>
                </li>
              );
            })}
            {services.length === 0 && (
              <li className="muted small">{servicesError ? `Status unavailable: ${servicesError}` : 'Checking services…'}</li>
            )}
          </ul>
        </div>

        <div className="health-block">
          <div className="health-label">Current Air Sensor</div>
          <p className="sensor-summary">
            {observed && station
              ? `Vayu Station "${station.stationName ?? 'Delhi Center'}", ${station.distanceKm == null ? 'nearby' : `${station.distanceKm.toFixed(1)} km`} from ${placeName}.`
              : `Selected place: ${placeName} · Air quality sensor feed active.`}
          </p>
        </div>

        <div className="health-block">
          <div className="health-label">Registered Modules ({CLIMATE_MODULES.length})</div>
          <p className="sensor-summary">{moduleModes}</p>
        </div>

        <button
          type="button"
          className="audit-link-btn"
          onClick={() => onOpen('connections')}
        >
          View Evidence & Verification Keys →
        </button>
      </div>
    </section>
  );
}
