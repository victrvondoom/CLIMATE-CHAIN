import registry from '../../../registry/projects.json';
import type { ModuleId } from '../types';

// The capability map is loaded from registry/projects.json, the same file the
// gateway serves at /api/v1/projects. Add or edit a project there, not here.

export type StageId = 'sense' | 'verify' | 'act' | 'finance' | 'prove';
export type WorkspaceView = 'overview' | 'mission' | 'studio' | 'capabilities' | 'cascade' | 'memory' | ModuleId;

interface RegistryProject {
  id: string;
  name: string;
  folder: string | null;
  descriptor: string;
  domain: string;
  stages: StageId[];
  features: string[];
  evidence: string;
  readiness: string;
  liveUrl?: string;
  linkLabel?: string;
  module?: ModuleId;
  central?: boolean;
  tone: string;
  stack: string[];
  track?: string;
  local?: { root: string; build?: string };
}

export interface Capability {
  id: string;
  name: string;
  descriptor: string;
  domain: string;
  stages: StageId[];
  features: string[];
  evidence: string;
  readiness: string;
  href?: string;
  linkLabel?: string;
  module?: ModuleId;
  central?: boolean;
  tone: string;
  folder: string | null;
  stack: string[];
  track?: string;
  local?: { root: string; build?: string };
}

export const STAGES: { id: StageId; number: string; title: string; short: string; description: string }[] = [
  { id: 'sense', number: '01', title: 'Sense', short: 'Find a signal', description: 'Start from a place, a measured condition, or a community report.' },
  { id: 'verify', number: '02', title: 'Verify', short: 'Build confidence', description: 'Check the evidence, its provenance, and the rule that lets it count.' },
  { id: 'act', number: '03', title: 'Act', short: 'Choose an intervention', description: 'Connect the verified need to a person or team who can respond.' },
  { id: 'finance', number: '04', title: 'Finance', short: 'Fund the work', description: 'Route climate funding through visible conditions and accountable receipts.' },
  { id: 'prove', number: '05', title: 'Prove', short: 'Show what changed', description: 'Measure outcomes, record reversals, and prevent the same impact being counted twice.' },
];

export const FOCUSES: { id: string; label: string; detail: string; projects: string[] }[] = registry.focuses;
export type FocusId = string;

// Each registry entry becomes one capability. `liveUrl` is exposed as `href`, the
// name the cards and mission studio already use.
export const CAPABILITIES: Capability[] = (registry.projects as RegistryProject[]).map(({ liveUrl, ...project }) => ({
  ...project,
  href: liveUrl,
}));

// Projects that have their own folder under climate-chain/projects/.
export const PROJECT_FOLDER_COUNT = CAPABILITIES.filter((item) => item.folder).length;

// Stage lists exclude the central workspace; it is the platform, not a tool in a mission.
export const STAGE_PROJECTS: Record<StageId, string[]> = Object.fromEntries(
  STAGES.map((stage) => [stage.id, CAPABILITIES.filter((item) => !item.central && item.stages.includes(stage.id)).map((item) => item.id)]),
) as Record<StageId, string[]>;
