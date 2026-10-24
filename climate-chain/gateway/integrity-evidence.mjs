// Climate Integrity Lab: evidence records, canonical hashing and claim documents.
// Pure functions only; network and chain access live in integrity-sources.mjs and
// integrity-service.mjs.
//
// A SHA-256 digest proves which bytes were committed. It does not prove that a
// measurement is accurate, calibrated, observed rather than modelled, or causal.

import { createHash } from 'node:crypto';

export const CANONICALIZATION = 'climate-chain-canonical-json/v1';
export const BUNDLE_SCHEMA = 'climate-chain:evidence-bundle:v1';
export const CLAIM_SCHEMA = 'climate-chain:environmental-claim:v1';
export const CHALLENGE_SCHEMA = 'climate-chain:claim-challenge:v1';
export const METHOD_VERSION = 'climate-chain:integrity-lab:2026-10-23';
export const CLAIM_LABEL = 'DEMO / NOT A CERTIFIED CREDIT';
export const EVIDENCE_ID = /^ev-[a-f0-9]{24}$/;
export const CLAIM_ID = /^cl-[a-f0-9]{24}$/;
export const REASON_CODES = ['STALE_SOURCE', 'MODEL_NOT_OBSERVATION', 'INCONSISTENT_SOURCES', 'WRONG_UNIT', 'EVIDENCE_REUSED', 'CONFLICTING_REGISTRY', 'OTHER'];

export class IntegrityError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'IntegrityError';
    this.code = code;
    this.status = status;
  }
}

// climate-chain-canonical-json/v1
// - objects: keys sorted by UTF-16 code unit (JavaScript's default sort), no whitespace
// - arrays: order preserved
// - strings, booleans, null and finite numbers: JSON.stringify
// The byte output matches cascade.mjs hashEvidence for valid JSON input. Unlike that
// helper, it refuses undefined, NaN, Infinity, functions and non-plain objects, so two
// different inputs cannot collapse to the same canonical text.
export function canonicalJson(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new IntegrityError('non_finite_number', 'Canonical JSON cannot encode NaN or Infinity.');
      return JSON.stringify(value);
    case 'object': {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) throw new IntegrityError('unsupported_value', 'Canonical JSON accepts plain objects only.');
      return `{${Object.keys(value).sort().map((key) => {
        if (value[key] === undefined) throw new IntegrityError('undefined_value', `Field "${key}" is undefined; use null for a missing value.`);
        return `${JSON.stringify(key)}:${canonicalJson(value[key])}`;
      }).join(',')}}`;
    }
    default:
      throw new IntegrityError('unsupported_value', `Canonical JSON cannot encode a ${typeof value}.`);
  }
}

export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export const digestOf = (value) => sha256Hex(canonicalJson(value));

const WHO_2021 = {
  source: 'WHO global air quality guidelines (2021)',
  sourceUrl: 'https://www.who.int/publications/i/item/9789240034228',
  exceedanceBasis: 'Short-term AQG levels are 99th percentiles of the annual distribution, about 3 to 4 exceedance days a year. One day above the level is context, not a breach.',
};

