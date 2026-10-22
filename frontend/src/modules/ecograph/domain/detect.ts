// Port of eco/detect.py. The Cypher queries become plain loops over the ledger fixture.
// Same rules, same thresholds: overlap and registry duplicate, double retirement, trading loops,
// clustering into cases, and noisy-OR scoring. Not ported: the FalkorDB betweenness and WCC
// calls, the MCP tools, and the upstream trace (see the Page for the full list).

import { FREEZE_AT, REVIEW_AT, WEIGHTS, WHY } from './rules';
import type { Band, Case, Finding, Ledger, Signal, Suggestion } from './types';

export type { Band, Case, Finding, FindingType, Ledger, Signal, Suggestion } from './types';

type Project = Ledger['projects'][number];
type Credit = Ledger['credits'][number];
type Trade = Ledger['trades'][number];
type Retire = Ledger['retires'][number];

interface Index {
  projects: Map<string, Project>;
  credits: Credit[];
  creditById: Map<string, Credit>;
  parcelsByProject: Map<string, string[]>;
  buyerName: Map<string, string>;
  audited: Set<string>;
  tradesByCredit: Map<string, Trade[]>;
  retiresByCredit: Map<string, Retire[]>;
}

function indexLedger(l: Ledger): Index {
  const projects = new Map(l.projects.map((p) => [p.id, p]));
  const creditById = new Map(l.credits.map((c) => [c.id, c]));
  const parcelsByProject = new Map<string, string[]>();
  for (const x of l.covers) {
    const list = parcelsByProject.get(x.p) ?? [];
    list.push(x.lp);
    parcelsByProject.set(x.p, list);
  }
  const tradesByCredit = new Map<string, Trade[]>();
  for (const t of l.trades) {
    const list = tradesByCredit.get(t.credit) ?? [];
    list.push(t);
    tradesByCredit.set(t.credit, list);
  }
  const retiresByCredit = new Map<string, Retire[]>();
  for (const r of l.retires) {
    const list = retiresByCredit.get(r.credit) ?? [];
    list.push(r);
    retiresByCredit.set(r.credit, list);
  }
  return {
    projects,
    credits: l.credits,
    creditById,
    parcelsByProject,
    buyerName: new Map(l.buyers.map((b) => [b.id, b.name])),
    audited: new Set(l.audits.map((a) => a.p)),
    tradesByCredit,
    retiresByCredit,
  };
}

// Q_PAIRS: every pair of active projects that share at least one parcel.
export interface PairRow {
  a: string;
  b: string;
  regA: string;
  regB: string;
  shared: string[];
  sameLand: boolean;
}

export function findPairs(l: Ledger): PairRow[] {
  const ix = indexLedger(l);
  const active = [...ix.projects.values()]
    .filter((p) => p.status === 'ACTIVE')
    .map((p) => p.id)
    .sort();
  const rows: PairRow[] = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      const landA = ix.parcelsByProject.get(a) ?? [];
      const landB = new Set(ix.parcelsByProject.get(b) ?? []);
      const shared = landA.filter((lp) => landB.has(lp)).sort();
      if (shared.length === 0) continue;
      const sameLand = shared.length === landA.length && shared.length === (ix.parcelsByProject.get(b) ?? []).length;
      rows.push({
        a,
        b,
        regA: ix.projects.get(a)!.registry,
        regB: ix.projects.get(b)!.registry,
        shared,
        sameLand,
      });
    }
  }
  return rows;
}

// Same as eco/detect.py: a pair is an overlap unless it is the same land on two registries.
export function findOverlappingClaims(l: Ledger): PairRow[] {
  return findPairs(l).filter((r) => !(r.sameLand && r.regA !== r.regB));
}

export function findRegistryDuplicates(l: Ledger): PairRow[] {
  return findPairs(l).filter((r) => r.sameLand && r.regA !== r.regB);
}

export interface Claim {
  buyer: string;
  name: string;
  day: number;
  claim: string;
}

export interface DoubleRetirement {
  credit: string;
  tonnes: number;
  project: string;
  claims: Claim[];
}

// Q_DOUBLE_RETIRE: a credit with more than one RETIRED_BY edge.
export function findDoubleRetirements(l: Ledger): DoubleRetirement[] {
  const ix = indexLedger(l);
  const out: DoubleRetirement[] = [];
  for (const [creditId, retires] of ix.retiresByCredit) {
    const credit = ix.creditById.get(creditId);
    if (!credit || retires.length <= 1) continue;
    out.push({
      credit: creditId,
      tonnes: credit.tonnes,
      project: credit.project,
      claims: retires.map((r) => ({ buyer: r.b, name: ix.buyerName.get(r.b) ?? r.b, day: r.day, claim: r.claim })),
    });
  }
  return out.sort(byText((r) => r.credit));
}

export interface TradingLoop {
  key: string;
  holders: string[];
  credits: string[];
  days: Record<string, number[]>;
}

