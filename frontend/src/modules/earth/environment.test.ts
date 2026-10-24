import { describe, expect, it } from 'vitest';
import { alignedDifference, destination, metric, type PlaceSnapshot } from './environment';

const snapshot = (value: number | null, time = '2026-10-23T04:00:00Z', unit = 'µg/m³') => ({ air: { status: 'available', current: { time, pm2_5: value }, units: { current: { pm2_5: unit } }, provenance: { product: 'air-quality' } } }) as unknown as PlaceSnapshot;
describe('place model comparison', () => {
  it('compares only matching valid times, units, and products', () => {
    expect(alignedDifference(snapshot(18), snapshot(23), 'pm2_5').value).toBe(5);
    expect(alignedDifference(snapshot(18), snapshot(23, '2026-10-23T05:00:00Z'), 'pm2_5').value).toBeNull();
    expect(alignedDifference(snapshot(18), snapshot(23, undefined, 'mg/m³'), 'pm2_5').value).toBeNull();
    const other = snapshot(23); other.air.provenance.product = 'different-model';
    expect(alignedDifference(snapshot(18), other, 'pm2_5').value).toBeNull();
  });
  it('retains unknown or unavailable values rather than coercing zero', () => {
    expect(metric(snapshot(null).air, 'pm2_5')).toBeNull();
    const unavailable = snapshot(99); unavailable.air.status = 'unavailable';
    expect(alignedDifference(snapshot(18), unavailable, 'pm2_5').value).toBeNull();
    expect(metric(snapshot(0).air, 'pm2_5')).toBe(0);
  });
  it('handles wind bearings and wraps dateline longitudes', () => {
    const north = destination({ lat: 0, lng: 0, name: 'origin' }, 0, 111.195);
    expect(north.lat).toBeCloseTo(1, 3); expect(north.lng).toBeCloseTo(0, 3);
    const east = destination({ lat: 0, lng: 179.9, name: 'origin' }, 90, 100);
    expect(east.lng).toBeLessThan(-179); expect(east.lat).toBeCloseTo(0, 3);
  });
});
