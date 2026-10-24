// Port of the challenge progress logic in AquaQuest js/features/contributions.js (getProgress,
// countByChallenge, hasUserContributed). Pure TypeScript.

export interface ChallengeRecord {
  readonly id: string;
  readonly title: string;
  /** The contributions this challenge aims for. Missing or 0 falls back to 50, as in the source. */
  readonly goal?: number | null;
}

export interface ContributionRecord {
  readonly id: string;
  readonly challengeId: string | null;
  readonly contributorId: string;
  readonly submittedAt: string;
}

export interface ChallengeProgress {
  readonly current: number;
  readonly target: number;
  readonly percent: number;
}

const DEFAULT_GOAL = 50;

export function countByChallenge(contributions: readonly ContributionRecord[], challengeId: string): number {
  return contributions.filter((contribution) => contribution.challengeId === challengeId).length;
}

export function hasUserContributed(
  contributions: readonly ContributionRecord[],
  challengeId: string,
  contributorId: string,
): boolean {
  return contributions.some(
    (contribution) => contribution.challengeId === challengeId && contribution.contributorId === contributorId,
  );
}

/** Progress toward a challenge's goal. An unknown challenge is zero of one, as in the source. */
export function progressFor(
  challenge: ChallengeRecord | undefined,
  contributions: readonly ContributionRecord[],
): ChallengeProgress {
  if (challenge === undefined) return { current: 0, target: 1, percent: 0 };
  const current = countByChallenge(contributions, challenge.id);
  const target = challenge.goal || DEFAULT_GOAL;
  return { current, target, percent: Math.min(100, Math.round((current / target) * 100)) };
}
