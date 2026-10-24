// Launchpad: 100% centralized native workflow access to all 18 climate projects without any external links or redirects.

import { useState } from 'react';
import { CAPABILITIES, STAGES, TRACKS, type Capability, type StageId, type TrackId } from '../data/capabilities';
import { TrackBadges } from '../components/TrackBadges';
import { ANNOUNCEMENTS, type Announcement } from '../data/announcements';
import { CLIMATE_MODULES } from './index';
import type { ProjectAppStatus } from '../api';
import '../launchpad.css';
import './signals.css';

export function AnnouncementBand({ onAction }: { onAction: (to: Announcement['action']['to']) => void }) {
  return (
    <section className="announce-band" aria-labelledby="announce-title">
      <header className="announce-head">
        <span className="announce-kicker">Unified Architecture</span>
        <h2 id="announce-title">Centralized Multi-Domain Climate Engine</h2>
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

export function Launchpad({
  apps: _apps,
  onDetails,
  onOpenModule
}: {
  apps: Record<string, ProjectAppStatus>;
  onDetails: () => void;
  onOpenModule: (id: string) => void;
}) {
  const projects = CAPABILITIES.filter((item) => !item.central);
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState<StageId | 'all'>('all');
  const [track, setTrack] = useState<TrackId | 'all'>('all');

  const visible = projects.filter(
    (item) =>
      [item.name, item.domain, item.descriptor, ...item.features, ...item.tracks.map((id) => TRACKS.find((entry) => entry.id === id)?.label ?? id)]
        .join(' ')
        .toLowerCase()
        .includes(query.trim().toLowerCase()) &&
      (stage === 'all' || item.stages.includes(stage)) &&
      (track === 'all' || item.tracks.includes(track))
  );

  return (
    <section id="launchpad" className="launchpad signal-page launchpad-centralized" aria-labelledby="launchpad-title">
      <header className="launchpad-head">
        <div>
          <span className="eyebrow">{projects.length} PROJECTS · 100% NATIVE CENTRALIZED WORKFLOW</span>
          <h2 id="launchpad-title">Centralized Project Module Hub</h2>
          <p className="muted">
            All 18 specialized climate initiatives operate directly inside this centralized platform.
            Every workflow runs in-app with verified provenance, cryptographic rules, and zero external redirects.
          </p>
        </div>
        <div className="launchpad-counts" aria-label="Launchpad totals">
          <span><strong>{projects.length}</strong> Centralized Modules</span>
          <span className="zero-ext"><strong>0</strong> External Links</span>
        </div>
      </header>

      <div className="library-controls">
        <label className="search-field">
          Filter Centralized Capabilities
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by project name, capability, or environmental domain…"
          />
        </label>
        <label>
          Mission Stage
          <select value={stage} onChange={(event) => setStage(event.target.value as StageId | 'all')}>
            <option value="all">All Stages (01 Sense to 05 Prove)</option>
            {STAGES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.number} {item.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          IEEE Climate Track
          <select value={track} onChange={(event) => setTrack(event.target.value as TrackId | 'all')}>
            <option value="all">All 4 IEEE Tracks</option>
            {TRACKS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="muted small" role="status">
        {visible.length} of {projects.length} projects integrated into this centralized workspace.
      </p>

      <div className="launchpad-grid">
        {visible.map((project) => (
          <LaunchCard
            key={project.id}
            project={project}
            onDetails={onDetails}
            onOpenModule={onOpenModule}
          />
        ))}
      </div>

      {visible.length === 0 && (
        <div className="card empty-search">
          <p>No projects match these filters.</p>
          <button
            type="button"
            className="clean-primary-btn"
            onClick={() => {
              setQuery('');
              setStage('all');
              setTrack('all');
            }}
          >
            Reset Filters
          </button>
        </div>
      )}
    </section>
  );
}

function LaunchCard({
  project,
  onDetails,
  onOpenModule
}: {
  project: Capability;
  onDetails: () => void;
  onOpenModule: (id: string) => void;
}) {
  const [details, setDetails] = useState(false);
  const hasModule = CLIMATE_MODULES.some((item) => item.id === project.id);

  return (
    <article className={`capability-card launch-card tone-${project.tone}`}>
      <header className="launch-head">
        <span className="launch-domain">{project.domain}</span>
        <span className="launch-status is-here">Centralized Workflow</span>
      </header>

      <TrackBadges tracks={project.tracks} owner={project.name} />

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
        {hasModule && (
          <button
            type="button"
            className="clean-primary-btn"
            onClick={() => onOpenModule(project.id)}
          >
            Launch in Centralized Console →
          </button>
        )}

        <button
          type="button"
          className="clean-secondary-btn"
          aria-expanded={details}
          aria-controls={`project-details-${project.id}`}
          onClick={() => setDetails((value) => !value)}
        >
          {details ? 'Hide Details' : 'Evidence & Rules'}
        </button>
      </div>

      {details && (
        <div id={`project-details-${project.id}`} className="boundary-note">
          <strong>{project.name} Verification Specification</strong>
          <p>{project.evidence}</p>
          <ul>
            {project.features.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
          <p className="muted small">
            Fully merged into the central Climate Chain pipeline. Execution and cryptographic verification run in-app.
          </p>
          <button type="button" className="text-action" onClick={onDetails}>
            Browse Full Capability Library →
          </button>
        </div>
      )}
    </article>
  );
}
