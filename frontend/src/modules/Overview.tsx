// Command center: one screen that maps live signals and opens the full mission path.
// The hero is a real 3D globe (drag it); the four floating chips are the
// live KPIs of the four modules and jump into them.

import { lazy, Suspense } from 'react';
import { Card, Stat, ModuleTag, ModeBadge, ExternalLink, Sparkline } from '../components/Ui';
import { inr, num, type ProjectAppStatus } from '../api';
import type { Overview, ModuleId } from '../types';
import { PROJECT_FOLDER_COUNT, STAGES, type StageId } from '../data/capabilities';
import { AnnouncementBand, Launchpad } from './Launchpad';

const Globe3D = lazy(() => import('../components/Globe3D').then((module) => ({ default: module.Globe3D })));

const SEVERITY_LABEL: Record<string, string> = { high: 'HIGH', medium: 'MEDIUM', low: 'INFO' };

export function Overview({ data, apps, onNavigate, onMission, onCapabilities, onStudio }: {
  data: Overview;
  apps: Record<string, ProjectAppStatus>;
  onNavigate: (m: ModuleId) => void;
  onMission: (stage: StageId) => void;
  onCapabilities: () => void;
  onStudio: () => void;
}) {
  const { waste, fire, water, air, sources, feed } = data;
  const scrollToLaunchpad = () => document.getElementById('launchpad')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const handleAnnouncement = (to: 'launchpad' | 'capabilities' | 'studio') => {
    if (to === 'launchpad') scrollToLaunchpad();
    else if (to === 'studio') onStudio();
    else onCapabilities();
  };
  return (
    <div className="stack">
      <section className="hero">
        <Suspense fallback={<div className="globe-loading">Rendering the 3D climate view…</div>}>
          <Globe3D data={data} />
        </Suspense>
        <div className="hero-vignette" />
        <div className="hero-overlay">
          <div className="hero-title">
            <h1>Climate Chain</h1>
            <p>{PROJECT_FOLDER_COUNT} climate projects, one mission: from a place-based signal to accountable action and proof.</p>
            <span className="hero-hint">drag to rotate · scroll to zoom · points use connected pilot data</span>
            <div className="hero-actions">
              <button className="hero-cta" onClick={() => onMission('sense')}>Start the guided path <span aria-hidden="true">→</span></button>
              <button className="hero-library-link" onClick={onStudio}>Build one mission from all {PROJECT_FOLDER_COUNT} projects</button>
              <button className="hero-library-link" onClick={scrollToLaunchpad}>Open the launchpad</button>
            </div>
          </div>

          <button className="chip3d c3d-waste f1" onClick={() => onNavigate('waste')}>
            <span className="chip3d-top">Waste · JunkSnap <ModeBadge mode={sources.junksnap.mode} /></span>
            <span className="chip3d-value">{num(waste.open)}</span>
            <span className="chip3d-hint">open dump sites · {num(waste.verified)} verified</span>
          </button>

          <button className="chip3d c3d-fire f2" onClick={() => onNavigate('fire')}>
            <span className="chip3d-top">Fire · clearsky <ModeBadge mode={sources.clearsky.mode} /></span>
            <span className="chip3d-value">{num(fire.redFields)}</span>
            <span className="chip3d-hint">fields at burn risk · {num(fire.acresCleared)} acres cleared</span>
          </button>

          <button className="chip3d c3d-water f3" onClick={() => onNavigate('water')}>
            <span className="chip3d-top">Water · Teesri Shikayat <ModeBadge mode={sources.teesri.mode} /></span>
            <span className="chip3d-value">{num(water.warned)}</span>
            <span className="chip3d-hint">homes warned · {num(water.reported)} reports joined</span>
          </button>

          <button className="chip3d c3d-air f4" onClick={() => onNavigate('air')}>
            <span className="chip3d-top">Air · Vayu <ModeBadge mode={sources.vayu.mode} /></span>
            <span className="chip3d-value">{air.pm25Now ?? '—'}</span>
            <span className="chip3d-hint">µg/m³ PM2.5 · {air.severity.label} in {air.place?.name ?? data.city.name}</span>
          </button>
        </div>
      </section>
      <div className="globe-legend" aria-label="Globe legend">
        <span><i className="legend-dot legend-pilot" /> Schematic pilot beacons</span>
        <span><i className="legend-dot legend-waste" /> JunkSnap site coordinates</span>
        <span><i className="legend-dot legend-air" /> Selected Vayu place</span>
        <span>Schematic arcs are not measured links.</span>
      </div>

      <section className="flow-preview" aria-label="Five-step climate mission path">
        {STAGES.map((stage, index) => (
          <button key={stage.id} className="flow-preview-step" onClick={() => onMission(stage.id)}>
            <span className="flow-preview-number">{stage.number}</span>
            <span><strong>{stage.title}</strong><small>{stage.short}</small></span>
            {index < STAGES.length - 1 && <span className="flow-preview-arrow" aria-hidden="true">→</span>}
          </button>
        ))}
      </section>

      <AnnouncementBand onAction={handleAnnouncement} />

      <div className="grid-2">
        <Card>
          <h2>Signals to review</h2>
          <p className="muted">Source-level signals are shown here. A place and time link appears only in Cascade Review when both sources provide matching evidence.</p>
          <ul className="feed">
            {feed.length === 0 && <li className="feed-item"><em>No threshold signals to review right now.</em></li>}
            {feed.map((f) => (
              <li key={f.title} className={`feed-item sev-${f.severity}`}>
                <div className="feed-head">
                  <span className={`sev sev-${f.severity}`}>{SEVERITY_LABEL[f.severity]}</span>
                  <ModuleTag modules={f.modules} />
                </div>
                <div className="feed-title">{f.title}</div>
                <div className="feed-detail">{f.detail}</div>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <h2>Season ledger</h2>
          <div className="ledger">
            <Stat label="Straw diverted from fires" value={num(fire.tonnesDelivered)} unit="t" hint={`${num(fire.bookings)} baler bookings · ${inr(fire.payoutsEstimatedInr)} estimated payouts`} />
            <Stat label="Waste sites cleared by the city" value={num(waste.sites.filter((s) => s.status !== 'open').length)} hint="against JunkSnap's measure of how fast Jodhpur clears dumps" />
            <Stat label="Water ring residents reached" value={`${num(water.warned)} / ${num(water.inRing)}`} hint="Aggregate Teesri snapshot; household records are not included here" />
            <Stat label="Fields saved after village alerts" value={fire.fieldsSavedAfterAlert == null ? 'Not reported' : num(fire.fieldsSavedAfterAlert)} hint="Clearsky outcome field when provided; not independently verified or joined to air readings" />
          </div>
        </Card>
      </div>

      <div className="grid-2">
        <Card>
          <h2>Air now, as one of four inputs</h2>
          <Sparkline hours={air.hours.slice(-24)} />
          <p className="muted">
            Vayu's 24-hour PM2.5 for {air.place?.name ?? data.city.name}. The dashed line is a Climate Chain reference band, not a source-specific health guideline. The regional Air reading is not joined to Clearsky field locations.
          </p>
        </Card>
        <Card>
          <h2>Connected tools, one workspace</h2>
          <p className="muted">All {PROJECT_FOLDER_COUNT} project folders are mapped into the guided path. Specialist actions keep their original evidence rules and approval steps.</p>
          <button className="text-action library-open" onClick={onCapabilities}>Browse all capabilities <span aria-hidden="true">→</span></button>
          <div className="ext-col">
            <ExternalLink href="https://junksnap.coehemang.dev">JunkSnap web app — report a waste site</ExternalLink>
            <ExternalLink href="https://clearsky.akkki.tech">clearsky dashboard — book straw, see the radar</ExternalLink>
            <ExternalLink href="https://t.me/TeesriShikayatBot?start=B">Teesri Shikayat bot — join the water ring</ExternalLink>
            <ExternalLink href="https://eirioqqhvtvve3aw5xhpje2wju0jztrl.lambda-url.ap-south-1.on.aws/console">Teesri console — the ward office view</ExternalLink>
          </div>
        </Card>
      </div>

      <Launchpad apps={apps} onDetails={onCapabilities} />
    </div>
  );
}
