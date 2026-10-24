// Shapes of the DEMO ledger fixture and the values the rules produce. No React, no DOM.

export interface Ledger {
  label: string;
  seed: number;
  source: { folder: string; files: string[] };
  note: string;
  registries: { id: string; name: string }[];
  parcels: { id: string; geohash: string; hectares: number; country: string }[];
  buyers: { id: string; name: string; kind: string }[];
  projects: {
    id: string;
    name: string;
    type: string;
    country: string;
    vintage: number;
    status: string;
    registry: string;
    developer: string;
  }[];
  credits: { id: string; project: string; vintage: number; tonnes: number; status: string }[];
  covers: { p: string; lp: string }[];
  audits: { p: string; id: string; auditor: string; date: string }[];
  trades: { credit: string; a: string; b: string; day: number }[];
  retires: { credit: string; b: string; day: number; claim: string }[];
  truth: { findings: { type: string; key: string }[]; decoys: { note: string }[] };
}

export type FindingType = 'overlap' | 'registry_duplicate' | 'double_retirement' | 'loop';
export type SignalType = FindingType | 'no_audit';
export type Band = 'freeze' | 'review' | 'watch';
export type Suggestion = 'freeze' | 'refer' | 'watch';

export interface Finding {
  id: string;
  type: FindingType;
  key: string;
  title: string;
  summary: string;
  projects: string[];
  credits: string[];
  buyers: string[];
  weight: number;
}

export interface Signal {
  signal: SignalType;
  weight: number;
  why: string;
  finding: string | null;
}

export interface CaseFinding {
  id: string;
  type: FindingType;
  title: string;
  summary: string;
  weight: number;
}

export interface Case {
  id: string;
  title: string;
  score: number;
  band: Band;
  suggested: Suggestion;
  types: FindingType[];
  findings: CaseFinding[];
  projects: string[];
  creditsAtRisk: number;
  tonnesAtRisk: number;
  atRiskIds: string[];
  creditsFrozen: number;
  signals: Signal[];
  summary: string;
}
