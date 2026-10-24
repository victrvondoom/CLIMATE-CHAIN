export interface SupplySite {
  id: string;
  name: string;
  lat: number;
  lng: number;
  product: string;
  outputQuantity: number | null;
  outputUnit: string;
  energyKwh: number | null;
  gridKgCo2PerKwh?: number | null;
  processKgCo2e?: number | null;
  source: string;
  evidenceUpdatedAt: string;
}

export interface SupplyLeg {
  id: string;
  fromSiteId: string;
  toSiteId: string;
  massTonnes: number | null;
  transportFactorKgPerTonneKm?: number | null;
  source: string;
  evidenceUpdatedAt: string;
}

export interface SupplyNetwork { sites: SupplySite[]; legs: SupplyLeg[] }
export interface SupplyPlace { lat: number; lng: number; name: string }
export interface IncomingSupplySite { id: string; name: string; lat: number; lng: number; product?: string | null; sourceUrl: string; requestKey?: string }

export interface SiteFootprint {
  electricityKgCo2e: number | null;
  processKgCo2e: number | null;
  totalKgCo2e: number | null;
  knownSubtotalKgCo2e: number | null;
  intensityKgPerUnit: number | null;
  unknown: string[];
}
export interface LegFootprint { distanceKm: number | null; totalKgCo2e: number | null; unknown: string[] }
export interface NetworkFootprint { totalKgCo2e: number | null; knownSubtotalKgCo2e: number | null; unknownComponents: number; siteCount: number; legCount: number }

export const SUPPLY_STORAGE_KEY = 'climate-chain.supply-network.v1';
export const SUPPLY_METHOD_SOURCES = {
  electricity: 'https://ghgptechassistance.zendesk.com/hc/en-us/articles/37790958151700-How-do-I-calculate-emissions',
  freight: 'https://measuringemissionsguide.environment.govt.nz/8_freight.html',
};