// Chemical identity and interpretation for each Open-Meteo air variable. Guideline values
// are WHO 2021 air quality guideline levels with their averaging period; they are not
// legal limits in any jurisdiction.
export const ANALYTES = Object.freeze({
  pm2_5: {
    id: 'pm2_5', label: 'PM2.5', name: 'Fine particulate matter',
    identity: 'Mass of airborne particles with aerodynamic diameter of 2.5 µm or less. A size fraction, not a single chemical species.',
    relevance: 'Health: reaches deep into the lungs. Some components, such as black carbon and sulphate, also affect climate; PM2.5 mass alone does not quantify that effect.',
    distinctFrom: 'Not PM10 and not an emission rate.',
    guideline: { value: 15, unit: 'μg/m³', averaging: '24-hour mean', ...WHO_2021 },
  },
  pm10: {
    id: 'pm10', label: 'PM10', name: 'Coarse and fine particulate matter',
    identity: 'Mass of airborne particles with aerodynamic diameter of 10 µm or less, including PM2.5.',
    relevance: 'Health: deposits in the airways. Dust and road resuspension contribute strongly.',
    distinctFrom: 'Includes PM2.5; not an emission rate.',
    guideline: { value: 45, unit: 'μg/m³', averaging: '24-hour mean', ...WHO_2021 },
  },
  nitrogen_dioxide: {
    id: 'nitrogen_dioxide', label: 'NO₂', name: 'Nitrogen dioxide',
    identity: 'NO₂ gas, one of the nitrogen oxides (NOx) formed mainly in combustion.',
    relevance: 'Respiratory irritant; a precursor of ground-level ozone and secondary particles.',
    distinctFrom: 'Not N₂, the inert nitrogen that makes up most of the atmosphere, and not total NOx.',
    guideline: { value: 25, unit: 'μg/m³', averaging: '24-hour mean', ...WHO_2021 },
  },
  ozone: {
    id: 'ozone', label: 'O₃', name: 'Ground-level ozone',
    identity: 'O₃ near the surface (tropospheric ozone), formed from NOx and volatile organic compounds in sunlight.',
    relevance: 'Respiratory irritant and a short-lived climate forcer.',
    distinctFrom: 'Not the protective stratospheric ozone layer.',
    guideline: { value: 100, unit: 'μg/m³', averaging: '8-hour mean', ...WHO_2021 },
  },
  sulphur_dioxide: {
    id: 'sulphur_dioxide', label: 'SO₂', name: 'Sulphur dioxide',
    identity: 'SO₂ gas from burning sulphur-containing fuels and from smelting.',
    relevance: 'Respiratory irritant; forms sulphate aerosol, which tends to cool rather than warm. Not a greenhouse gas.',
    distinctFrom: 'Not sulphate aerosol and not a greenhouse gas.',
    guideline: { value: 40, unit: 'μg/m³', averaging: '24-hour mean', ...WHO_2021 },
  },
  carbon_monoxide: {
    id: 'carbon_monoxide', label: 'CO', name: 'Carbon monoxide',
    identity: 'CO gas from incomplete combustion.',
    relevance: 'Reduces oxygen transport in blood; influences climate only indirectly through atmospheric chemistry.',
    distinctFrom: 'Not CO₂. This is a concentration near the surface, not an emission of carbon dioxide.',
    guideline: { value: 4000, unit: 'μg/m³', averaging: '24-hour mean', note: 'WHO states 4 mg/m³; shown here in the source unit.', ...WHO_2021 },
  },
});

export const CAN_PROVE = [
  'These exact bytes existed when the digest was anchored, and they have not changed since if the digest still matches.',
  'Which provider, request URL, retrieval time and method version produced the bundle.',
  'Which evidence record a claim used, and which later record corrected it.',
];

export const CANNOT_PROVE = [
  'That the modelled concentration matches what a ground monitor would measure at this place and hour.',
  'Which source emitted the pollution. Concentration data does not attribute a cause.',
  'Any emission reduction, removal or avoided emission.',
  'That the provider data was correct before it was retrieved and hashed.',
];

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function assertAnalyte(analyte) {
  if (!Object.hasOwn(ANALYTES, analyte)) throw new IntegrityError('unknown_analyte', `Unknown analyte "${analyte}".`);
  return ANALYTES[analyte];
}

// Arithmetic mean of the focus analyte's last 24 hourly values. Missing values are
// excluded and counted, never filled in.
function deriveMean(measurements, analyte) {
  const series = measurements.filter((item) => item.analyte === analyte && item.series);
  const present = series.filter((item) => item.value !== null);
  if (present.length === 0) return null;
  const mean = present.reduce((sum, item) => sum + item.value, 0) / present.length;
  const definition = ANALYTES[analyte];
  const guideline = definition.guideline;
  const comparable = guideline.averaging === '24-hour mean' && present.length >= 18;
  return {
    derivedId: `mean24h:${analyte}`,
    basis: 'DERIVED_ESTIMATE',
    formula: 'Arithmetic mean of hourly model values at or before retrieval time; null hours excluded.',
    inputs: series.map((item) => item.measurementId),
    hoursUsed: present.length,
    hoursMissing: series.length - present.length,
    value: round(mean, 2),
    unit: series[0].unit,
    rounding: '2 decimal places, applied once in the gateway before hashing',
    guidelineComparison: comparable
      ? { guideline, exceeds: mean > guideline.value, note: 'Compares a modelled mean with a WHO guideline level. It is context, not a regulatory exceedance finding.' }
      : { guideline, exceeds: null, note: present.length < 18 ? 'Fewer than 18 of 24 hours available; no comparison made.' : `Guideline uses a ${guideline.averaging}; no comparison made with a 24-hour mean.` },
    limitations: ['Hourly values between 3-hourly model steps are interpolated by the provider, so the 24 values are not independent samples.'],
  };
}