interface Ring {
  nodes: string[];
  days: number[];
}

// Q_LOOPS: inside one credit's own trades, a trail of 3 to 6 sales that returns to its start.
// The start must be the smallest holder on the trail, so each circle is counted once.
// Relationships are not reused, the same as Cypher.
function ringsIn(edges: Trade[]): Ring[] {
  const rings: Ring[] = [];
  const starts = [...new Set(edges.map((e) => e.a))].sort();
  for (const start of starts) {
    const used = new Set<number>();
    const walk = (node: string, nodes: string[], days: number[]) => {
      edges.forEach((e, idx) => {
        if (e.a !== node || used.has(idx) || e.b < start) return;
        used.add(idx);
        const nextNodes = [...nodes, e.b];
        const nextDays = [...days, e.day];
        if (e.b === start && nextDays.length >= 3) rings.push({ nodes: nextNodes, days: nextDays });
        if (nextDays.length < 6) walk(e.b, nextNodes, nextDays);
        used.delete(idx);
      });
    };
    walk(start, [start], []);
  }
  return rings;
}

export function findTradingLoops(l: Ledger): TradingLoop[] {
  const ix = indexLedger(l);
  const groups = new Map<string, { holders: string[]; credits: string[]; days: Record<string, number[]> }>();
  for (const [creditId, trades] of ix.tradesByCredit) {
    if (trades.length < 3) continue;
    for (const ring of ringsIn(trades)) {
      const holders = ring.nodes.slice(0, -1);
      const key = [...holders].sort().join('|');
      const group = groups.get(key) ?? { holders, credits: [], days: {} };
      group.credits.push(creditId);
      group.days[creditId] = ring.days;
      groups.set(key, group);
    }
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, holders: g.holders, credits: [...g.credits].sort(), days: g.days }))
    .sort(byText((g) => g.key));
}

function byText<T>(pick: (x: T) => string): (a: T, b: T) => number {
  return (a, b) => {
    const x = pick(a);
    const y = pick(b);
    return x < y ? -1 : x > y ? 1 : 0;
  };
}

// Each rule's finding, in the same order as eco/detect.py _findings: overlaps, duplicates, double retirements, loops.
export function buildFindings(l: Ledger): Finding[] {
  const ix = indexLedger(l);
  const out: Finding[] = [];

  for (const r of findOverlappingClaims(l)) out.push(pairFinding('overlap', r));
  for (const r of findRegistryDuplicates(l)) out.push(pairFinding('registry_duplicate', r));

  for (const r of findDoubleRetirements(l)) {
    const who = r.claims.map((c) => c.name).join(' and ');
    out.push({
      id: `double_retirement:${r.credit}`,
      type: 'double_retirement',
      key: r.credit,
      title: 'One credit retired twice',
      summary: `${r.credit} (${r.tonnes} t, ${r.project}) was retired by ${who}.`,
      projects: [r.project],
      credits: [r.credit],
      buyers: r.claims.map((c) => c.buyer),
      weight: WEIGHTS.double_retirement,
    });
  }

  for (const loop of findTradingLoops(l)) {
    const projects = [...new Set(loop.credits.map((c) => ix.creditById.get(c)?.project).filter((p): p is string => !!p))].sort();
    out.push({
      id: `loop:${loop.key}`,
      type: 'loop',
      key: loop.key,
      title: 'Credits sold in a circle',
      summary:
        `${loop.credits.length} credit(s) from ${projects.join(', ')} were sold around ${loop.holders.length} holders ` +
        `(${loop.holders.join(', ')}) and came back to where they started.`,
      projects,
      credits: loop.credits,
      buyers: loop.holders,
      weight: WEIGHTS.loop,
    });
  }
  return out;
}

function pairFinding(type: 'overlap' | 'registry_duplicate', r: PairRow): Finding {
  const key = `${r.a}|${r.b}`;
  const shared = r.shared.join(', ');
  const tail = type === 'registry_duplicate' ? ' and have no other land.' : '.';
  return {
    id: `${type}:${key}`,
    type,
    key,
    title: type === 'registry_duplicate' ? 'Same land listed on two registries' : 'Two projects claim the same land',
    summary: `${r.a} (${r.regA}) and ${r.b} (${r.regB}) both cover ${shared}${tail}`,
    projects: [r.a, r.b],
    credits: [],
    buyers: [],
    weight: WEIGHTS[type],
  };
}

export interface Cluster {
  findings: string[];
  projects: string[];
  credits: number;
}

