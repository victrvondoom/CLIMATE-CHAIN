import { describe, expect, it } from 'vitest';
import { airPlaceName, distanceKm, integritySiteForCity, nearestCity, nearestIntegritySite, placeForCity } from './places';

describe('shared place context', () => {
  it('measures great-circle distance', () => {
    // New Delhi to Chennai is about 1,760 km by great circle.
    expect(distanceKm({ lat: 28.6139, lng: 77.209 }, { lat: 13.0827, lng: 80.2707 })).toBeGreaterThan(1740);
    expect(distanceKm({ lat: 28.6139, lng: 77.209 }, { lat: 13.0827, lng: 80.2707 })).toBeLessThan(1780);
    expect(distanceKm({ lat: 10, lng: 10 }, { lat: 10, lng: 10 })).toBe(0);
  });

  it('maps the Delhi air location to the New Delhi integrity site, and no other city', () => {
    expect(integritySiteForCity('delhi')).toBe('new-delhi');
    expect(integritySiteForCity('jodhpur')).toBeNull();
    expect(integritySiteForCity('chandigarh')).toBeNull();
  });

  it('offers a AirPulse city or an integrity site only within reach of the point', () => {
    expect(nearestCity({ lat: 28.65, lng: 77.1 })?.key).toBe('delhi');
    expect(nearestCity({ lat: 51.9225, lng: 4.4792 })).toBeNull();
    expect(nearestIntegritySite({ lat: 13.05, lng: 80.25 })?.id).toBe('chennai');
    expect(nearestIntegritySite({ lat: 26.2389, lng: 73.0243 })).toBeNull();
  });

  it('builds the place for a city', () => {
    expect(placeForCity('jodhpur')).toEqual({ name: 'Jodhpur, India', lat: 26.29, lng: 73.02 });
  });

  it('replaces the generic AirPulse label with the selected city, and keeps real names', () => {
    expect(airPlaceName('Your location', 'Delhi')).toBe('Delhi');
    expect(airPlaceName(null, 'Delhi')).toBe('Delhi');
    expect(airPlaceName('Anand Vihar', 'Delhi')).toBe('Anand Vihar');
  });
});