function measurementsFrom(source, focusAnalyte, site) {
  const location = { lat: site.lat, lon: site.lon, crs: 'WGS84', precisionDecimals: 4 };
  const make = (analyte, point, series) => ({
    measurementId: `${analyte}@${point.validTimeUtc}`,
    analyte,
    basis: 'MODEL_FORECAST',
    measured: false,
    series,
    value: point.value,
    unit: source.units[analyte],
    validTimeUtc: point.validTimeUtc,
    heightAboveGroundM: 10,
    location,
    gridCell: source.sourceRecord.grid,
    missing: point.value === null ? 'NOT_PROVIDED_BY_SOURCE' : null,
    sourceId: source.sourceRecord.sourceId,
  });
  const measurements = source.series[focusAnalyte].slice(-24).map((point) => make(focusAnalyte, point, true));
  for (const analyte of Object.keys(source.series)) {
    if (analyte === focusAnalyte) continue;
    const latest = source.series[analyte].at(-1);
    if (latest) measurements.push(make(analyte, latest, false));
  }
  return measurements;
}

export function metadataOf(bundle) {
  return {
    schema: bundle.schema,
    methodVersion: bundle.methodVersion,
    claimType: bundle.claimType,
    evidenceId: bundle.evidenceId,
    parentEvidenceId: bundle.parentEvidenceId,
    focusAnalyte: bundle.focusAnalyte,
    siteId: bundle.location.siteId,
    timeframe: bundle.timeframe,
    sources: bundle.sources.map((item) => ({ sourceId: item.sourceId, dataKind: item.dataKind, retrievalMode: item.retrievalMode })),
  };
}

export const metadataHashOf = (bundle) => digestOf(metadataOf(bundle));

// Builds the evidence bundle and its identifiers. The evidence id is derived from the
// content without the id, and the digest covers the content including the id.
export function buildEvidenceBundle({ site, analyte, source, secondSource = null, parentEvidenceId = null, revisionNote = null }) {
  const definition = assertAnalyte(analyte);
  if (!source?.series?.[analyte]?.length) throw new IntegrityError('no_focus_values', `The source returned no ${definition.label} values at or before retrieval time.`, 422);
  if (parentEvidenceId !== null && !EVIDENCE_ID.test(parentEvidenceId)) throw new IntegrityError('invalid_parent', 'parentEvidenceId must be an ev- identifier or null.');
  const measurements = measurementsFrom(source, analyte, site);
  const focusTimes = measurements.filter((item) => item.series).map((item) => item.validTimeUtc);
  const derived = deriveMean(measurements, analyte);
  const record = source.sourceRecord;
  const included = [...new Set(measurements.map((item) => item.analyte))];

  const body = {
    schema: BUNDLE_SCHEMA,
    canonicalization: CANONICALIZATION,
    methodVersion: METHOD_VERSION,
    claimType: 'AIR_QUALITY_CONTEXT',
    parentEvidenceId,
    revisionNote,
    location: { siteId: site.id, label: site.label, lat: site.lat, lon: site.lon, crs: 'WGS84', precisionDecimals: 4, note: site.note },
    timeframe: { startUtc: focusTimes[0], endUtc: focusTimes.at(-1) },
    focusAnalyte: analyte,
    analyteDefinitions: included.map((id) => ANALYTES[id]),
    sources: [record],
    measurements,
    derived: derived ? [derived] : [],
    comparisons: [secondSource ?? {
      with: 'OpenAQ v3 observed station measurements',
      status: 'NOT_PERFORMED',
      reason: 'No observed station series was retrieved. A model value and a station value are compared only when both exist for the same place and hours.',
    }],
    uncertainty: [
      'Values are modelled near-surface concentrations for a grid cell, not measurements at this address.',
      `Spatial resolution: ${record.spatialResolution}. A city can contain several cells with different values.`,
      record.temporalResolution,
      record.freshness.stale ? `Stale: the newest value was ${record.freshness.ageHoursAtRetrieval} hours old at retrieval.` : `Newest value was ${record.freshness.ageHoursAtRetrieval} hours old at retrieval.`,
    ],
    canProve: CAN_PROVE,
    cannotProve: CANNOT_PROVE,
    custody: [
      { step: 'retrieved', at: record.retrievedAt, actor: 'gateway/integrity-sources.mjs', outputSha256: record.rawPayloadSha256 },
      { step: 'normalised', actor: 'gateway/integrity-sources.mjs', inputSha256: record.rawPayloadSha256, outputSha256: record.normalizedPayloadSha256 },
      { step: 'bundled', actor: 'gateway/integrity-evidence.mjs', methodVersion: METHOD_VERSION },
    ],
  };
  const evidenceId = `ev-${digestOf(body).slice(0, 24)}`;
  const bundle = { evidenceId, ...body };
  return { bundle, digest: digestOf(bundle), metadataHash: metadataHashOf(bundle) };
}

