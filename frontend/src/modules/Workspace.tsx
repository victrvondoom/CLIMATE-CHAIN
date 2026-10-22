import { useMemo, useState } from 'react';
import { Card, ModeBadge } from '../components/Ui';
import { num } from '../api';
import { CAPABILITIES, FOCUSES, PROJECT_FOLDER_COUNT, STAGES, STAGE_PROJECTS, type Capability, type FocusId, type StageId, type WorkspaceView } from '../data/capabilities';
import type { Overview } from '../types';

const STAGE_GUIDANCE: Record<StageId, { eyebrow: string; heading: string; body: string; checklist: string[]; boundary: string }> = {
  sense: {
    eyebrow: 'Step 01 · Observe', heading: 'Start with a place and a signal',
    body: 'Use live civic and environmental signals where they exist. A signal tells you where to look; it does not claim a verified cause on its own.',
    checklist: ['Choose a place or climate issue.', 'Check the source and how recent it is.', 'Carry the signal into evidence review.'],
    boundary: 'The four India pilot feeds are queried live through Climate Chain. Other project data keeps its source app, dataset and readiness label.',
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
    body: 'Connect funding to a clearly scoped intervention. Escrow, credit issuance and marketplace features retain the controls and demo boundaries of their source projects.',
    checklist: ['Name the action and its evidence requirement.', 'Check who approves release or issuance.', 'Distinguish test-chain and simulated flows from real funds.'],
    boundary: 'No funds move through Climate Chain. PLUME and the registry demos are opened in their own apps with their own execution status.',
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
      <h3>{project.name}</h3>
      <p className="capability-descriptor">{project.descriptor}</p>
      <ul className="capability-features">
        {project.features.map((feature) => <li key={feature}>{feature}</li>)}
      </ul>
      <div className="capability-proof"><span className="proof-mark" />{project.evidence}</div>
      <div className="capability-footer">
        <span className="readiness-label">{project.readiness}</span>
        <div className="capability-actions">
          {project.module && <button className="text-action" onClick={() => onNavigate(project.module!)}>Open live view <span aria-hidden="true">↗</span></button>}
          {project.central && <button className="text-action" onClick={() => onNavigate('overview')}>Open command center <span aria-hidden="true">↗</span></button>}
          {project.href && <a className="text-action" href={project.href} target="_blank" rel="noreferrer">{project.linkLabel ?? 'Open project'} <span aria-hidden="true">↗</span></a>}
        </div>
      </div>
    </article>
  );
}

