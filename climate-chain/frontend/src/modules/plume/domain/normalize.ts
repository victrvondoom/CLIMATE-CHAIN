// Carbon Mapper record normalization, ported from PLUME backend/app/providers/carbonmapper.py
// (normalize_carbonmapper_with_reason) and backend/app/ingestion/pipeline.py (normalize_batch).
// A provider-hidden or non-positive emission is kept as unavailable and never estimated.

export interface RawPlume {
  id: string;
  plume_id: string;
  scene_id?: string | null;
  scene_timestamp: string;
  platform?: string | null;
  instrument: string | null;
  sector: string | null;
  gas: string;
  status?: string | null;
  plume_quality?: string | null;
  hide_emission?: boolean | null;
  emission_auto: number | null;
  emission_uncertainty_auto: number | null;
  geometry_json: { type: string; coordinates: number[] } | null;
}

export interface Observation {
  key: string; // Carbon Mapper record id
  plumeId: string;
  lon: number;
  lat: number;
  sector: string | null;
  instrument: string | null;
  observedAt: string; // ISO 8601, UTC
  rateKgH: number | null;
  uncertaintyKgH: number | null;
  flags: string[];
}

export interface Dropped {
  reason: string;
  id: string;
  plumeId: string;
}

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function emissionFacts(raw: RawPlume): { rateKgH: number | null; uncertaintyKgH: number | null; flags: string[] } {
  const flags: string[] = [];
  let rate = finite(raw.emission_auto);
  let unc = finite(raw.emission_uncertainty_auto);
  if (raw.hide_emission) {
    flags.push('emission_hidden_by_provider');
    rate = null;
    unc = null;
  }
  if (rate === null || rate <= 0) {
    if (rate !== null) flags.push('non_positive_emission_estimate');
    else if (!flags.includes('emission_hidden_by_provider')) flags.push('emission_estimate_unavailable');
    rate = null;
    unc = null;
  }
  if (unc !== null && unc < 0) {
    flags.push('negative_uncertainty_discarded');
    unc = null;
  }
  if (rate !== null && unc === null) flags.push('uncertainty_unavailable');
  if (rate !== null && unc !== null && unc > rate) flags.push('uncertainty_exceeds_estimate');
  return { rateKgH: rate, uncertaintyKgH: unc, flags };
}

// Returns the rejection reason, or null when the record is usable.
function rejection(raw: RawPlume): { reason: string; observation?: Observation } | null {
  if (raw.gas.toUpperCase() !== 'CH4') return { reason: 'not_methane' };
  if (raw.status != null && raw.status !== 'published') return { reason: 'not_published' };
  if (!raw.id || !raw.plume_id) return { reason: 'missing_identifier' };
  const ms = Date.parse(raw.scene_timestamp);
  if (Number.isNaN(ms)) return { reason: 'invalid_timestamp' };
  const coords = raw.geometry_json?.type === 'Point' ? raw.geometry_json.coordinates : null;
  if (!coords || coords.length < 2) return { reason: 'missing_point_geometry' };
  const [lon, lat] = coords;
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) {
    return { reason: 'invalid_coordinates' };
  }
  const emission = emissionFacts(raw);
  return {
    reason: '',
    observation: {
      key: raw.id,
      plumeId: raw.plume_id,
      lon,
      lat,
      sector: raw.sector,
      instrument: raw.instrument,
      observedAt: new Date(ms).toISOString(),
      rateKgH: emission.rateKgH,
      uncertaintyKgH: emission.uncertaintyKgH,
      flags: emission.flags,
    },
  };
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

// Drops records that fail validation, then re-issued copies: the same external id, or the
// same instrument, timestamp and origin (to 1e-4 degrees) under a different id.
export function normalizeBatch(raw: readonly RawPlume[]): { observations: Observation[]; dropped: Dropped[] } {
  const observations: Observation[] = [];
  const dropped: Dropped[] = [];
  const seenIds = new Set<string>();
  const seenDetections = new Set<string>();
  for (const r of raw) {
    const checked = rejection(r);
    if (!checked || !checked.observation) {
      dropped.push({ reason: checked?.reason ?? 'unknown', id: r.id, plumeId: r.plume_id });
      continue;
    }
    const obs = checked.observation;
    if (seenIds.has(obs.key)) {
      dropped.push({ reason: 'same_id', id: r.id, plumeId: r.plume_id });
      continue;
    }
    const detection = `${obs.instrument}|${obs.observedAt}|${round4(obs.lon)}|${round4(obs.lat)}`;
    if (seenDetections.has(detection)) {
      dropped.push({ reason: 'same_detection', id: r.id, plumeId: r.plume_id });
      continue;
    }
    seenIds.add(obs.key);
    seenDetections.add(detection);
    observations.push(obs);
  }
  return { observations, dropped };
}
