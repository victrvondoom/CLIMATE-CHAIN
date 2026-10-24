import { createHash } from 'node:crypto';

export const CASCADE_SCHEMA_VERSION = 1;
export const DEFAULT_CASCADE_THRESHOLDS = Object.freeze({ radiusKm: 5, timeWindowHours: 24 });

export function parseThreshold(value, fallback, maximum) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > maximum) return null;
  return parsed;
}

export function validPoint(point) {
  return Boolean(
    point && Number.isFinite(point.lat) && Number.isFinite(point.lng) &&
    point.lat >= -90 && point.lat <= 90 && point.lng >= -180 && point.lng <= 180,
  );
}

function parsedTime(value) {
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashEvidence(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

/**
 * Assess a single JunkSnap site against the nearest Vayu monitor response for
 * that site's query point. The monitor's coordinates are not returned by this
 * route, so this is a bounded proximity lead, never a causal attribution.
 */
export function assessCascade({ site, air, wasteMode, airUpstreamMode, sourceUrls = {}, thresholds = DEFAULT_CASCADE_THRESHOLDS, capturedAt = new Date().toISOString() }) {
  const prov = air?.provenance ?? null;
  const siteTime = parsedTime(site?.lastReportedAt);
  const airTime = parsedTime(prov?.observedAt);
  const capturedTime = parsedTime(capturedAt);
  const temporalGapHours = siteTime == null || airTime == null ? null : Math.abs(siteTime - airTime) / 3_600_000;
  const siteAgeHours = siteTime == null || capturedTime == null ? null : (capturedTime - siteTime) / 3_600_000;
  const airAgeHours = airTime == null || capturedTime == null ? null : (capturedTime - airTime) / 3_600_000;
  const distanceKm = Number.isFinite(prov?.distanceKm) ? prov.distanceKm : null;
  const sourceEligible = wasteMode === 'live' && airUpstreamMode === 'live' &&
    ['live', 'measured'].includes(prov?.mode) && prov?.source === 'station' &&
    typeof prov?.stationName === 'string' && prov.stationName.length > 0 &&
    Number.isFinite(air?.pm25Now) && air.pm25Now >= 0 && prov?.simulated !== true;
  const spatialEligible = distanceKm == null ? null : distanceKm <= thresholds.radiusKm;
  const temporalEligible = temporalGapHours == null || siteAgeHours == null || airAgeHours == null
    ? null
    : temporalGapHours <= thresholds.timeWindowHours &&
      siteAgeHours >= 0 && airAgeHours >= 0 &&
      siteAgeHours <= thresholds.timeWindowHours && airAgeHours <= thresholds.timeWindowHours;
  const coverageDimensions = {
    observedSources: sourceEligible,
    monitorDistance: spatialEligible !== null,
    reportAndReadingTimes: temporalEligible !== null,
  };
  const availableDimensions = Object.values(coverageDimensions).filter(Boolean).length;
  const coverage = {
    score: Math.round((availableDimensions / 3) * 100),
    availableDimensions,
    totalDimensions: 3,
    dimensions: coverageDimensions,
    meaning: 'Evidence availability only; it does not score threshold success, accuracy, causality, emissions or climate impact.',
  };

  let status = 'not_evaluable';
  if (!validPoint(site)) status = 'missing_location';
  else if (site.status !== 'open') status = 'site_not_open';
  else if (!sourceEligible) status = 'source_not_observed';
  else if (spatialEligible === null) status = 'missing_spatial_provenance';
  else if (!spatialEligible) status = 'outside_radius';
  else if (temporalEligible === null) status = 'missing_time_provenance';
  else if (!temporalEligible) status = 'outside_time_window';
  else status = 'ready_for_human_review';

  const assessment = {
    status,
    candidate: status === 'ready_for_human_review',
    relationship: 'spatiotemporal_proximity_lead',
    causality: 'not_assessed',
    thresholds: { ...thresholds },
    checks: {
      bothSourcesObserved: sourceEligible,
      nearestMonitorWithinRadius: spatialEligible,
      observationsWithinTimeWindow: temporalEligible,
    },
    coverage,
    proximity: {
      nearestMonitorDistanceKm: distanceKm,
      distanceMeaning: 'Vayu-reported distance from the rounded query point to its nearest monitor; monitor coordinates are not included in this response.',
      temporalGapHours: temporalGapHours == null ? null : Number(temporalGapHours.toFixed(2)),
      siteAgeHours: siteAgeHours == null ? null : Number(siteAgeHours.toFixed(2)),
      airAgeHours: airAgeHours == null ? null : Number(airAgeHours.toFixed(2)),
    },
    explanation: status === 'ready_for_human_review'
      ? 'A recent open waste-site report and a recent PM2.5 observation from a nearby Vayu monitor meet the configured proximity and time checks. This is a review lead; it does not show that the waste site caused the air reading.'
      : `No review lead was created (${status.replace(/_/g, ' ')}). Missing or ineligible evidence is left explicit.`,
  };

  const evidence = {
    schemaVersion: CASCADE_SCHEMA_VERSION,
    capturedAt,
    site: {
      source: 'JunkSnap',
      sourceUrl: sourceUrls.waste ?? null,
      sourceId: site?.id ?? null,
      status: site?.status ?? null,
      verification: site?.verification ?? null,
      reportCount: Number.isFinite(site?.reportCount) ? site.reportCount : null,
      firstReportedAt: site?.firstReportedAt ?? null,
      lastReportedAt: site?.lastReportedAt ?? null,
      location: validPoint(site) ? { lat: site.lat, lng: site.lng, precision: 'JunkSnap public site point' } : null,
      sourceMode: wasteMode,
    },
    air: {
      source: 'The Vayu Project',
      sourceUrl: sourceUrls.air ?? null,
      queryPlace: air?.place ?? null,
      pm25: Number.isFinite(air?.pm25Now) ? air.pm25Now : null,
      unit: 'µg/m³',
      provenance: prov,
      upstreamMode: airUpstreamMode,
    },
    assessment,
  };
  const payload = {
    schemaVersion: CASCADE_SCHEMA_VERSION,
    id: `cascade:${site?.id ?? 'unknown'}`,
    capturedAt,
    evidence,
  };
  const manifest = {
    ...payload,
    integrity: {
      algorithm: 'SHA-256',
      digest: hashEvidence(payload),
      scope: 'Canonical JSON serialization of this manifest without the integrity field.',
      limitation: 'A content hash detects changes relative to this digest; it does not provide independent or immutable storage.',
    },
  };

  return { assessment, evidence, manifest };
}
