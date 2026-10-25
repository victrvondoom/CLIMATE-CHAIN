import { describe, expect, it } from 'vitest';
import {
  countByChallenge,
  hasUserContributed,
  progressFor,
  type ChallengeRecord,
  type ContributionRecord,
} from './challenges';

// Rules ported from BlueTrail js/features/contributions.js: getProgress, countByChallenge,
// hasUserContributed. Goal and fallback values are the source's own.

const challenge = (id: string, goal?: number): ChallengeRecord => ({ id, title: id, goal });

const contribution = (id: string, challengeId: string | null, contributorId: string): ContributionRecord => ({
  id,
  challengeId,
  contributorId,
  submittedAt: '2026-10-20T10:00:00.000Z',
});

const log = [
  contribution('AQ-1', 'chal_a', 'slot-1'),
  contribution('AQ-2', 'chal_a', 'slot-2'),
  contribution('AQ-3', 'chal_b', 'slot-1'),
];

describe('challenge progress (contributions.js getProgress)', () => {
  it('counts only the contributions to this challenge, against its goal', () => {
    expect(progressFor(challenge('chal_a', 50), log)).toEqual({ current: 2, target: 50, percent: 4 });
  });

  it('caps the percentage at 100 when the goal is passed', () => {
    const many = Array.from({ length: 60 }, (_, i) => contribution(`x${i}`, 'chal_a', `s${i}`));
    expect(progressFor(challenge('chal_a', 40), many)).toEqual({ current: 60, target: 40, percent: 100 });
  });

  it('rounds the percentage to a whole number', () => {
    expect(progressFor(challenge('chal_a', 3), [contribution('one', 'chal_a', 's')]).percent).toBe(33);
  });

  it('uses 50 as the goal when the challenge has none (goal || 50 in the source)', () => {
    expect(progressFor(challenge('chal_a'), log).target).toBe(50);
    expect(progressFor(challenge('chal_a', 0), log).target).toBe(50);
  });

  it('gives zero progress against a target of 1 for an unknown challenge', () => {
    expect(progressFor(undefined, log)).toEqual({ current: 0, target: 1, percent: 0 });
  });
});

describe('contribution counts', () => {
  it('counts a challenge only from its own contributions', () => {
    expect(countByChallenge(log, 'chal_a')).toBe(2);
    expect(countByChallenge(log, 'chal_missing')).toBe(0);
  });

  it('does not count a contribution with no challenge', () => {
    expect(countByChallenge([contribution('free', null, 's')], 'chal_a')).toBe(0);
  });

  it('says whether a contributor has already taken part in a challenge', () => {
    expect(hasUserContributed(log, 'chal_a', 'slot-1')).toBe(true);
    expect(hasUserContributed(log, 'chal_b', 'slot-2')).toBe(false);
  });
});
