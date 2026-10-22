// Human-reviewed freeze decision. Each case moves through four states:
//   proposed  -> the rules raised the case; nothing has been decided
//   reviewed  -> a person has checked the evidence and written a note (12+ characters)
//   frozen | dismissed -> the person's final decision. Both are terminal.
// Freezing marks the case's at-risk credits frozen. A credit already frozen is not counted again.
// Pure and immutable, so the page can hold the book in React state.
// The source also has a 'refer' action; this state machine keeps only freeze and dismiss.

import type { Case, Suggestion } from './types';

export type DecisionStatus = 'proposed' | 'reviewed' | 'frozen' | 'dismissed';
export type DecisionAction = 'freeze' | 'dismiss';

export interface CaseRecord {
  caseId: string;
  title: string;
  score: number;
  suggested: Suggestion;
  atRiskIds: string[];
  status: DecisionStatus;
  reviewNote: string | null;
}

export interface LogEntry {
  caseId: string;
  action: DecisionAction;
  reviewer: string;
  note: string;
  creditsFrozen: number;
  suggested: Suggestion;
  at: string;
}

export interface DecisionBook {
  records: Record<string, CaseRecord>;
  frozen: string[];
  log: LogEntry[];
}

export const REVIEWER = 'human reviewer';
const MIN_NOTE = 12;

export function openBook(cases: Case[]): DecisionBook {
  const records: Record<string, CaseRecord> = {};
  for (const c of cases) {
    records[c.id] = {
      caseId: c.id,
      title: c.title,
      score: c.score,
      suggested: c.suggested,
      atRiskIds: c.atRiskIds,
      status: 'proposed',
      reviewNote: null,
    };
  }
  return { records, frozen: [], log: [] };
}

function recordOf(book: DecisionBook, caseId: string): CaseRecord {
  const rec = book.records[caseId];
  if (!rec) throw new Error(`unknown case ${caseId}`);
  return rec;
}

export function markReviewed(book: DecisionBook, caseId: string, note: string): DecisionBook {
  const rec = recordOf(book, caseId);
  if (rec.status !== 'proposed') throw new Error(`a ${rec.status} case cannot be reviewed again`);
  const clean = note.trim();
  if (clean.length < MIN_NOTE) throw new Error(`give a reviewer note of at least ${MIN_NOTE} characters`);
  return {
    ...book,
    records: { ...book.records, [caseId]: { ...rec, status: 'reviewed', reviewNote: clean.slice(0, 300) } },
  };
}

export function decide(
  book: DecisionBook,
  caseId: string,
  action: DecisionAction,
  at: string,
): { book: DecisionBook; entry: LogEntry } {
  const rec = recordOf(book, caseId);
  if (rec.status !== 'reviewed') throw new Error('a case must be reviewed before it is frozen or dismissed');
  if (action !== 'freeze' && action !== 'dismiss') throw new Error('action must be freeze or dismiss');

  const already = new Set(book.frozen);
  const newly = action === 'freeze' ? rec.atRiskIds.filter((id) => !already.has(id)) : [];
  const frozen = action === 'freeze' ? [...book.frozen, ...newly].sort() : book.frozen;
  const entry: LogEntry = {
    caseId,
    action,
    reviewer: REVIEWER,
    note: rec.reviewNote ?? '',
    creditsFrozen: newly.length,
    suggested: rec.suggested,
    at,
  };
  return {
    book: {
      records: {
        ...book.records,
        [caseId]: { ...rec, status: action === 'freeze' ? 'frozen' : 'dismissed' },
      },
      frozen,
      log: [entry, ...book.log],
    },
    entry,
  };
}
