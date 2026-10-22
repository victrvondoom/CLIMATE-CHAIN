// Launchpad and announcements for the command center. Every project in the
// registry gets one card: its standalone app when the gateway confirms it is
// present, its live site when it has one, and its stage in the mission path.

import { CAPABILITIES, STAGES, type Capability } from '../data/capabilities';
import { ANNOUNCEMENTS, type Announcement } from '../data/announcements';
import { CLIMATE_MODULES } from './index';
import type { ProjectAppStatus } from '../api';
import '../launchpad.css';

export function AnnouncementBand({ onAction }: { onAction: (to: Announcement['action']['to']) => void }) {
  return (
    <section className="announce-band" aria-labelledby="announce-title">
      <header className="announce-head">
        <span className="announce-kicker">Announced</span>
        <h2 id="announce-title">What changed in this build</h2>
      </header>
      <div className="announce-grid">
        {ANNOUNCEMENTS.map((item) => (
          <article key={item.id} className="announce-item">
            <div className="announce-meta">
              <span className={`announce-tag announce-${item.tag.toLowerCase()}`}>{item.tag}</span>
              <time>{item.date}</time>
            </div>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
            <button type="button" className="text-action" onClick={() => onAction(item.action.to)}>
              {item.action.label} <span aria-hidden="true">→</span>
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

export function Launchpad({ apps, onDetails, onOpenModule }: { apps: Record<string, ProjectAppStatus>; onDetails: () => void; onOpenModule: (id: string) => void }) {
  const projects = CAPABILITIES.filter((item) => !item.central);
  const openHere = projects.filter((item) => apps[item.id]?.available).length;
  const withLiveLink = projects.filter((item) => item.href).length;
  return (
    <section id="launchpad" className="launchpad" aria-labelledby="launchpad-title">
      <header className="launchpad-head">
        <div>
          <span className="eyebrow">{projects.length} PROJECTS · ONE WORKSPACE</span>
          <h2 id="launchpad-title">Launchpad</h2>
          <p className="muted">Open a project&apos;s standalone app here, its live site, or its details. The numbers on each card are its place in the five-step mission path.</p>
        </div>
        <div className="launchpad-counts" aria-label="Launchpad totals">
          <span><strong>{openHere}</strong> open here</span>
          <span><strong>{withLiveLink}</strong> live links</span>
        </div>
      </header>
      <div className="launchpad-grid">
        {projects.map((project) => (
          <LaunchCard key={project.id} project={project} app={apps[project.id]} onDetails={onDetails} onOpenModule={onOpenModule} />
        ))}
      </div>
    </section>
  );
}

function LaunchCard({ project, app, onDetails, onOpenModule }: { project: Capability; app?: ProjectAppStatus; onDetails: () => void; onOpenModule: (id: string) => void }) {
  const openHere = app?.available ? app.path : null;
  const hasModule = CLIMATE_MODULES.some((item) => item.id === project.id);
  const status = openHere ? 'Open here' : project.href ? 'Live link' : 'Source project';
  return (
    <article className={`capability-card launch-card tone-${project.tone}`}>
      <header className="launch-head">
        <span className="launch-domain">{project.domain}</span>
        <span className={`launch-status ${openHere ? 'is-here' : ''}`}>{status}</span>
      </header>
      <h3>{project.name}</h3>
      <p className="launch-descriptor">{project.descriptor}</p>
      <div className="launch-stages" aria-label={`Mission stages for ${project.name}`}>
        {STAGES.map((stage) => (
          <span
            key={stage.id}
            className={project.stages.includes(stage.id) ? 'stage-chip is-on' : 'stage-chip'}
            title={`${stage.title}${project.stages.includes(stage.id) ? ' · in this project' : ''}`}
          >
            {stage.number}
          </span>
        ))}
      </div>
      <p className="launch-readiness">{project.readiness}</p>
      <div className="launch-actions">
        {hasModule && <button type="button" className="text-action launch-module" onClick={() => onOpenModule(project.id)}>Open module <span aria-hidden="true">→</span></button>}
        {openHere && <a className="text-action" href={openHere} target="_blank" rel="noreferrer">Open app here <span aria-hidden="true">↗</span></a>}
        {project.href && <a className="text-action" href={project.href} target="_blank" rel="noreferrer">{project.linkLabel ?? 'Open live'} <span aria-hidden="true">↗</span></a>}
        {app && !app.available && <span className="launch-build">Build needed: <code>{app.build ?? 'see the project README'}</code></span>}
        <button type="button" className="text-action" onClick={onDetails}>Details</button>
      </div>
    </article>
  );
}
