import { useMemo, useState } from 'react';
import { ModeBadge } from '../components/Ui';
import { MissionRuntime } from './MissionRuntime';
import { CAPABILITIES, FOCUSES, PROJECT_FOLDER_COUNT, STAGES, STAGE_PROJECTS, type Capability, type FocusId, type WorkspaceView } from '../data/capabilities';
import type { Overview } from '../types';

type SourceId = 'junksnap' | 'clearsky' | 'teesri' | 'vayu';
const SOURCE_BY_PROJECT: Partial<Record<string, SourceId>> = {
  junksnap: 'junksnap', clearsky: 'clearsky', teesri: 'teesri', vayu: 'vayu',
};

function sourceLabel(project: Capability, data: Overview | null) {
  const source = SOURCE_BY_PROJECT[project.id];
  return source && data ? <ModeBadge mode={data.sources[source].mode} /> : null;
}

function signalSummary(source: SourceId, data: Overview | null) {
  if (!data) return 'No source snapshot';
  const count = (value: number) => value.toLocaleString();
  switch (source) {
    case 'junksnap': return `${count(data.waste.open)} open · ${count(data.waste.verified)} verified`;
    case 'clearsky': return `${count(data.fire.redFields)} RED fields · ${count(data.fire.acresCleared)} acres cleared`;
    case 'teesri': return `${count(data.water.warned)} homes warned · ${count(data.water.reported)} reports`;
    case 'vayu': return `${data.air.pm25Now ?? '—'} µg/m³ PM2.5 · ${data.air.place?.name ?? data.city.name}`;
  }
}

function openProject(project: Capability, onNavigate: (view: WorkspaceView) => void) {
  if (project.module) onNavigate(project.module);
  else if (project.central) onNavigate('overview');
}

function buildBrief(title: string, place: string, selected: Capability[], data: Overview | null) {
  const lines = [
    `# ${title.trim() || 'Climate action mission'}`,
    '',
    `- Scope: ${place.trim() || 'Not specified'}`,
    `- Created from: Climate Chain unified mission studio`,
    `- Capability sets: ${selected.length} of ${CAPABILITIES.length}`,
    data ? `- Source snapshot as of: ${new Date(data.asOf).toISOString()}` : '- Source snapshot: unavailable',
    '',
  ];
  lines.push('## Connected signal snapshot', '');
  if (data) {
    for (const source of ['junksnap', 'clearsky', 'teesri', 'vayu'] as const) {
      const capability = CAPABILITIES.find((project) => SOURCE_BY_PROJECT[project.id] === source)!;
      const mode = data.sources[source].mode === 'live' ? 'LIVE' : 'SIMULATED';
      lines.push(`- **${capability.name} (${mode}):** ${signalSummary(source, data)}`);
    }
    const provenance = data.air.provenance;
    if (provenance?.stationName) {
      lines.push(`- **Air monitor provenance:** ${provenance.stationName}${provenance.distanceKm == null ? '' : `, ${provenance.distanceKm} km away`}${provenance.ageMinutes == null ? '' : `, ${provenance.ageMinutes} min old`}`);
    }
  } else {
    lines.push('_No source snapshot was available when this brief was exported._');
  }
  lines.push('', '## Mission stages', '');
  for (const stage of STAGES) {
    const projects = STAGE_PROJECTS[stage.id]
      .filter((id) => selected.some((project) => project.id === id))
      .map((id) => selected.find((project) => project.id === id)!)
      .filter(Boolean);
    lines.push(`### ${stage.number}. ${stage.title} — ${stage.short}`, '');
    if (!projects.length) {
      lines.push('_No selected capability is mapped to this stage._', '');
      continue;
    }
    for (const project of projects) {
      const source = SOURCE_BY_PROJECT[project.id];
      const mode = source && data ? (data.sources[source].mode === 'live' ? 'LIVE' : 'SIMULATED') : source ? 'Source status unavailable' : project.readiness;
      lines.push(`#### ${project.name} · ${project.domain}`, '', `_${project.descriptor}_`, '', `- Readiness: ${mode}`, `- Evidence: ${project.evidence}`, ...project.features.map((feature) => `- ${feature}`), '');
    }
  }
  lines.push(
    '## Integration boundary',
    '',
    'Climate Chain normalizes live data from JunkSnap, clearsky, Teesri Shikayat and Vayu when those upstreams are reachable. Other project capabilities are specialist handoffs with their own data, evidence, permissions and execution. This brief does not combine project claims into a verified impact total or execute specialist actions.',
    '',
  );
  return lines.join('\n');
}

