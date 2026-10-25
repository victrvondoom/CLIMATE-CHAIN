// Evidence-to-Claim Trust Firewall: Deterministic verification policy engine for environmental claims.
//
// Core Question:
// "Can an environmental claim be accepted when the underlying evidence is duplicated,
// altered, outdated, contradictory, derived only from a model, or insufficient to
// establish the claimed outcome?"
//
// Distinguishes 4 claim types with strict evidence tiers:
// 1. ENVIRONMENTAL_OBSERVATION (requires physical sensor/satellite observation; rejects model forecasts)
// 2. ENVIRONMENTAL_RISK_ALERT (permits model forecasts/indicators with explicit uncertainty and horizon)
// 3. INTERVENTION_COMPLETION (requires physical action manifest showing completion)
// 4. QUANTIFIED_EMISSIONS_REDUCTION (requires physical MRV baseline + spatial exclusivity; forbids pure models)
//
// v2 adds claim-subtype sufficiency (methane response, livestock traceability, air quality), overlap-safe
// exclusivity and an optional statistical-plausibility rule. See claim-sufficiency.mjs and docs/THREAT_MODEL.md.
// Everything here judges the SUBMITTED bundle; it cannot prove the bundle came from a real sensor.
// Inputs are untrusted: malformed claims/evidence are rejected, never thrown on.

import { canonicalJson, digestOf, sha256Hex } from './integrity-evidence.mjs';
import {
  KNOWN_LIMITATIONS, MAX_MEASUREMENTS, boundedPeriodHours, checkClaimTypeSufficiency, distanceKm, evidenceFingerprints,
  isModelLike, isObject, isObservedBasis, isRecognisedMethodology, objectsOf, overlapProfile, pointOf, scopesOverlap, token,
} from './claim-sufficiency.mjs';

// v2: tighter basis/temporal/geographic/exclusivity rules, claim-subtype sufficiency, overlap-safe exclusivity.
export const FIREWALL_VERSION = 'climate-chain:trust-firewall:v2';

export const CLAIM_TYPES = Object.freeze({
  ENVIRONMENTAL_OBSERVATION: 'ENVIRONMENTAL_OBSERVATION',
  ENVIRONMENTAL_RISK_ALERT: 'ENVIRONMENTAL_RISK_ALERT',
  INTERVENTION_COMPLETION: 'INTERVENTION_COMPLETION',
  QUANTIFIED_EMISSIONS_REDUCTION: 'QUANTIFIED_EMISSIONS_REDUCTION',
});

export const VERDICTS = Object.freeze({
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  HUMAN_REVIEW_REQUIRED: 'HUMAN_REVIEW_REQUIRED',
  UNKNOWN: 'UNKNOWN',
});

export const POLICY_RULES = Object.freeze({
  CANONICAL_HASH_INTEGRITY: 'CANONICAL_HASH_INTEGRITY',
  SOURCE_PROVENANCE_AUTHENTICITY: 'SOURCE_PROVENANCE_AUTHENTICITY',
  EVIDENCE_BASIS_COMPATIBILITY: 'EVIDENCE_BASIS_COMPATIBILITY',
  TEMPORAL_CONSISTENCY_AND_FRESHNESS: 'TEMPORAL_CONSISTENCY_AND_FRESHNESS',
  GEOGRAPHIC_SCOPE_CONSISTENCY: 'GEOGRAPHIC_SCOPE_CONSISTENCY',
  DUPLICATE_SCOPE_EXCLUSIVITY: 'DUPLICATE_SCOPE_EXCLUSIVITY',
  CONTRADICTORY_EVIDENCE_RECONCILIATION: 'CONTRADICTORY_EVIDENCE_RECONCILIATION',
  UNCERTAINTY_AND_SUFFICIENCY_BOUNDING: 'UNCERTAINTY_AND_SUFFICIENCY_BOUNDING',
  // Optional rules: only evaluated when a claimSubtype / requireSubtype / plausibility provider is supplied.
  CLAIM_TYPE_EVIDENCE_SUFFICIENCY: 'CLAIM_TYPE_EVIDENCE_SUFFICIENCY',
  STATISTICAL_PLAUSIBILITY: 'STATISTICAL_PLAUSIBILITY',
});

// Maximum allowed age for physical observations
const MAX_OBSERVATION_AGE_HOURS = 48;
const MAX_SATELLITE_AGE_HOURS = 168; // 7 days for satellite revisit
const MAX_RISK_HORIZON_HOURS = 72;   // 3 days forecast horizon
const MAX_RISK_ISSUE_AGE_HOURS = 48; // a forecast issued earlier than this is no longer an active alert
const MAX_LEGACY_SCOPE_DISTANCE_KM = 25;
const CONTENT_REUSE_FRACTION = 0.5;  // at least half of a bundle's measurements already claimed elsewhere = re-wrapped evidence

