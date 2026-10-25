// Every page the dashboard can show, in one list. Labels and topbar titles are the ones
// the sidebar used before the merge, so nothing is renamed. Module entries come from the
// module registry, so a new module shows up here without an edit.

import { CLIMATE_MODULES } from '../modules';
import type { StageId, WorkspaceView } from '../data/capabilities';

export const DEFAULT_VIEW: WorkspaceView = 'overview';

export type LibraryGroupId = 'overview' | 'signals' | 'mission' | 'evidence' | 'tools' | 'modules';

export const LIBRARY_GROUPS: { id: LibraryGroupId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'signals', label: 'Signals' },
  { id: 'mission', label: 'Mission' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'tools', label: 'Tools' },
  { id: 'modules', label: 'Native modules' },
];

export interface Destination {
  id: WorkspaceView;
  label: string;
  title: string;
  group: LibraryGroupId;
  // Modules are filed under their first mission stage. Each module declares at least one.
  stage?: StageId;
}

const CORE_DESTINATIONS: Destination[] = [
  { id: 'overview', label: 'Command center', title: 'Climate Chain', group: 'overview' },
  { id: 'earth', label: 'Satellite climate globe', title: 'Earth intelligence', group: 'overview' },
  { id: 'pollution', label: 'Global Pollution Atlas · 195 countries', title: 'Global Pollution Atlas', group: 'signals' },
  { id: 'waste', label: 'Waste · JunkSnap', title: 'Waste · JunkSnap', group: 'signals' },
  { id: 'fire', label: 'Fire · clearsky', title: 'Fire · clearsky', group: 'signals' },
  { id: 'water', label: 'Water · Teesri Shikayat', title: 'Water · Teesri Shikayat', group: 'signals' },
  { id: 'air', label: 'Air · Vayu', title: 'Air · The Vayu Project', group: 'signals' },
  { id: 'mission', label: 'Guided mission path', title: 'From signal to proof', group: 'mission' },
  { id: 'studio', label: 'Unified mission studio', title: 'Unified mission studio', group: 'mission' },
  { id: 'cascade', label: 'Place-based review', title: 'Climate Cascade Review', group: 'mission' },
  { id: 'timeline', label: '200-Year Climate Intelligence', title: 'Climate Intelligence Timeline', group: 'evidence' },
  { id: 'lab', label: 'Causal Lab · scenarios, El Niño, molecules', title: 'Causal Lab', group: 'evidence' },
  { id: 'integrity', label: 'Climate Integrity Lab', title: 'Climate Integrity Lab', group: 'evidence' },
  { id: 'connections', label: 'Data, keys & MCP evidence', title: 'Data and connection evidence', group: 'evidence' },
  { id: 'session', label: 'Review desk', title: 'Climate Chain', group: 'evidence' },
  { id: 'ledger', label: 'Evidence ledger', title: 'Evidence ledger', group: 'evidence' },
  { id: 'memory', label: 'AI engineering memory', title: 'Engineering memory', group: 'tools' },
  { id: 'refinery', label: 'Data Refinery · clean & reformat CSV/JSON', title: 'Data Refinery', group: 'tools' },
];

const MODULE_DESTINATIONS: Destination[] = CLIMATE_MODULES.map((item) => ({
  id: `module:${item.id}` as WorkspaceView,
  label: item.name,
  title: item.name,
  group: 'modules',
  stage: item.stages[0] ?? 'sense',
}));

export const DESTINATIONS: Destination[] = [...CORE_DESTINATIONS, ...MODULE_DESTINATIONS];

const BY_ID = new Map<string, Destination>(DESTINATIONS.map((item) => [item.id, item]));

export function destinationFor(id: string): Destination | undefined {
  return BY_ID.get(id);
}

export function isDestination(id: string): boolean {
  return BY_ID.has(id);
}

// Accepts a location hash, with or without the leading '#'. Returns null for anything
// that does not name a destination, so the caller can fall back to DEFAULT_VIEW.
export function resolveView(hash: string): WorkspaceView | null {
  const target = hash.replace(/^#/, '');
  return BY_ID.has(target) ? (target as WorkspaceView) : null;
}
