import type { SignalType } from './types';

// Values from eco/detect.py: WEIGHTS, WHY, FREEZE_AT and REVIEW_AT.
// A case's score is 1 - product(1 - weight), so independent signals stack.

export const WEIGHTS: Record<SignalType, number> = {
  double_retirement: 0.9,
  registry_duplicate: 0.8,
  overlap: 0.6,
  loop: 0.55,
  no_audit: 0.15,
};

export const WHY: Record<SignalType, string> = {
  double_retirement: 'The same credit was retired by two different buyers.',
  registry_duplicate: 'The same land is registered as a project on two registries.',
  overlap: 'Two active projects claim the same land.',
  loop: 'One credit was sold around a circle and came back to a holder it had already passed through.',
  no_audit: 'No audit report is on file for a project in this case.',
};

export const FREEZE_AT = 0.85;
export const REVIEW_AT = 0.5;
