// Ports of backend/server/src/domain/letters/BackingStatement.ts, SitePlace.ts, Rule.ts,
// services/letters/QuoteVerifier.ts and LetterService.ts (DumpWatch). Pure: no React, no DOM.
// Not ported: the clause picker's scoring, channel routing, prose drafting, rate limits and letter IDs.

import { BACKERS_NEEDED } from './backers';

export type Office = 'councillor' | 'mla' | 'mp';
export type Lang = 'en' | 'hi';

export interface SeatRef {
  readonly id: string;
  readonly name: string;
}

export interface Representative {
  readonly office: Office;
  readonly seatId: string;
}

export interface PlaceFacts {
  readonly state: string;
  readonly district: SeatRef;
  readonly town: string | null;
  readonly ward: SeatRef | null;
  readonly assemblySeat: SeatRef | null;
  readonly loksabhaSeat: SeatRef | null;
  readonly representatives: readonly Representative[];
}

export interface CcLine {
  readonly office: Office;
  readonly seat: SeatRef;
  readonly marking: 'for attention';
}

// Copies go only to a seat that has a current representative for that office. The MP seat is skipped
// when no current representative is on file, so no stale MP is copied.
export function ccLines(place: PlaceFacts): CcLine[] {
  const seats: readonly (readonly [Office, SeatRef | null])[] = [
    ['councillor', place.ward],
    ['mla', place.assemblySeat],
    ['mp', place.loksabhaSeat],
  ];
  return seats.flatMap(([office, seat]) =>
    seat !== null && place.representatives.some((row) => row.office === office && row.seatId === seat.id)
      ? [{ office, seat: { id: seat.id, name: seat.name }, marking: 'for attention' as const }]
      : [],
  );
}

export function placeName(place: PlaceFacts): string {
  const town = place.town ?? place.district.name;
  return place.ward === null ? town : `${place.ward.name}, ${town}`;
}

// Count nouns: "1 person" and "3 people", "1 व्यक्ति" and "3 लोगों" (Hindi nouns before ने take the oblique plural).
function countOf(singular: string, plural: string, count: number): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export interface BackingFacts {
  readonly verified: boolean;
  readonly backers: number;
  // Null when the reporters are not known; the wording then says "residents".
  readonly reporters: number | null;
}

// Decision 20261011-1750: every site letter says how many people backed the site, and says verified only at 10.
export function backingStatement(lang: Lang, facts: BackingFacts): string {
  const { verified, backers, reporters } = facts;
  if (lang === 'hi') {
    if (verified) {
      return `${countOf('व्यक्ति', 'लोगों', backers)} ने इस स्थान की पुष्टि की है, इसलिए यह सत्यापित है।`;
    }
    const who = reporters === null ? 'निवासियों' : countOf('निवासी', 'निवासियों', reporters);
    return `${who} ने इसकी सूचना दी है; सामुदायिक पुष्टि जारी है (${BACKERS_NEEDED} में से ${countOf('व्यक्ति', 'लोगों', backers)} ने अब तक पुष्टि की)।`;
  }
  if (verified) {
    return `${countOf('person', 'people', backers)} confirmed this site, so it is verified.`;
  }
  const who = reporters === null ? 'residents' : countOf('resident', 'residents', reporters);
  return `Reported by ${who}; community verification in progress (${backers} of ${BACKERS_NEEDED} people confirmed so far).`;
}

export interface LetterRule {
  readonly ruleId: string;
  readonly clause: string;
  // The label printed just before the quote on its page, such as (f) or (vii).
  readonly clauseMarker: string;
  readonly exactText: string;
  readonly page: number;
  readonly sourceSha256: string;
  readonly situationTags: readonly string[];
}

export interface Citation {
  readonly ruleId: string;
  readonly document: string;
  readonly clause: string;
  readonly quote: string;
  readonly sourceSha256: string;
  readonly verified: true;
}

export function normalise(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

const WORD_CHAR = /[\p{L}\p{M}\p{N}_]/u;

// Positions where the quote occurs with no word character on either side.
function occurrences(quote: string, text: string): number[] {
  const needle = normalise(quote);
  const haystack = normalise(text);
  const found: number[] = [];
  if (needle === '') {
    return found;
  }
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    const before = haystack.charAt(at - 1);
    const after = haystack.charAt(at + needle.length);
    if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after)) {
      found.push(at);
    }
  }
  return found;
}

