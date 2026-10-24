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
// 3. INTERVENTION_COMPLETION (requires physical action manifest, attestation, completion timestamp)
// 4. QUANTIFIED_EMISSIONS_REDUCTION (requires physical MRV baseline + spatial exclusivity; forbids pure models)

import { createHash } from 'node:crypto';
import { canonicalJson, digestOf, sha256Hex } from './integrity-evidence.mjs';

export const FIREWALL_VERSION = 'climate-chain:trust-firewall:v1';

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
});

// Maximum allowed age for physical observations
const MAX_OBSERVATION_AGE_HOURS = 48;
const MAX_SATELLITE_AGE_HOURS = 168; // 7 days for satellite revisit
const MAX_RISK_HORIZON_HOURS = 72;   // 3 days forecast horizon

/**
 * Computes a deterministic composite scope key for duplicate detection.
 * Prevents evasion via new claim IDs while allowing different activities
 * sharing the same geographic boundary.
 */
export function computeCompositeScopeKey(scope) {
  if (!scope || typeof scope !== 'object') return null;
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
  if (!evidence || typeof evidence !== 'object') {
    return { passed: false, ruleId: POLICY_RULES.CANONICAL_HASH_INTEGRITY, reason: 'Evidence bundle is missing or not a valid object.' };
  }
  const recomputed = digestOf(evidence);
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
 */
function checkProvenance(evidence) {
  if (!evidence) {
    return { passed: false, ruleId: POLICY_RULES.SOURCE_PROVENANCE_AUTHENTICITY, reason: 'No evidence object provided.' };
  }
  const sources = evidence.sources || [];
  if (!Array.isArray(sources) || sources.length === 0) {
    return { passed: false, ruleId: POLICY_RULES.SOURCE_PROVENANCE_AUTHENTICITY, reason: 'Missing source records. Evidence provenance cannot be established.' };
  }
  const primarySource = sources[0];
  if (!primarySource.sourceId || typeof primarySource.sourceId !== 'string') {
    return { passed: false, ruleId: POLICY_RULES.SOURCE_PROVENANCE_AUTHENTICITY, reason: 'Primary source has no valid sourceId.' };
  }
  const custody = evidence.custody || [];
  if (!Array.isArray(custody) || custody.length === 0) {
    return { passed: false, ruleId: POLICY_RULES.SOURCE_PROVENANCE_AUTHENTICITY, reason: 'Custody trail is empty. Transformation provenance cannot be verified.' };
  }
  // Check required custody steps
  const steps = custody.map((c) => c.step);
  if (!steps.includes('retrieved') || !steps.includes('bundled')) {
    return { passed: false, ruleId: POLICY_RULES.SOURCE_PROVENANCE_AUTHENTICITY, reason: 'Incomplete custody chain. Missing "retrieved" or "bundled" step.' };
  }
  return { passed: true, ruleId: POLICY_RULES.SOURCE_PROVENANCE_AUTHENTICITY, sourceId: primarySource.sourceId };
}

/**
 * Enforces claim-type to evidence-basis compatibility.
 * Core climate integrity rule: Models can never prove observations or carbon reductions.
 */
function checkBasisCompatibility(claimType, evidence, claimResult) {
  const sources = evidence.sources || [];
  const primarySource = sources[0] || {};
  const dataKind = (primarySource.dataKind || '').toUpperCase();
  const measurements = evidence.measurements || [];
  const primaryBasis = measurements[0]?.basis || primarySource.basis || 'UNKNOWN';

  // Rule 1: Environmental Observation requires empirical observation
  if (claimType === CLAIM_TYPES.ENVIRONMENTAL_OBSERVATION) {
    const isObserved = ['OBSERVED_MONITOR', 'SATELLITE_MEASURED', 'COMMUNITY_REPORT'].includes(primaryBasis) ||
      dataKind.includes('OBSERVED') ||
      dataKind.includes('MEASURED');
    if (!isObserved) {
      return {
        passed: false,
        ruleId: POLICY_RULES.EVIDENCE_BASIS_COMPATIBILITY,
        reason: `Model-to-Observation Prohibition: A modelled reading (${primaryBasis}) cannot be accepted as independently observed environmental pollution.`,
        code: 'MODEL_CANNOT_PROVE_OBSERVATION',
      };
    }
  }

  // Rule 2: Quantified Emissions Reduction requires physical measurement & baseline MRV
  if (claimType === CLAIM_TYPES.QUANTIFIED_EMISSIONS_REDUCTION) {
    const isPureModel = primaryBasis === 'MODEL_FORECAST' || dataKind.includes('MODEL') || primaryBasis === 'DERIVED_ESTIMATE';
    if (isPureModel) {
      return {
        passed: false,
        ruleId: POLICY_RULES.EVIDENCE_BASIS_COMPATIBILITY,
        reason: `Model-to-Carbon Prohibition: Modelled air concentrations or simulations (${primaryBasis}) cannot prove physical avoided emissions or carbon reduction.`,
        code: 'MODEL_CANNOT_PROVE_EMISSIONS_REDUCTION',
      };
    }
    // Check if baseline methodology is provided
    if (!claimResult?.baselineMethodology && !evidence?.methodology) {
      return {
        passed: false,
        ruleId: POLICY_RULES.EVIDENCE_BASIS_COMPATIBILITY,
        reason: 'Quantified emissions reduction requires a verifiable baseline methodology (e.g. EPA Subpart W or Nature Comms 2026 counterfactual).',
        code: 'MISSING_BASELINE_METHODOLOGY',
      };
    }
  }

  // Rule 3: Intervention Completion requires action manifest or attestation
  if (claimType === CLAIM_TYPES.INTERVENTION_COMPLETION) {
    const hasManifest = evidence.manifest || evidence.workOrder || evidence.actionProof || evidence.custody?.some((c) => c.step === 'completed' || c.step === 'dispatched');
    if (!hasManifest) {
      return {
        passed: false,
        ruleId: POLICY_RULES.EVIDENCE_BASIS_COMPATIBILITY,
        reason: 'Intervention completion requires a physical action manifest, dispatch log, or verifier attestation.',
        code: 'MISSING_INTERVENTION_MANIFEST',
      };
    }
  }

  // Rule 4: Risk Alert permits model forecasts, but requires declared uncertainty and forecast horizon
  if (claimType === CLAIM_TYPES.ENVIRONMENTAL_RISK_ALERT) {
    const hasUncertainty = (evidence.uncertainty && evidence.uncertainty.length > 0) || evidence.forecastHorizonHours;
    if (!hasUncertainty) {
      return {
        passed: false,
        ruleId: POLICY_RULES.EVIDENCE_BASIS_COMPATIBILITY,
        reason: 'Environmental risk alert based on models must declare explicit uncertainty bounds and forecast horizon.',
        code: 'MISSING_RISK_UNCERTAINTY',
      };
    }
  }

  return { passed: true, ruleId: POLICY_RULES.EVIDENCE_BASIS_COMPATIBILITY, claimType, primaryBasis };
}

/**
 * Validates temporal consistency and evidence freshness.
 */
function checkTemporalFreshness(evidence, claimType, evaluationTime = new Date()) {
  const sources = evidence.sources || [];
  const primarySource = sources[0] || {};
  const retrievedAt = new Date(primarySource.retrievedAt || evidence.timeframe?.endUtc || 0);
  const evalTime = new Date(evaluationTime);

  if (Number.isNaN(retrievedAt.getTime())) {
    return { passed: false, ruleId: POLICY_RULES.TEMPORAL_CONSISTENCY_AND_FRESHNESS, reason: 'Invalid or missing retrieval timestamp.' };
  }

  // Evidence cannot originate from the future
  if (retrievedAt.getTime() > evalTime.getTime() + 60_000) {
    return { passed: false, ruleId: POLICY_RULES.TEMPORAL_CONSISTENCY_AND_FRESHNESS, reason: 'Temporal violation: Evidence timestamp is in the future relative to evaluation time.' };
  }

  const ageHours = (evalTime.getTime() - retrievedAt.getTime()) / (1000 * 60 * 60);

  if (claimType === CLAIM_TYPES.ENVIRONMENTAL_OBSERVATION) {
    const isSatellite = primarySource.dataKind?.includes('SATELLITE') || primarySource.sourceId?.includes('sentinel') || primarySource.sourceId?.includes('viirs');
    const maxAge = isSatellite ? MAX_SATELLITE_AGE_HOURS : MAX_OBSERVATION_AGE_HOURS;
    if (ageHours > maxAge) {
      return {
        passed: false,
        ruleId: POLICY_RULES.TEMPORAL_CONSISTENCY_AND_FRESHNESS,
        reason: `Evidence is stale (${Math.round(ageHours)} hours old). Maximum allowed age for ${isSatellite ? 'satellite' : 'ground'} observation is ${maxAge} hours.`,
        code: 'EVIDENCE_STALE',
      };
    }
  }

  return { passed: true, ruleId: POLICY_RULES.TEMPORAL_CONSISTENCY_AND_FRESHNESS, ageHours: Math.round(ageHours * 10) / 10 };
}

/**
 * Checks geographic consistency and bounds.
 */
function checkGeographicConsistency(evidence, scope) {
  const location = evidence.location || {};
  const lat = location.lat ?? scope?.lat;
  const lon = location.lon ?? scope?.lon;

  if (lat === undefined || lon === undefined) {
    return { passed: false, ruleId: POLICY_RULES.GEOGRAPHIC_SCOPE_CONSISTENCY, reason: 'Evidence or scope is missing geographic coordinates.' };
  }

  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { passed: false, ruleId: POLICY_RULES.GEOGRAPHIC_SCOPE_CONSISTENCY, reason: `Invalid geographic coordinates: lat=${lat}, lon=${lon}.` };
  }

  return { passed: true, ruleId: POLICY_RULES.GEOGRAPHIC_SCOPE_CONSISTENCY, lat, lon };
}

