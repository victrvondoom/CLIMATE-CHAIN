// Helpers from pipeline/screen.py: name cleaning, capacity parsing, word Jaccard, and the
// transparent pre-score that orders candidates before adjudication.

const GENERIC =
  /\b(project|projects|the|of|and|in|at|by|for|programme|program|pvt|ltd|limited|private|co|company|sa|inc|llc|bundled|grouped|phase|power|plant|india|china|state)\b/g;
const CAPACITY = /(\d+(?:\.\d+)?)\s*(mw|mwp|mwe|kw|kwp|gw)\b/gi;

export const NAME_THRESHOLD = 0.62;

export function clean(text: string | null | undefined): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(GENERIC, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Capacities in MW, so "500 kW" and "0.5 MW" compare equal.
export function capacities(name: string): Set<number> {
  const out = new Set<number>();
  for (const match of name.matchAll(CAPACITY)) {
    let value = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (unit.startsWith('kw')) value /= 1000;
    else if (unit === 'gw') value *= 1000;
    out.add(Math.round(value * 100) / 100);
  }
  return out;
}

export function jaccard(a: string, b: string): number {
  const sa = new Set(a.split(/\s+/).filter(Boolean));
  const sb = new Set(b.split(/\s+/).filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return 0;
  let shared = 0;
  for (const word of sa) if (sb.has(word)) shared++;
  return shared / new Set([...sa, ...sb]).size;
}

export interface PreScoreInput {
  name_sim: number;
  dev_sim: number;
  loc_sim: number;
  same_type: boolean;
  same_scope: boolean;
  capacity_conflict: boolean;
}

export function screenScore(c: PreScoreInput): number {
  let s = 0.55 * c.name_sim + 0.2 * c.dev_sim + 0.1 * c.loc_sim;
  s += c.same_type ? 0.1 : c.same_scope ? 0.04 : 0;
  s -= c.capacity_conflict ? 0.35 : 0;
  return Math.round(Math.max(0, Math.min(1, s + 0.05)) * 1e4) / 1e4;
}