/**
 * Computes a deterministic composite scope key for duplicate detection.
 * Prevents evasion via new claim IDs while allowing different activities
 * sharing the same geographic boundary. (Exact-label key; overlap-by-meaning is checked separately.)
 */
export function computeCompositeScopeKey(scope) {
  if (!isObject(scope)) return null;
  const canonicalFields = {
    domain: String(scope.domain || scope.benefitType || 'environmental').toLowerCase().trim(),
    spatialBoundary: String(scope.boundary || scope.gridCell || scope.siteId || 'unbounded').toLowerCase().trim(),
    timeEpoch: String(scope.monitoringPeriod || scope.timeEpoch || scope.date || 'unspecified').trim(),
    activityType: String(scope.activityType || scope.analyte || 'unspecified').toLowerCase().trim(),
  };
  return sha256Hex(canonicalJson(canonicalFields));
}

/**
 * Validates canonical serialization and hash integrity.
 */
function checkHashIntegrity(evidence, expectedDigest) {
  if (!isObject(evidence)) {
    return { passed: false, ruleId: POLICY_RULES.CANONICAL_HASH_INTEGRITY, reason: 'Evidence bundle is missing or not a valid object.' };
  }
  let recomputed;
  try {
    recomputed = digestOf(evidence);
  } catch {
    return { passed: false, ruleId: POLICY_RULES.CANONICAL_HASH_INTEGRITY, reason: 'Evidence cannot be canonically serialised (non-finite numbers, excessive nesting or unsupported types).' };
  }
  const cleanExpected = String(expectedDigest || '').replace(/^0x/, '').toLowerCase();
  if (!cleanExpected) {
    return { passed: false, ruleId: POLICY_RULES.CANONICAL_HASH_INTEGRITY, reason: 'Expected digest was not provided for verification.' };
  }
  if (recomputed !== cleanExpected) {
    return {
      passed: false,
      ruleId: POLICY_RULES.CANONICAL_HASH_INTEGRITY,
      reason: `Digest mismatch: expected ${cleanExpected.slice(0, 16)}..., recomputed ${recomputed.slice(0, 16)}... Data has been modified.`,
    };
  }
  return { passed: true, ruleId: POLICY_RULES.CANONICAL_HASH_INTEGRITY, digest: recomputed };
}

/**
 * Validates provenance custody chain and source authenticity.
 * Note: this checks that provenance fields are PRESENT and coherent, not that they are TRUE.
 */
function checkProvenance(evidence) {
  const fail = (reason) => ({ passed: false, ruleId: POLICY_RULES.SOURCE_PROVENANCE_AUTHENTICITY, reason });
  if (!isObject(evidence)) return fail('No evidence object provided.');
  const sources = objectsOf(evidence.sources);
  if (sources.length === 0) return fail('Missing source records. Evidence provenance cannot be established.');
  const primarySource = sources[0];
  if (!primarySource.sourceId || typeof primarySource.sourceId !== 'string') return fail('Primary source has no valid sourceId.');
  const custody = objectsOf(evidence.custody);
  if (custody.length === 0) return fail('Custody trail is empty. Transformation provenance cannot be verified.');
  const steps = custody.map((c) => c.step);
  if (!steps.includes('retrieved') || !steps.includes('bundled')) return fail('Incomplete custody chain. Missing "retrieved" or "bundled" step.');
  return { passed: true, ruleId: POLICY_RULES.SOURCE_PROVENANCE_AUTHENTICITY, sourceId: primarySource.sourceId };
}

/**
 * Enforces claim-type to evidence-basis compatibility.
 * Core climate integrity rule: Models can never prove observations or carbon reductions.
 * Labels are compared as whole tokens (v1 used substring tests and accepted "UNOBSERVED_MODEL_ESTIMATE").
 */
