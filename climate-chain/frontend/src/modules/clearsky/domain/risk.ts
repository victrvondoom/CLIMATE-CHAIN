// Port of backend/src/clearsky/domain/risk.py (burn-risk scoring). Pure: no React, no DOM.
//
// score = 100 × (0.45·urgency + 0.25·no_capacity + 0.30·fire_history) × (1 if harvested else 0.35)
// RED ≥ 60, YELLOW ≥ 40, else GREEN. Booked and cleared fields are 0; a reported fire is 100.

export const SOWING_WINDOW_DAYS = 20;
export const RISK_RED_AT = 60;
export const RISK_YELLOW_AT = 40;
export const HIGH_HISTORY = 0.6;

export type FieldStatus = 'REGISTERED' | 'HARVESTED' | 'BOOKED' | 'CLEARED' | 'FIRE_REPORTED';
export type RiskLevel = 'RED' | 'YELLOW' | 'GREEN';

export interface FieldState {
  readonly status: FieldStatus;
  // ISO dates, YYYY-MM-DD.
  readonly harvestDate: string;
  readonly sowingDeadline: string;
  readonly harvestConfirmed: boolean;
}

export interface RiskResult {
  readonly score: number;
  readonly level: RiskLevel;
  readonly reasons: readonly string[];
}

// Python's round() sends a tie to the even integer (round(40.5) is 40); Math.round would give 41.
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

// Whole days from `from` to `to` (negative when `to` is earlier).
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function addDays(day: string, count: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);
}

export function levelFor(score: number): RiskLevel {
  if (score >= RISK_RED_AT) return 'RED';
  if (score >= RISK_YELLOW_AT) return 'YELLOW';
  return 'GREEN';
}

// `refused` counts the balers that declined this field or let its offer expire.
export function scoreField(
  field: FieldState,
  fireHistory: number,
  today: string,
  slotAvailable: boolean,
  refused = 0,
): RiskResult {
  if (field.status === 'BOOKED') return { score: 0, level: 'GREEN', reasons: ['booked'] };
  if (field.status === 'CLEARED') return { score: 0, level: 'GREEN', reasons: ['cleared'] };
  if (field.status === 'FIRE_REPORTED') return { score: 100, level: 'RED', reasons: ['fire reported'] };

  const harvested = field.harvestConfirmed || today >= field.harvestDate;
  const daysLeft = daysBetween(today, field.sowingDeadline);
  const urgency = Math.min(Math.max(1 - daysLeft / SOWING_WINDOW_DAYS, 0), 1);
  const history = Math.min(Math.max(fireHistory, 0), 1);
  const base = 0.45 * urgency + 0.25 * (slotAvailable ? 0 : 1) + 0.3 * history;
  const score = roundHalfEven(100 * base * (harvested ? 1 : 0.35));

  const reasons: string[] = [];
  if (harvested) {
    const ago = daysBetween(field.harvestDate, today);
    reasons.push(ago <= 0 ? 'harvested today' : `harvested ${ago} day${ago !== 1 ? 's' : ''} ago`);
  } else {
    reasons.push(`harvest in ${daysBetween(today, field.harvestDate)} days`);
  }
  reasons.push(daysLeft >= 0 ? `${daysLeft} days to sowing` : 'sowing deadline passed');
  if (history >= HIGH_HISTORY) reasons.push('high fire history');
  if (refused > 0 && !slotAvailable) {
    reasons.push('no baler accepted');
  } else if (!slotAvailable) {
    reasons.push('no baler free');
  } else if (refused > 0) {
    reasons.push(`declined by ${refused} baler${refused !== 1 ? 's' : ''}`);
  }
  reasons.push('not booked');
  return { score, level: levelFor(score), reasons };
}
