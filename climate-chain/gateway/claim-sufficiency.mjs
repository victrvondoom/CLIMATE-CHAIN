// Claim-type-aware evidence sufficiency for the Trust Firewall (v2).
//
// The v1 rules ask "is this evidence well-formed, fresh and of the right *kind* for this claim tier?".
// They never asked "does this evidence actually support THIS claim?". A perfectly formed PM2.5 bundle
// could back an "avoided 5,000 tCO2e of methane" claim. This module closes that gap with declarative,
// claim-subtype profiles (methane response, livestock traceability, air quality) and adds overlap-safe
// duplicate detection (activity synonyms, nested time periods, nearby coordinates, re-wrapped evidence).
//
// Trust boundary (also stated in docs/THREAT_MODEL.md): every check here is a deterministic policy over the
// SUBMITTED bundle. None of them can prove the bundle came from the physical world. See KNOWN_LIMITATIONS.
// Inputs are untrusted: every accessor tolerates missing, mistyped or hostile values and fails closed.

import { sha256Hex } from './integrity-evidence.mjs';

export const CLAIM_SUBTYPES = Object.freeze({
  METHANE_RESPONSE: 'methane-response',
  LIVESTOCK_TRACEABILITY: 'livestock-traceability',
  AIR_QUALITY: 'air-quality',
});

// Statements about what the firewall cannot do. Surfaced in receipts, the API and the docs.
export const KNOWN_LIMITATIONS = Object.freeze([
  'Authenticity: a fabricated bundle that is internally consistent, names an allow-listed source and carries its own correct digest is accepted. The firewall checks the bundle, not the sensor; only an anchored attestation or a re-fetch from the upstream source can close this.',
  'Overlap detection uses slugs, nearby-coordinate cells and period intervals within ONE registry. Claims made in other registries, other chains or with deliberately different coordinates are not visible.',
  'Methodology checks compare a recognised-name allow-list; they do not audit the methodology itself.',
  'Plausibility is an empirical climatology envelope built from modelled/reanalysis data for six cities; it says a value is unusual, not that it is false, and is silent outside those cities.',
]);

export const MAX_PERIOD_HOURS = 8760; // a claimed averaging/credit period is never longer than a year
export const MAX_MEASUREMENTS = 5000;

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
export const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Array of plain objects only: drops null, primitives and nested arrays. */
export const objectsOf = (v) => (Array.isArray(v) ? v.filter(isObject) : []);

// "ModelEstimate" -> MODEL_ESTIMATE, "ground-station observed" -> GROUND_STATION_OBSERVED
export const token = (s) => String(s ?? '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const words = (s) => new Set(token(s).split('_').filter(Boolean));
const compact = (s) => token(s).replace(/_/g, '');
export const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null));
const claimantOf = (claim) => claim?.claimant?.account ?? claim?.claimant;
/** A claimant-supplied averaging period is honoured only when finite, positive and at most a year. */
export const boundedPeriodHours = (v) => {
  const n = num(v);
  return n !== null && n > 0 && n <= MAX_PERIOD_HOURS ? n : null;
};

const MODEL_WORDS = new Set([
  'MODEL', 'MODELS', 'MODELLED', 'MODELED', 'MODELLING', 'MODELING', 'FORECAST', 'FORECASTS', 'SIMULATED', 'SIMULATION',
  'SYNTHETIC', 'ESTIMATE', 'ESTIMATES', 'ESTIMATED', 'ESTIMATION', 'DERIVED', 'REANALYSIS', 'SCENARIO', 'PROJECTION',
  'PROJECTED', 'PREDICTIVE', 'PREDICTED', 'UNOBSERVED', 'MOCK', 'FAKE', 'PROXY', 'IMPUTED', 'ASSUMED', 'ASSUMPTION',
  'INTERPOLATED', 'EXTRAPOLATED', 'NOT', 'NON', 'UNMEASURED', 'UNVERIFIED',
]);
export function isModelLike(...labels) {
  return labels.some((label) => [...words(label)].some((w) => MODEL_WORDS.has(w)));
}