function checkBasisCompatibility(claimType, evidence, claimResult) {
  const primarySource = objectsOf(evidence.sources)[0] || {};
  const dataKind = primarySource.dataKind || '';
  const measurements = objectsOf(evidence.measurements);
  const primaryBasis = measurements[0]?.basis || primarySource.basis || 'UNKNOWN';
  const fail = (reason, code, extra = {}) => ({ passed: false, ruleId: POLICY_RULES.EVIDENCE_BASIS_COMPATIBILITY, reason, code, ...extra });

  if (!Object.values(CLAIM_TYPES).includes(claimType)) {
    return fail('Unknown claim type. The firewall has no evidence policy for it, so it cannot be accepted.', 'UNKNOWN_CLAIM_TYPE', { isUnknown: true });
  }

  // Tier 1: Environmental Observation requires empirical observation, for the headline value and every measurement
  if (claimType === CLAIM_TYPES.ENVIRONMENTAL_OBSERVATION) {
    if (!isObservedBasis(primaryBasis, dataKind)) {
      return fail(`Model-to-Observation Prohibition: A modelled reading (${String(primaryBasis).slice(0, 40)}) cannot be accepted as independently observed environmental pollution.`, 'MODEL_CANNOT_PROVE_OBSERVATION');
    }
    const hidden = measurements.find((m) => m.basis && isModelLike(m.basis));
    if (hidden) {
      return fail(`Model-to-Observation Prohibition: measurement ${String(hidden.measurementId || hidden.analyte).slice(0, 60)} is ${String(hidden.basis).slice(0, 40)}; an observation claim cannot rest on any modelled value in the bundle.`, 'MODEL_CANNOT_PROVE_OBSERVATION');
    }
  }

  // Tier 4: Quantified Emissions Reduction requires physical measurement and a recognised baseline methodology
  if (claimType === CLAIM_TYPES.QUANTIFIED_EMISSIONS_REDUCTION) {
    const labels = [primaryBasis, dataKind, ...measurements.map((m) => m.basis)];
    if (isModelLike(...labels) || (claimResult?.basis && isModelLike(claimResult.basis))) {
      return fail(`Model-to-Carbon Prohibition: Modelled, simulated or synthetic values (${String(primaryBasis).slice(0, 40)}) cannot prove physical avoided emissions or carbon reduction.`, 'MODEL_CANNOT_PROVE_EMISSIONS_REDUCTION');
    }
    // A deny-list is never enough: the evidence must positively present as observed.
    if (!isObservedBasis(primaryBasis, dataKind) || measurements.some((m) => m.basis && !isObservedBasis(m.basis, dataKind))) {
      return fail(`The evidence basis (${String(primaryBasis).slice(0, 40)}) is not a recognised observation basis, so it cannot prove a quantified emissions reduction.`, 'REDUCTION_REQUIRES_OBSERVED_BASIS');
    }
    const methodology = claimResult?.baselineMethodology || evidence?.methodology;
    if (!methodology) {
      return fail('Quantified emissions reduction requires a verifiable baseline methodology (e.g. EPA Subpart W or Nature Comms 2026 counterfactual).', 'MISSING_BASELINE_METHODOLOGY');
    }
    if (!isRecognisedMethodology(methodology)) {
      return fail(`Baseline methodology "${String(methodology).slice(0, 60)}" is not a recognised methodology name; a human reviewer must assess it.`, 'UNRECOGNISED_METHODOLOGY', { requiresHumanReview: true });
    }
  }

  // Tier 3: Intervention Completion requires evidence the work was COMPLETED, not merely dispatched
  if (claimType === CLAIM_TYPES.INTERVENTION_COMPLETION) {
    const manifest = isObject(evidence.manifest) ? evidence.manifest : null;
    if (manifest) {
      const status = token(manifest.status);
      if (!status) return fail('The action manifest has no status, so completion cannot be established.', 'MISSING_INTERVENTION_STATUS', { isUnknown: true });
      if (!['COMPLETED', 'VERIFIED', 'DELIVERED'].includes(status)) {
        return fail(`The action manifest status is "${String(manifest.status).slice(0, 30)}", not a completed state.`, 'INTERVENTION_NOT_COMPLETED');
      }
    } else {
      const completed = evidence.workOrder || evidence.actionProof || objectsOf(evidence.custody).some((c) => c.step === 'completed');
      if (!completed) {
        const dispatchedOnly = objectsOf(evidence.custody).some((c) => c.step === 'dispatched');
        return fail(dispatchedOnly
          ? 'A dispatch record shows work was sent, not that it was completed.'
          : 'Intervention completion requires a physical action manifest, completion record, or verifier attestation.', dispatchedOnly ? 'DISPATCH_IS_NOT_COMPLETION' : 'MISSING_INTERVENTION_MANIFEST');
      }
    }
  }

  // Tier 2: Risk Alert permits model forecasts, but requires declared uncertainty and a bounded forecast horizon
  if (claimType === CLAIM_TYPES.ENVIRONMENTAL_RISK_ALERT) {
    const hasUncertainty = (Array.isArray(evidence.uncertainty) && evidence.uncertainty.length > 0) || evidence.forecastHorizonHours;
    if (!hasUncertainty) {
      return fail('Environmental risk alert based on models must declare explicit uncertainty bounds and forecast horizon.', 'MISSING_RISK_UNCERTAINTY');
    }
    if (evidence.forecastHorizonHours !== undefined) {
      const horizon = Number(evidence.forecastHorizonHours);
      if (!Number.isFinite(horizon) || horizon <= 0 || horizon > MAX_RISK_HORIZON_HOURS) {
        return fail(`Forecast horizon ${String(evidence.forecastHorizonHours).slice(0, 12)} h is outside the allowed 0-${MAX_RISK_HORIZON_HOURS} h window for a risk alert.`, 'RISK_HORIZON_EXCEEDED');
      }
    }
  }

  return { passed: true, ruleId: POLICY_RULES.EVIDENCE_BASIS_COMPATIBILITY, claimType, primaryBasis };
}

