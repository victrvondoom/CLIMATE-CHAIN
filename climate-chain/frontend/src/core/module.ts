import type { ComponentType } from 'react';

// The contract every native module implements. See docs/ARCHITECTURE_V2.md.

export type StageId = 'sense' | 'verify' | 'act' | 'finance' | 'prove';

// LIVE: data read from a reachable source. SIMULATED: fallback or fixture values.
// DEMO: illustrative walkthrough. RESEARCH: measured result copied from a project's own outputs.
export type EvidenceMode = 'LIVE' | 'SIMULATED' | 'DEMO' | 'RESEARCH';

export interface ClimateModule {
  id: string;
  name: string;
  tagline: string;
  stages: StageId[];
  tone: string;
  mode: EvidenceMode;
  features: string[];
  source: { folder: string | null; files: string[] };
  Page: ComponentType;
}