const OBSERVED_BASES = new Set([
  'OBSERVED_MONITOR', 'SATELLITE_MEASURED', 'AIRBORNE_MEASURED', 'COMMUNITY_REPORT', 'OPTICAL_GAS_IMAGING',
  'REMOTE_SENSING_RETRIEVAL', 'RETRIEVAL',
]);
const OBSERVED_KIND_WORDS = new Set(['OBSERVED', 'MEASURED', 'RETRIEVAL']);
/** Whole-token test: negations and model words veto ("UNOBSERVED_MODEL_ESTIMATE", "NOT_MEASURED"). */
export function isObservedBasis(basis, dataKind) {
  if (isModelLike(basis, dataKind)) return false;
  if (OBSERVED_BASES.has(token(basis))) return true;
  return [...words(dataKind)].some((w) => OBSERVED_KIND_WORDS.has(w));
}

const METHODOLOGIES = ['EPA_SUBPART_W', 'SUBPART_W', 'OGMP', 'IPCC', 'GHG_PROTOCOL', 'VERRA', 'GOLD_STANDARD', 'ISO_14064', 'CDM', 'ACR'];
/** Whole-token phrase match; a negation anywhere ("Not IPCC") vetoes it. */
export function isRecognisedMethodology(text) {
  const t = token(text);
  if (!t || t.length > 200 || [...words(t)].some((w) => w === 'NOT' || w === 'NON' || w === 'NO')) return false;
  const padded = `_${t}_`;
  return METHODOLOGIES.some((m) => padded.includes(`_${m}_`));
}

export function distanceKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function pointOf(...candidates) {
  for (const c of candidates) {
    if (!isObject(c)) continue;
    const lat = num(c.lat);
    const lon = num(c.lon);
    if (lat !== null && lon !== null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) return { lat, lon };
  }
  return null;
}

// ---------------------------------------------------------------- overlap-safe exclusivity (fixes B1-B5)

const DOMAIN_CLASSES = [
  ['METHANE', ['methane', 'ch4']],
  ['AIR_QUALITY', ['air', 'pm2', 'pm10', 'aerosol', 'smog']],
  ['CARBON', ['carbon', 'co2', 'offset']],
  ['FIRE', ['fire', 'burn', 'stubble', 'straw']],
  ['LIVESTOCK', ['livestock', 'cattle', 'herd', 'bovine']],
];
const ACTIVITY_CLASSES = [
  ['LEAK_REPAIR', ['leak', 'repair', 'fugitive', 'abate']],
  ['MONITORING', ['monitor', 'observ', 'measure']],
];
// Whole-word match; keys of 4+ characters also match as a word prefix ("abate" matches "abatement").
// "air" must be a word of its own, so "repair" is not air quality.
function classOf(value, table, fallback) {
  const raw = String(value ?? '').toLowerCase();
  if (!raw.trim()) return fallback;
  const ws = raw.split(/[^a-z0-9]+/).filter(Boolean);
  for (const [name, keys] of table) {
    if (keys.some((k) => ws.some((w) => w === k || (k.length >= 4 && w.startsWith(k))))) return name;
  }
  return token(raw).slice(0, 80) || fallback;
}

const validDate = (y, m, d) => {
  const t = Date.UTC(y, m - 1, d);
  const x = new Date(t);
  return y >= 1900 && m >= 1 && m <= 12 && d >= 1 && x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? t : null;
};

/**
 * Parses 2026 | 2026-Q4 | 2026-10 | 2026-10-24 | "start/end" into a [startMs, endMs) interval, or null when the text is not
 * a recognised, valid period. Range ends that are plain dates are inclusive.
 */
export function periodInterval(epoch) {
  const s = String(epoch ?? '').trim();
  if (s.length > 64) return null;
  let m;
  if ((m = /^(\d{4})$/.exec(s))) return +m[1] >= 1900 ? [Date.UTC(+m[1], 0, 1), Date.UTC(+m[1] + 1, 0, 1)] : null;
  if ((m = /^(\d{4})-Q([1-4])$/i.exec(s))) return +m[1] >= 1900 ? [Date.UTC(+m[1], (+m[2] - 1) * 3, 1), Date.UTC(+m[1], +m[2] * 3, 1)] : null;
  if ((m = /^(\d{4})-(\d{2})$/.exec(s))) {
    const start = validDate(+m[1], +m[2], 1);
    return start === null ? null : [start, Date.UTC(+m[1], +m[2], 1)];
  }
  if ((m = /^(\d{4})-(\d{2})-(\d{2})(?:T[0-9:.]+Z?)?$/.exec(s))) {
    const start = validDate(+m[1], +m[2], +m[3]);
    return start === null ? null : [start, start + 86_400_000];
  }
  if (s.includes('/')) {
    const [a, b] = s.split('/');
    const lo = periodInterval(a);
    const hi = periodInterval(b);
    return lo && hi && hi[1] > lo[0] ? [lo[0], hi[1]] : null;
  }
  return null;
}