/**
 * Validates temporal consistency and evidence freshness.
 * Observation freshness is measured from the OLDEST of retrieval time and each measurement's valid time, so a
 * freshly fetched copy of 2019 data is stale (v1 looked at retrievedAt only). A claimant-supplied averaging period
 * widens the allowance only up to a year (boundedPeriodHours).
 */
function checkTemporalFreshness(evidence, claimType, evalTime, claimResult = {}) {
  const primarySource = objectsOf(evidence.sources)[0] || {};
  const fail = (reason, code) => ({ passed: false, ruleId: POLICY_RULES.TEMPORAL_CONSISTENCY_AND_FRESHNESS, reason, code });

  const rawRetrieved = primarySource.retrievedAt ?? evidence.timeframe?.endUtc;
  const retrievedAt = rawRetrieved ? new Date(rawRetrieved) : null;
  if (!retrievedAt || Number.isNaN(retrievedAt.getTime())) return fail('Invalid or missing retrieval timestamp.', 'MISSING_RETRIEVAL_TIME');

  // Evidence cannot originate from the future
  if (retrievedAt.getTime() > evalTime.getTime() + 60_000) {
    return fail('Temporal violation: Evidence timestamp is in the future relative to evaluation time.', 'EVIDENCE_FROM_FUTURE');
  }

  const ageOf = (d) => (evalTime.getTime() - d.getTime()) / (1000 * 60 * 60);
  const retrievedAge = ageOf(retrievedAt);
  let ageHours = retrievedAge;

  if (claimType === CLAIM_TYPES.ENVIRONMENTAL_OBSERVATION) {
    const validTimes = objectsOf(evidence.measurements).map((m) => (m.validTimeUtc ? new Date(m.validTimeUtc) : null)).filter((d) => d && !Number.isNaN(d.getTime()));
    if (validTimes.some((d) => d.getTime() > evalTime.getTime() + 60_000)) return fail('Temporal violation: a measurement is dated in the future relative to evaluation time.', 'EVIDENCE_FROM_FUTURE');
    if (validTimes.length) ageHours = Math.max(retrievedAge, ageOf(new Date(Math.min(...validTimes.map((d) => d.getTime())))));
    const isSatellite = /SATELLITE/i.test(String(primarySource.dataKind || '')) || /sentinel|viirs/i.test(String(primarySource.sourceId || ''));
    const base = isSatellite ? MAX_SATELLITE_AGE_HOURS : MAX_OBSERVATION_AGE_HOURS;
    const maxAge = base + (boundedPeriodHours(claimResult?.periodHours) ?? 0);
    if (ageHours > maxAge) {
      return fail(`Evidence is stale (${Math.round(ageHours)} hours old). Maximum allowed age for ${isSatellite ? 'satellite' : 'ground'} observation is ${maxAge} hours.`, 'EVIDENCE_STALE');
    }
  }

  if (claimType === CLAIM_TYPES.ENVIRONMENTAL_RISK_ALERT) {
    if (retrievedAge > MAX_RISK_ISSUE_AGE_HOURS) {
      return fail(`The forecast was issued ${Math.round(retrievedAge)} hours ago; a risk alert must rest on a forecast issued within ${MAX_RISK_ISSUE_AGE_HOURS} hours.`, 'FORECAST_STALE');
    }
    const horizon = Number(evidence.forecastHorizonHours);
    if (Number.isFinite(horizon) && retrievedAge > horizon) {
      return fail(`The forecast horizon (${horizon} h) ended ${Math.round(retrievedAge - horizon)} hours ago.`, 'FORECAST_EXPIRED');
    }
  }

  return { passed: true, ruleId: POLICY_RULES.TEMPORAL_CONSISTENCY_AND_FRESHNESS, ageHours: Math.round(ageHours * 10) / 10 };
}

/**
 * Checks geographic consistency and bounds. The evidence must carry valid coordinates (or, failing that, the claim
 * scope must); when both are present they must agree (v1 only range-checked the numbers).
 */
