import { describe, expect, it } from 'vitest';
import { BACKERS_NEEDED, backerOutcome, backersView, countBackers, verifiedAt } from './backers';

// Vectors from backend/server/tests/sites/backers.test.ts (DumpWatch).
describe('site backers: the 10-person verification rule', () => {
  it('needs 10 people', () => {
    expect(BACKERS_NEEDED).toBe(10);
  });

  it('counts a person with a photo and a yes vote once', () => {
    expect(countBackers(['p1', 'p2'], ['p2', 'v1'])).toBe(3);
    expect(backersView({ photoPeople: ['p1', 'p2'], yesPeople: ['p2', 'v1'], noPeople: [], rejectMargin: 3 }, null)).toEqual({
      count: 3,
      needed: 10,
      photoPeople: 2,
      votePeople: 2,
    });
  });

  it('verifies at exactly 10 backers, not 9', () => {
    const eight = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8'];
    expect(backerOutcome({ photoPeople: ['p1'], yesPeople: eight, noPeople: [], rejectMargin: 3 })).toBeNull();
    expect(backerOutcome({ photoPeople: ['p1'], yesPeople: [...eight, 'v9'], noPeople: [], rejectMargin: 3 })).toBe('verified');
  });

  it('rejects when distinct no voters lead the backers by 3, ignoring a no from someone who sent a photo', () => {
    const base = { photoPeople: ['p1'], yesPeople: [], rejectMargin: 3 };
    expect(backerOutcome({ ...base, noPeople: ['n1', 'n2', 'n3'] })).toBeNull();
    expect(backerOutcome({ ...base, noPeople: ['n1', 'n2', 'n3', 'n4'] })).toBe('rejected');
    expect(backerOutcome({ ...base, noPeople: ['p1', 'n2', 'n3', 'n4'] })).toBeNull();
  });

  it('treats a site with 9 backers as unverified and one with 10 as verified', () => {
    expect(verifiedAt(9)).toBe(false);
    expect(verifiedAt(10)).toBe(true);
  });

  it('keeps the count it had when verified, never showing fewer backers', () => {
    expect(backersView({ photoPeople: ['p1'], yesPeople: [], noPeople: [], rejectMargin: 3 }, 10).count).toBe(10);
  });
});
