export interface Place { lat: number; lng: number; name: string }
export interface PlaceResult extends Place { id: string; country?: string | null; admin1?: string | null; timezone?: string | null }
export interface ModelProvenance {
  provider: string; product: string; dataKind: 'modelled'; measured: false; fetchedAt: string;
  modelTime: string | null; grid: { lat: number; lng: number } | null; sourceUrl: string;
  attribution: string; notes: string[] | string;
}
export interface ModelSource {
  status: 'available' | 'unavailable';
  current: Record<string, number | string | null> | null;
  hourly: { time: string[]; [key: string]: (number | string | null)[] } | null;
  units: { current: Record<string, string>; hourly: Record<string, string> };
  provenance: ModelProvenance;
  error: { code: string; message: string } | null;
}
export interface PlaceSnapshot {
  schema: string; requested: { lat: number; lng: number }; asOf: string;
  cache: { hit: boolean; expiresAt: string };
  weather: ModelSource; air: ModelSource;
  carbon: { status: 'available' | 'unavailable'; current: Record<string, string | number | null> | null; units: Record<string, string>; provenance: ModelProvenance; error: { code: string; message: string } | null };
}

async function readJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: 'no-store', headers: { accept: 'application/json' } });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message || `Place service returned HTTP ${response.status}.`);
  }
  return response.json() as Promise<T>;
}
export const fetchPlace = (place: Pick<Place, 'lat' | 'lng'>, signal?: AbortSignal) => readJson<PlaceSnapshot>(`/api/v1/place?${new URLSearchParams({ lat: String(place.lat), lng: String(place.lng) })}`, signal);
export const searchPlaces = (query: string, signal?: AbortSignal) => readJson<{ results: PlaceResult[]; asOf: string }>(`/api/v1/places/search?${new URLSearchParams({ q: query })}`, signal);

export function metric(source: ModelSource | PlaceSnapshot['carbon'] | undefined, name: string): number | null {
  const value = source?.status === 'available' ? source.current?.[name] : null;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
export function destination(place: Place, bearing: number, distanceKm: number): Place {
  const radians = Math.PI / 180;
  const lat = place.lat * radians;
  const lng = place.lng * radians;
  const direction = bearing * radians;
  const arc = distanceKm / 6371.0088;
  const newLat = Math.asin(Math.sin(lat) * Math.cos(arc) + Math.cos(lat) * Math.sin(arc) * Math.cos(direction));
  const newLng = lng + Math.atan2(Math.sin(direction) * Math.sin(arc) * Math.cos(lat), Math.cos(arc) - Math.sin(lat) * Math.sin(newLat));
  return { lat: newLat / radians, lng: ((newLng / radians + 540) % 360) - 180, name: `${distanceKm} km from ${place.name}` };
}
export function alignedDifference(a: PlaceSnapshot, b: PlaceSnapshot, field: string): { value: number | null; reason: string } {
  const left = metric(a.air, field); const right = metric(b.air, field);
  if (left === null || right === null) return { value: null, reason: 'A required model value is unavailable.' };
  if (!a.air.current?.time || a.air.current.time !== b.air.current?.time) return { value: null, reason: 'Model timestamps do not align.' };
  const unit = a.air.units.current[field];
  if (!unit || unit !== b.air.units.current[field]) return { value: null, reason: 'Model units do not align.' };
  if (a.air.provenance.product !== b.air.provenance.product) return { value: null, reason: 'Model products do not align.' };
  return { value: right - left, reason: `Downwind minus upwind model value (${unit}); spatial context, causality not assessed.` };
}
export function downloadEvidence(name: string, payload: unknown) {
  const href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = href; anchor.download = `${name}.json`; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}
