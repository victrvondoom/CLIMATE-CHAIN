import { describe, expect, it } from 'vitest';
import ledger from '../fixtures/ledger-demo.json';
import {
  bandFor,
  buildFindings,
  clusterFindings,
  findDoubleRetirements,
  findOverlappingClaims,
  findRegistryDuplicates,
  findTradingLoops,
  noisyOr,
  scanLedger,
  suggestedFor,
  type Finding,
} from './detect';
import { plantedCheck } from './evaluate';

// Test vectors come from the source: tests/test_detection.py and eco/evaluate.py.

const pairKeys = (rows: { a: string; b: string }[]) => rows.map((r) => `${r.a}|${r.b}`).sort();

describe('overlap and registry-duplicate rules (eco/detect.py Q_PAIRS)', () => {
  it('flags the two planted overlaps and the one planted registry duplicate', () => {
    expect(pairKeys(findOverlappingClaims(ledger))).toEqual(['P-07|P-19', 'P-25|P-26']);
    expect(pairKeys(findRegistryDuplicates(ledger))).toEqual(['P-12|P-41']);
  });

  it('keeps a duplicate out of the overlap list', () => {
    expect(pairKeys(findOverlappingClaims(ledger))).not.toContain('P-12|P-41');
  });

  it('does not flag the succession decoy (P-33 ended, P-34) or the near-geohash decoy (P-35, P-36)', () => {
    const flagged = [...pairKeys(findOverlappingClaims(ledger)), ...pairKeys(findRegistryDuplicates(ledger))];
    expect(flagged).not.toContain('P-33|P-34');
    expect(flagged).not.toContain('P-35|P-36');
  });
});

describe('double retirement (eco/detect.py Q_DOUBLE_RETIRE)', () => {
  it('flags exactly the two planted credits, each retired by two buyers', () => {
    const rows = findDoubleRetirements(ledger);
    expect(rows.map((r) => r.credit)).toEqual(['CR-00089', 'CR-00694']);
    expect(rows.every((r) => r.claims.length === 2)).toBe(true);
  });

  it('does not flag the large honest buyer CO-01, which retires many credits once each', () => {
    const coRetirements = ledger.retires.filter((r) => r.b === 'CO-01');
    expect(coRetirements.length).toBeGreaterThan(100);
    const flagged = findDoubleRetirements(ledger).flatMap((r) => r.claims.map((c) => c.buyer));
    expect(flagged).not.toContain('CO-01');
  });
});

describe('trading loops (eco/detect.py Q_LOOPS)', () => {
  it('finds the two planted circles and nothing else', () => {
    const keys = findTradingLoops(ledger).map((l) => l.key);
    expect(new Set(keys)).toEqual(new Set(['BR-02|BR-05|CO-08', 'BR-09|BR-11|BR-12|CO-22']));
    expect(keys).toHaveLength(2);
  });

  it('does not treat the BR-03 / BR-04 two-cycle or the five-hop chain as a loop', () => {
    const holders = findTradingLoops(ledger).flatMap((l) => l.holders);
    expect(holders).not.toContain('BR-03');
    expect(holders).not.toContain('BR-04');
    expect(holders).not.toContain('BR-14');
  });

  it('counts the five circled credits (three in one ring, two in the other)', () => {
    const total = findTradingLoops(ledger).reduce((n, l) => n + l.credits.length, 0);
    expect(total).toBe(5);
  });
});

describe('planted-case evaluation (eco/evaluate.py)', () => {
  it('finds all 7 planted cases with no false alarms and no misses', () => {
    const r = plantedCheck(ledger, buildFindings(ledger));
    expect(r.planted).toBe(7);
    expect(r.found).toBe(7);
    expect(r.missed).toEqual([]);
    expect(r.falsePositives).toEqual([]);
    expect(r.precision).toBe(1);
    expect(r.recall).toBe(1);
    expect(r.decoys).toHaveLength(6);
  });
});

describe('scan: cases, scores and bands (eco/detect.py scan)', () => {
  const scan = scanLedger(ledger);

  it('builds 7 findings grouped into 5 cases', () => {
    expect(scan.findingCount).toBe(7);
    expect(scan.cases).toHaveLength(5);
  });

  it('puts the ring, its double retirement and the land overlap in one top case that suggests freeze', () => {
    const ring = scan.cases[0];
    expect([...ring.types].sort()).toEqual(['double_retirement', 'loop', 'overlap']);
    expect(ring.projects).toEqual(['P-07', 'P-19']);
    expect(ring.score).toBeGreaterThanOrEqual(0.85);
    expect(ring.suggested).toBe('freeze');
    expect(ring.creditsAtRisk).toBe(4);
  });

  it('keeps the lone loop as a refer suggestion below the freeze threshold', () => {
    const lone = scan.cases.find((c) => c.types.length === 1 && c.types[0] === 'loop');
    expect(lone).toBeDefined();
    expect(lone!.suggested).toBe('refer');
    expect(lone!.score).toBeLessThan(0.85);
  });

  it('never raises a case from the unaudited decoy projects alone', () => {
    const flagged = new Set(scan.cases.flatMap((c) => c.projects));
    for (const pid of ['P-05', 'P-14', 'P-29', 'P-38']) expect(flagged.has(pid)).toBe(false);
  });

  it('scores each case as an explainable noisy-OR of its signals, each with a reason', () => {
    for (const c of scan.cases) {
      const expected = 1 - c.signals.reduce((p, s) => p * (1 - s.weight), 1);
      expect(c.score).toBeCloseTo(Math.round(expected * 1000) / 1000, 6);
      expect(c.signals.every((s) => s.why.length > 0)).toBe(true);
    }
  });
});

describe('scoring and clustering helpers', () => {
  it('noisy-OR raises the score when independent signals stack', () => {
    expect(noisyOr([])).toBe(0);
    expect(noisyOr([0.9])).toBe(0.9);
    expect(noisyOr([0.9, 0.6])).toBe(0.96);
  });

  it('bands at 0.85 (freeze) and 0.5 (review), otherwise watch; refer is the review suggestion', () => {
    expect(bandFor(0.85)).toBe('freeze');
    expect(bandFor(0.5)).toBe('review');
    expect(bandFor(0.49)).toBe('watch');
    expect(suggestedFor(0.6)).toBe('refer');
    expect(suggestedFor(0.2)).toBe('watch');
  });

  it('merges findings that share a project or a credit into one cluster', () => {
    const f = (id: string, projects: string[], credits: string[]): Finding => ({
      id, type: 'overlap', key: id, title: id, summary: id, projects, credits, buyers: [], weight: 0.6,
    });
    const clusters = clusterFindings([f('a', ['P-1'], []), f('b', ['P-1', 'P-2'], []), f('c', ['P-9'], ['CR-1']), f('d', ['P-8'], ['CR-1'])]);
    expect(clusters.map((c) => c.findings)).toEqual([['a', 'b'], ['c', 'd']]);
    expect(clusters[0].projects).toEqual(['P-1', 'P-2']);
    expect(clusters[1].credits).toBe(1);
  });
});