function checkGeographicConsistency(evidence, scope) {
  const fail = (reason, code) => ({ passed: false, ruleId: POLICY_RULES.GEOGRAPHIC_SCOPE_CONSISTENCY, reason, ...(code ? { code } : {}) });
  const location = isObject(evidence.location) ? evidence.location : {};
  const scopeObj = isObject(scope) ? scope : {};
  const scopePoint = pointOf(scopeObj);
  const evidencePoint = pointOf(location);

  if (location.lat !== undefined || location.lon !== undefined) {
    // Coordinates were supplied but are not usable: never fall back silently to the claimant's own scope.
    if (!evidencePoint) return fail(`Invalid geographic coordinates on the evidence: lat=${String(location.lat).slice(0, 12)}, lon=${String(location.lon).slice(0, 12)}.`, 'INVALID_COORDINATES');
  }
  const point = evidencePoint ?? scopePoint;
  if (!point) return fail('Evidence or scope is missing geographic coordinates.', 'MISSING_COORDINATES');

  if (scopePoint && evidencePoint) {
    const km = distanceKm(scopePoint, evidencePoint);
    if (km > MAX_LEGACY_SCOPE_DISTANCE_KM) {
      return fail(`Evidence was collected ${km.toFixed(0)} km from the claimed scope (limit ${MAX_LEGACY_SCOPE_DISTANCE_KM} km).`, 'EVIDENCE_NOT_AT_CLAIMED_LOCATION');
    }
  }
  if (scopeObj.siteId && location.siteId && token(scopeObj.siteId) !== token(location.siteId)) {
    return fail(`Claim scope names site "${String(scopeObj.siteId).slice(0, 40)}" but the evidence is for site "${String(location.siteId).slice(0, 40)}".`, 'EVIDENCE_SITE_MISMATCH');
  }

  return { passed: true, ruleId: POLICY_RULES.GEOGRAPHIC_SCOPE_CONSISTENCY, lat: point.lat, lon: point.lon };
}

/**
 * Checks duplicate and overlapping claim-scope exclusivity.
 * Distinguishes identical activities from legitimate co-located distinct activities. Beyond the exact composite key
 * it blocks: re-wrapped evidence (content fingerprints), and the same activity class at the same place over
 * intersecting periods even when the boundary label, period granularity or activity wording differs.
 */
function checkScopeExclusivity(claim, existingClaims = [], evidence = null) {
  const scope = isObject(claim.scope) ? claim.scope : {};
  const currentCompositeKey = computeCompositeScopeKey(scope);
  const currentClaimId = claim.claimId;
  const currentEvidenceDigest = claim.evidence?.[0]?.digest;
  const currentPrint = overlapProfile(scope, pointOf(evidence?.location, scope));
  const currentFingerprints = new Set(evidence ? evidenceFingerprints(evidence) : []);

  for (const existing of objectsOf(existingClaims)) {
    // If the claim was rejected or superseded, it doesn't block
    if (existing.status === 'Rejected' || existing.status === 'Superseded') continue;
    if (existing.claimId === currentClaimId) continue;

    // Check 1: Exact evidence digest reused for another active claim
    const existingDigest = existing.evidence?.[0]?.digest || existing.evidenceDigest;
    if (existingDigest && currentEvidenceDigest && existingDigest === currentEvidenceDigest) {
      return {
        passed: false,
        ruleId: POLICY_RULES.DUPLICATE_SCOPE_EXCLUSIVITY,
        reason: `Evidence Reuse Violation: Evidence digest ${String(currentEvidenceDigest).slice(0, 16)}... is already committed to active claim ${String(existing.claimId).slice(0, 40)}.`,
        code: 'EVIDENCE_ALREADY_CLAIMED',
      };
    }

    // Check 2: Same measurements re-wrapped (digest differs, content largely identical)
    if (currentFingerprints.size && Array.isArray(existing.evidenceFingerprints)) {
      const held = new Set(existing.evidenceFingerprints);
      let shared = 0;
      for (const f of currentFingerprints) if (held.has(f)) shared += 1;
      if (shared > 0 && shared / currentFingerprints.size >= CONTENT_REUSE_FRACTION) {
        return {
          passed: false,
          ruleId: POLICY_RULES.DUPLICATE_SCOPE_EXCLUSIVITY,
          reason: `Evidence Content Reuse: ${shared} of ${currentFingerprints.size} measurements in this bundle are already committed to active claim ${String(existing.claimId).slice(0, 40)} (the bundle was re-wrapped to change its digest).`,
          code: 'EVIDENCE_CONTENT_ALREADY_CLAIMED',
        };
      }
    }

    // Check 3: Same composite scope (domain + boundary + epoch + activity) with a different claim ID
    const existingCompositeKey = existing.compositeScopeKey || computeCompositeScopeKey(existing.scope);
    if (existingCompositeKey && currentCompositeKey && existingCompositeKey === currentCompositeKey) {
      return {
        passed: false,
        ruleId: POLICY_RULES.DUPLICATE_SCOPE_EXCLUSIVITY,
        reason: `Duplicate Claim Scope: An active claim (${String(existing.claimId).slice(0, 40)}) already covers ${String(scope.activityType || scope.analyte).slice(0, 40)} at this location for this time period. Generating a new claim ID does not evade scope exclusivity.`,
        code: 'DUPLICATE_CLAIM_SCOPE_DETECTED',
      };
    }

    // Check 4: Overlap by meaning, not spelling (boundary slug / nearby cell, activity synonyms, nested periods)
    const existingPrint = overlapProfile(existing.scope || {}, pointOf(existing.location, existing.scope));
    if (scopesOverlap(currentPrint, existingPrint)) {
      return {
        passed: false,
        ruleId: POLICY_RULES.DUPLICATE_SCOPE_EXCLUSIVITY,
        reason: `Overlapping Claim Scope: active claim ${String(existing.claimId).slice(0, 40)} already covers the same ${currentPrint.activity.toLowerCase().replace(/_/g, ' ')} activity at this place over an overlapping period, even though the labels differ.`,
        code: 'OVERLAPPING_CLAIM_SCOPE_DETECTED',
      };
    }
  }

  return { passed: true, ruleId: POLICY_RULES.DUPLICATE_SCOPE_EXCLUSIVITY, compositeScopeKey: currentCompositeKey };
}

