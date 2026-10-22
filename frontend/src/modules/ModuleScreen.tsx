import type { ClimateModule } from '../core/module';
import { STAGES } from '../data/capabilities';
import { WorkspaceErrorBoundary } from '../components/WorkspaceErrorBoundary';
import { CLIMATE_MODULES } from './index';
import './shell.css';

export function findModule(id: string): ClimateModule | undefined {
  return CLIMATE_MODULES.find((item) => item.id === id);
}

// One frame for every native module: stages, evidence mode, features, then the module's own page.
export function ModuleScreen({ climateModule }: { climateModule: ClimateModule }) {
  const { Page } = climateModule;
  const stageTitles = climateModule.stages.map((id) => STAGES.find((stage) => stage.id === id)?.title ?? id);
  return (
    <section className={`module-screen tone-${climateModule.tone}`} aria-labelledby={`module-${climateModule.id}-title`}>
      <header className="module-head">
        <span className="eyebrow">{stageTitles.join(' · ').toUpperCase()}</span>
        <h2 id={`module-${climateModule.id}-title`}>{climateModule.name}</h2>
        <p className="module-tagline">{climateModule.tagline}</p>
        <div className="module-meta">
          <span className={`mode-pill mode-${climateModule.mode.toLowerCase()}`}>{climateModule.mode}</span>
          <span className="muted small">{climateModule.source.folder ? `Ported from projects/${climateModule.source.folder}` : 'Climate Chain core'}</span>
        </div>
      </header>
      <ul className="module-features" aria-label={`${climateModule.name} features`}>
        {climateModule.features.map((feature) => <li key={feature}>{feature}</li>)}
      </ul>
      <WorkspaceErrorBoundary key={climateModule.id} label={climateModule.name}>
        <div className="module-body">
          <Page />
        </div>
      </WorkspaceErrorBoundary>
    </section>
  );
}
