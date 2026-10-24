import { describe, expect, it } from 'vitest';
import {
  ADVICE_MAX_AGE_MINUTES,
  ageMinutes,
  haversineKm,
  newestReading,
  nearestFreshMonitor,
  readingState,
  window24h,
  type Monitor,
  type MonitorHour,
} from './monitors';

// Rules ported from the-vayu-project-main: docs/safety.md rule I1 and I3, apps/api stationsRoute.ts,
// packages/core/src/provenance.ts, packages/core/src/timeline.ts (unusableMin), packages/data/src/freshStation.ts.

const hour = (hourStart: string, pm25: number | null, pm10: number | null = null): MonitorHour => ({
  hourStart,
  pm25,
  pm10,
});

const monitor = (id: string, lat: number, lng: number, hours: MonitorHour[]): Monitor => ({
  id,
  name: `Monitor ${id}`,
  lat,
  lng,
  hours,
});

const POINT = { lat: 28.6, lng: 77.0 };
const ASOF = '2025-12-15T02:00:00.000Z';

describe('haversineKm', () => {
  it('is zero for the same point', () => {
    expect(haversineKm(POINT, POINT)).toBe(0);
  });

  it('is about 111.195 km for one degree of latitude', () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111.195, 2);
  });
});

describe('reading age (rule I3)', () => {
  it('counts whole minutes between the reading and the moment asked about', () => {
    expect(ageMinutes('2025-12-14T10:00:00.000Z', '2025-12-14T10:40:00.000Z')).toBe(40);
  });

  it('never reports a negative age for a reading from the future', () => {
    expect(ageMinutes('2025-12-14T11:00:00.000Z', '2025-12-14T10:00:00.000Z')).toBe(0);
  });

  it('is current up to three hours, shown without advice from three to six hours, and dropped after six', () => {
    expect(readingState(0)).toBe('current');
    expect(readingState(ADVICE_MAX_AGE_MINUTES)).toBe('current');
    expect(readingState(ADVICE_MAX_AGE_MINUTES + 1)).toBe('old_no_advice');
    expect(readingState(360)).toBe('old_no_advice');
    expect(readingState(361)).toBe('dropped');
  });

  it('drops a reading from the future', () => {
    expect(readingState(-1)).toBe('dropped');
  });
});

describe('newest reading', () => {
  it('reports a dropped reading too, with its age, so the page can say why it is not used', () => {
    const old = monitor('old', 28.61, 77.0, [hour('2025-12-14T10:00:00.000Z', 90)]);
    expect(newestReading(old, ASOF)).toEqual({
      observedAt: '2025-12-14T11:00:00.000Z',
      ageMinutes: 900,
      state: 'dropped',
    });
  });

  it('is undefined for a monitor with no PM2.5 value', () => {
    const noPm25 = monitor('none', 28.62, 77.0, [hour('2025-12-14T23:00:00.000Z', null, 90)]);
    expect(newestReading(noPm25, ASOF)).toBeUndefined();
  });
});

describe('nearest fresh monitor', () => {
  it('takes the nearest monitor whose newest reading is fresh, skipping a nearer dropped one', () => {
    const nearDropped = monitor('near', 28.601, 77.0, [hour('2025-12-14T18:00:00.000Z', 100)]);
    const farFresh = monitor('far', 28.61, 77.0, [hour('2025-12-14T23:00:00.000Z', 80, 120)]);
    const result = nearestFreshMonitor(POINT, [nearDropped, farFresh], ASOF);
    expect(result?.monitor.id).toBe('far');
    expect(result?.state).toBe('current');
    expect(result?.ageMinutes).toBe(120);
    expect(result?.distanceKm).toBeCloseTo(haversineKm(POINT, { lat: 28.61, lng: 77.0 }), 9);
  });

  it('uses the newest hour that has a PM2.5 value, ignoring a newer hour without one', () => {
    const gappy = monitor('gappy', 28.61, 77.0, [
      hour('2025-12-14T22:00:00.000Z', 100),
      hour('2025-12-14T23:00:00.000Z', null, 200),
    ]);
    const result = nearestFreshMonitor(POINT, [gappy], ASOF);
    expect(result?.observedAt).toBe('2025-12-14T23:00:00.000Z');
    expect(result?.ageMinutes).toBe(180);
    expect(result?.state).toBe('current');
  });

  it('does not look ahead: an hour that had not ended by asOf is not a reading (rule I1)', () => {
    const early = monitor('early', 28.61, 77.0, [hour('2025-12-15T00:00:00.000Z', 50)]);
    expect(nearestFreshMonitor(POINT, [early], '2025-12-15T00:30:00.000Z')).toBeUndefined();
  });

  it('returns undefined when every monitor is dropped or has no PM2.5', () => {
    const old = monitor('old', 28.61, 77.0, [hour('2025-12-14T10:00:00.000Z', 90)]);
    const noPm25 = monitor('none', 28.62, 77.0, [hour('2025-12-14T23:00:00.000Z', null, 90)]);
    expect(nearestFreshMonitor(POINT, [old, noPm25], ASOF)).toBeUndefined();
  });
});

describe('24-hour window', () => {
  it('counts only hours that ended in the last 24 hours, so an old hour cannot fill a gap', () => {
    const hours = [
      hour('2025-12-13T23:00:00.000Z', 500), // ends exactly 24 h before asOf: excluded
      hour('2025-12-14T23:00:00.000Z', 40), // ends at asOf: included
    ];
    expect(window24h(hours, '2025-12-15T00:00:00.000Z').pm25).toEqual([40]);
  });
});
