import { describe, expect, it } from 'vitest';
import { centroid, haversineM, spreadM } from './geo';

// Vectors from MethaneMend backend/tests/test_investigation_units.py.
describe('geodesy', () => {
  it('measures 0.001 degrees of latitude as about 111.2 m', () => {
    const d = haversineM({ lon: -102, lat: 32 }, { lon: -102, lat: 32.001 });
    expect(d).toBeGreaterThan(111.2 * 0.99);
    expect(d).toBeLessThan(111.2 * 1.01);
  });

  it('puts the centroid halfway between two points and reports their spread', () => {
    const pts = [
      { lon: -102, lat: 32 },
      { lon: -102, lat: 32.002 },
    ];
    const c = centroid(pts);
    expect(c.lat).toBeCloseTo(32.001, 6);
    expect(c.lon).toBeCloseTo(-102, 6);
    expect(spreadM(pts)).toBeGreaterThan(111.2 * 0.98);
    expect(spreadM(pts)).toBeLessThan(111.2 * 1.02);
  });

  it('has zero spread for a single point', () => {
    expect(spreadM([{ lon: -102, lat: 32 }])).toBe(0);
  });
});