/**
 * Checks duplicate and overlapping claim-scope exclusivity.
 * Distinguishes identical activities from legitimate co-located distinct activities.
 */
function checkScopeExclusivity(claim, existingClaims = []) {
  const scope = claim.scope || {};
  const currentCompositeKey = computeCompositeScopeKey(scope);
  const currentClaimId = claim.claimId;
  const currentEvidenceDigest = claim.evidence?.[0]?.digest;

  for (const existing of existingClaims) {
    // If the claim was rejected or superseded, it doesn't block
    if (existing.status === 'Rejected' || existing.status === 'Superseded') continue;

    // Check 1: Exact evidence digest reused for another active claim
    const existingDigest = existing.evidence?.[0]?.digest || existing.evidenceDigest;
    if (existingDigest && currentEvidenceDigest && existingDigest === currentEvidenceDigest && existing.claimId !== currentClaimId) {
      return {
        passed: false,
        ruleId: POLICY_RULES.DUPLICATE_SCOPE_EXCLUSIVITY,
        reason: `Evidence Reuse Violation: Evidence digest ${currentEvidenceDigest.slice(0, 16)}... is already committed to active claim ${existing.claimId}.`,
        code: 'EVIDENCE_ALREADY_CLAIMED',
      };
    }

    // Check 2: Same composite scope (domain + boundary + epoch + activity) with a different claim ID
    const existingCompositeKey = existing.compositeScopeKey || computeCompositeScopeKey(existing.scope);
    if (existingCompositeKey && currentCompositeKey && existingCompositeKey === currentCompositeKey && existing.claimId !== currentClaimId) {
      return {
        passed: false,
        ruleId: POLICY_RULES.DUPLICATE_SCOPE_EXCLUSIVITY,
        reason: `Duplicate Claim Scope: An active claim (${existing.claimId}) already covers ${scope.activityType || scope.analyte} at this location for this time period. Generating a new claim ID does not evade scope exclusivity.`,
        code: 'DUPLICATE_CLAIM_SCOPE_DETECTED',
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
  const comparisons = evidence.comparisons || [];
  for (const comp of comparisons) {
    if (comp.status === 'CONTRADICTORY' || comp.status === 'DIVERGENT') {
      return {
        passed: false,
        ruleId: POLICY_RULES.CONTRADICTORY_EVIDENCE_RECONCILIATION,
        reason: `Contradictory source assertion detected: ${comp.reason || 'Dual-source measurements diverge significantly.'}`,
        requiresHumanReview: true,
      };
    }
  }
  return { passed: true, ruleId: POLICY_RULES.CONTRADICTORY_EVIDENCE_RECONCILIATION };
}

/**
 * Checks completeness and uncertainty bounds.
 */
function checkSufficiency(evidence, claim) {
  const measurements = evidence.measurements || [];
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

/**
 * Main Evidence-to-Claim Trust Firewall Evaluation Function.
 *
 * @param {Object} options
 * @param {Object} options.claim - The submitted claim object
 * @param {Object} options.evidence - The evidence bundle backing the claim
 * @param {string} options.expectedDigest - Expected canonical SHA-256 digest
 * @param {string} [options.claimType] - Explicit claim type (defaults to claim.claimType or inferred)
 * @param {Array} [options.existingClaims] - Currently active claims in registry for duplicate check
 * @param {Date|string} [options.evaluationTime] - Current time anchor (default: now)
 * @returns {Object} FirewallEvaluationResult with verdict, rule details, and receipt
 */
export function evaluateClaimThroughFirewall({
  claim,
  evidence,
  expectedDigest,
  claimType,
  existingClaims = [],
  evaluationTime = new Date(),
}) {
  const resolvedClaimType = claimType || claim?.claimType || claim?.result?.claimType || CLAIM_TYPES.ENVIRONMENTAL_OBSERVATION;
  const ruleResults = [];
  const errors = [];
  let requiresHumanReview = false;
  let isUnknown = false;

  // Rule 1: Canonical Serialization & Hash Integrity
  const hashCheck = checkHashIntegrity(evidence, expectedDigest || claim?.evidence?.[0]?.digest);
  ruleResults.push(hashCheck);
  if (!hashCheck.passed) errors.push(hashCheck.reason);

  // Rule 2: Provenance & Source Authenticity
  const provCheck = checkProvenance(evidence);
  ruleResults.push(provCheck);
  if (!provCheck.passed) errors.push(provCheck.reason);

  // Rule 3: Evidence Basis Compatibility (Model vs. Observation vs. Reduction)
  const basisCheck = checkBasisCompatibility(resolvedClaimType, evidence, claim?.result);
  ruleResults.push(basisCheck);
  if (!basisCheck.passed) errors.push(basisCheck.reason);

  // Rule 4: Temporal Consistency & Freshness
  const timeCheck = checkTemporalFreshness(evidence, resolvedClaimType, evaluationTime);
  ruleResults.push(timeCheck);
  if (!timeCheck.passed) errors.push(timeCheck.reason);

  // Rule 5: Geographic Scope Consistency
  const geoCheck = checkGeographicConsistency(evidence, claim?.scope);
  ruleResults.push(geoCheck);
  if (!geoCheck.passed) errors.push(geoCheck.reason);

  // Rule 6: Duplicate Scope & Exclusivity Detection
  const scopeCheck = checkScopeExclusivity(claim, existingClaims);
  ruleResults.push(scopeCheck);
  if (!scopeCheck.passed) errors.push(scopeCheck.reason);

  // Rule 7: Multi-Source Contradictions
  const contraCheck = checkContradictions(evidence);
  ruleResults.push(contraCheck);
  if (!contraCheck.passed) {
    if (contraCheck.requiresHumanReview) requiresHumanReview = true;
    else errors.push(contraCheck.reason);
  }

  // Rule 8: Uncertainty & Evidence Sufficiency
  const suffCheck = checkSufficiency(evidence, claim);
  ruleResults.push(suffCheck);
  if (!suffCheck.passed) {
    if (suffCheck.isUnknown) isUnknown = true;
    else errors.push(suffCheck.reason);
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
    evaluatedAt: new Date(evaluationTime).toISOString(),
    claimId: claim?.claimId || 'unassigned',
    claimType: resolvedClaimType,
    evidenceDigest: expectedDigest || claim?.evidence?.[0]?.digest || null,
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

  const firewallReceiptHash = digestOf(receiptBody);
  const receiptId = `rcpt-${firewallReceiptHash.slice(0, 24)}`;
  const receipt = { receiptId, ...receiptBody, firewallReceiptHash };

  return {
    verdict,
    receiptId,
    receipt,
    errors,
    ruleResults,
    eligibleForOnChainSubmission: verdict === VERDICTS.ACCEPTED,
    scopeKey: scopeCheck.compositeScopeKey,
    limitsNotice: 'The Trust Firewall verifies deterministic policy compliance and provenance. It does not replace independent on-site scientific calibration or regulatory certification.',
  };
}
