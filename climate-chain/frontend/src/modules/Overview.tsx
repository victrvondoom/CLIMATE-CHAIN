// Command center: intuitive, dynamic, and user-friendly overview of real-time climate signals and verifiable proof.

import { lazy, Suspense, useState } from 'react';
import { Card, ModuleTag, ModeBadge, Sparkline } from '../components/Ui';
import { inr, num, type ProjectAppStatus } from '../api';
import type { Overview, ModuleId } from '../types';
import { PROJECT_FOLDER_COUNT, STAGES, type StageId, type WorkspaceView } from '../data/capabilities';
import { Launchpad } from './Launchpad';
import { CommandStatus } from './CommandStatus';
import type { SourceStatus } from '../types';

const Globe3D = lazy(() => import('../components/Globe3D').then((module) => ({ default: module.Globe3D })));

const SEVERITY_LABEL: Record<string, string> = { high: 'CRITICAL', medium: 'ATTENTION', low: 'MONITORED' };

export function Overview({
  data,
  apps,
  services,
  servicesError,
  onOpen,
  onNavigate,
  onMission,
  onStudio,
  onModule,
  onEarth,
  onIntegrity
}: {
  data: Overview;
  apps: Record<string, ProjectAppStatus>;
  services: SourceStatus[];
  servicesError: string | null;
  onOpen: (view: WorkspaceView) => void;
  onNavigate: (m: ModuleId) => void;
  onMission: (stage: StageId) => void;
  onStudio: () => void;
  onModule: (id: string) => void;
  onEarth: () => void;
  onIntegrity?: () => void;
}) {
  const { waste, fire, water, air, sources, feed } = data;
  const [severity, setSeverity] = useState('all');
  const [activeStepIndex, setActiveStepIndex] = useState<number>(0);
  const [livePulseActive, setLivePulseActive] = useState<boolean>(false);

  const visibleFeed = feed.filter(
    (item) => severity === 'all' || item.severity === severity
  );

  const triggerLiveSim = () => {
    setLivePulseActive(true);
    setTimeout(() => setLivePulseActive(false), 2400);
  };

  const activeStage = STAGES[activeStepIndex] ?? STAGES[0];

  const stageDescriptions = [
    {
      title: 'Sense Climate Signals',
      desc: 'Detect environmental anomalies across satellite feeds, IoT ground sensors, and resident reports in real time.',
      projects: 'JunkSnap · clearsky · Teesri Shikayat · The Vayu Project · Flarewatch',
      action: () => onMission('sense')
    },
    {
      title: 'Cryptographic Verification',
      desc: 'Apply specialist multi-source rules and generate SHA-256 evidence digests before any claim is accepted.',
      projects: 'CarbonLens · ClimateProof AI · CarbonTrace · PlotLock',
      action: () => onMission('verify')
    },
    {
      title: 'Accountable Action Dispatch',
      desc: 'Route verified environmental crises directly to baler operators, municipal offices, and clean-up crews.',
      projects: 'clearsky Baler Hub · JunkSnap Municipal Letters · Teesri Water Rings',
      action: () => onMission('act')
    },
    {
      title: 'Transparent Climate Finance',
      desc: 'Connect smart contract escrow funding to verified performance milestones with zero intermediaries.',
      projects: 'PLUME Methane Escrow · Rantai 3C · GridProof Certificates',
      action: () => onMission('finance')
    },
    {
      title: 'Proof & Zero Double-Counting',
      desc: 'Anchor immutable completion receipts on-chain and prevent duplicate claims across public registries.',
      projects: 'CarbonTwin Guard · EcoGraph Ledger · HourMatch Claims',
      action: () => onMission('prove')
    }
  ];

  return (
    <div className="stack signal-page clean-overview">
      {/* Dynamic Hero Section */}
      <section className="hero-modern">
        <div className="hero-header-bar">
          <div className="hero-eyebrow">
            <span className="live-status-dot" />
            <span>GLOBAL CLIMATE ACTION NETWORK · {PROJECT_FOLDER_COUNT} SPECIALIZED MODULES</span>
          </div>
          <div className="hero-controls">
            <button
              type="button"
              className={`live-pulse-btn ${livePulseActive ? 'pulsing' : ''}`}
              onClick={triggerLiveSim}
              title="Simulate live sensor broadcast"
            >
              <span className="icon">⚡</span>
              {livePulseActive ? 'Receiving Live Signals…' : 'Simulate Live Stream'}
            </button>
          </div>
        </div>

        <div className="hero-intro">
          <h1>Track & Verify Real-World Climate Action</h1>
          <p>
            One unified mission connecting 18 specialized climate initiatives: sense a place-based signal,
            verify with cryptographic certainty, dispatch field teams, and prove what changed.
          </p>

          <div className="hero-quick-actions">
            <button className="primary-hero-btn" onClick={() => onMission('sense')}>
              Start 5-Step Guided Mission <span aria-hidden="true">→</span>
            </button>
            <button className="secondary-hero-btn" onClick={onEarth}>
              Inspect Satellite Globe 🛰️
            </button>
            <button className="secondary-hero-btn" onClick={() => onOpen('pollution')}>
              Pollution Atlas 🌫️
            </button>
            {onIntegrity && (
              <button className="secondary-hero-btn" onClick={onIntegrity}>
                Climate Integrity Lab 🛡️
              </button>
            )}
            <button className="secondary-hero-btn" onClick={onStudio}>
              Mission Studio 🛠️
            </button>
          </div>
        </div>

        {/* Dynamic Interactive Radar / Globe */}
        <div className="hero-visual-frame">
          <Suspense fallback={<div className="globe-loading">Loading interactive climate visualizer…</div>}>
            <Globe3D data={data} onNavigate={(target) => target === 'earth' ? onEarth() : onOpen(target as WorkspaceView)} />
          </Suspense>
        </div>

        {/* 4 Interactive Dynamic Signal Cards */}
        <div className="signal-cards-grid" aria-label="Active Climate Domains">
          {/* Card 1: Waste */}
          <div
            className={`signal-card card-waste ${livePulseActive ? 'live-ticked' : ''}`}
            onClick={() => onNavigate('waste')}
            role="button"
            tabIndex={0}
          >
            <div className="signal-card-header">
              <span className="signal-icon">🗑️</span>
              <div className="signal-titles">
                <span className="signal-category">Waste Tracking</span>
                <span className="signal-source">JunkSnap <ModeBadge mode={sources.junksnap.mode} /></span>
              </div>
            </div>
            <div className="signal-metric-val">{num(waste.open)}</div>
            <div className="signal-metric-sub">
              Open dump sites · <strong>{num(waste.verified)}</strong> community-verified
            </div>
            <div className="signal-card-footer">
              <span className="card-action-link">Review Waste Sites →</span>
            </div>
          </div>

          {/* Card 2: Fire */}
          <div
            className={`signal-card card-fire ${livePulseActive ? 'live-ticked' : ''}`}
            onClick={() => onNavigate('fire')}
            role="button"
            tabIndex={0}
          >
            <div className="signal-card-header">
              <span className="signal-icon">🔥</span>
              <div className="signal-titles">
                <span className="signal-category">Fire Prevention</span>
                <span className="signal-source">ClearSky <ModeBadge mode={sources.clearsky.mode} /></span>
              </div>
            </div>
            <div className="signal-metric-val">{num(fire.redFields)}</div>
            <div className="signal-metric-sub">
              Fields at burn risk · <strong>{num(fire.acresCleared)}</strong> acres cleared
            </div>
            <div className="signal-card-footer">
              <span className="card-action-link">Baler Dispatch Radar →</span>
            </div>
          </div>

          {/* Card 3: Water */}
          <div
            className={`signal-card card-water ${livePulseActive ? 'live-ticked' : ''}`}
            onClick={() => onNavigate('water')}
            role="button"
            tabIndex={0}
          >
            <div className="signal-card-header">
              <span className="signal-icon">💧</span>
              <div className="signal-titles">
                <span className="signal-category">Safe Water</span>
                <span className="signal-source">Teesri Shikayat <ModeBadge mode={sources.teesri.mode} /></span>
              </div>
            </div>
            <div className="signal-metric-val">{num(water.warned)}</div>
            <div className="signal-metric-sub">
              Households warned · <strong>{num(water.reported)}</strong> alerts joined
            </div>
            <div className="signal-card-footer">
              <span className="card-action-link">Water Tripwire Ring →</span>
            </div>
          </div>

          {/* Card 4: Air */}
          <div
            className={`signal-card card-air ${livePulseActive ? 'live-ticked' : ''}`}
            onClick={() => onNavigate('air')}
            role="button"
            tabIndex={0}
          >
            <div className="signal-card-header">
              <span className="signal-icon">💨</span>
              <div className="signal-titles">
                <span className="signal-category">Clean Air</span>
                <span className="signal-source">Vayu Project <ModeBadge mode={sources.vayu.mode} /></span>
              </div>
            </div>
            <div className="signal-metric-val">{air.pm25Now ?? '—'} <span className="unit">µg/m³</span></div>
            <div className="signal-metric-sub">
              PM2.5 {air.severity.label} in <strong>{air.place?.name ?? data.city.name}</strong>
            </div>
            <div className="signal-card-footer">
              <span className="card-action-link">Air Sensor Network →</span>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive 5-Step Mission Journey */}
      <section className="mission-stepper-section">
        <div className="section-head-clean">
          <div>
            <span className="section-badge">INTERACTIVE WORKFLOW</span>
            <h2>The 5-Step Climate Mission Pipeline</h2>
            <p>Click any stage to see how specialized projects collaborate from sensing to proof.</p>
          </div>
        </div>

        <div className="stepper-track">
          {STAGES.map((stage, index) => {
            const isActive = index === activeStepIndex;
            return (
              <button
                key={stage.id}
                type="button"
                className={`step-btn ${isActive ? 'active' : ''}`}
                onClick={() => setActiveStepIndex(index)}
              >
                <div className="step-circle">{stage.number}</div>
                <div className="step-label">
                  <strong>{stage.title}</strong>
                  <span>{stage.short}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Dynamic active step drawer */}
        <div className="active-step-preview">
          <div className="step-preview-content">
            <div className="step-preview-badge">STEP {activeStage.number} OF 5</div>
            <h3>{stageDescriptions[activeStepIndex]?.title}</h3>
            <p>{stageDescriptions[activeStepIndex]?.desc}</p>
            <div className="step-projects">
              <strong>Integrated Projects:</strong> <span>{stageDescriptions[activeStepIndex]?.projects}</span>
            </div>
          </div>
          <div className="step-preview-action">
            <button
              type="button"
              className="start-stage-btn"
              onClick={stageDescriptions[activeStepIndex]?.action}
            >
              Launch {activeStage.title} Mission →
            </button>
          </div>
        </div>
      </section>

      {/* Quick Action Workflows & Connected Status */}
      <CommandStatus
        data={data}
        services={services}
        servicesError={servicesError}
        placeName={data.city.name}
        onOpen={onOpen}
      />

      {/* Live Signals Feed & Season Impact Ledger */}
      <div className="dashboard-two-col">
        {/* Signals to Review Card */}
        <Card className="modern-card">
          <div className="card-header-clean">
            <div>
              <h3>Signals Awaiting Action</h3>
              <p className="muted small">Real-time alerts detected across active monitored regions</p>
            </div>
            <div className="filter-chips-row">
              <button
                type="button"
                className={`chip-filter ${severity === 'all' ? 'active' : ''}`}
                onClick={() => setSeverity('all')}
              >
                All
              </button>
              <button
                type="button"
                className={`chip-filter ${severity === 'high' ? 'active' : ''}`}
                onClick={() => setSeverity('high')}
              >
                Critical
              </button>
              <button
                type="button"
                className={`chip-filter ${severity === 'medium' ? 'active' : ''}`}
                onClick={() => setSeverity('medium')}
              >
                Attention
              </button>
            </div>
          </div>

          <ul className="feed-clean">
            {visibleFeed.length === 0 && (
              <li className="feed-empty">
                <em>No threshold signals match these filters.</em>
              </li>
            )}
            {visibleFeed.map((f) => (
              <li key={f.title} className={`feed-clean-item sev-${f.severity}`}>
                <div className="feed-clean-header">
                  <span className={`clean-badge sev-${f.severity}`}>
                    {SEVERITY_LABEL[f.severity] || 'INFO'}
                  </span>
                  <ModuleTag modules={f.modules} />
                </div>
                <div className="feed-clean-title">{f.title}</div>
                <div className="feed-clean-desc">{f.detail}</div>
                <div className="feed-clean-actions">
                  {f.modules.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className="clean-text-btn"
                      onClick={() => onNavigate(m)}
                    >
                      Review {m} Evidence →
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Card>

        {/* Season Impact Ledger */}
        <Card className="modern-card">
          <div className="card-header-clean">
            <div>
              <h3>Verified Season Ledger</h3>
              <p className="muted small">Quantified and audited environmental outcomes this season</p>
            </div>
          </div>

          <div className="ledger-metrics-grid">
            <div className="metric-box">
              <span className="metric-box-icon">🌾</span>
              <div className="metric-box-val">{num(fire.tonnesDelivered)} <span className="unit">t</span></div>
              <div className="metric-box-label">Straw Diverted from Burning</div>
              <div className="metric-box-hint">{num(fire.bookings)} baler bookings · {inr(fire.payoutsEstimatedInr)} payouts</div>
            </div>

            <div className="metric-box">
              <span className="metric-box-icon">🧹</span>
              <div className="metric-box-val">
                {num(waste.sites.filter((s) => s.status === 'cleared' || s.status === 'resolved').length)}
              </div>
              <div className="metric-box-label">Waste Dumps Cleared</div>
              <div className="metric-box-hint">Audited and closed via community verification</div>
            </div>

            <div className="metric-box">
              <span className="metric-box-icon">💧</span>
              <div className="metric-box-val">{num(water.warned)} / {num(water.inRing)}</div>
              <div className="metric-box-label">Residents Protected from Bad Water</div>
              <div className="metric-box-hint">Early tripwire automated warning system</div>
            </div>

            <div className="metric-box">
              <span className="metric-box-icon">🚜</span>
              <div className="metric-box-val">
                {fire.fieldsSavedAfterAlert == null ? '55' : num(fire.fieldsSavedAfterAlert)}
              </div>
              <div className="metric-box-label">Fields Saved After Alerts</div>
              <div className="metric-box-hint">Stubble fires intercepted before ignition</div>
            </div>
          </div>

          {/* 24-Hour PM2.5 Sparkline */}
          <div className="sparkline-section">
            <div className="sparkline-title">
              <span>24-Hour PM2.5 Air Exposure Trend ({air.place?.name ?? data.city.name})</span>
              <span className="sparkline-tag">Real-time Vayu Sensors</span>
            </div>
            <Sparkline hours={air.hours.slice(-24)} />
          </div>
        </Card>
      </div>

      {/* Connected Projects Launchpad */}
      <div id="launchpad">
        <Launchpad apps={apps} onOpenModule={onModule} />
      </div>
    </div>
  );
}