export function MissionStudio({
  data, focus, onFocus, selection, onSelection, title, onTitle, place, onPlace, onNavigate, loading, focusMissionId,
}: {
  data: Overview | null;
  focus: FocusId;
  onFocus: (focus: FocusId) => void;
  selection: string[];
  onSelection: (ids: string[]) => void;
  title: string;
  onTitle: (title: string) => void;
  place: string;
  onPlace: (place: string) => void;
  onNavigate: (view: WorkspaceView) => void;
  loading: boolean;
  focusMissionId?: string | null;
}) {
  const [tab, setTab] = useState<'plan' | 'capabilities'>('plan');
  const [notice, setNotice] = useState('');
  const selected = useMemo(() => CAPABILITIES.filter((project) => selection.includes(project.id)), [selection]);
  const selectedSet = new Set(selection);
  const liveSources = ['junksnap', 'clearsky', 'teesri', 'vayu'] as const;
  const apiCount = selected.filter((project) => SOURCE_BY_PROJECT[project.id]).length;

  const toggleProject = (id: string) => {
    onSelection(selectedSet.has(id) ? selection.filter((item) => item !== id) : [...selection, id]);
    setNotice('');
  };
  const addFocusBundle = () => {
    const bundle = FOCUSES.find((item) => item.id === focus)!.projects;
    const next = [...new Set([...selection, ...bundle])];
    const added = next.length - selection.length;
    onSelection(next);
    setNotice(added ? `Added ${added} ${FOCUSES.find((item) => item.id === focus)!.label} tool${added === 1 ? '' : 's'}.` : 'This focus bundle is already included.');
  };
  const exportBrief = () => {
    const brief = buildBrief(title, place, selected, data);
    const blob = new Blob([brief], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const filename = (title.trim() || 'climate-action-mission').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'climate-action-mission';
    anchor.href = url;
    anchor.download = `${filename}.md`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('Mission brief downloaded as Markdown.');
  };

  return (
    <div className="stack mission-studio">
      <section className="journey-intro studio-intro card">
        <div>
          <span className="eyebrow">ONE MISSION · ALL PROJECT FOLDERS</span>
          <h1>Build one climate operations brief</h1>
          <p>Bring the capabilities from all {PROJECT_FOLDER_COUNT} projects into one staged plan. Choose a focus, tune the toolset, and carry a source-labeled brief into the work.</p>
        </div>
        <div className="studio-rollup" aria-label="Integration summary">
          <strong>{selected.length}<small> / {CAPABILITIES.length}</small></strong><span>feature sets included</span>
          <div><b>{apiCount}</b> selected projects have a connected API feed</div>
        </div>
      </section>

      <section className="studio-sources card" aria-label="Live connected sources">
        <div><span className="eyebrow">CONNECTED API FEEDS</span><strong>Four project APIs</strong><small>Each feed is labeled LIVE or SIMULATED.</small></div>
        {liveSources.map((source) => {
          const capability = CAPABILITIES.find((item) => SOURCE_BY_PROJECT[item.id] === source)!;
          const isSelected = selectedSet.has(capability.id);
          return <div className={'studio-source' + (isSelected ? ' included' : '')} key={source}>
            <span>{capability.name}</span>
            {data ? <ModeBadge mode={data.sources[source].mode} /> : <span className="readiness-label">{loading ? 'CHECKING' : 'UNAVAILABLE'}</span>}
            <small>{signalSummary(source, data)}</small>
            {!isSelected && <small>Not in this mission</small>}
          </div>;
        })}
      </section>

      <section className="studio-setup card">
        <div className="section-heading"><div><span className="eyebrow">MISSION SETUP</span><h2>Set the shared scope</h2></div><button className="text-action" onClick={exportBrief} disabled={selected.length === 0}>Export mission brief <span aria-hidden="true">↓</span></button></div>
        <div className="studio-fields">
          <label className="studio-field"><span>Mission name</span><input value={title} onChange={(event) => onTitle(event.target.value)} maxLength={100} placeholder="e.g. Safer, cleaner neighbourhoods" /></label>
          <label className="studio-field"><span>Place or region <small>optional</small></span><input value={place} onChange={(event) => onPlace(event.target.value)} maxLength={120} placeholder="e.g. Ward, district, watershed or project area" /></label>
          <label className="studio-field"><span>Starting focus</span><select value={focus} onChange={(event) => onFocus(event.target.value as FocusId)}>{FOCUSES.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
        </div>
        <div className="studio-setup-foot"><span>Scope fields stay in this browser session. They are included only when you export.</span><button className="mini-action" onClick={addFocusBundle}>Add focus tools</button></div>
        {notice && <p className="studio-notice" role="status">{notice}</p>}
      </section>

      <div className="studio-tabs" role="group" aria-label="Mission studio views">
        <button type="button" aria-pressed={tab === 'plan'} className={tab === 'plan' ? 'active' : ''} onClick={() => setTab('plan')}>Staged mission plan</button>
        <button type="button" aria-pressed={tab === 'capabilities'} className={tab === 'capabilities' ? 'active' : ''} onClick={() => setTab('capabilities')}>Choose feature sets <span>{selected.length}/{CAPABILITIES.length}</span></button>
      </div>

      {tab === 'plan' ? <div className="studio-stage-list">
        {STAGES.map((stage) => {
          const projects = STAGE_PROJECTS[stage.id].filter((id) => selectedSet.has(id)).map((id) => CAPABILITIES.find((project) => project.id === id)!).filter(Boolean);
          const available = STAGE_PROJECTS[stage.id].map((id) => CAPABILITIES.find((project) => project.id === id)!).filter(Boolean);
          return <section className="studio-stage card" key={stage.id}>
            <header className="studio-stage-head"><span className="stage-number">{stage.number}</span><div><h2>{stage.title}</h2><p>{stage.description}</p></div><span className="chip">{projects.length} / {available.length} tools</span></header>
            {projects.length ? <div className="studio-tool-grid">{projects.map((project) => <article className={'studio-tool tone-' + project.tone} key={project.id}>
              <div className="studio-tool-meta"><span>{project.domain}</span>{sourceLabel(project, data)}</div>
              <h3>{project.name}</h3><p>{project.descriptor}</p>
              <ul>{project.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
              <div className="studio-evidence"><strong>{project.readiness}</strong><span>{project.evidence}</span></div>
              <div className="studio-tool-actions">
                {project.module || project.central ? <button className="text-action" onClick={() => openProject(project, onNavigate)}>{project.central ? 'Open command center' : 'Open live view'} <span aria-hidden="true">↗</span></button> : null}
                {project.href ? <a className="text-action" href={project.href} target="_blank" rel="noreferrer">{project.linkLabel ?? 'Open specialist tool'} <span aria-hidden="true">↗</span></a> : null}
                <button className="text-action studio-remove" onClick={() => toggleProject(project.id)}>Remove from mission</button>
              </div>
            </article>)}</div> : <div className="studio-empty">No selected feature set is mapped to this step. Add tools in the feature-set view.</div>}
          </section>;
        })}
      </div> : <section className="studio-selector">
        <div className="studio-selector-head"><div><span className="eyebrow">ALL {PROJECT_FOLDER_COUNT} SOURCE FOLDERS</span><h2>Select the capabilities for this mission</h2><p>Every folder stays visible with its features, evidence label and working handoff.</p></div><div><button className="text-action" onClick={() => { onSelection(CAPABILITIES.map((item) => item.id)); setNotice('All 13 capability sets included.'); }}>Select all</button><button className="text-action" onClick={() => { onSelection([]); setNotice('All capability sets removed from this mission.'); }}>Clear</button></div></div>
        <div className="capability-grid">{CAPABILITIES.map((project) => {
          const included = selectedSet.has(project.id);
          const stages = STAGES.filter((stage) => STAGE_PROJECTS[stage.id].includes(project.id));
          return <article className={'capability-card studio-select-card tone-' + project.tone + (included ? ' selected' : '')} key={project.id}>
            <label className="studio-select-toggle"><input type="checkbox" checked={included} onChange={() => toggleProject(project.id)} /><span>{included ? 'IN MISSION' : 'AVAILABLE'}</span></label>
            <div className="capability-topline"><span className="capability-domain">{project.domain}</span>{sourceLabel(project, data)}</div>
            <h3>{project.name}</h3><p className="capability-descriptor">{project.descriptor}</p>
            <ul className="capability-features">{project.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
            <div className="capability-proof"><span className="proof-mark" />{project.evidence}</div>
            <div className="studio-stage-tags">{stages.map((stage) => <span key={stage.id}>{stage.title}</span>)}</div>
            <div className="capability-footer"><span className="readiness-label">{project.readiness}</span><div className="capability-actions">
              {project.module ? <button className="text-action" onClick={() => onNavigate(project.module!)}>Open live view <span aria-hidden="true">↗</span></button> : null}
              {project.central ? <button className="text-action" onClick={() => onNavigate('overview')}>Open command center <span aria-hidden="true">↗</span></button> : null}
              {project.href ? <a className="text-action" href={project.href} target="_blank" rel="noreferrer">{project.linkLabel ?? 'Open project'} <span aria-hidden="true">↗</span></a> : null}
            </div></div>
          </article>;
        })}</div>
      </section>}

      <MissionRuntime
        title={title}
        place={place}
        focus={focus}
        capabilityIds={selection}
        data={data}
        focusMissionId={focusMissionId}
        onLoadMission={(mission) => { onTitle(mission.title); onPlace(mission.place); onFocus(mission.focus); onSelection(mission.capabilityIds); }}
      />

      <p className="muted small source-footnote studio-boundary">This studio combines capabilities into one planning surface and export. Live API data is limited to the four labeled feeds above; specialist writes, approvals, evidence rules and funding stay with their source projects. No cross-project impact total is inferred.</p>
    </div>
  );
}