/**
 * Checks multi-source contradictory evidence.
 * Triggers HUMAN_REVIEW_REQUIRED when dual sensors strongly diverge.
 */
function checkContradictions(evidence) {
  for (const comp of objectsOf(evidence.comparisons)) {
    if (comp.status === 'CONTRADICTORY' || comp.status === 'DIVERGENT') {
      return {
        passed: false,
        ruleId: POLICY_RULES.CONTRADICTORY_EVIDENCE_RECONCILIATION,
        reason: `Contradictory source assertion detected: ${String(comp.reason || 'Dual-source measurements diverge significantly.').slice(0, 300)}`,
        requiresHumanReview: true,
      };
    }
  }
  return { passed: true, ruleId: POLICY_RULES.CONTRADICTORY_EVIDENCE_RECONCILIATION };
}

/**
 * Checks completeness and uncertainty bounds.
 */
function checkSufficiency(evidence) {
  const measurements = objectsOf(evidence.measurements);
  if (measurements.length === 0 && !evidence.manifest) {
    return {
      passed: false,
      ruleId: POLICY_RULES.UNCERTAINTY_AND_SUFFICIENCY_BOUNDING,
      reason: 'No measurement records or action manifests in evidence bundle.',
      isUnknown: true,
    };
  }

  // Check for critical missing values
  const hasValidValues = measurements.some((m) => m.value !== null && m.value !== undefined);
  if (!hasValidValues && !evidence.manifest) {
    return {
      passed: false,
      ruleId: POLICY_RULES.UNCERTAINTY_AND_SUFFICIENCY_BOUNDING,
      reason: 'All sensor measurements returned null or missing values from source.',
      isUnknown: true,
    };
  }

  return { passed: true, ruleId: POLICY_RULES.UNCERTAINTY_AND_SUFFICIENCY_BOUNDING };
}

const LIMITS_NOTICE = 'The Trust Firewall verifies deterministic policy compliance of the submitted evidence bundle. It cannot prove the bundle came from a real sensor, it sees only the claims in this registry, and it does not replace independent on-site calibration or regulatory certification.';

function malformedResult({ claim, expectedDigest, evaluationTime, reason }) {
  const receiptBody = {
    schema: 'climate-chain:firewall-receipt:v1',
    firewallVersion: FIREWALL_VERSION,
    evaluatedAt: evaluationTime.toISOString(),
    claimId: isObject(claim) && typeof claim.claimId === 'string' ? claim.claimId.slice(0, 80) : 'unassigned',
    claimType: null,
    evidenceDigest: typeof expectedDigest === 'string' ? expectedDigest.slice(0, 80) : null,
    verdict: VERDICTS.REJECTED,
    passedAllRules: false,
    reasons: [reason],
    ruleSummary: { total: 0, passed: 0, failed: 0 },
    compositeScopeKey: null,
    onChainAnchoringEligible: false,
  };
  const firewallReceiptHash = digestOf(receiptBody);
  const receiptId = `rcpt-${firewallReceiptHash.slice(0, 24)}`;
  return {
    verdict: VERDICTS.REJECTED,
    receiptId,
    receipt: { receiptId, ...receiptBody, firewallReceiptHash },
    errors: [reason],
    notes: [],
    ruleResults: [],
    eligibleForOnChainSubmission: false,
    scopeKey: null,
    limitsNotice: LIMITS_NOTICE,
    knownLimitations: KNOWN_LIMITATIONS,
  };
}

