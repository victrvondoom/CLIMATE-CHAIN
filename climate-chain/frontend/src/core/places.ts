import { CITIES, type CityKey } from '../api';
import type { Place } from '../modules/earth/environment';

// Shared place context. The topbar air location, the Earth globe, Air · AirPulse and the Climate
// Integrity Lab start from one selected place. A view offers another view for that place only
// when a real match exists: a AirPulse city or an Integrity Lab site within NEAR_KM of the point.

export const NEAR_KM = 50;

// Mirrors SITES in gateway/integrity-sources.mjs (public city-centre coordinates). The gateway
// test site-parity.test.mjs fails if the two lists drift apart.
export const INTEGRITY_SITES = [
  { id: 'new-delhi', label: 'New Delhi', lat: 28.6139, lng: 77.209 },
  { id: 'chennai', label: 'Chennai', lat: 13.0827, lng: 80.2707 },
] as const;
export type IntegritySiteId = typeof INTEGRITY_SITES[number]['id'];

const EARTH_RADIUS_KM = 6371.0088;
const radians = (degrees: number) => degrees * Math.PI / 180;

// Great-circle distance on a spherical Earth. Good to well under 1% at these distances.
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function placeForCity(city: CityKey): Place {
  const { name, lat, lng } = CITIES[city];
  return { name: `${name}, India`, lat, lng };
}

export function nearestCity(place: { lat: number; lng: number }, maxKm = NEAR_KM): { key: CityKey; name: string; distanceKm: number } | null {
  let best: { key: CityKey; name: string; distanceKm: number } | null = null;
  for (const key of Object.keys(CITIES) as CityKey[]) {
    const distance = distanceKm(place, CITIES[key]);
    if (distance <= maxKm && (!best || distance < best.distanceKm)) best = { key, name: CITIES[key].name, distanceKm: distance };
  }
  return best;
}

export function nearestIntegritySite(place: { lat: number; lng: number }, maxKm = NEAR_KM): { id: IntegritySiteId; label: string; distanceKm: number } | null {
  let best: { id: IntegritySiteId; label: string; distanceKm: number } | null = null;
  for (const site of INTEGRITY_SITES) {
    const distance = distanceKm(place, site);
    if (distance <= maxKm && (!best || distance < best.distanceKm)) best = { id: site.id, label: site.label, distanceKm: distance };
  }
  return best;
}

export function integritySiteForCity(city: CityKey): IntegritySiteId | null {
  return nearestIntegritySite(CITIES[city])?.id ?? null;
}

// AirPulse answers a coordinate query with the generic name "Your location". When the query was a
// selected city, the city name is the accurate label for that point.
export function airPlaceName(sourceName: string | null | undefined, cityName: string): string {
  return !sourceName || sourceName.trim().toLowerCase() === 'your location' ? cityName : sourceName;
}
