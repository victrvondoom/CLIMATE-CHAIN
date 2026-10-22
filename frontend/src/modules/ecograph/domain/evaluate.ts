import type { Finding, Ledger } from './types';

// Port of eco/evaluate.py: compare what the rules found with the cases planted in the fixture.
export interface PlantedCheck {
  planted: number;
  found: number;
  truePositives: number;
  falsePositives: string[];
  missed: string[];
  precision: number | null;
  recall: number | null;
  decoys: string[];
}

export function plantedCheck(l: Ledger, findings: Finding[]): PlantedCheck {
  const planted = new Set(l.truth.findings.map((f) => `${f.type}:${f.key}`));
  const found = new Set(findings.map((f) => `${f.type}:${f.key}`));
  const hits = [...planted].filter((k) => found.has(k));
  const falsePositives = [...found].filter((k) => !planted.has(k)).sort();
  const missed = [...planted].filter((k) => !found.has(k)).sort();
  return {
    planted: planted.size,
    found: found.size,
    truePositives: hits.length,
    falsePositives,
    missed,
    precision: found.size ? Math.round((hits.length / found.size) * 1000) / 1000 : null,
    recall: planted.size ? Math.round((hits.length / planted.size) * 1000) / 1000 : null,
    decoys: l.truth.decoys.map((d) => d.note),
  };
}