// Union-find over findings, projects and credits: the same grouping as the WCC call in detect.py.
export function clusterFindings(findings: Finding[]): Cluster[] {
  const parent = new Map<string, string>();
  const root = (x: string): string => {
    let cur = x;
    while (parent.get(cur) !== cur) cur = parent.get(cur)!;
    return cur;
  };
  const ensure = (x: string) => {
    if (!parent.has(x)) parent.set(x, x);
  };
  const join = (a: string, b: string) => {
    ensure(a);
    ensure(b);
    parent.set(root(a), root(b));
  };
  for (const f of findings) {
    const fid = `F:${f.id}`;
    ensure(fid);
    for (const p of f.projects) join(fid, `P:${p}`);
    for (const c of f.credits) join(fid, `C:${c}`);
  }

  const groups = new Map<string, { findings: string[]; projects: Set<string>; credits: number }>();
  for (const node of parent.keys()) {
    const r = root(node);
    const g = groups.get(r) ?? { findings: [], projects: new Set<string>(), credits: 0 };
    if (node.startsWith('F:')) g.findings.push(node.slice(2));
    else if (node.startsWith('P:')) g.projects.add(node.slice(2));
    else g.credits += 1;
    groups.set(r, g);
  }
  return [...groups.values()]
    .filter((g) => g.findings.length > 0)
    .map((g) => ({ findings: g.findings.sort(), projects: [...g.projects].sort(), credits: g.credits }))
    .sort((a, b) => b.findings.length - a.findings.length || (a.findings[0] < b.findings[0] ? -1 : 1));
}

// Score = 1 - product(1 - weight), rounded to 3 places like the source.
export function noisyOr(weights: number[]): number {
  let p = 1;
  for (const w of weights) p *= 1 - w;
  return Math.round((1 - p) * 1000) / 1000;
}

export function bandFor(score: number): Band {
  return score >= FREEZE_AT ? 'freeze' : score >= REVIEW_AT ? 'review' : 'watch';
}

export function suggestedFor(score: number): Suggestion {
  return score >= FREEZE_AT ? 'freeze' : score >= REVIEW_AT ? 'refer' : 'watch';
}

// The source hashes the sorted finding ids with MD5. WebCrypto has no MD5, so this port uses FNV-1a,
// which keeps the scan synchronous. Case ids therefore differ from the source's ids.
export function caseIdFor(findingIds: string[]): string {
  const text = [...findingIds].sort().join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `CASE-${(h >>> 0).toString(16).padStart(8, '0').slice(0, 5).toUpperCase()}`;
}

export interface ScanResult {
  findingCount: number;
  findings: Finding[];
  cases: Case[];
}

const ATRISK_CAP = 400;

// scan() in eco/detect.py. `frozen` holds credit ids the reviewer has already frozen; it only affects creditsFrozen.
export function scanLedger(l: Ledger, frozen: ReadonlySet<string> = new Set()): ScanResult {
  const ix = indexLedger(l);
  const findings = buildFindings(l);
  const byId = new Map(findings.map((f) => [f.id, f]));
  const unaudited = new Set(
    [...ix.projects.values()].filter((p) => p.status === 'ACTIVE' && !ix.audited.has(p.id)).map((p) => p.id),
  );

  const cases: Case[] = clusterFindings(findings).map((cluster) => {
    const fs = cluster.findings.map((id) => byId.get(id)!);
    const projects = [...new Set(fs.flatMap((f) => f.projects))].sort();

    const signals: Signal[] = fs.map((f) => ({ signal: f.type, weight: f.weight, why: WHY[f.type], finding: f.id }));
    const missing = projects.filter((p) => unaudited.has(p));
    if (missing.length > 0) {
      signals.push({
        signal: 'no_audit',
        weight: WEIGHTS.no_audit,
        why: `${WHY.no_audit} (${missing.join(', ')})`,
        finding: null,
      });
    }
    signals.sort((x, y) => y.weight - x.weight);
    const score = noisyOr(signals.map((s) => s.weight));

    const creditIds = [...new Set(fs.flatMap((f) => f.credits))].sort();
    const risky = creditIds.length > 0
      ? creditIds.filter((id) => ix.creditById.has(id)).map((id) => ix.creditById.get(id)!)
      : ix.credits.filter((c) => projects.includes(c.project) && c.status === 'ACTIVE').sort(byText((c) => c.id));

    const sortedAtRisk = [...risky].sort(byText((c) => c.id));
    const id = caseIdFor(cluster.findings);
    return {
      id,
      title: fs.length === 1 ? fs[0].title : `Linked scheme around ${projects.slice(0, 2).join(', ')}`,
      score,
      band: bandFor(score),
      suggested: suggestedFor(score),
      types: fs.map((f) => f.type),
      findings: fs.map((f) => ({ id: f.id, type: f.type, title: f.title, summary: f.summary, weight: f.weight })),
      projects,
      creditsAtRisk: risky.length,
      tonnesAtRisk: risky.reduce((n, c) => n + c.tonnes, 0),
      atRiskIds: sortedAtRisk.map((c) => c.id).slice(0, ATRISK_CAP),
      creditsFrozen: risky.filter((c) => frozen.has(c.id)).length,
      signals,
      summary: fs.slice(0, 3).map((f) => f.summary).join(' '),
    };
  });

  cases.sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return { findingCount: findings.length, findings, cases };
}
