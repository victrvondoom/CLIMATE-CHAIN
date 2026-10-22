import { describe, expect, it } from 'vitest';
import ledger from '../fixtures/ledger-demo.json';
import { scanLedger } from './detect';
import { decide, markReviewed, openBook } from './freeze';

const cases = scanLedger(ledger).cases;
const AT = '2026-10-22T00:00:00.000Z';
const NOTE = 'checked the registry and the retirement claims';

describe('freeze decision state machine: proposed, reviewed, frozen or dismissed', () => {
  it('starts every case as proposed with nothing frozen', () => {
    const book = openBook(cases);
    expect(book.records[cases[0].id].status).toBe('proposed');
    expect(book.frozen).toEqual([]);
  });

  it('needs a reviewer note of at least 12 characters before review', () => {
    const book = openBook(cases);
    expect(() => markReviewed(book, cases[0].id, 'short')).toThrow();
    const next = markReviewed(book, cases[0].id, NOTE);
    expect(next.records[cases[0].id].status).toBe('reviewed');
  });

  it('cannot freeze or dismiss before review', () => {
    const book = openBook(cases);
    expect(() => decide(book, cases[0].id, 'freeze', AT)).toThrow();
    expect(() => decide(book, cases[0].id, 'dismiss', AT)).toThrow();
  });

  it('freezes the case credits on freeze, and the count matches credits at risk (source test: 4 == 4)', () => {
    const reviewed = markReviewed(openBook(cases), cases[0].id, NOTE);
    const { book, entry } = decide(reviewed, cases[0].id, 'freeze', AT);
    expect(entry.creditsFrozen).toBe(cases[0].creditsAtRisk);
    expect(entry.creditsFrozen).toBe(4);
    expect(book.frozen).toHaveLength(4);
    expect(book.records[cases[0].id].status).toBe('frozen');
    expect(entry.reviewer).toBe('human reviewer');
    expect(entry.action).toBe('freeze');
  });

  it('counts only newly frozen credits when two cases share a credit', () => {
    const shared = cases.filter((c) => c.atRiskIds.length > 0);
    const second = { ...shared[1], atRiskIds: [...shared[0].atRiskIds] };
    const book = openBook([shared[0], second]);
    const first = decide(markReviewed(book, shared[0].id, NOTE), shared[0].id, 'freeze', AT);
    const r1 = decide(markReviewed(first.book, second.id, NOTE), second.id, 'freeze', AT);
    expect(first.entry.creditsFrozen).toBe(shared[0].creditsAtRisk);
    expect(r1.entry.creditsFrozen).toBe(0);
    expect(r1.book.frozen).toHaveLength(shared[0].creditsAtRisk);
  });

  it('dismiss records the decision and freezes nothing', () => {
    const reviewed = markReviewed(openBook(cases), cases[1].id, NOTE);
    const { book, entry } = decide(reviewed, cases[1].id, 'dismiss', AT);
    expect(book.records[cases[1].id].status).toBe('dismissed');
    expect(entry.creditsFrozen).toBe(0);
    expect(book.frozen).toEqual([]);
  });

  it('is terminal: a decided case cannot be decided again', () => {
    const { book } = decide(markReviewed(openBook(cases), cases[0].id, NOTE), cases[0].id, 'freeze', AT);
    expect(() => decide(book, cases[0].id, 'dismiss', AT)).toThrow();
  });

  it('rejects an action outside freeze or dismiss', () => {
    const reviewed = markReviewed(openBook(cases), cases[0].id, NOTE);
    expect(() => decide(reviewed, cases[0].id, 'delete' as 'freeze', AT)).toThrow();
  });

  it('keeps the rule suggestion on each record for the log', () => {
    const book = openBook(cases);
    for (const c of cases) expect(book.records[c.id].suggested).toBe(c.suggested);
  });
});
