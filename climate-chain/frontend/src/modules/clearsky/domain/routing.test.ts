import { describe, expect, it } from 'vitest';
import { balersInRange, fits, haversineKm, offsetPoint, routeToBaler, type Baler, type FieldSite } from './routing';

// Rules and vectors from backend/src/clearsky/domain/matching.py and backend/tests/test_matching.py.
const BASE = { lat: 30.0, lng: 76.0 };
const TODAY = '2026-10-20';
const field = (over: Partial<FieldSite> = {}): FieldSite => ({
  acres: 10,
  lat: BASE.lat,
  lng: BASE.lng,
  harvestDate: '2026-10-19',
  sowingDeadline: '2026-10-25',
  ...over,
});
const baler = (id: string, eastKm: number, over: Partial<Baler> = {}): Baler => {
  const [lat, lng] = offsetPoint(BASE.lat, BASE.lng, 0, eastKm);
  return { id, lat, lng, acresPerDay: 15, radiusKm: 20, active: true, ...over };
};

describe('distance and reach', () => {
  it('measures great-circle distance in km', () => {
    expect(haversineKm(BASE.lat, BASE.lng, BASE.lat, BASE.lng)).toBe(0);
    const [lat, lng] = offsetPoint(BASE.lat, BASE.lng, 0, 2);
    expect(haversineKm(BASE.lat, BASE.lng, lat, lng)).toBeCloseTo(2, 1);
  });

  it('keeps only active balers whose radius covers the field', () => {
    const balers = [baler('near', 2), baler('far', 30), baler('off', 1, { active: false })];
    expect(balersInRange(field(), balers).map(([b]) => b.id)).toEqual(['near']);
  });
});

describe('capacity', () => {
  it('a field fits when the day has room for it', () => {
    expect(fits(10, 15, 0)).toBe(true);
    expect(fits(10, 15, 5)).toBe(true);
    expect(fits(10, 15, 10)).toBe(false);
  });

  it('a field bigger than a whole day only fits an empty day', () => {
    expect(fits(20, 15, 0)).toBe(true);
    expect(fits(20, 15, 1)).toBe(false);
  });
});

describe('routing to a baler', () => {
  it('picks the nearest baler when all else is equal', () => {
    const route = routeToBaler(field(), [baler('B_FAR', 8), baler('B_NEAR', 2)], {}, {}, TODAY);
    expect(route?.balerId).toBe('B_NEAR');
  });

  it('respects capacity: a full day is skipped and the next day is chosen', () => {
    const route = routeToBaler(field(), [baler('B1', 0)], { B1: { '2026-10-21': 10 } }, {}, TODAY);
    expect(route?.day).toBe('2026-10-22');
  });

  it('sends the field to another baler when it is closer than the one-day delay penalty', () => {
    const balers = [baler('B1', 0), baler('B2', 1)];
    const route = routeToBaler(field(), balers, { B1: { '2026-10-21': 10 } }, {}, TODAY);
    expect(route?.balerId).toBe('B2');
    expect(route?.day).toBe('2026-10-21');
  });

  it('prefers a day the baler already has a stop in the village', () => {
    const route = routeToBaler(field(), [baler('B_NEAR', 3), baler('B_CLUSTER', 5)], {}, { B_CLUSTER: ['2026-10-22'] }, TODAY);
    expect(route).toMatchObject({ balerId: 'B_CLUSTER', day: '2026-10-22', cluster: true });
  });

  it('returns null when no baler has room in the booking window', () => {
    expect(routeToBaler(field({ harvestDate: '2026-10-24', sowingDeadline: '2026-10-25' }), [baler('B1', 0)], {}, {}, TODAY)).toBeNull();
    expect(routeToBaler(field(), [baler('B1', 0)], { B1: { '2026-10-21': 15, '2026-10-22': 15, '2026-10-23': 15 } }, {}, TODAY)).toBeNull();
  });
});
