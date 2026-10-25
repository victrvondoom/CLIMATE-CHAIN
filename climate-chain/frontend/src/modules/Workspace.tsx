import { useState } from 'react';
import { Card, ModeBadge } from '../components/Ui';
import { TrackBadges } from '../components/TrackBadges';
import { inr, num } from '../api';
import { CAPABILITIES, FOCUSES, STAGES, STAGE_PROJECTS, TRACKS, type Capability, type FocusId, type StageId, type TrackId, type WorkspaceView } from '../data/capabilities';
import type { Overview } from '../types';
import './signals.css';

const CHECKLIST_KEY = 'climate-chain-mission-preparation-v1';

function readPreparation(): Record<string, boolean> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(CHECKLIST_KEY) ?? '{}');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored).filter(([, value]) => typeof value === 'boolean'));
  } catch { return {}; }
}

const STAGE_GUIDANCE: Record<StageId, { eyebrow: string; heading: string; body: string; checklist: string[]; boundary: string }> = {
  sense: {
    eyebrow: 'Step 01 · Observe', heading: 'Start with a place and a signal',
    body: 'Use live civic and environmental signals where they exist. A signal tells you where to look; it does not claim a verified cause on its own.',
    checklist: ['Choose a place or climate issue.', 'Check the source and how recent it is.', 'Carry the signal into evidence review.'],
    boundary: 'The four India pilot feeds are queried through Climate Chain and retain their returned connection and live or simulated status. Other project data keeps its source app, dataset and readiness label.',
  },
  verify: {
    eyebrow: 'Step 02 · Establish evidence', heading: 'Make the signal credible enough to act on',
    body: 'Keep the evidence rule visible. Resident confirmations, monitor provenance, satellite checks, registry matches and graph findings answer different questions.',
    checklist: ['Record where the evidence came from.', 'Apply the project’s actual verification threshold.', 'Keep uncertain or simulated findings labeled.'],
    boundary: 'Specialist checks run in their owning projects. This hub links their workflows and preserves their reported evidence status.',
  },
  act: {
    eyebrow: 'Step 03 · Respond', heading: 'Match the evidence to an intervention',
    body: 'Choose the action that changes the local condition: clear a dump, route straw to a baler, warn nearby residents, repair a methane leak, or plan resilient power.',
    checklist: ['Choose the team that can respond.', 'Follow its consent, safety and approval steps.', 'Return with a documented action result.'],
    boundary: 'Writes and approvals stay in the specialist app that owns them. Opening a tool does not submit anything from this workspace.',
  },
  finance: {
    eyebrow: 'Step 04 · Fund responsibly', heading: 'Tie funding to a verifiable action',
    body: 'Choose a funding context by IEEE track, then open the source capability that fits. Market records, clean-energy certificates, farmer supply flows and climate evidence stay in separate pathways.',
    checklist: ['Name the action and its evidence requirement.', 'Check who approves release or issuance.', 'Distinguish test-chain and simulated flows from real funds.'],
    boundary: 'Climate Chain reads and routes; it does not transfer funds. A live Clearsky payout total is an estimate based on demo prices, while contracts and payment actions stay in their source apps.',
  },
  prove: {
    eyebrow: 'Step 05 · Account for outcomes', heading: 'Show what changed and what remains uncertain',
    body: 'Close the loop with measured results, reversals, receipts and duplicate checks. Keep modeled impact separate from observed outcomes.',
    checklist: ['Compare the result with a stated baseline.', 'Check reversals and duplicate claims.', 'Publish the evidence trail with its data date and limits.'],
    boundary: 'This hub does not combine project claims into a single verified climate-impact total. Each result stays attributed to its source.',
  },
};

