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
    title: '18 modules, one workspace',
    body: '18 native modules are re-implemented in climate-chain/frontend/src/modules from the source projects and run on bundled fixtures (8 SIMULATED, 6 RESEARCH, 4 DEMO). The original project folders are not included in this repository.',
    action: { label: 'Open the launchpad', to: 'launchpad' },
  },
  {
    id: 'apps-here',
    tag: 'PREVIEW',
    date: '22 Oct 2026',
    title: 'Standalone apps (local only)',
    body: 'BlueTrail, TorchSight, ParcelSeal, HourSync, UniqueCredit, CarbonScope and the ImpactGraph story page are served under /apps by a local gateway only when climate-chain/projects/ is present; they are not available on the hosted deployment. Apps that need a backend or a build step say so.',
    action: { label: 'Browse the projects', to: 'launchpad' },
  },
  {
    id: 'six-joined',
    tag: 'NEW',
    date: '22 Oct 2026',
    title: 'Six more projects join the workflow',
    body: 'TonneTrail, ClaimGuard AI, TorchSight, WattCert, HourSync and ParcelSeal now have stage mapping, readiness notes and evidence statements in the mission studio.',
    action: { label: 'Build a mission', to: 'studio' },
  },
  {
    id: 'one-registry',
    tag: 'PREVIEW',
    date: '22 Oct 2026',
    title: 'One registry drives the gateway and the UI',
    body: 'registry/projects.json is the single list of projects. The gateway serves it at /api/v1/projects and checks each app is present before linking to it.',
    action: { label: 'Open the launchpad', to: 'launchpad' },
  },
];
