// Port of projects/hourmatch-master/src/ruleparse.mjs: keyword rules from a sentence to a structured
// claim, with no language model. It says what it could not read instead of guessing: an unknown
// company or an unsupported time window is an error, never a silent default.
import type { Claim } from './checker';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

interface NamedCompany {
  id: string;
  name: string;
}

function companyKeys(c: NamedCompany): string[] {
  const name = c.name.replace(/\s*\(fictional\)\s*/i, '').trim().toLowerCase();
  const keys = new Set([name, c.id.toLowerCase(), c.id.toLowerCase().replace(/-/g, ' ')]);
  const first = name.split(/\s+/)[0];
  if (first.length >= 4) keys.add(first);
  return [...keys];
}

function findCompany(text: string, consumers: NamedCompany[]): NamedCompany[] {
  const t = text.toLowerCase();
  return consumers.filter((c) => companyKeys(c).some((k) => k && t.includes(k)));
}

function to24(h: number, mer: string | null): number {
  if (!mer) return h;
  const pm = mer.startsWith('p');
  if (h === 12) return pm ? 12 : 0;
  return pm ? h + 12 : h;
}

export type TimeWindow = { from: number; to: number } | { error: string } | null;

// Finds a daily time window (hour-aligned). Returns {from, to} | {error} | null.
export function findWindow(text: string): TimeWindow {
  // drop dates and percentages so their digits are not read as hours
  const t = text
    .toLowerCase()
    .replace(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/g, ' ')
    .replace(/\d+(?:\.\d+)?\s*%/g, ' ')
    .replace(/\b(noon|midday)\b/g, '12:00')
    .replace(/\bmidnight\b/g, '24:00');
  const re =
    /(?:\b(from|between)\s+)?\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|h\b|o'clock)?\s*(?:to|until|till|and|-|–)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|h\b|o'clock)?/g;
  for (const m of t.matchAll(re)) {
    const [, , h1s, m1, mer1raw, h2s, m2, mer2raw] = m;
    const after = t.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 12);
    if (/^\s*(kwh|mwh|gwh|percent|days?|weeks?|plants?)/.test(after)) continue;
    // accepted: "between 9 and 18", "from 9 to 18", "9 to 18", "9:00-18:00", "9am to 6pm", "9 h to 18 h"
    const mer1 = mer1raw && /[ap]/.test(mer1raw) ? mer1raw.replace(/\./g, '') : null;
    const mer2 = mer2raw && /[ap]/.test(mer2raw) ? mer2raw.replace(/\./g, '') : null;
    if ((m1 && m1 !== '00') || (m2 && m2 !== '00')) {
      return { error: 'time windows must start and end on a full hour (for example 09:00 to 18:00)' };
    }
    let a = to24(Number(h1s), mer1 || (mer2 && Number(h1s) <= Number(h2s) ? mer2 : null));
    let b = to24(Number(h2s), mer2);
    if (a > 24 || b > 24) continue;
    if (b === 0) b = 24;
    if (a === 24) a = 0;
    if (b <= a) {
      return { error: `a window from ${a}:00 to ${b}:00 crosses midnight; check it as two claims, before and after midnight` };
    }
    return { from: a, to: b };
  }
  return null;
}

function findDates(text: string, days: string[]): string[] {
  const out = [...text.matchAll(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/g)].map(
    (m) => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`,
  );
  const year = (days[0] || '2026').slice(0, 4);
  const t = text.toLowerCase();
  // "8 October", "October 8", "Oct 8"
  for (const m of t.matchAll(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/g)) {
    out.push(`${year}-${String(MONTHS.indexOf(m[2]) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`);
  }
  for (const m of t.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b(?!:)/g)) {
    out.push(`${year}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`);
  }
  return [...new Set(out)].sort();
}

export interface RuleParseResult {
  ok: boolean;
  claim: Claim;
  errors: string[];
  notes: string[];
}

/**
 * @param days dates covered by the ledger, in order
 */
export function ruleParse(text: string, { consumers, days }: { consumers: NamedCompany[]; days: string[] }): RuleParseResult {
  const errors: string[] = [];
  const notes: string[] = [];
  const t = text.toLowerCase();

  const hits = findCompany(text, consumers);
  if (hits.length === 0) {
    errors.push(`no known company named in the sentence. This ledger has: ${consumers.map((c) => c.name).join(', ')}`);
  } else if (hits.length > 1) {
    errors.push(`the sentence names more than one company (${hits.map((c) => c.name).join(', ')}); check one at a time`);
  }

  const dates = findDates(text, days);
  let start = days[0];
  let end = days[days.length - 1];
  if (dates.length >= 1) {
    start = dates[0];
    end = dates[dates.length - 1];
  } else if (/\b(this week|the week|whole week|all week)\b/.test(t)) {
    notes.push('"this week" read as the whole ledger range');
  } else {
    notes.push(`no date found; using the whole ledger range ${days[0]} to ${days[days.length - 1]}`);
  }

  let hourFrom = 0;
  let hourTo = 24;
  const w = findWindow(text);
  if (w && 'error' in w) {
    errors.push(w.error);
  } else if (w) {
    hourFrom = w.from;
    hourTo = w.to;
  } else if (/\bnight\b/.test(t)) {
    hourFrom = 0;
    hourTo = 6;
    notes.push('"night" read as 00:00 to 06:00');
  } else if (/\b(business|office|working) hours\b/.test(t)) {
    hourFrom = 8;
    hourTo = 19;
    notes.push('"business hours" read as 08:00 to 19:00');
  }
  if (/\bweekends?\b/.test(t)) errors.push('weekend-only claims are not supported by this checker yet');

  const pm = /(\d{1,3}(?:\.\d+)?)\s*(?:%|percent)/.exec(t);
  let claimed: number | null = pm ? Number(pm[1]) : null;
  if (claimed === null) {
    if (/\b(fully|entirely|all of|every kwh|completely|100 ?percent)\b/.test(t) || /\b(renewable|green|clean)\b/.test(t)) {
      claimed = 100;
      notes.push('no percentage found; read as 100%');
    } else {
      errors.push('no percentage found in the sentence');
      claimed = 0;
    }
  }
  if (claimed > 100) errors.push('claimed share above 100%');

  const volume = /(certificate|purchase|bought|procure)[^.]*(cover|equal|total|match)/.test(t) && !/(hour|24\/7|around the clock)/.test(t);
  const hourly = /(hour by hour|hour-by-hour|hourly|every hour|each hour|24\/7|around the clock|same[- ]hour)/.test(t);
  const standard: Claim['standard'] = volume ? 'volume' : hourly ? 'hourly' : 'unspecified';
  if (standard === 'unspecified') notes.push('basis not stated; judged hour by hour');

  const claim: Claim = {
    consumer_id: hits[0]?.id ?? '',
    start_date: start,
    end_date: end,
    hour_from: hourFrom,
    hour_to: hourTo,
    weekdays_only: /\b(weekdays?|business days?|working days?)\b/.test(t),
    claimed_pct: Math.min(100, claimed),
    standard,
    re100: /\bre ?100\b/.test(t),
    claim_year: 2026,
  };
  return { ok: errors.length === 0, claim, errors, notes };
}