function CapabilityCard({ project, onNavigate }: { project: Capability; onNavigate: (view: WorkspaceView) => void }) {
  return (
    <article className={'capability-card tone-' + project.tone}>
      <div className="capability-topline">
        <span className="capability-domain">{project.domain}</span>
        {project.central && <span className="status-pill status-central">CURRENT WORKSPACE</span>}
      </div>
      <TrackBadges tracks={project.tracks} owner={project.name} />
      <h3>{project.name}</h3>
      <p className="capability-descriptor">{project.descriptor}</p>
      <ul className="capability-features">
        {project.features.map((feature) => <li key={feature}>{feature}</li>)}
      </ul>
      <div className="capability-proof"><span className="proof-mark" />{project.evidence}</div>
      <div className="capability-footer">
        <div className="capability-actions">
          {project.central ? (
            <button className="text-action" onClick={() => onNavigate('overview')}>Open command center <span aria-hidden="true">→</span></button>
          ) : (
            <button className="text-action" onClick={() => onNavigate((project.module ?? `module:${project.id}`) as WorkspaceView)}>
              Open <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function LiveSignalStrip({ data, onNavigate }: { data: Overview; onNavigate: (view: WorkspaceView) => void }) {
  const signals = [
    { id: 'waste' as const, name: 'Waste sites', city: 'Jodhpur', value: num(data.waste.open), unit: 'open', mode: data.sources.junksnap.mode, tone: 'waste' },
    { id: 'fire' as const, name: 'Burn risk', city: 'Punjab', value: num(data.fire.redFields), unit: 'RED fields', mode: data.sources.clearsky.mode, tone: 'fire' },
    { id: 'water' as const, name: 'Water ring', city: data.water.ward || 'Ward not supplied', value: num(data.water.warned), unit: 'homes warned', mode: data.sources.teesri.mode, tone: 'water' },
    { id: 'air' as const, name: 'Air exposure', city: data.air.place?.name ?? data.city.name, value: data.air.pm25Now == null ? '—' : String(data.air.pm25Now), unit: 'µg/m³ PM2.5', mode: data.sources.vayu.mode, tone: 'air' },
  ];
  return (
    <div className="signal-strip" aria-label="Current connected signals">
      {signals.map((signal) => (
        <button key={signal.id} className={'signal-tile signal-' + signal.tone} onClick={() => onNavigate(signal.id)}>
          <span className="signal-name">{signal.name}<ModeBadge mode={signal.mode} /></span>
          <strong>{signal.value}</strong>
          <span>{signal.unit} · {signal.city}</span>
        </button>
      ))}
    </div>
  );
}

function FinanceSnapshot({ data, onNavigate }: { data: Overview | null; onNavigate: (view: WorkspaceView) => void }) {
  const source = data?.sources.clearsky;
  const amount = data?.fire.payoutsEstimatedInr;
  return (
    <Card>
      <div className="phase-heading"><span className="eyebrow">SOURCE-REPORTED FINANCE SIGNAL</span>{source && <ModeBadge mode={source.mode} />}</div>
      <h2>Farmer payout estimate</h2>
      {amount != null && Number.isFinite(amount)
        ? <strong className="finance-payout-value">{inr(amount)}</strong>
        : <strong className="finance-payout-value">Unavailable</strong>}
      <p className="muted">Clearsky reports this estimate in its season summary. It is not a payment receipt or a Climate Chain transaction.</p>
      {data?.fire.demoPrices === true && <p className="finance-demo-note">Demo buyer prices · estimate only · no money moves here.</p>}
      {data && data.fire.demoPrices == null && <p className="finance-demo-note">The source did not provide its demo-price flag; treat the reported amount as an estimate only.</p>}
      {data?.fire.demoPrices === false && <p className="finance-demo-note">The source marks its price inputs as non-demo; this reported amount is still an estimate, not proof of payment.</p>}
      {source?.error && <p role="alert" className="finance-source-error">Latest source check failed: {source.error.message}</p>}
      <div className="finance-source-footer">
        <small className="muted">{source?.provenance?.fetchedAt ? `Source fetched ${new Date(source.provenance.fetchedAt).toLocaleString()}` : 'No source fetch time is available.'}</small>
        <button type="button" className="mini-action finance-open-source" onClick={() => onNavigate('fire')}>Open Clearsky source detail</button>
      </div>
    </Card>
  );
}

export function MissionPath({
  data, activeStage, onStage, focus, onFocus, onNavigate,
}: {
  data: Overview | null;
  activeStage: StageId;
  onStage: (stage: StageId) => void;
  focus: FocusId;
  onFocus: (focus: FocusId) => void;
  onNavigate: (view: WorkspaceView) => void;
}) {
  const stage = STAGES.find((item) => item.id === activeStage)!;
  const guidance = STAGE_GUIDANCE[activeStage];
  const focusItem = FOCUSES.find((item) => item.id === focus)!;
  const focusSet = new Set<string>(focusItem.projects);
  const suggestedIds = STAGE_PROJECTS[activeStage].filter((id) => focusSet.has(id));
  const visibleIds = suggestedIds.length > 0 ? suggestedIds : STAGE_PROJECTS[activeStage];
  const projects = visibleIds.map((id) => CAPABILITIES.find((item) => item.id === id)!).filter(Boolean);
  const nextStage = STAGES[STAGES.findIndex((item) => item.id === activeStage) + 1];
  const [preparation, setPreparation] = useState(readPreparation);
  const [storageError, setStorageError] = useState(false);
  const [financeTrack, setFinanceTrack] = useState<TrackId | 'all'>('all');
  const financeProjects = CAPABILITIES.filter((project) => !project.central && project.stages.includes('finance') && (financeTrack === 'all' || project.tracks.includes(financeTrack)));
  const financeTrackCounts = Object.fromEntries(TRACKS.map((track) => [track.id, CAPABILITIES.filter((project) => !project.central && project.stages.includes('finance') && project.tracks.includes(track.id)).length])) as Record<TrackId, number>;
  const preparationPrefix = `${focus}:${activeStage}:`;
  const completed = guidance.checklist.filter((_, index) => preparation[preparationPrefix + index]).length;
  const togglePreparation = (index: number) => {
    const key = preparationPrefix + index;
    const next = { ...preparation, [key]: !preparation[key] };
    setPreparation(next);
    try { localStorage.setItem(CHECKLIST_KEY, JSON.stringify(next)); setStorageError(false); }
    catch { setStorageError(true); }
  };

  return (
    <div className="stack signal-page">
      <section className="journey-intro card">
        <div>
          <span className="eyebrow">ONE CLIMATE MISSION · FIVE CLEAR STEPS</span>
          <h1>From a signal to accountable climate action</h1>
          <p>Keep one place-based mission moving from observation through proof. Use specialist tools at the point where their evidence or action is needed.</p>
        </div>
        <div className="journey-intro-aside"><span className="intro-orbit" aria-hidden="true">CC</span><span>Signals, evidence, response and outcomes in one guided workspace.</span></div>
      </section>

      <nav className="stage-track" aria-label="Climate mission steps">
        {STAGES.map((item, index) => (
          <button key={item.id} className={'stage-step' + (activeStage === item.id ? ' active' : '') + (index < STAGES.findIndex((step) => step.id === activeStage) ? ' passed' : '')} onClick={() => onStage(item.id)} aria-current={activeStage === item.id ? 'step' : undefined}>
            <span className="stage-number">{item.number}</span>
            <span className="stage-step-copy"><strong>{item.title}</strong><small>{item.short}</small></span>
            {index < STAGES.length - 1 && <span className="stage-connector" aria-hidden="true" />}
          </button>
        ))}
      </nav>

      {activeStage === 'finance' ? (
        <section className="focus-section finance-track-selector" aria-labelledby="finance-track-heading">
          <div className="section-heading"><div><span className="eyebrow">CHOOSE A FINANCE CONTEXT</span><h2 id="finance-track-heading">Switch between the four IEEE pathways</h2></div><button type="button" className="finance-all-toggle" aria-pressed={financeTrack === 'all'} aria-controls="finance-pathways" onClick={() => setFinanceTrack('all')}>All pathways · {CAPABILITIES.filter((project) => !project.central && project.stages.includes('finance')).length} unique capabilities</button></div>
          <div className="finance-track-grid">
            {TRACKS.map((track, index) => <button type="button" key={track.id} className={'finance-track-card finance-track-' + (index + 1) + (financeTrack === track.id ? ' active' : '')} aria-pressed={financeTrack === track.id} aria-controls="finance-pathways" onClick={() => setFinanceTrack(track.id)}>
              <span className="eyebrow">TRACK {String(index + 1).padStart(2, '0')}</span><strong>{track.label}</strong><span className="finance-track-detail">{track.detail}</span><small>{financeTrackCounts[track.id]} linked {financeTrackCounts[track.id] === 1 ? 'capability' : 'capabilities'}</small>
            </button>)}
          </div>
        </section>
      ) : (
        <section className="focus-section">
        <div className="section-heading">
          <div><span className="eyebrow">PICK A STARTING POINT</span><h2>What climate issue are you working on?</h2></div>
          <span className="muted small">Your focus changes the suggested tools.</span>
        </div>
        <div className="focus-grid">
          {FOCUSES.map((item) => (
            <button key={item.id} className={'focus-option' + (focus === item.id ? ' active' : '')} onClick={() => onFocus(item.id)} aria-pressed={focus === item.id}>
              <span className="focus-check" aria-hidden="true">{focus === item.id ? '✓' : '·'}</span>
              <strong>{item.label}</strong><small>{item.detail}</small>
            </button>
          ))}
        </div>
        </section>
      )}

      <div className="grid-2 journey-content">
        <Card>
          <div className="phase-heading"><span className="eyebrow">{guidance.eyebrow}</span><span className="phase-index">{stage.number} / 05</span></div>
          <h2>{guidance.heading}</h2>
          <p className="muted">{guidance.body}</p>
          <p className="muted small">Preparation checklist · {completed} of {guidance.checklist.length} marked for {focusItem.label}. Saved in this browser; these marks do not approve or verify project work.</p>
          <ol className="phase-checklist">{guidance.checklist.map((item, index) => <li key={item}><label><input type="checkbox" checked={!!preparation[preparationPrefix + index]} onChange={() => togglePreparation(index)} /> {item}</label></li>)}</ol>
          {storageError && <p role="status">Browser storage is unavailable. Checklist marks last for this session only.</p>}
          <div className="boundary-note"><strong>How this workspace connects</strong><span>{guidance.boundary}</span></div>
          {nextStage && <button className="primary-action" onClick={() => onStage(nextStage.id)}>Continue to {nextStage.title}<span aria-hidden="true">→</span></button>}
          {!nextStage && <button className="primary-action" onClick={() => onNavigate('studio')}>Review the mission in Studio <span aria-hidden="true">→</span></button>}
        </Card>
        {activeStage === 'finance' ? <FinanceSnapshot data={data} onNavigate={onNavigate} /> : <Card>
          <div className="phase-heading"><span className="eyebrow">RECOMMENDED FOR {focusItem.label.toUpperCase()}</span><span className="chip">{projects.length} connected tools</span></div>
          <p className="muted">Each specialist capability keeps its own validation and execution rules. Open the one that fits this step.</p>
          <div className="recommended-list">
            {projects.map((project) => (
              <div className="recommended-item" key={project.id}>
                <div><strong>{project.name}</strong><span>{project.descriptor}</span></div>
                {project.central ? (
                  <button className="mini-action" onClick={() => onNavigate('overview')}>Open <span aria-hidden="true">→</span></button>
                ) : (
                  <button className="mini-action" onClick={() => onNavigate((project.module ?? `module:${project.id}`) as WorkspaceView)} aria-label={'Open ' + project.name}>Open <span aria-hidden="true">→</span></button>
                )}
              </div>
            ))}
          </div>
        </Card>}
      </div>

      {activeStage === 'finance' && (
        <section className="finance-pathways-section" aria-labelledby="finance-pathways-heading">
          <div className="section-heading finance-pathways-heading"><div><span className="eyebrow">SOURCE-OWNED FUNDING REFERENCES</span><h2 id="finance-pathways-heading">{financeTrack === 'all' ? 'Funding and evidence pathways' : TRACKS.find((track) => track.id === financeTrack)?.label}</h2><p>Each project keeps its own rules, evidence and approvals.</p></div><span className="finance-count-chip">{financeProjects.length} {financeProjects.length === 1 ? 'capability' : 'capabilities'}</span></div>
          {financeProjects.length > 0
            ? <div className="capability-grid finance-pathway-grid" id="finance-pathways">{financeProjects.map((project) => <CapabilityCard key={project.id} project={project} onNavigate={onNavigate} />)}</div>
            : <div className="empty-search card"><strong>No funding reference is mapped to this pathway yet.</strong><span>Switch track to see the closest source-owned evidence and funding tools.</span></div>}
          <p className="muted small source-footnote">Changing tracks filters the live registry mapping. It does not create, approve, or transfer funding.</p>
        </section>
      )}

      {activeStage === 'sense' && data && (
        <section className="stack tight">
          <div className="section-heading"><div><span className="eyebrow">SOURCE SIGNAL SNAPSHOT</span><h2>Four signals, one place to start</h2></div><button className="text-action" onClick={() => onNavigate('overview')}>Open command center <span aria-hidden="true">→</span></button></div>
          <LiveSignalStrip data={data} onNavigate={onNavigate} />
          <p className="muted small source-footnote">As of {new Date(data.asOf).toLocaleTimeString()} · each source is labeled live or simulated · project datasets outside these feeds keep their own dates and provenance.</p>
        </section>
      )}
    </div>
  );
}