export function overlapProfile(scope = {}, point = null) {
  const sc = isObject(scope) ? scope : {};
  const epoch = String(sc.monitoringPeriod || sc.timeEpoch || sc.date || '').trim();
  return {
    domain: classOf(sc.domain || sc.benefitType, DOMAIN_CLASSES, 'ENVIRONMENTAL'),
    activity: classOf(sc.activityType || sc.analyte, ACTIVITY_CLASSES, 'UNSPECIFIED'),
    site: compact(sc.boundary || sc.gridCell || sc.siteId || '').slice(0, 160),
    epoch,
    interval: periodInterval(epoch),
    point,
  };
}

/** True when two claim scopes describe the same activity class at the same place over intersecting (or unknowable) time. */
export function scopesOverlap(a, b) {
  if (a.domain !== b.domain || a.activity !== b.activity) return false;
  const sameSite = (a.site && b.site && a.site === b.site)
    || (a.point && b.point && Math.abs(a.point.lat - b.point.lat) <= 0.05 && Math.abs(a.point.lon - b.point.lon) <= 0.05);
  if (!sameSite) return false;
  // An unparseable period cannot be shown disjoint, so it is treated as overlapping (fail closed).
  if (!a.interval || !b.interval) return true;
  return a.interval[0] < b.interval[1] && b.interval[0] < a.interval[1];
}

/** Content fingerprints survive wrapper-field edits that change the evidence digest. Values and times are normalised. */
export function evidenceFingerprints(evidence) {
  const sourceless = []; // the source label is deliberately NOT part of the fingerprint: relabelling must not evade it
  for (const m of objectsOf(evidence?.measurements).slice(0, MAX_MEASUREMENTS)) {
    const value = num(m.value);
    if (value === null) continue;
    const t = Date.parse(m.validTimeUtc);
    const when = Number.isFinite(t) ? new Date(t).toISOString() : String(m.validTimeUtc ?? '');
    sourceless.push(sha256Hex(`${token(m.analyte)}|${when}|${value}`).slice(0, 32));
  }
  return sourceless;
}

export function animalIdsOf(evidence) {
  const t = evidence?.traceability;
  if (!isObject(t)) return [];
  const raw = Array.isArray(t.animalIds) ? t.animalIds : (Array.isArray(t.animals) ? t.animals.map((a) => (isObject(a) ? a.id : a)) : []);
  return raw.map((x) => token(x)).filter(Boolean);
}

// ---------------------------------------------------------------- sufficiency profiles

const RULE = 'CLAIM_TYPE_EVIDENCE_SUFFICIENCY';
const fail = (code, reason, extra = {}) => ({ passed: false, ruleId: RULE, code, reason, ...extra });
const unknown = (code, reason) => fail(code, reason, { isUnknown: true });
const review = (code, reason) => fail(code, reason, { requiresHumanReview: true });