/**
 * Main Evidence-to-Claim Trust Firewall Evaluation Function. Never throws: anything that cannot be evaluated is
 * REJECTED with a reason.
 *
 * @param {Object} options
 * @param {Object} options.claim - The submitted claim object
 * @param {Object} options.evidence - The evidence bundle backing the claim
 * @param {string} options.expectedDigest - Expected canonical SHA-256 digest
 * @param {string} [options.claimType] - Explicit claim type (defaults to claim.claimType or inferred)
 * @param {string} [options.claimSubtype] - methane-response | livestock-traceability | air-quality (opt-in sufficiency profile)
 * @param {Array} [options.existingClaims] - Currently active claims in registry for duplicate check
 * @param {Date|string} [options.evaluationTime] - Current time anchor (default: now; an invalid value falls back to now)
 * @param {boolean} [options.requireSubtype] - Fail closed (UNKNOWN) for emissions-reduction claims without a supported subtype
 * @param {Function} [options.plausibility] - ({claim, evidence, claimType}) => {covered, outOfEnvelope[]} statistical envelope provider
 * @returns {Object} FirewallEvaluationResult with verdict, rule details, and receipt
 */
export function evaluateClaimThroughFirewall(options = {}) {
  const requested = new Date(options?.evaluationTime ?? Date.now());
  const evaluationTime = Number.isNaN(requested.getTime()) ? new Date() : requested;
  try {
    return evaluate({ ...options, evaluationTime });
  } catch (error) {
    return malformedResult({
      claim: options?.claim,
      expectedDigest: options?.expectedDigest,
      evaluationTime,
      reason: 'The submitted claim or evidence has a structure the firewall cannot evaluate, so it was rejected.',
    });
  }
}

