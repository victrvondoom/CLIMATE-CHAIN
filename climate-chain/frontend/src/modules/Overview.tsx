// Command center: the live numbers first, then the map, the mission pipeline, signals awaiting action and the season ledger.

import { lazy, Suspense, useState } from 'react';
import { ModuleTag, ModeBadge, Sparkline } from '../components/Ui';
import { Icon, type IconName } from '../components/Icon';
import { inr, num, type ProjectAppStatus } from '../api';
import type { Overview, ModuleId, SourceMode } from '../types';
import { PROJECT_FOLDER_COUNT, STAGES, type StageId, type WorkspaceView } from '../data/capabilities';
import { Launchpad } from './Launchpad';
import { CommandStatus } from './CommandStatus';
import type { SourceStatus } from '../types';

const Globe3D = lazy(() => import('../components/Globe3D').then((module) => ({ default: module.Globe3D })));

const SEVERITY_LABEL: Record<string, string> = { high: 'Critical', medium: 'Attention', low: 'Monitored' };

interface Kpi {
  id: ModuleId;
  tone: 'waste' | 'fire' | 'water' | 'air';
  icon: IconName;
  label: string;
  source: string;
  mode: SourceMode;
  value: string;
  unit?: string;
  caption: string;
  facts: { label: string; value: string }[];
  action: string;
}

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

  const visibleFeed = feed.filter((item) => severity === 'all' || item.severity === severity);
  const activeStage = STAGES[activeStepIndex] ?? STAGES[0];

  const kpis: Kpi[] = [
    {
      id: 'waste', tone: 'waste', icon: 'waste', label: 'Waste tracking', source: 'JunkSnap', mode: sources.junksnap.mode,
      value: num(waste.open), caption: 'Open dump sites',
      facts: [{ label: 'Community-verified', value: num(waste.verified) }],
      action: 'Review waste sites'
    },
    {
      id: 'fire', tone: 'fire', icon: 'fire', label: 'Fire prevention', source: 'ClearSky', mode: sources.clearsky.mode,
      value: num(fire.redFields), caption: 'Fields at burn risk',
      facts: [{ label: 'Acres cleared', value: num(fire.acresCleared) }],
      action: 'Open baler dispatch'
    },
    {
      id: 'water', tone: 'water', icon: 'water', label: 'Safe water', source: 'Teesri Shikayat', mode: sources.teesri.mode,
      value: num(water.warned), caption: 'Households warned',
      facts: [{ label: 'Alerts joined', value: num(water.reported) }],
      action: 'Open water tripwire'
    },
    {
      id: 'air', tone: 'air', icon: 'air', label: 'Clean air', source: 'Vayu Project', mode: sources.vayu.mode,
      value: air.pm25Now == null ? '—' : String(air.pm25Now), unit: 'µg/m³', caption: `PM2.5 · ${air.severity.label}`,
      facts: [{ label: 'Location', value: air.place?.name ?? data.city.name }],
      action: 'Open air sensors'
    }
  ];

  const stageDescriptions = [
    {
      title: 'Sense climate signals',
      desc: 'Detect environmental anomalies across satellite feeds, ground sensors and resident reports.',
      projects: 'JunkSnap · ClearSky · Teesri Shikayat · The Vayu Project · Flarewatch',
      action: () => onMission('sense')
    },
    {
      title: 'Verify the evidence',
      desc: 'Apply specialist multi-source rules and generate SHA-256 evidence digests before any claim is accepted.',
      projects: 'CarbonLens · ClimateProof AI · CarbonTrace · PlotLock',
      action: () => onMission('verify')
    },
    {
      title: 'Dispatch accountable action',
      desc: 'Route verified environmental problems to baler operators, municipal offices and clean-up crews.',
      projects: 'ClearSky Baler Hub · JunkSnap Municipal Letters · Teesri Water Rings',
      action: () => onMission('act')
    },
    {
      title: 'Finance the work transparently',
      desc: 'Review funding mechanisms (escrow, registries) and their status.',
      projects: 'PLUME Methane Escrow · Rantai 3C · GridProof Certificates',
      action: () => onMission('finance')
    },
    {
      title: 'Prove it and count it once',
      desc: 'Anchor completion receipts on a local demo chain (not public or immutable) and flag duplicate claims within the local demo registry.',
      projects: 'CarbonTwin Guard · EcoGraph Ledger · HourMatch Claims',
      action: () => onMission('prove')
    }
  ];

  const cleared = waste.sites.filter((s) => s.status === 'cleared' || s.status === 'resolved').length;

  return (
    <div className="stack signal-page clean-overview ov">
      {/* Headline */}
      <header className="ov-header">
        <div className="hero-eyebrow">
          <span className="live-status-dot" />
          <span className="eyebrow-network">Global network</span>
          <span className="eyebrow-divider">/</span>
          <span className="eyebrow-count">{PROJECT_FOLDER_COUNT} specialised modules</span>
        </div>
        <h1 className="ov-title">
          Track and verify <em>real-world</em> climate action
        </h1>
        <p className="ov-lede">
          One mission across {PROJECT_FOLDER_COUNT} climate initiatives: sense a place-based signal, check the evidence with SHA-256 digests,
          dispatch field teams, and prove what changed.
        </p>
        <div className="ov-actions">
          <button type="button" className="primary-hero-btn" onClick={() => onMission('sense')}>
            Start the 5-step mission <Icon name="arrow" size={16} />
          </button>
          <button type="button" className="secondary-hero-btn" onClick={onEarth}>
            <Icon name="globe" size={16} /> Satellite globe
          </button>
          <button type="button" className="secondary-hero-btn" onClick={() => onOpen('pollution')}>
            <Icon name="cloud" size={16} /> Pollution atlas
          </button>
          {onIntegrity && (
            <button type="button" className="secondary-hero-btn" onClick={onIntegrity}>
              <Icon name="shield" size={16} /> Integrity lab
            </button>
          )}
          <button type="button" className="secondary-hero-btn" onClick={onStudio}>
            <Icon name="tool" size={16} /> Mission studio
          </button>
        </div>
      </header>

      {/* The numbers */}
      <section className="kpi-grid" aria-label="Active climate domains">
        {kpis.map((kpi) => (
          <article
            key={kpi.id}
            className={`kpi-card tone-${kpi.tone}`}
            onClick={() => onNavigate(kpi.id)}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onNavigate(kpi.id); } }}
            role="button"
            tabIndex={0}
          >
            <div className="kpi-top">
              <span className="kpi-icon"><Icon name={kpi.icon} size={20} /></span>
              <div className="kpi-names">
                <span className="kpi-label">{kpi.label}</span>
                <span className="kpi-source">{kpi.source}</span>
              </div>
            </div>
            <div className="kpi-figure">
              <span className="kpi-number">{kpi.value}</span>
              {kpi.unit && <span className="kpi-unit">{kpi.unit}</span>}
            </div>
            <div className="kpi-caption">{kpi.caption}</div>
            <dl className="kpi-facts">
              {kpi.facts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
              <div>
                <dt>Data mode</dt>
                <dd><ModeBadge mode={kpi.mode} /></dd>
              </div>
            </dl>
            <span className="kpi-link">{kpi.action} <Icon name="arrow" size={14} /></span>
          </article>
        ))}
      </section>

      {/* Map */}
      <section className="ov-section">
        <div className="ov-section-head">
          <span className="section-badge">Signal map</span>
          <h2>Where the signals are</h2>
          <p>Switch between the radar and the 3D satellite view; select a marker to open its evidence.</p>
        </div>
        <div className="hero-visual-frame">
          <Suspense fallback={<div className="globe-loading">Loading the climate map…</div>}>
            <Globe3D data={data} onNavigate={(target) => target === 'earth' ? onEarth() : onOpen(target as WorkspaceView)} />
          </Suspense>
        </div>
      </section>

      {/* Pipeline */}
      <section className="ov-section">
        <div className="ov-section-head">
          <span className="section-badge">Workflow</span>
          <h2>The five-step <em>mission pipeline</em></h2>
          <p>Select a stage to see how the specialised projects hand off from sensing to proof.</p>
        </div>

        <div className="pipeline panel">
          <ol className="pipeline-track">
            {STAGES.map((stage, index) => {
              const isActive = index === activeStepIndex;
              return (
                <li key={stage.id}>
                  <button
                    type="button"
                    className={`pipeline-step ${isActive ? 'active' : ''}`}
                    aria-current={isActive ? 'step' : undefined}
                    onClick={() => setActiveStepIndex(index)}
                  >
                    <span className="pipeline-num">{stage.number}</span>
                    <span className="pipeline-name">{stage.title}</span>
                    <span className="pipeline-short">{stage.short}</span>
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="pipeline-detail">
            <div className="pipeline-copy">
              <span className="section-badge">Step {activeStage.number} of {STAGES.length}</span>
              <h3>{stageDescriptions[activeStepIndex]?.title}</h3>
              <p>{stageDescriptions[activeStepIndex]?.desc}</p>
              <p className="pipeline-projects"><strong>Projects</strong> {stageDescriptions[activeStepIndex]?.projects}</p>
            </div>
            <button type="button" className="start-stage-btn" onClick={stageDescriptions[activeStepIndex]?.action}>
              Open {activeStage.title} <Icon name="arrow" size={16} />
            </button>
          </div>
        </div>
      </section>

      {/* Signals + ledger */}
      <section className="ov-two-col">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>Signals awaiting action</h3>
              <p className="muted">Alerts detected across the monitored regions</p>
            </div>
            <div className="seg" role="group" aria-label="Filter by severity">
              {[['all', 'All'], ['high', 'Critical'], ['medium', 'Attention']].map(([id, label]) => (
                <button key={id} type="button" className={severity === id ? 'active' : ''} aria-pressed={severity === id} onClick={() => setSeverity(id)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <ul className="feed-list">
            {visibleFeed.length === 0 && <li className="feed-empty">No signals match this filter.</li>}
            {visibleFeed.map((f) => (
              <li key={f.title} className={`feed-item sev-${f.severity}`}>
                <div className="feed-meta">
                  <span className={`sev-chip sev-${f.severity}`}>{SEVERITY_LABEL[f.severity] || 'Info'}</span>
                  <ModuleTag modules={f.modules} />
                </div>
                <h4>{f.title}</h4>
                <p>{f.detail}</p>
                <div className="feed-actions">
                  {f.modules.map((m) => (
                    <button key={m} type="button" className="clean-text-btn" onClick={() => onNavigate(m)}>
                      Review {m} evidence <Icon name="arrow" size={14} />
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h3>Season ledger</h3>
              <p className="muted">Source-reported counters, labelled live or simulated. Not independently audited.</p>
            </div>
          </div>

          <div className="ledger-tiles">
            <div className="ledger-tile">
              <span className="ledger-tile-icon tone-fire"><Icon name="leaf" size={18} /></span>
              <div className="ledger-tile-val">{num(fire.tonnesDelivered)}<span className="unit"> t</span></div>
              <div className="ledger-tile-label">Straw diverted from burning</div>
              <div className="ledger-tile-hint">{num(fire.bookings)} baler bookings · {inr(fire.payoutsEstimatedInr)} payouts</div>
            </div>
            <div className="ledger-tile">
              <span className="ledger-tile-icon tone-waste"><Icon name="waste" size={18} /></span>
              <div className="ledger-tile-val">{num(cleared)}</div>
              <div className="ledger-tile-label">Waste dumps cleared</div>
              <div className="ledger-tile-hint">Sites marked cleared or resolved in the source feed</div>
            </div>
            <div className="ledger-tile">
              <span className="ledger-tile-icon tone-water"><Icon name="water" size={18} /></span>
              <div className="ledger-tile-val">{num(water.warned)}<span className="unit"> / {num(water.inRing)}</span></div>
              <div className="ledger-tile-label">Households warned of bad water</div>
              <div className="ledger-tile-hint">Early tripwire warning, households in ring</div>
            </div>
            <div className="ledger-tile">
              <span className="ledger-tile-icon tone-air"><Icon name="shield" size={18} /></span>
              <div className="ledger-tile-val">{fire.fieldsSavedAfterAlert == null ? '—' : num(fire.fieldsSavedAfterAlert)}</div>
              <div className="ledger-tile-label">Fields saved after alerts</div>
              <div className="ledger-tile-hint">Fields that were alerted and not burned</div>
            </div>
          </div>

          <div className="trend">
            <div className="trend-head">
              <span className="trend-title">PM2.5, last 24 hours · {air.place?.name ?? data.city.name}</span>
              <span className="trend-note">Dashed line: 115 µg/m³ reference level</span>
            </div>
            <Sparkline hours={air.hours.slice(-24)} />
          </div>
        </div>
      </section>

      {/* Workflows + status */}
      <CommandStatus
        data={data}
        services={services}
        servicesError={servicesError}
        placeName={data.city.name}
        onOpen={onOpen}
      />

      {/* Connected projects */}
      <div id="launchpad">
        <Launchpad apps={apps} onOpenModule={onModule} />
      </div>
    </div>
  );
}