export function verifyBundle(bundle, expectedDigest) {
  const recomputedDigest = digestOf(bundle);
  return { recomputedDigest, matches: recomputedDigest === String(expectedDigest).replace(/^0x/, '').toLowerCase() };
}

// Returns a modified COPY of the bundle. The original is never touched.
export function tamperCopy(bundle) {
  const tampered = structuredClone(bundle);
  const index = tampered.measurements.findIndex((item) => item.value !== null);
  if (index < 0) throw new IntegrityError('nothing_to_tamper', 'The bundle has no numeric measurement to change.', 422);
  const before = tampered.measurements[index].value;
  const after = round(before + 0.1, 6);
  tampered.measurements[index].value = after;
  return { tampered, change: { path: `measurements[${index}].value`, measurementId: tampered.measurements[index].measurementId, before, after } };
}

// The exclusivity scope deliberately excludes evidence ids: swapping in different evidence
// must not let the same benefit be claimed twice for the same place, period and method.
export function claimScope(bundle, demoRun) {
  return {
    project: `demo-air-context:${bundle.location.siteId}:run-${demoRun}`,
    boundary: `Open-Meteo CAMS global grid cell nearest ${bundle.location.label}`,
    monitoringPeriod: bundle.timeframe.endUtc.slice(0, 10),
    methodology: METHOD_VERSION,
    benefitType: 'AIR_QUALITY_ADVISORY_INFORMATION',
    analyte: bundle.focusAnalyte,
  };
}

export const exclusivityKeyOf = (scope) => digestOf(scope);

function claimStatement(bundle) {
  const definition = ANALYTES[bundle.focusAnalyte];
  const derived = bundle.derived[0];
  if (!derived) return { statement: `No ${definition.label} values were available; no result is claimed.`, value: null, unit: null };
  const comparison = derived.guidelineComparison;
  const verdict = comparison.exceeds === true ? `above the ${comparison.guideline.source} ${comparison.guideline.averaging} level of ${comparison.guideline.value} ${comparison.guideline.unit}`
    : comparison.exceeds === false ? `at or below the ${comparison.guideline.source} ${comparison.guideline.averaging} level of ${comparison.guideline.value} ${comparison.guideline.unit}`
      : 'not compared with a guideline';
  return {
    statement: `Modelled ${derived.hoursUsed}-hour mean ${definition.label} for the ${bundle.location.label} grid cell was ${derived.value} ${derived.unit}, ${verdict}. Advisory information only, pending observed data.`,
    value: derived.value,
    unit: derived.unit,
  };
}

