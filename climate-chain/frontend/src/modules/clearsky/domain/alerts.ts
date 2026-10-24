// Ports of the alert text (backend/src/clearsky/channels/templates.py, VILLAGE_ALERT), the cooldown and the
// farmer selection (backend/src/clearsky/domain/alerts.py). Pure: no React, no DOM.

import type { FieldStatus } from './risk';

// A repeat alert inside this window returns the first one (config alert_cooldown_minutes = 30).
export const ALERT_COOLDOWN_MIN = 30;
export const ALERT_BOOK_BUTTON = 'HAAN, book karo';

// The approved WhatsApp template body with {{1}} = the village name.
export function villageAlertText(villageName: string): string {
  return `Namaste ji 🌾 ${villageName} mein baler khali hai. Parali jalane ki jagah muft mein khet saaf karwaiye. Booking ke liye HAAN dabaiye.`;
}

export function alertCoolingDown(lastAtMs: number, nowMs: number, cooldownMin = ALERT_COOLDOWN_MIN): boolean {
  return nowMs - lastAtMs < cooldownMin * 60_000;
}

export interface FieldContact {
  readonly phone: string;
  readonly status: FieldStatus;
  readonly riskScore: number;
}

// Only open fields (registered or harvested) are told. One message per phone, at its highest open risk,
// and the highest-risk farmers first.
export function farmersToNotify(fields: readonly FieldContact[]): string[] {
  const open = fields.filter((field) => field.status === 'REGISTERED' || field.status === 'HARVESTED');
  const ordered = [...open].sort((a, b) => b.riskScore - a.riskScore);
  const seen = new Set<string>();
  const phones: string[] = [];
  for (const field of ordered) {
    if (!seen.has(field.phone)) {
      seen.add(field.phone);
      phones.push(field.phone);
    }
  }
  return phones;
}
