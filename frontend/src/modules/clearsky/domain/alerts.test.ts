import { describe, expect, it } from 'vitest';
import { ALERT_BOOK_BUTTON, ALERT_COOLDOWN_MIN, alertCoolingDown, farmersToNotify, villageAlertText } from './alerts';

// Text and rules from backend/src/clearsky/channels/templates.py (VILLAGE_ALERT) and domain/alerts.py.
describe('village alert text', () => {
  it('fills the village name into the approved WhatsApp template', () => {
    expect(villageAlertText('Bhawanigarh')).toBe(
      'Namaste ji 🌾 Bhawanigarh mein baler khali hai. Parali jalane ki jagah muft mein khet saaf karwaiye. Booking ke liye HAAN dabaiye.',
    );
    expect(ALERT_BOOK_BUTTON).toBe('HAAN, book karo');
  });
});

describe('alert cooldown', () => {
  it('is 30 minutes: a second alert inside it returns the first', () => {
    expect(ALERT_COOLDOWN_MIN).toBe(30);
    const first = Date.parse('2026-10-20T06:00:00Z');
    expect(alertCoolingDown(first, first + 29 * 60_000)).toBe(true);
    expect(alertCoolingDown(first, first + 30 * 60_000)).toBe(false);
  });
});

describe('who gets the alert', () => {
  it('notifies open fields only, once per phone, highest risk first', () => {
    const fields = [
      { phone: 'A', status: 'REGISTERED' as const, riskScore: 40 },
      { phone: 'D', status: 'HARVESTED' as const, riskScore: 85 },
      { phone: 'B', status: 'BOOKED' as const, riskScore: 99 },
      { phone: 'A', status: 'HARVESTED' as const, riskScore: 70 },
    ];
    // D (85) leads; A is notified once, at its highest open risk (70), after D.
    expect(farmersToNotify(fields)).toEqual(['D', 'A']);
  });
});