function LiveSignalStrip({ data, onNavigate }: { data: Overview; onNavigate: (view: WorkspaceView) => void }) {
  const signals = [
    { id: 'waste' as const, name: 'Waste sites', city: 'Jodhpur', value: num(data.waste.open), unit: 'open', mode: data.sources.junksnap.mode, tone: 'waste' },
    { id: 'fire' as const, name: 'Burn risk', city: 'Punjab', value: num(data.fire.redFields), unit: 'RED fields', mode: data.sources.clearsky.mode, tone: 'fire' },
    { id: 'water' as const, name: 'Water ring', city: 'Mumbai', value: num(data.water.warned), unit: 'homes warned', mode: data.sources.teesri.mode, tone: 'water' },
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

  return (
    <div className="stack">
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

      <div className="grid-2 journey-content">
        <Card>
          <div className="phase-heading"><span className="eyebrow">{guidance.eyebrow}</span><span className="phase-index">{stage.number} / 05</span></div>
          <h2>{guidance.heading}</h2>
          <p className="muted">{guidance.body}</p>
          <ol className="phase-checklist">{guidance.checklist.map((item) => <li key={item}>{item}</li>)}</ol>
          <div className="boundary-note"><strong>How this workspace connects</strong><span>{guidance.boundary}</span></div>
          {nextStage && <button className="primary-action" onClick={() => onStage(nextStage.id)}>Continue to {nextStage.title}<span aria-hidden="true">→</span></button>}
        </Card>
        <Card>
          <div className="phase-heading"><span className="eyebrow">RECOMMENDED FOR {focusItem.label.toUpperCase()}</span><span className="chip">{projects.length} connected tools</span></div>
          <p className="muted">Each specialist capability keeps its own validation and execution rules. Open the one that fits this step.</p>
          <div className="recommended-list">
            {projects.slice(0, 5).map((project) => (
              <div className="recommended-item" key={project.id}>
                <div><strong>{project.name}</strong><span>{project.descriptor}</span></div>
                {project.module
                  ? <button className="mini-action" onClick={() => onNavigate(project.module!)} aria-label={'Open ' + project.name}>Open <span aria-hidden="true">↗</span></button>
                  : project.central
                    ? <button className="mini-action" onClick={() => onNavigate('overview')}>Open <span aria-hidden="true">↗</span></button>
                    : <a className="mini-action" href={project.href} target="_blank" rel="noreferrer">Open <span aria-hidden="true">↗</span></a>}
              </div>
            ))}
            {projects.length > 5 && <button className="text-action" onClick={() => onNavigate('capabilities')}>See all {projects.length} recommended tools <span aria-hidden="true">→</span></button>}
          </div>
        </Card>
      </div>

      {activeStage === 'sense' && data && (
        <section className="stack tight">
          <div className="section-heading"><div><span className="eyebrow">CONNECTED LIVE FEEDS</span><h2>Four signals, one place to start</h2></div><button className="text-action" onClick={() => onNavigate('overview')}>Open command center <span aria-hidden="true">→</span></button></div>
          <LiveSignalStrip data={data} onNavigate={onNavigate} />
          <p className="muted small source-footnote">As of {new Date(data.asOf).toLocaleTimeString()} · each source is labeled live or simulated · project datasets outside these feeds keep their own dates and provenance.</p>
        </section>
      )}
    </div>
  );
}

export function CapabilityLibrary({ onNavigate }: { onNavigate: (view: WorkspaceView) => void }) {
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<StageId | 'all'>('all');
  const filtered = useMemo(() => CAPABILITIES.filter((item) => {
    const matchesStage = stageFilter === 'all' || item.stages.includes(stageFilter);
    const haystack = [item.name, item.descriptor, item.domain, ...item.features, item.evidence].join(' ').toLowerCase();
    return matchesStage && haystack.includes(query.trim().toLowerCase());
  }), [query, stageFilter]);

  return (
    <div className="stack">
      <section className="journey-intro library-intro card">
        <div><span className="eyebrow">ONE WORKSPACE · {PROJECT_FOLDER_COUNT} PROJECT FOLDERS</span><h1>Every capability, in its place in the path</h1><p>Browse the combined toolbox by mission step. Each project keeps its own app, evidence limits and specialist workflow.</p></div>
        <div className="library-count"><strong>{CAPABILITIES.length}</strong><span>connected capabilities</span></div>
      </section>

      <div className="library-controls">
        <label className="search-field"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a project or capability" aria-label="Find a project or capability" /></label>
        <div className="filter-row" aria-label="Filter capabilities by mission step">
          <button className={stageFilter === 'all' ? 'filter-pill active' : 'filter-pill'} onClick={() => setStageFilter('all')}>All steps</button>
          {STAGES.map((stage) => <button key={stage.id} className={stageFilter === stage.id ? 'filter-pill active' : 'filter-pill'} onClick={() => setStageFilter(stage.id)}>{stage.title}</button>)}
        </div>
      </div>

      <div className="library-resultline"><span>{filtered.length} of {CAPABILITIES.length} capabilities</span><span>Project status and evidence are shown on every card.</span></div>
      {filtered.length > 0
        ? <div className="capability-grid">{filtered.map((project) => <CapabilityCard key={project.id} project={project} onNavigate={onNavigate} />)}</div>
        : <div className="empty-search card"><strong>No matching capability</strong><span>Try a shorter search or select a different mission step.</span></div>}
      <p className="muted small source-footnote">This directory is a navigation and evidence map. A project’s inclusion does not mean its backend, storage or account system has been merged into Climate Chain.</p>
    </div>
  );
}

