import { describe, expect, it } from 'vitest';
import { calculateLegFootprint, calculateNetworkFootprint, calculateSiteFootprint, haversineKm, parseSupplyNetwork, type SupplyLeg, type SupplySite } from './supply';

// Synthetic arithmetic fixtures; these do not describe actual facilities or factors.
const site: SupplySite = { id: 'test-a', name: 'Arithmetic fixture A', lat: 0, lng: 0, product: 'test product', outputQuantity: 10, outputUnit: 'test units', energyKwh: 100, gridKgCo2PerKwh: 0.5, processKgCo2e: 5, source: 'Synthetic test input', evidenceUpdatedAt: '2026-10-23T00:00:00Z' };
const other: SupplySite = { ...site, id: 'test-b', name: 'Arithmetic fixture B', lng: 1 };
const leg: SupplyLeg = { id: 'leg-1', fromSiteId: site.id, toSiteId: other.id, massTonnes: 2, transportFactorKgPerTonneKm: 0.1, source: 'Synthetic test input', evidenceUpdatedAt: '' };

describe('entered supply carbon estimates', () => {
  it('multiplies explicit energy and factor, adds explicit process emissions, and normalizes positive output', () => {
    expect(calculateSiteFootprint(site)).toEqual({ electricityKgCo2e: 50, processKgCo2e: 5, totalKgCo2e: 55, knownSubtotalKgCo2e: 55, intensityKgPerUnit: 5.5, unknown: [] });
  });

  it('keeps missing factors unknown and reports the known process subtotal separately', () => {
    const result = calculateSiteFootprint({ ...site, gridKgCo2PerKwh: null });
    expect(result.totalKgCo2e).toBeNull();
    expect(result.electricityKgCo2e).toBeNull();
    expect(result.knownSubtotalKgCo2e).toBe(5);
    expect(result.intensityKgPerUnit).toBeNull();
    expect(result.unknown).toContain('Electricity emission factor');
  });

  it('does not silently assume process emissions are zero', () => {
    const result = calculateSiteFootprint({ ...site, processKgCo2e: undefined });
    expect(result.totalKgCo2e).toBeNull();
    expect(result.knownSubtotalKgCo2e).toBe(50);
    expect(result.unknown).toContain('Process emissions');
  });

  it('preserves documented zeros but never divides by a zero or unspecified output', () => {
    const zero = calculateSiteFootprint({ ...site, energyKwh: 0, gridKgCo2PerKwh: 0, processKgCo2e: 0, outputQuantity: 0 });
    expect(zero.totalKgCo2e).toBe(0);
    expect(zero.intensityKgPerUnit).toBeNull();
    expect(calculateSiteFootprint({ ...site, outputQuantity: null }).intensityKgPerUnit).toBeNull();
    expect(calculateSiteFootprint({ ...site, outputUnit: '' }).intensityKgPerUnit).toBeNull();
    expect(calculateSiteFootprint({ ...site, energyKwh: 0, gridKgCo2PerKwh: null }).totalKgCo2e).toBeNull();
  });

  it('keeps total unknown when a route factor is missing while retaining known facility components', () => {
    const result = calculateNetworkFootprint({ sites: [site, other], legs: [{ ...leg, transportFactorKgPerTonneKm: null }] });
    expect(result.totalKgCo2e).toBeNull();
    expect(result.knownSubtotalKgCo2e).toBe(110);
    expect(result.unknownComponents).toBe(1);
  });

  it('does not present an empty network as measured zero emissions', () => {
    expect(calculateNetworkFootprint({ sites: [], legs: [] })).toMatchObject({ totalKgCo2e: null, knownSubtotalKgCo2e: 0, siteCount: 0, legCount: 0 });
  });

  it('returns unknown instead of Infinity or a fabricated zero after numeric overflow', () => {
    const overflow = { ...site, energyKwh: 1e308, gridKgCo2PerKwh: 2, processKgCo2e: 0 };
    expect(calculateSiteFootprint(overflow)).toMatchObject({ totalKgCo2e: null, electricityKgCo2e: null, knownSubtotalKgCo2e: 0 });
    const subtotalOverflow = { ...site, energyKwh: 1e308, gridKgCo2PerKwh: 1, processKgCo2e: 1e308 };
    expect(calculateSiteFootprint(subtotalOverflow)).toMatchObject({ totalKgCo2e: null, knownSubtotalKgCo2e: null });
    expect(calculateNetworkFootprint({ sites: [subtotalOverflow], legs: [] }).knownSubtotalKgCo2e).toBeNull();
  });
});