// A rule's quote must also follow its clause marker, so it cannot match the same words in another clause.
export function quoteVerifies(rule: LetterRule, pageText: string): boolean {
  const page = normalise(pageText);
  const marker = normalise(rule.clauseMarker);
  return marker !== '' && occurrences(rule.exactText, page).some((at) => page.slice(0, at).trimEnd().endsWith(marker));
}

export interface CheckedCitations {
  readonly citations: readonly Citation[];
  readonly verified: number;
  readonly total: number;
}

export function checkCitations(
  rules: readonly LetterRule[],
  document: string,
  pages: Readonly<Record<string, string>>,
): CheckedCitations {
  const passed = rules.filter((rule) => quoteVerifies(rule, pages[String(rule.page)] ?? ''));
  return {
    citations: passed.map((rule) => ({
      ruleId: rule.ruleId,
      document,
      clause: rule.clause,
      quote: rule.exactText,
      sourceSha256: rule.sourceSha256,
      verified: true,
    })),
    verified: passed.length,
    total: rules.length,
  };
}

const WHAT: Readonly<Record<string, string>> = {
  vacant_plot: 'a waste dump on a vacant plot',
  no_bin: 'a place with no waste bin',
};

const REQUEST: Readonly<Record<string, string>> = {
  waste_dump: 'We request that the site be cleared and that a bin or collection point be provided nearby.',
  no_bin: 'We request that waste bins be placed here and that regular collection be arranged.',
};

const OFFICE: Readonly<Record<Office, string>> = {
  councillor: 'the councillor of',
  mla: 'the MLA for',
  mp: 'the MP for',
};

export interface LetterInput {
  readonly siteId: string;
  readonly reportType: string;
  readonly context: string;
  readonly backers: number;
  readonly reporters: number | null;
  readonly place: PlaceFacts;
  readonly rules: readonly LetterRule[];
  readonly pages: Readonly<Record<string, string>>;
  readonly document: string;
}

export interface CitedLetter {
  readonly subject: string;
  readonly body: string;
  readonly citations: readonly Citation[];
  readonly verifier: { readonly verified: number; readonly total: number };
  readonly cc: readonly CcLine[];
}

// Never ship an unverified quote: anything short of verified N of N is a data bug, so drafting throws.
export function draftCitedLetter(input: LetterInput): CitedLetter {
  const picked = input.rules.filter((rule) => rule.situationTags.includes(input.context));
  const checked = checkCitations(picked, input.document, input.pages);
  if (checked.citations.length === 0 || checked.verified !== checked.total) {
    throw new Error(`Quote verifier passed ${checked.verified} of ${checked.total} picked rules`);
  }
  const cc = ccLines(input.place);
  const place = placeName(input.place);
  const councillor = cc.find((line) => line.office === 'councillor');
  const addressee = councillor ? `${OFFICE.councillor} ${councillor.seat.name}` : 'the local body';
  const copies = cc.filter((line) => line.office !== 'councillor').map((line) => `${OFFICE[line.office]} ${line.seat.name}`);
  const closing = copies.length === 0
    ? 'This letter is filed by a resident.'
    : `This letter is filed by a resident. Copies go for attention to ${copies.join(' and ')}.`;
  const verified = input.backers >= BACKERS_NEEDED;
  const body = [
    `To ${addressee}.`,
    `Residents have reported ${WHAT[input.context] ?? 'waste'} in ${place}. ${backingStatement('en', { verified, backers: input.backers, reporters: input.reporters })}`,
    'The relevant provisions read:',
    ...checked.citations.map((citation) => `Clause ${citation.clause}: "${citation.quote}"`),
    REQUEST[input.reportType] ?? '',
    closing,
  ].filter((line) => line !== '').join('\n');
  return {
    subject: `Request for action on ${WHAT[input.context] ?? 'waste'} in ${place} (DumpWatch site ${input.siteId})`,
    body,
    citations: checked.citations,
    verifier: { verified: checked.verified, total: checked.total },
    cc,
  };
}