export function buildClaim({ bundle, digest, claimant, scope, supersedes = null, correctionNote = null, createdAt }) {
  if (supersedes !== null && !CLAIM_ID.test(supersedes)) throw new IntegrityError('invalid_supersedes', 'supersedes must be a cl- identifier or null.');
  const exclusivityKey = exclusivityKeyOf(scope);
  const body = {
    schema: CLAIM_SCHEMA,
    label: CLAIM_LABEL,
    createdAt,
    claimant: { account: claimant, role: 'Hardhat dev claimant account (internal test actor)' },
    scope,
    exclusivityKey,
    evidence: [{ evidenceId: bundle.evidenceId, digest }],
    result: { ...claimStatement(bundle), basis: 'DERIVED_ESTIMATE from MODEL_FORECAST' },
    baseline: 'None. This is an information claim. No emission reduction, removal or avoided emission is claimed.',
    creditable: false,
    verificationState: 'UNVERIFIED: recorded and reviewed only by internal test actors. No independent verifier.',
    externalRegistryReferences: [],
    supersedes,
    correctionNote,
  };
  const claimId = `cl-${digestOf(body).slice(0, 24)}`;
  const claim = { claimId, ...body };
  return { claim, claimHash: digestOf(claim), exclusivityKey };
}

export function buildChallenge({ claimId, challenger, reasonCode, detail, createdAt }) {
  if (!CLAIM_ID.test(claimId)) throw new IntegrityError('invalid_claim_id', 'claimId must be a cl- identifier.');
  if (!REASON_CODES.includes(reasonCode)) throw new IntegrityError('invalid_reason', `reasonCode must be one of ${REASON_CODES.join(', ')}.`);
  const text = typeof detail === 'string' ? detail.trim() : '';
  if (text.length < 10 || text.length > 600) throw new IntegrityError('invalid_detail', 'Describe the challenge in 10 to 600 characters.');
  const challenge = { schema: CHALLENGE_SCHEMA, claimId, challenger: { account: challenger, role: 'Hardhat dev challenger account (internal test actor)' }, reasonCode, detail: text, createdAt };
  return { challenge, reasonHash: digestOf(challenge) };
}

// Bounded next steps from the evidence itself. Deterministic: same bundle, same advice.
export function recommendNextSteps(bundle, { claimStatus = null } = {}) {
  const definition = ANALYTES[bundle.focusAnalyte];
  const source = bundle.sources[0];
  const derived = bundle.derived[0] ?? null;
  const steps = [{
    action: `Compare with a reference-grade station for the same hours (CPCB CAAQMS or OpenAQ) before acting on ${definition.label}.`,
    why: 'These values come from a 45 km model grid, not a monitor at this place.',
    evidenceNeeded: definition.id === 'pm2_5' || definition.id === 'pm10'
      ? 'Hourly readings from a gravimetric reference or an equivalent continuous monitor.'
      : definition.id === 'nitrogen_dioxide' ? 'Hourly readings from a chemiluminescence NO₂ analyser.' : 'Hourly readings from a reference-method analyser for this gas.',
  }];
  if (source.retrievalMode !== 'LIVE_FETCH' || source.freshness.stale) {
    steps.push({ action: 'Re-fetch live data before relying on this bundle.', why: source.retrievalMode !== 'LIVE_FETCH' ? 'This bundle uses a cached historical example.' : 'The newest value was more than 6 hours old at retrieval.', evidenceNeeded: 'A fresh retrieval with a new digest.' });
  }
  if (derived && derived.hoursMissing > 0) {
    steps.push({ action: `Resample: ${derived.hoursMissing} of 24 hours were missing.`, why: 'A mean over partial hours can misstate exposure.', evidenceNeeded: 'A complete 24-hour series.' });
  }
  if (derived?.guidelineComparison.exceeds) {
    steps.push({ action: 'Issue a precautionary, clearly model-based advisory for sensitive groups.', why: `The modelled mean is above the ${derived.guidelineComparison.guideline.source} level.`, evidenceNeeded: 'Observed data to confirm before any public health statement names a cause.' });
  }
  steps.push({
    action: 'Do not attribute this to a source or claim an impact yet.',
    why: 'Concentration does not identify which source emitted the pollution, and no baseline or counterfactual exists.',
    evidenceNeeded: 'Source apportionment or emission inventory data, a stated baseline, a monitoring plan and an independent verifier.',
  });
  if (claimStatus === 'Challenged') {
    steps.push({ action: 'Resolve the open challenge before using this claim.', why: 'A challenged claim is disputed.', evidenceNeeded: 'A reviewer decision or an approved correction.' });
  }
  return steps;
}
