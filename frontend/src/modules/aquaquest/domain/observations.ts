// Port of the validation in AquaQuest js/pages/observe.js (validateCurrentStep, submitObservation,
// captureStep4Inputs) and the input limits declared in the same file (pH 0 to 14, turbidity min 0,
// note maxlength 300). Pure TypeScript.

export const CLARITY = ['excellent', 'good', 'moderate', 'poor', 'critical'] as const;
export const LITTER = ['none', 'little', 'moderate', 'heavy', 'severe'] as const;
export const SMELL = ['none', 'mild', 'strong', 'foul'] as const;
export const COLOUR = ['normal', 'green', 'brown', 'black', 'oily'] as const;
export const WILDLIFE = [
  'fish',
  'birds',
  'plants',
  'crabs',
  'shells',
  'butterflies',
  'turtles',
  'insects',
  'mammals',
] as const;

export type Clarity = (typeof CLARITY)[number];
export type Litter = (typeof LITTER)[number];
export type Smell = (typeof SMELL)[number];
export type Colour = (typeof COLOUR)[number];
export type Wildlife = (typeof WILDLIFE)[number];

export const STEP_COUNT = 5;
export const NOTE_MAX_LENGTH = 300;
export const PH_MIN = 0;
export const PH_MAX = 14;

export interface ObservationDraft {
  clarity: Clarity | null;
  litter: Litter | null;
  smell: Smell | null;
  colour: Colour | null;
  wildlife: Wildlife[];
  ph: number | null;
  turbidity: number | null;
  temperature: number | null;
  note: string;
}

export function emptyDraft(): ObservationDraft {
  return {
    clarity: null,
    litter: null,
    smell: null,
    colour: null,
    wildlife: [],
    ph: null,
    turbidity: null,
    temperature: null,
    note: '',
  };
}

/** Step 1 needs clarity and step 2 needs litter. Steps 3 to 5 never block the way forward. */
export function stepIsValid(step: number, draft: ObservationDraft): boolean {
  if (step === 1) return draft.clarity !== null;
  if (step === 2) return draft.litter !== null;
  return true;
}

/** The problems with the readings and note. An empty pH or turbidity is allowed. */
export function draftProblems(draft: ObservationDraft): string[] {
  const problems: string[] = [];
  if (draft.ph !== null && (draft.ph < PH_MIN || draft.ph > PH_MAX)) {
    problems.push(`pH must be between ${PH_MIN} and ${PH_MAX}`);
  }
  if (draft.turbidity !== null && draft.turbidity < 0) {
    problems.push('Turbidity cannot be negative');
  }
  if (draft.note.length > NOTE_MAX_LENGTH) {
    problems.push(`Note is over ${NOTE_MAX_LENGTH} characters`);
  }
  return problems;
}

/** Submit needs clarity and litter, and no reading or note problem. */
export function canSubmit(draft: ObservationDraft): boolean {
  return draft.clarity !== null && draft.litter !== null && draftProblems(draft).length === 0;
}

/**
 * A typed reading as a number, or null when the field is empty or not a number. The source uses
 * parseFloat and stores NaN for text; the port keeps the field empty instead.
 */
export function parseReading(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = parseFloat(trimmed);
  return Number.isFinite(value) ? value : null;
}
