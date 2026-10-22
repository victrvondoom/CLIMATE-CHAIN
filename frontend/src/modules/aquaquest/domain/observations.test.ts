import { describe, expect, it } from 'vitest';
import {
  CLARITY,
  NOTE_MAX_LENGTH,
  canSubmit,
  draftProblems,
  emptyDraft,
  parseReading,
  stepIsValid,
  WILDLIFE,
  type ObservationDraft,
} from './observations';

// Rules ported from AquaQuest js/pages/observe.js (validateCurrentStep, submitObservation, captureStep4Inputs)
// and the HTML limits on the pH, turbidity and note inputs.

const filled = (overrides: Partial<ObservationDraft> = {}): ObservationDraft => ({
  ...emptyDraft(),
  clarity: 'good',
  litter: 'little',
  ...overrides,
});

describe('step gates (observe.js validateCurrentStep)', () => {
  it('needs a clarity choice on step 1', () => {
    expect(stepIsValid(1, emptyDraft())).toBe(false);
    expect(stepIsValid(1, filled())).toBe(true);
  });

  it('needs a litter choice on step 2', () => {
    expect(stepIsValid(2, { ...emptyDraft(), clarity: 'good' })).toBe(false);
    expect(stepIsValid(2, filled())).toBe(true);
  });

  it('never blocks steps 3 to 5', () => {
    for (const step of [3, 4, 5]) {
      expect(stepIsValid(step, emptyDraft())).toBe(true);
    }
  });
});

describe('submit (observe.js submitObservation)', () => {
  it('needs both clarity and litter', () => {
    expect(canSubmit(emptyDraft())).toBe(false);
    expect(canSubmit({ ...emptyDraft(), litter: 'none' })).toBe(false);
    expect(canSubmit(filled())).toBe(true);
  });
});

describe('reading limits (pH 0 to 14, turbidity 0 or more)', () => {
  it('accepts pH from 0 to 14 and an empty pH', () => {
    expect(draftProblems(filled({ ph: 0 }))).toEqual([]);
    expect(draftProblems(filled({ ph: 14 }))).toEqual([]);
    expect(draftProblems(filled({ ph: null }))).toEqual([]);
  });

  it('refuses a pH outside 0 to 14', () => {
    expect(draftProblems(filled({ ph: 14.1 }))).toContain('pH must be between 0 and 14');
    expect(draftProblems(filled({ ph: -0.1 }))).toContain('pH must be between 0 and 14');
  });

  it('accepts turbidity of 0 and refuses a negative turbidity', () => {
    expect(draftProblems(filled({ turbidity: 0 }))).toEqual([]);
    expect(draftProblems(filled({ turbidity: -1 }))).toContain('Turbidity cannot be negative');
  });

  it('limits the note to 300 characters', () => {
    expect(NOTE_MAX_LENGTH).toBe(300);
    expect(draftProblems(filled({ note: 'a'.repeat(300) }))).toEqual([]);
    expect(draftProblems(filled({ note: 'a'.repeat(301) }))).toContain('Note is over 300 characters');
  });

  it('does not let an out-of-range reading submit', () => {
    expect(canSubmit(filled({ ph: 15 }))).toBe(false);
  });
});

describe('parseReading (captureStep4Inputs)', () => {
  it('returns null for an empty field and a number for a typed one', () => {
    expect(parseReading('')).toBeNull();
    expect(parseReading('7.2')).toBe(7.2);
  });

  it('keeps a typed 0 (the source turns 0 into null when it saves, the port does not)', () => {
    expect(parseReading('0')).toBe(0);
  });

  it('returns null for text that is not a number, rather than NaN', () => {
    expect(parseReading('abc')).toBeNull();
  });
});

describe('option lists', () => {
  it('has the five clarity levels and the nine wildlife groups from observations.js', () => {
    expect(CLARITY).toEqual(['excellent', 'good', 'moderate', 'poor', 'critical']);
    expect(WILDLIFE).toHaveLength(9);
  });
});
