// Announced features shown on the command center. Each entry states what changed
// and where to act on it. Keep claims to what the workspace actually does now.

export type AnnouncementTag = 'NEW' | 'LIVE' | 'PREVIEW';

export interface Announcement {
  id: string;
  tag: AnnouncementTag;
  date: string;
  title: string;
  body: string;
  action: { label: string; to: 'launchpad' | 'capabilities' | 'studio' };
}

export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: 'one-folder',
    tag: 'NEW',
    date: '22 Oct 2026',
    title: 'One folder, every project',
    body: 'All 18 project folders are merged into climate-chain/projects. The original folders are untouched; this copy is the one the workspace runs and links to.',
    action: { label: 'Open the launchpad', to: 'launchpad' },
  },
  {
    id: 'apps-here',
    tag: 'LIVE',
    date: '22 Oct 2026',
    title: 'Standalone apps open from this origin',
    body: 'AquaQuest, Flarewatch, PlotLock, HourMatch, CarbonTwin, CarbonLens and the EcoGraph story page are served under /apps by the same gateway. Apps that need a backend or a build step say so.',
    action: { label: 'Browse capabilities', to: 'capabilities' },
  },
  {
    id: 'six-joined',
    tag: 'NEW',
    date: '22 Oct 2026',
    title: 'Six more projects join the workflow',
    body: 'CarbonTrace, ClimateProof AI, Flarewatch, GridProof, HourMatch and PlotLock now have stage mapping, readiness notes and evidence statements in the mission studio.',
    action: { label: 'Build a mission', to: 'studio' },
  },
  {
    id: 'one-registry',
    tag: 'PREVIEW',
    date: '22 Oct 2026',
    title: 'One registry drives the gateway and the UI',
    body: 'registry/projects.json is the single list of projects. The gateway serves it at /api/v1/projects and checks each app is present before linking to it.',
    action: { label: 'See the capability map', to: 'capabilities' },
  },
];