function evaluate({
  claim,
  evidence,
  expectedDigest,
  claimType,
  claimSubtype,
  existingClaims = [],
  evaluationTime,
  requireSubtype = false,
  plausibility = null,
}) {
  if (!isObject(claim)) {
    return malformedResult({ claim, expectedDigest, evaluationTime, reason: 'The claim is missing or is not an object.' });
  }
  if (isObject(evidence) && Array.isArray(evidence.measurements) && evidence.measurements.length > MAX_MEASUREMENTS) {
    return malformedResult({ claim, expectedDigest, evaluationTime, reason: `The evidence bundle has more than ${MAX_MEASUREMENTS} measurements.` });
  }
  const resolvedClaimType = claimType || claim.claimType || claim.result?.claimType || CLAIM_TYPES.ENVIRONMENTAL_OBSERVATION;
  const resolvedSubtype = claimSubtype || claim.claimSubtype || claim.result?.claimSubtype || null;
  const ev = isObject(evidence) ? evidence : {};
  const ruleResults = [];
  const errors = [];
  const notes = [];
  let requiresHumanReview = false;
  let isUnknown = false;

  // Rule 1: Canonical Serialization & Hash Integrity
  const hashCheck = checkHashIntegrity(evidence, expectedDigest || claim.evidence?.[0]?.digest);
  ruleResults.push(hashCheck);
  if (!hashCheck.passed) errors.push(hashCheck.reason);

  // Rule 2: Provenance & Source Authenticity
  const provCheck = checkProvenance(evidence);
  ruleResults.push(provCheck);
  if (!provCheck.passed) errors.push(provCheck.reason);

  // Rule 3: Evidence Basis Compatibility (Model vs. Observation vs. Reduction)
  const basisCheck = checkBasisCompatibility(resolvedClaimType, ev, claim.result);
  ruleResults.push(basisCheck);
  if (!basisCheck.passed) {
    if (basisCheck.isUnknown) { isUnknown = true; notes.push(basisCheck.reason); }
    else if (basisCheck.requiresHumanReview) { requiresHumanReview = true; notes.push(basisCheck.reason); }
    else errors.push(basisCheck.reason);
  }

  // Rule 4: Temporal Consistency & Freshness
  const timeCheck = checkTemporalFreshness(ev, resolvedClaimType, evaluationTime, claim.result);
  ruleResults.push(timeCheck);
  if (!timeCheck.passed) errors.push(timeCheck.reason);

  // Rule 5: Geographic Scope Consistency
  const geoCheck = checkGeographicConsistency(ev, claim.scope);
  ruleResults.push(geoCheck);
  if (!geoCheck.passed) errors.push(geoCheck.reason);

  // Rule 6: Duplicate Scope & Exclusivity Detection
  const scopeCheck = checkScopeExclusivity(claim, existingClaims, evidence ? ev : null);
  ruleResults.push(scopeCheck);
  if (!scopeCheck.passed) errors.push(scopeCheck.reason);

  // Rule 7: Multi-Source Contradictions
  const contraCheck = checkContradictions(ev);
  ruleResults.push(contraCheck);
  if (!contraCheck.passed) {
    if (contraCheck.requiresHumanReview) { requiresHumanReview = true; notes.push(contraCheck.reason); }
    else errors.push(contraCheck.reason);
  }

  // Rule 8: Uncertainty & Evidence Sufficiency
  const suffCheck = checkSufficiency(ev);
  ruleResults.push(suffCheck);
  if (!suffCheck.passed) {
    if (suffCheck.isUnknown) { isUnknown = true; notes.push(suffCheck.reason); }
    else errors.push(suffCheck.reason);
  }

  // Rule 9 (opt-in): does THIS evidence support THIS claim? Only evaluated when a subtype is declared or required.
  const claimSufficiency = checkClaimTypeSufficiency({
    claim, evidence: ev, claimType: resolvedClaimType, claimSubtype: resolvedSubtype, existingClaims: objectsOf(existingClaims), evaluationTime, requireSubtype,
  });
  if (claimSufficiency) {
    ruleResults.push(claimSufficiency);
    if (!claimSufficiency.passed) {
      if (claimSufficiency.isUnknown) { isUnknown = true; notes.push(claimSufficiency.reason); }
      else if (claimSufficiency.requiresHumanReview) { requiresHumanReview = true; notes.push(claimSufficiency.reason); }
      else errors.push(claimSufficiency.reason);
    }
  }

  // Rule 10 (opt-in): is the claimed value statistically plausible for the place and season? Advisory: never rejects.
  if (typeof plausibility === 'function' && Object.values(CLAIM_TYPES).includes(resolvedClaimType)) {
    let plausibilityResult = null;
    try {
      plausibilityResult = plausibility({ claim, evidence: ev, claimType: resolvedClaimType });
    } catch {
      notes.push('The plausibility envelope was unavailable for this evaluation.');
    }
    if (plausibilityResult?.covered) {
      const outside = Array.isArray(plausibilityResult.outOfEnvelope) ? plausibilityResult.outOfEnvelope.slice(0, 20) : [];
      ruleResults.push({
        passed: outside.length === 0,
        ruleId: POLICY_RULES.STATISTICAL_PLAUSIBILITY,
        reason: outside.length ? `Value outside the empirical envelope for this place and season: ${outside.map((o) => o.summary).join('; ')}.` : undefined,
        envelope: plausibilityResult.envelope,
      });
      if (outside.length) {
        requiresHumanReview = true;
        notes.push(`Statistical plausibility: ${outside.map((o) => o.summary).join('; ')}.`);
      }
    }
  }

  // Determine final verdict
  let verdict = VERDICTS.ACCEPTED;
  if (errors.length > 0) {
    verdict = VERDICTS.REJECTED;
  } else if (isUnknown) {
    verdict = VERDICTS.UNKNOWN;
  } else if (requiresHumanReview) {
    verdict = VERDICTS.HUMAN_REVIEW_REQUIRED;
  }

  // Generate deterministic cryptographic verification receipt
  const receiptBody = {
    schema: 'climate-chain:firewall-receipt:v1',
    firewallVersion: FIREWALL_VERSION,
    evaluatedAt: evaluationTime.toISOString(),
    claimId: typeof claim.claimId === 'string' ? claim.claimId.slice(0, 80) : 'unassigned',
    claimType: typeof resolvedClaimType === 'string' ? resolvedClaimType.slice(0, 80) : null,
    evidenceDigest: expectedDigest || claim.evidence?.[0]?.digest || null,
    verdict,
    passedAllRules: verdict === VERDICTS.ACCEPTED,
    reasons: errors,
    ruleSummary: {
      total: ruleResults.length,
      passed: ruleResults.filter((r) => r.passed).length,
      failed: ruleResults.filter((r) => !r.passed).length,
    },
    compositeScopeKey: scopeCheck.compositeScopeKey || null,
    onChainAnchoringEligible: verdict === VERDICTS.ACCEPTED,
  };
  if (notes.length) receiptBody.notes = notes;
  if (typeof resolvedSubtype === 'string') receiptBody.claimSubtype = resolvedSubtype.slice(0, 80);

  const firewallReceiptHash = digestOf(receiptBody);
  const receiptId = `rcpt-${firewallReceiptHash.slice(0, 24)}`;
  const receipt = { receiptId, ...receiptBody, firewallReceiptHash };

  return {
    verdict,
    receiptId,
    receipt,
    errors,
    notes,
    ruleResults,
    eligibleForOnChainSubmission: verdict === VERDICTS.ACCEPTED,
    scopeKey: scopeCheck.compositeScopeKey,
    limitsNotice: LIMITS_NOTICE,
    knownLimitations: KNOWN_LIMITATIONS,
  };
}