const unitKey = (u) => String(u ?? '').toLowerCase().replace(/[μµ]/g, 'u').replace(/³/g, '3').replace(/²/g, '2').replace(/[^a-z0-9]/g, '');
const ANALYTE_ALIASES = { pm25: 'PM25', no2: 'NO2', nitrogendioxide: 'NO2', so2: 'SO2', sulphurdioxide: 'SO2', o3: 'O3', ozone: 'O3', co: 'CO', carbonmonoxide: 'CO' };
const analyteKey = (a) => {
  const k = String(a ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return hasOwn(ANALYTE_ALIASES, k) ? ANALYTE_ALIASES[k] : compact(a);
};

function distanceCheck(claim, evidence, maxKm) {
  const claimPoint = pointOf(claim?.scope);
  const evidencePoint = pointOf(evidence?.location);
  if (!claimPoint || !evidencePoint) return unknown('SCOPE_COORDINATES_REQUIRED', 'This claim type needs coordinates on both the claim scope and the evidence location to bind the evidence to the claimed place.');
  const km = distanceKm(claimPoint, evidencePoint);
  if (km > maxKm) return fail('EVIDENCE_NOT_AT_CLAIMED_LOCATION', `Evidence location is ${km.toFixed(1)} km from the claimed scope; this claim type allows at most ${maxKm} km.`);
  return null;
}

/** Measurement objects whose analyte matches; values are returned unparsed so profiles can reject non-numeric ones. */
function matchingMeasurements(evidence, wanted) {
  return objectsOf(evidence?.measurements).slice(0, MAX_MEASUREMENTS).filter((m) => m.value !== null && m.value !== undefined && wanted(m));
}

function aggregate(values, how) {
  if (how === 'mean') return values.reduce((a, b) => a + b, 0) / values.length;
  if (how === 'max') return Math.max(...values);
  if (how === 'min') return Math.min(...values);
  return values[values.length - 1]; // latest (input is sorted by time)
}

function airQualityProfile({ claim, evidence, claimType }) {
  const result = isObject(claim?.result) ? claim.result : {};
  const wantedAnalyte = analyteKey(result.analyte || claim?.scope?.analyte);
  if (!wantedAnalyte) return unknown('CLAIMED_ANALYTE_REQUIRED', 'An air-quality claim must name the analyte it asserts (claim.result.analyte).');
  const measurements = matchingMeasurements(evidence, (m) => analyteKey(m.analyte) === wantedAnalyte);
  if (!measurements.length) return fail('CLAIM_ANALYTE_NOT_IN_EVIDENCE', `The claim asserts ${String(result.analyte).slice(0, 40)} but the evidence contains no such measurement.`);
  if (measurements.some((m) => num(m.value) === null)) return fail('MEASUREMENT_VALUE_NOT_NUMERIC', 'A measurement behind the claimed analyte has a non-numeric value, so the claim cannot be checked against it.');
  if (claimType === 'ENVIRONMENTAL_OBSERVATION') {
    const bad = measurements.find((m) => !isObservedBasis(m.basis || evidence?.sources?.[0]?.basis, evidence?.sources?.[0]?.dataKind));
    if (bad) return fail('MEASUREMENT_NOT_OBSERVED', `Measurement ${String(bad.measurementId || bad.analyte).slice(0, 60)} backing the claimed value is not an observation (basis ${String(bad.basis || 'unknown').slice(0, 40)}).`);
  }
  const unit = unitKey(result.unit);
  if (!unit) return unknown('CLAIMED_UNIT_REQUIRED', 'The claim must state the unit of the value it asserts.');
  if (measurements.some((m) => unitKey(m.unit) !== unit)) return fail('UNIT_MISMATCH', `Claimed unit "${String(result.unit).slice(0, 20)}" differs from the evidence unit "${String(measurements[0].unit).slice(0, 20)}".`);
  const claimed = num(result.value);
  if (claimed === null) return unknown('CLAIMED_VALUE_REQUIRED', 'The claim does not state a numeric value that can be compared with the evidence.');
  const how = ['latest', 'mean', 'max', 'min'].includes(result.aggregation) ? result.aggregation : 'latest';
  const ordered = measurements
    .map((m) => ({ v: num(m.value), t: Date.parse(m.validTimeUtc) }))
    .sort((a, b) => (Number.isFinite(a.t) ? a.t : 0) - (Number.isFinite(b.t) ? b.t : 0));
  const measured = aggregate(ordered.map((o) => o.v), how);
  if (Math.abs(claimed - measured) > Math.max(0.05 * Math.abs(measured), 1e-9)) {
    return fail('CLAIM_VALUE_MISMATCH', `Claimed ${claimed} but the evidence ${how} is ${Math.round(measured * 1000) / 1000} (tolerance 5%).`);
  }
  const geo = distanceCheck(claim, evidence, 10);
  if (geo) return geo;
  return { passed: true, ruleId: RULE, subtype: CLAIM_SUBTYPES.AIR_QUALITY, boundValue: measured, aggregation: how };
}

const RATE_UNITS_TO_KG_H = Object.freeze({ kgh: 1, kghr: 1, kgperhour: 1, kgperhr: 1, kgh1: 1, th: 1000, thr: 1000, tperhour: 1000, th1: 1000 });
const TONNES_CO2E = /^(T|TONNE|TONNES|METRIC_TON|METRIC_TONS|TONNE_S)_?CO2_?E(Q)?$/;
const REPAIR_DONE = new Set(['COMPLETED', 'VERIFIED']);
const GWP100_METHANE = 30; // IPCC AR6, fossil methane (29.8) rounded up: an upper bound on what a measured rate drop can claim
const MAX_BASELINE_AGE_DAYS = 90;

function methaneResponseProfile({ claim, evidence, evaluationTime }) {
  const result = isObject(claim?.result) ? claim.result : {};
  const nowMs = new Date(evaluationTime).getTime();
  const ch4 = matchingMeasurements(evidence, (m) => /CH4|METHANE/.test(token(m.analyte)));
  if (!ch4.length) return fail('CLAIM_ANALYTE_NOT_IN_EVIDENCE', 'A methane-response claim needs methane (CH4) emission-rate measurements; the evidence has none.');
  const nonObs = ch4.find((m) => !isObservedBasis(m.basis, evidence?.sources?.[0]?.dataKind));
  if (nonObs) return fail('MEASUREMENT_NOT_OBSERVED', `Methane measurement ${String(nonObs.measurementId || '').slice(0, 60)} is not an observation (basis ${String(nonObs.basis || 'unknown').slice(0, 40)}); models cannot prove a methane reduction.`);

  // Only phase-tagged measurements are emission rates. Untagged methane context (e.g. ambient ppb) is ignored.
  const rates = [];
  for (const m of ch4) {
    const phase = token(m.phase);
    if (!['BASELINE', 'PRE_REPAIR', 'POST_REPAIR', 'POST'].includes(phase)) continue;
    const key = unitKey(m.unit);
    if (!hasOwn(RATE_UNITS_TO_KG_H, key)) return fail('UNSUPPORTED_RATE_UNIT', `Methane measurement unit "${String(m.unit).slice(0, 20)}" is not an emission rate (kg/h or t/h).`);
    const value = num(m.value);
    if (value === null || value < 0) return fail('INVALID_RATE_VALUE', 'A methane emission rate is not a finite, non-negative number.');
    rates.push({ kgPerH: value * RATE_UNITS_TO_KG_H[key], at: Date.parse(m.validTimeUtc), phase });
  }
  const baseline = rates.filter((r) => ['BASELINE', 'PRE_REPAIR'].includes(r.phase));
  const post = rates.filter((r) => ['POST_REPAIR', 'POST'].includes(r.phase));
  if (!baseline.length || !post.length) return unknown('BASELINE_AND_POST_REPAIR_REQUIRED', 'A reduction needs both baseline (pre-repair) and post-repair measurements, each tagged with measurement.phase.');
  if ([...baseline, ...post].some((r) => !Number.isFinite(r.at))) return fail('MEASUREMENT_TIME_INVALID', 'A phase-tagged methane measurement has no valid timestamp.');

  const manifest = isObject(evidence?.manifest) ? evidence.manifest : null;
  if (!manifest || !REPAIR_DONE.has(token(manifest.status))) return fail('REPAIR_NOT_COMPLETED', `Repair work order status is "${String(manifest?.status ?? 'missing').slice(0, 30)}"; it must be COMPLETED or VERIFIED.`);
  const completedAt = Date.parse(manifest.completedAt);
  if (!Number.isFinite(completedAt)) return unknown('REPAIR_COMPLETION_TIME_REQUIRED', 'The repair manifest has no valid completedAt timestamp.');
  if (completedAt > nowMs + 60_000) return fail('REPAIR_COMPLETION_IN_FUTURE', 'The repair completion time is in the future.');
  if (manifest.dispatchedAt && Date.parse(manifest.dispatchedAt) > completedAt) return fail('REPAIR_TIMELINE_INCONSISTENT', 'The repair was dispatched after it was reported complete.');
  if (baseline.some((r) => !(r.at <= completedAt))) return fail('BASELINE_NOT_BEFORE_REPAIR', 'A baseline measurement is not earlier than the repair completion.');
  if (baseline.some((r) => completedAt - r.at > MAX_BASELINE_AGE_DAYS * 86_400_000)) return fail('BASELINE_TOO_OLD', `A baseline measurement is more than ${MAX_BASELINE_AGE_DAYS} days older than the repair; it no longer represents the pre-repair condition.`);
  if (post.some((r) => !(r.at >= completedAt))) return fail('POST_REPAIR_NOT_AFTER_REPAIR', 'A post-repair measurement predates the repair completion; it cannot show the leak stopped.');
  if (post.some((r) => r.at > nowMs + 60_000)) return fail('MEASUREMENT_IN_FUTURE', 'A post-repair measurement is dated in the future.');

  const verifier = token(manifest.verifier);
  if (!verifier) return unknown('INDEPENDENT_VERIFIER_REQUIRED', 'The repair manifest names no verifier.');
  if (verifier === token(claimantOf(claim))) return review('VERIFIER_NOT_INDEPENDENT', 'The repair was verified by the claimant; an independent verifier is required.');

  const methodology = result.baselineMethodology || evidence?.methodology;
  if (!isRecognisedMethodology(methodology)) return review('UNRECOGNISED_METHODOLOGY', `Methodology "${String(methodology ?? 'none').slice(0, 60)}" is not in the recognised list (EPA Subpart W, OGMP 2.0, IPCC, GHG Protocol, Verra, Gold Standard, ISO 14064, CDM, ACR).`);

  const mean = (xs) => xs.reduce((a, r) => a + r.kgPerH, 0) / xs.length;
  const dropKgPerH = mean(baseline) - mean(post);
  if (!(dropKgPerH > 0)) return fail('NO_MEASURED_REDUCTION', 'The post-repair emission rate is not lower than the baseline.');
  const periodHours = boundedPeriodHours(result.periodHours);
  const claimed = num(result.value);
  if (periodHours === null || claimed === null || claimed < 0 || !TONNES_CO2E.test(token(result.unit))) {
    return unknown('CLAIM_QUANTITY_REQUIRED', `State the claim as result.value in tonnes CO2e (unit "tCO2e") with result.periodHours (at most ${MAX_PERIOD_HOURS}) so it can be bound to the measured rate drop.`);
  }
  // A reduction can only be credited for time that has actually elapsed since the repair was completed.
  const elapsedHours = (nowMs - completedAt) / 3_600_000;
  if (periodHours > elapsedHours + 1) return fail('CLAIM_PERIOD_EXCEEDS_ELAPSED_TIME', `The claim covers ${periodHours} h but only ${Math.max(0, Math.round(elapsedHours))} h have passed since the repair was completed; future reductions cannot be credited.`);
  const ceiling = (dropKgPerH / 1000) * periodHours * GWP100_METHANE;
  if (claimed > ceiling * 1.05) return fail('CLAIM_EXCEEDS_MEASURED_REDUCTION', `Claimed ${claimed} tCO2e over ${periodHours} h but the measured rate drop supports at most ${ceiling.toFixed(2)} tCO2e.`);

  const geo = distanceCheck(claim, evidence, 5);
  if (geo) return geo;
  return { passed: true, ruleId: RULE, subtype: CLAIM_SUBTYPES.METHANE_RESPONSE, measuredDropKgPerH: Math.round(dropKgPerH * 100) / 100, maxClaimableTco2e: Math.round(ceiling * 100) / 100 };
}

const MAX_CUSTODY_GAP_DAYS = 30;
function livestockProfile({ claim, evidence, existingClaims, evaluationTime }) {
  const t = evidence?.traceability;
  if (!isObject(t)) return unknown('TRACEABILITY_RECORD_REQUIRED', 'A livestock claim needs evidence.traceability (animal IDs, custody events, registry cross-check).');
  const ids = animalIdsOf(evidence);
  if (!ids.length) return unknown('ANIMAL_IDS_REQUIRED', 'No animal identifiers in the traceability record.');
  if (new Set(ids).size !== ids.length) return fail('DUPLICATE_ANIMAL_IDS', 'The same animal ID appears more than once in one lot.');
  const result = isObject(claim?.result) ? claim.result : {};
  const headCount = num(result.headCount);
  if (headCount !== null && headCount !== ids.length) return fail('HEAD_COUNT_MISMATCH', `Claim states ${headCount} animals but the record lists ${ids.length}.`);

  const events = objectsOf(t.events);
  if (events.length < 2 || events.length !== (Array.isArray(t.events) ? t.events.length : 0)) return unknown('CUSTODY_EVENTS_REQUIRED', 'At least two well-formed, timestamped custody events are required.');
  const nowMs = new Date(evaluationTime).getTime();
  let prev = null;
  for (const e of events) {
    const at = Date.parse(e.at);
    if (!Number.isFinite(at)) return fail('EVENT_TIME_INVALID', 'A custody event has no valid timestamp.');
    if (at > nowMs + 60_000) return fail('EVENT_IN_FUTURE', 'A custody event is dated in the future.');
    if (prev) {
      if (at < prev.at) return fail('EVENTS_OUT_OF_ORDER', 'Custody events are not in chronological order.');
      if (prev.to && e.from && token(prev.to) !== token(e.from)) return fail('CUSTODY_BREAK', `Animals left ${String(prev.to).slice(0, 40)} but the next event starts at ${String(e.from).slice(0, 40)}.`);
      if ((at - prev.at) / 86_400_000 > MAX_CUSTODY_GAP_DAYS) return review('UNACCOUNTED_CUSTODY_GAP', `More than ${MAX_CUSTODY_GAP_DAYS} days pass between custody events.`);
    }
    prev = { at, to: e.to };
  }

  const reg = isObject(t.registryCrossCheck) ? t.registryCrossCheck : null;
  if (!reg || !reg.registry) return unknown('REGISTRY_CROSS_CHECK_REQUIRED', 'An independent registry cross-check is required.');
  if (token(reg.status) !== 'MATCHED') return fail('REGISTRY_MISMATCH', `Registry cross-check status is "${String(reg.status).slice(0, 30)}", not MATCHED.`);
  if (token(reg.checkedBy) && token(reg.checkedBy) === token(claimantOf(claim))) return review('REGISTRY_CHECK_NOT_INDEPENDENT', 'The registry cross-check was run by the claimant.');

  const taken = new Set();
  for (const existing of objectsOf(existingClaims)) {
    if (existing.status === 'Rejected' || existing.status === 'Superseded' || existing.claimId === claim?.claimId) continue;
    for (const id of Array.isArray(existing.animalIds) ? existing.animalIds : []) taken.add(token(id));
  }
  const clash = ids.find((id) => taken.has(id));
  if (clash) return fail('ANIMAL_ALREADY_CLAIMED', `Animal ${clash} is already part of another active claim (possible laundering across lots).`);
  return { passed: true, ruleId: RULE, subtype: CLAIM_SUBTYPES.LIVESTOCK_TRACEABILITY, animals: ids.length, events: events.length };
}

export const SUFFICIENCY_PROFILES = Object.freeze({
  [CLAIM_SUBTYPES.AIR_QUALITY]: { tiers: ['ENVIRONMENTAL_OBSERVATION', 'ENVIRONMENTAL_RISK_ALERT'], run: airQualityProfile },
  [CLAIM_SUBTYPES.METHANE_RESPONSE]: { tiers: ['QUANTIFIED_EMISSIONS_REDUCTION'], run: methaneResponseProfile },
  [CLAIM_SUBTYPES.LIVESTOCK_TRACEABILITY]: { tiers: ['INTERVENTION_COMPLETION'], run: livestockProfile },
});

/**
 * Runs the subtype profile. Unknown subtype, or a subtype used under the wrong claim tier, fails closed.
 * With `requireSubtype`, a quantified-emissions reduction without a supported subtype is UNKNOWN: the firewall
 * has no profile that could show the evidence supports that quantity.
 */
export function checkClaimTypeSufficiency({ claim, evidence, claimType, claimSubtype, existingClaims = [], evaluationTime = new Date(), requireSubtype = false }) {
  if (!claimSubtype) {
    if (requireSubtype && claimType === 'QUANTIFIED_EMISSIONS_REDUCTION') {
      return unknown('SUBTYPE_REQUIRED', 'No sufficiency profile was selected for this emissions-reduction claim; supported: methane-response. Route it to human review.');
    }
    return null;
  }
  if (typeof claimSubtype !== 'string' || !hasOwn(SUFFICIENCY_PROFILES, claimSubtype)) {
    return unknown('UNKNOWN_CLAIM_SUBTYPE', `Unknown claim subtype; supported: ${Object.keys(SUFFICIENCY_PROFILES).join(', ')}.`);
  }
  const profile = SUFFICIENCY_PROFILES[claimSubtype];
  if (!profile.tiers.includes(claimType)) return fail('SUBTYPE_TIER_MISMATCH', `Subtype ${claimSubtype} cannot back a ${String(claimType).slice(0, 40)} claim.`);
  return profile.run({ claim, evidence, claimType, existingClaims, evaluationTime });
}
