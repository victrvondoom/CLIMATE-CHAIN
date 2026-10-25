import { describe, expect, it } from 'vitest';
import lettersFixture from '../fixtures/letter-rules.json';
import { backingStatement, ccLines, draftCitedLetter, normalise, quoteVerifies, type LetterRule, type PlaceFacts } from './letters';

const rules = lettersFixture.rules as LetterRule[];
const pages = lettersFixture.pages as Record<string, string>;
const place = lettersFixture.place as PlaceFacts;

// Vectors from backend/server/tests/letters/countWording.test.ts (DumpWatch).
describe('backing statement in letters', () => {
  it('says 1 person or several, in English', () => {
    expect(backingStatement('en', { verified: false, backers: 1, reporters: 1 })).toBe(
      'Reported by 1 resident; community verification in progress (1 of 10 people confirmed so far).',
    );
    expect(backingStatement('en', { verified: false, backers: 3, reporters: 3 })).toBe(
      'Reported by 3 residents; community verification in progress (3 of 10 people confirmed so far).',
    );
    expect(backingStatement('en', { verified: true, backers: 12, reporters: 12 })).toBe('12 people confirmed this site, so it is verified.');
  });

  it('says 1 person or several, in Hindi', () => {
    expect(backingStatement('hi', { verified: false, backers: 1, reporters: 1 })).toBe(
      '1 निवासी ने इसकी सूचना दी है; सामुदायिक पुष्टि जारी है (10 में से 1 व्यक्ति ने अब तक पुष्टि की)।',
    );
    expect(backingStatement('hi', { verified: false, backers: 3, reporters: 3 })).toBe(
      '3 निवासियों ने इसकी सूचना दी है; सामुदायिक पुष्टि जारी है (10 में से 3 लोगों ने अब तक पुष्टि की)।',
    );
  });
});

describe('quote verification (word for word, after its clause marker)', () => {
  it('verifies every fixture rule against its own page', () => {
    for (const rule of rules) {
      expect(quoteVerifies(rule, normalise(pages[String(rule.page)]))).toBe(true);
    }
  });

  it('rejects a quote that follows a different clause marker', () => {
    const dumpsites = rules.find((rule) => rule.ruleId === 'fx-dumpsites')!;
    expect(quoteVerifies({ ...dumpsites, clauseMarker: '(ii)' }, normalise(pages['3']))).toBe(false);
  });

  it('rejects a quote that is only part of a longer word, even after its marker', () => {
    const bins = rules.find((rule) => rule.ruleId === 'fx-bins')!;
    expect(quoteVerifies({ ...bins, exactText: 'placement of waste bin' }, '(x) placement of waste bins')).toBe(false);
    expect(quoteVerifies(bins, '(x) schedule for street sweeping and placement of waste bins as per prescribed norms;')).toBe(true);
  });
});

describe('ward and elected-seat mapping (copies go only to seats with a current representative)', () => {
  it('copies the councillor and the MLA, and skips the MP seat with no current representative', () => {
    const lines = ccLines(place).map((line) => `${line.office}:${line.seat.id}`);
    expect(lines).toEqual(['councillor:ward-fx-1', 'mla:seat-fx-a']);
  });
});

describe('cited letter draft', () => {
  it('cites only verified quotes and reports verified of total', () => {
    const letter = draftCitedLetter({
      siteId: 'fixture-site-b',
      context: 'vacant_plot',
      reportType: 'waste_dump',
      backers: 3,
      reporters: 3,
      place,
      rules,
      pages,
      document: lettersFixture.document,
    });
    expect(letter.verifier).toEqual({ verified: 3, total: 3 });
    expect(letter.citations.map((citation) => citation.ruleId)).toEqual(['fx-dumpsites', 'fx-hot-spots', 'fx-vacant-plots']);
    expect(letter.citations[0]).toMatchObject({ clause: '15(1)', document: 'Sample Waste Rules (test fixture)', verified: true });
    expect(letter.subject).toContain('(DumpWatch site fixture-site-b)');
    expect(letter.body).toContain('Reported by 3 residents');
  });

  it('refuses to draft when a picked quote fails verification', () => {
    const broken = rules.map((rule) => (rule.ruleId === 'fx-vacant-plots' ? { ...rule, exactText: 'a quote that is not on the page' } : rule));
    expect(() =>
      draftCitedLetter({ siteId: 'x', context: 'vacant_plot', reportType: 'waste_dump', backers: 1, reporters: 1, place, rules: broken, pages, document: lettersFixture.document }),
    ).toThrow(/Quote verifier passed 2 of 3/);
  });
});