describe('geographic freight approximation', () => {
  it('uses a great-circle distance for mass × kilometres × the entered transport factor', () => {
    const result = calculateLegFootprint(leg, [site, other]);
    expect(result.distanceKm).toBeCloseTo(111.19508, 4);
    expect(result.totalKgCo2e).toBeCloseTo(22.239016, 4);
    expect(result.unknown).toEqual([]);
    expect(calculateNetworkFootprint({ sites: [site, other], legs: [leg] }).totalKgCo2e).toBeCloseTo(132.239016, 4);
  });

  it('crosses the antimeridian by the short great-circle arc and remains symmetric', () => {
    const a = { lat: 0, lng: 179 };
    const b = { lat: 0, lng: -179 };
    expect(haversineKm(a, b)).toBeCloseTo(222.39016, 4);
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 10);
    expect(haversineKm(a, a)).toBe(0);
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 })).toBeCloseTo(20015.114, 2);
  });

  it('keeps missing freight mass, factors and endpoints explicit', () => {
    expect(calculateLegFootprint({ ...leg, massTonnes: null }, [site, other])).toMatchObject({ totalKgCo2e: null, unknown: ['Freight mass'] });
    expect(calculateLegFootprint({ ...leg, transportFactorKgPerTonneKm: undefined }, [site, other]).totalKgCo2e).toBeNull();
    expect(calculateLegFootprint(leg, [site])).toMatchObject({ distanceKm: null, totalKgCo2e: null, unknown: ['Route endpoints'] });
    expect(() => haversineKm({ lat: NaN, lng: 0 }, other)).toThrow('Coordinates');
  });
});

describe('atomic supply-network validation', () => {
  it('normalizes optional unknown values, trims fields, and converts timestamps without inventing sources', () => {
    const result = parseSupplyNetwork({ schemaVersion: 1, sites: [{ id: ' x ', name: ' User site ', lat: 0, lng: 180 }], legs: [] });
    expect(result.sites[0]).toMatchObject({ id: 'x', name: 'User site', outputQuantity: null, outputUnit: '', energyKwh: null, gridKgCo2PerKwh: null, processKgCo2e: null, source: '', evidenceUpdatedAt: '' });
    expect(parseSupplyNetwork({ sites: [site], legs: [] }).sites[0].evidenceUpdatedAt).toBe('2026-10-23T00:00:00.000Z');
  });

  it.each([NaN, Infinity, -Infinity, 91, '12'])('rejects malformed latitude %s', (lat) => {
    expect(() => parseSupplyNetwork({ sites: [{ ...site, lat }], legs: [] })).toThrow('coordinates');
  });

  it.each([-1, Infinity, '10', {}])('rejects nonnumeric or negative activity %s', (energyKwh) => {
    expect(() => parseSupplyNetwork({ sites: [{ ...site, energyKwh }], legs: [] })).toThrow('finite nonnegative');
  });

  it('rejects duplicate identities, dangling routes and self routes without partial acceptance', () => {
    expect(() => parseSupplyNetwork({ sites: [site, { ...other, id: site.id }], legs: [] })).toThrow('Site IDs must be unique');
    expect(() => parseSupplyNetwork({ sites: [site], legs: [leg] })).toThrow('two distinct existing sites');
    expect(() => parseSupplyNetwork({ sites: [site, other], legs: [{ ...leg, toSiteId: site.id }] })).toThrow('two distinct existing sites');
    expect(() => parseSupplyNetwork({ sites: [site, other], legs: [leg, leg] })).toThrow('Route leg IDs must be unique');
  });

  it.each(['2026-02-30T00:00:00Z', '2026-10-23T00:00:00', 'yesterday'])('rejects ambiguous or invalid evidence timestamps %s', (evidenceUpdatedAt) => {
    expect(() => parseSupplyNetwork({ sites: [{ ...site, evidenceUpdatedAt }], legs: [] })).toThrow('valid ISO timestamp');
  });

  it('rejects unsupported schemas and bounds collection sizes', () => {
    expect(() => parseSupplyNetwork({ schemaVersion: 2, sites: [], legs: [] })).toThrow('schema version');
    expect(() => parseSupplyNetwork({ sites: Array.from({ length: 301 }, (_, index) => ({ ...site, id: String(index) })), legs: [] })).toThrow('up to 300');
  });
});