function nonnegative(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function safeProduct(a: number, b: number): number | null { const result = a * b; return Number.isFinite(result) ? result : null; }

/** Spherical great-circle approximation. It is not a road, sea or air itinerary. */
export function haversineKm(from: Pick<SupplySite, 'lat' | 'lng'>, to: Pick<SupplySite, 'lat' | 'lng'>): number {
  if (![from.lat, from.lng, to.lat, to.lng].every(Number.isFinite) || Math.abs(from.lat) > 90 || Math.abs(to.lat) > 90 || Math.abs(from.lng) > 180 || Math.abs(to.lng) > 180) throw new Error('Coordinates must be finite and within latitude/longitude bounds.');
  const radians = Math.PI / 180;
  const dLat = (to.lat - from.lat) * radians;
  const dLng = (to.lng - from.lng) * radians;
  const arc = Math.sin(dLat / 2) ** 2 + Math.cos(from.lat * radians) * Math.cos(to.lat * radians) * Math.sin(dLng / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(Math.min(1, arc)), Math.sqrt(Math.max(0, 1 - arc)));
}

/** All values are user-declared; missing factors never silently become zero. */
export function calculateSiteFootprint(site: SupplySite): SiteFootprint {
  const unknown: string[] = [];
  if (!nonnegative(site.energyKwh)) unknown.push('Electricity use');
  if (!nonnegative(site.gridKgCo2PerKwh)) unknown.push('Electricity emission factor');
  if (!nonnegative(site.processKgCo2e)) unknown.push('Process emissions');
  const electricityKgCo2e = nonnegative(site.energyKwh) && nonnegative(site.gridKgCo2PerKwh) ? safeProduct(site.energyKwh, site.gridKgCo2PerKwh) : null;
  const processKgCo2e = nonnegative(site.processKgCo2e) ? site.processKgCo2e : null;
  if (nonnegative(site.energyKwh) && nonnegative(site.gridKgCo2PerKwh) && electricityKgCo2e === null) unknown.push('Electricity calculation exceeds numeric limits');
  const subtotal = (electricityKgCo2e ?? 0) + (processKgCo2e ?? 0);
  const knownSubtotalKgCo2e = Number.isFinite(subtotal) ? subtotal : null;
  if (!Number.isFinite(subtotal)) unknown.push('Subtotal exceeds numeric limits');
  const totalKgCo2e = unknown.length === 0 ? knownSubtotalKgCo2e : null;
  const intensity = totalKgCo2e !== null && nonnegative(site.outputQuantity) && site.outputQuantity > 0 && site.outputUnit.trim() ? totalKgCo2e / site.outputQuantity : null;
  return { electricityKgCo2e, processKgCo2e, totalKgCo2e, knownSubtotalKgCo2e, intensityKgPerUnit: intensity !== null && Number.isFinite(intensity) ? intensity : null, unknown };
}

export function calculateLegFootprint(leg: SupplyLeg, sites: SupplySite[]): LegFootprint {
  const from = sites.find((site) => site.id === leg.fromSiteId);
  const to = sites.find((site) => site.id === leg.toSiteId);
  const unknown: string[] = [];
  if (!from || !to) unknown.push('Route endpoints');
  if (!nonnegative(leg.massTonnes)) unknown.push('Freight mass');
  if (!nonnegative(leg.transportFactorKgPerTonneKm)) unknown.push('Transport emission factor');
  let distanceKm: number | null = null;
  if (from && to) { try { distanceKm = haversineKm(from, to); } catch { unknown.push('Valid endpoint coordinates'); } }
  const tonneKm = distanceKm !== null && nonnegative(leg.massTonnes) ? safeProduct(distanceKm, leg.massTonnes) : null;
  const result = tonneKm !== null && nonnegative(leg.transportFactorKgPerTonneKm) ? safeProduct(tonneKm, leg.transportFactorKgPerTonneKm) : null;
  if (unknown.length === 0 && result === null) unknown.push('Calculation exceeds numeric limits');
  return { distanceKm, totalKgCo2e: unknown.length === 0 ? result : null, unknown };
}

export function calculateNetworkFootprint(network: SupplyNetwork): NetworkFootprint {
  const sites = network.sites.map(calculateSiteFootprint);
  const legs = network.legs.map((leg) => calculateLegFootprint(leg, network.sites));
  const unknownComponents = sites.filter((site) => site.totalKgCo2e === null).length + legs.filter((leg) => leg.totalKgCo2e === null).length;
  const subtotal = sites.some((site) => site.knownSubtotalKgCo2e === null) ? Infinity : sites.reduce((sum, site) => sum + (site.knownSubtotalKgCo2e ?? 0), 0) + legs.reduce((sum, leg) => sum + (leg.totalKgCo2e ?? 0), 0);
  return {
    totalKgCo2e: sites.length > 0 && unknownComponents === 0 && Number.isFinite(subtotal) ? subtotal : null,
    knownSubtotalKgCo2e: Number.isFinite(subtotal) ? subtotal : null,
    unknownComponents: unknownComponents + (Number.isFinite(subtotal) ? 0 : 1),
    siteCount: sites.length, legCount: legs.length,
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string, required = false, limit = 500): string {
  if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) throw new Error(`${label} must be ${required ? 'a nonempty' : 'a'} string of at most ${limit} characters.`);
  return value.trim();
}
function quantity(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (!nonnegative(value)) throw new Error(`${label} must be a finite nonnegative number, or null for UNKNOWN.`);
  return value;
}
function timestamp(value: unknown, label: string): string {
  const text = value === undefined || value === null ? '' : string(value, label, false, 64);
  const parts = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(text);
  const validDay = parts ? Number(parts[2]) >= 1 && Number(parts[2]) <= 12 && Number(parts[3]) >= 1 && Number(parts[3]) <= new Date(Date.UTC(Number(parts[1]), Number(parts[2]), 0)).getUTCDate() : false;
  if (text && (!parts || !validDay || !Number.isFinite(Date.parse(text)))) throw new Error(`${label} must be a valid ISO timestamp with a timezone, or blank for UNKNOWN.`);
  return text ? new Date(text).toISOString() : '';
}

/** Import is atomic: any malformed record or dangling route rejects the whole document. */
export function parseSupplyNetwork(value: unknown): SupplyNetwork {
  const data = object(value, 'Supply network');
  if (data.schemaVersion !== undefined && data.schemaVersion !== 1) throw new Error('Unsupported supply-network schema version.');
  if (!Array.isArray(data.sites) || !Array.isArray(data.legs) || data.sites.length > 300 || data.legs.length > 1000) throw new Error('Supply network requires sites (up to 300) and legs (up to 1000) arrays.');
  const sites = data.sites.map((value, index): SupplySite => {
    const item = object(value, `Site ${index + 1}`);
    if (typeof item.lat !== 'number' || typeof item.lng !== 'number' || !Number.isFinite(item.lat) || !Number.isFinite(item.lng) || Math.abs(item.lat) > 90 || Math.abs(item.lng) > 180) throw new Error(`Site ${index + 1} has invalid coordinates.`);
    return {
      id: string(item.id, 'Site ID', true, 128), name: string(item.name, 'Site name', true, 160), lat: item.lat, lng: item.lng,
      product: string(item.product ?? '', 'Product', false, 160), outputQuantity: quantity(item.outputQuantity, 'Output quantity'), outputUnit: string(item.outputUnit ?? '', 'Output unit', false, 60),
      energyKwh: quantity(item.energyKwh, 'Electricity use'), gridKgCo2PerKwh: quantity(item.gridKgCo2PerKwh, 'Electricity emission factor'), processKgCo2e: quantity(item.processKgCo2e, 'Process emissions'),
      source: string(item.source ?? '', 'Source', false, 1000), evidenceUpdatedAt: timestamp(item.evidenceUpdatedAt, 'Site evidence timestamp'),
    };
  });
  const siteIds = new Set(sites.map((site) => site.id));
  if (siteIds.size !== sites.length) throw new Error('Site IDs must be unique.');
  const legs = data.legs.map((value, index): SupplyLeg => {
    const item = object(value, `Route leg ${index + 1}`);
    const fromSiteId = string(item.fromSiteId, 'Origin site ID', true, 128);
    const toSiteId = string(item.toSiteId, 'Destination site ID', true, 128);
    if (!siteIds.has(fromSiteId) || !siteIds.has(toSiteId) || fromSiteId === toSiteId) throw new Error(`Route leg ${index + 1} requires two distinct existing sites.`);
    return { id: string(item.id, 'Route leg ID', true, 128), fromSiteId, toSiteId, massTonnes: quantity(item.massTonnes, 'Freight mass'), transportFactorKgPerTonneKm: quantity(item.transportFactorKgPerTonneKm, 'Transport emission factor'), source: string(item.source ?? '', 'Route source', false, 1000), evidenceUpdatedAt: timestamp(item.evidenceUpdatedAt, 'Route evidence timestamp') };
  });
  if (new Set(legs.map((leg) => leg.id)).size !== legs.length) throw new Error('Route leg IDs must be unique.');
  return { sites, legs };
}
