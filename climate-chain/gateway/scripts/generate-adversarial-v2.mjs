// Generates fixtures/adversarial-claims-v2.json: the v2 adversarial suite for the Trust Firewall.
//   node scripts/generate-adversarial-v2.mjs
//
// HOW TO READ THIS SUITE (also stated in docs/TRUST_FIREWALL_BENCHMARK_REPORT.md):
//  - All cases are SYNTHETIC and authored by the project team AFTER probing the v1 firewall for blind spots.
//    It is therefore a targeted regression/threat-model suite, not a blind held-out test.
//  - group FIXED_BLIND_SPOT : attacks the v1 firewall wrongly accepted (or genuine claims it wrongly rejected).
//  - group SUBTYPE          : claim-type-aware sufficiency (methane response, livestock traceability, air quality).
//  - group KNOWN_LIMITATION : unsafe claims the firewall CANNOT detect. expectedVerdict is ACCEPTED on purpose; the
//                             suite documents them so nobody mistakes "0 failures" for "no way to fool it".

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { digestOf, sha256Hex } from '../integrity-evidence.mjs';
import { CLAIM_TYPES, computeCompositeScopeKey } from '../trust-firewall.mjs';
import { evidenceFingerprints } from '../claim-sufficiency.mjs';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const iso = (offsetHours) => new Date(NOW + offsetHours * 3600_000).toISOString();

const PERMIAN = { siteId: 'permian-wellhead-4', lat: 31.89, lon: -102.32 };
const DELHI = { siteId: 'delhi-anand-vihar', lat: 28.6469, lon: 77.316 };
const CHENNAI = { siteId: 'chennai-adyar', lat: 13.0067, lon: 80.2575 };
const FEEDLOT = { siteId: 'feedlot-c', lat: 35.2, lon: -101.8 };

function bundle({ site, sourceId, dataKind = 'GROUND_STATION_OBSERVED', basis = 'OBSERVED_MONITOR', measurements, retrievedAgoH = 2, extra = {} }) {
  const retrievedAt = iso(-retrievedAgoH);
  return {
    schema: 'climate-chain:evidence-bundle:v1',
    evidenceId: `ev-${sha256Hex(JSON.stringify([site.siteId, sourceId, measurements])).slice(0, 24)}`,
    location: { siteId: site.siteId, lat: site.lat, lon: site.lon },
    timeframe: { startUtc: retrievedAt, endUtc: retrievedAt },
    sources: [{ sourceId, dataKind, basis, retrievedAt }],
    measurements,
    uncertainty: ['Instrument tolerance +/- 5%'],
    comparisons: [],
    custody: [
      { step: 'retrieved', at: retrievedAt, actor: 'gateway' },
      { step: 'bundled', actor: 'trust-firewall' },
    ],
    ...extra,
  };
}

const m = (analyte, value, unit, basis, validTimeUtc, extra = {}) => ({ measurementId: `${analyte}@${validTimeUtc}`, analyte, value, unit, basis, validTimeUtc, ...extra });

const cases = [];
let nextId = 1;
function add({ name, group, category, claimType, claimSubtype, requireSubtype = false, scope, result, claimant, evidence, existingClaims, expectedVerdict, expectedCode = null, isUnsafeClaim, knownLimitation = false }) {
  const digest = digestOf(evidence);
  const claim = {
    claimId: `v2-cl-${nextId}`,
    claimType,
    scope,
    claimant,
    evidence: [{ evidenceId: evidence.evidenceId, digest }],
    result,
  };
  cases.push({
    id: nextId++, name, group, category, expectedVerdict, expectedCode, isUnsafeClaim, knownLimitation,
    options: { claimSubtype: claimSubtype || null, requireSubtype },
    claim, evidence, expectedDigest: digest,
    ...(existingClaims ? { existingClaims } : {}),
  });
}

const OBS = CLAIM_TYPES.ENVIRONMENTAL_OBSERVATION;
const RISK = CLAIM_TYPES.ENVIRONMENTAL_RISK_ALERT;
const INT = CLAIM_TYPES.INTERVENTION_COMPLETION;
const RED = CLAIM_TYPES.QUANTIFIED_EMISSIONS_REDUCTION;
const pm = (site, extra = {}) => bundle({ site, sourceId: `monitor-${site.siteId}`, measurements: [m('pm2_5', 42.5, 'ug/m3', 'OBSERVED_MONITOR', iso(-2))], ...extra });
const delhiScope = { domain: 'air_quality', boundary: DELHI.siteId, timeEpoch: '2026-10-24', activityType: 'monitoring', lat: DELHI.lat, lon: DELHI.lon };

// ------------------------------------------------------------------ FIXED_BLIND_SPOT
add({ name: 'A1 evidence from Chennai backs a claim scoped to Delhi', group: 'FIXED_BLIND_SPOT', category: 'WRONG_PLACE', claimType: OBS, scope: delhiScope, result: { value: 42.5 }, evidence: pm(CHENNAI), expectedVerdict: 'REJECTED', expectedCode: 'EVIDENCE_NOT_AT_CLAIMED_LOCATION', isUnsafeClaim: true });
add({ name: 'A2a PM2.5 bundle backing a methane-avoidance claim with "trust me" methodology', group: 'FIXED_BLIND_SPOT', category: 'SOURCE_DOES_NOT_SUPPORT_CLAIM', claimType: RED, scope: { domain: 'methane_abatement', boundary: DELHI.siteId, timeEpoch: '2026-Q4', activityType: 'leak_repair', lat: DELHI.lat, lon: DELHI.lon }, result: { value: 5000, unit: 'tCO2e', baselineMethodology: 'trust me' }, evidence: pm(DELHI), expectedVerdict: 'HUMAN_REVIEW_REQUIRED', expectedCode: 'UNRECOGNISED_METHODOLOGY', isUnsafeClaim: true });
add({ name: 'A2b same claim with the methane-response profile selected', group: 'FIXED_BLIND_SPOT', category: 'SOURCE_DOES_NOT_SUPPORT_CLAIM', claimType: RED, claimSubtype: 'methane-response', scope: { domain: 'methane_abatement', boundary: DELHI.siteId, timeEpoch: '2026-Q4', activityType: 'leak_repair', lat: DELHI.lat, lon: DELHI.lon }, result: { value: 5000, unit: 'tCO2e', baselineMethodology: 'EPA Subpart W' }, evidence: pm(DELHI), expectedVerdict: 'REJECTED', expectedCode: 'CLAIM_ANALYTE_NOT_IN_EVIDENCE', isUnsafeClaim: true });
add({ name: 'A3 dataKind UNOBSERVED_MODEL_ESTIMATE passes a substring test for OBSERVED', group: 'FIXED_BLIND_SPOT', category: 'LABEL_TRICK', claimType: OBS, scope: delhiScope, result: { value: 42.5 }, evidence: bundle({ site: DELHI, sourceId: 'cams-global', dataKind: 'UNOBSERVED_MODEL_ESTIMATE', basis: 'MODEL_FORECAST', measurements: [m('pm2_5', 42.5, 'ug/m3', 'MODEL_FORECAST', iso(-2))] }), expectedVerdict: 'REJECTED', expectedCode: 'MODEL_CANNOT_PROVE_OBSERVATION', isUnsafeClaim: true });
add({ name: 'A3b observed temperature first, modelled PM2.5 second', group: 'FIXED_BLIND_SPOT', category: 'HIDDEN_MODEL_VALUE', claimType: OBS, scope: delhiScope, result: { value: 42.5 }, evidence: bundle({ site: DELHI, sourceId: 'monitor-mixed', measurements: [m('temperature_2m', 31, 'C', 'OBSERVED_MONITOR', iso(-2)), m('pm2_5', 42.5, 'ug/m3', 'MODEL_FORECAST', iso(-2))] }), expectedVerdict: 'REJECTED', expectedCode: 'MODEL_CANNOT_PROVE_OBSERVATION', isUnsafeClaim: true });
add({ name: 'A4 simulated/synthetic scenario claimed as a carbon reduction', group: 'FIXED_BLIND_SPOT', category: 'MODEL_UNDER_ANOTHER_NAME', claimType: RED, scope: { domain: 'carbon_offset', boundary: PERMIAN.siteId, timeEpoch: '2026-Q4', activityType: 'offset', lat: PERMIAN.lat, lon: PERMIAN.lon }, result: { value: 900, unit: 'tCO2e', baselineMethodology: 'EPA Subpart W' }, evidence: bundle({ site: PERMIAN, sourceId: 'scenario-engine', dataKind: 'SYNTHETIC_SCENARIO', basis: 'SIMULATED', measurements: [m('ch4_emission_rate', 400, 'kg/h', 'SIMULATED', iso(-2))] }), expectedVerdict: 'REJECTED', expectedCode: 'MODEL_CANNOT_PROVE_EMISSIONS_REDUCTION', isUnsafeClaim: true });

const permianExistingScope = { domain: 'methane', boundary: 'permian-wellhead-4', timeEpoch: '2026-Q4', activityType: 'fugitive_leak_repair', lat: PERMIAN.lat, lon: PERMIAN.lon };
const permianEvidence = () => bundle({ site: PERMIAN, sourceId: 'carbonmapper', dataKind: 'SATELLITE_MEASURED_CARBON_MAPPER', basis: 'SATELLITE_MEASURED', measurements: [m('ch4_emission_rate', 450, 'kg/h', 'SATELLITE_MEASURED', iso(-30))], extra: { methodology: 'EPA Subpart W' } });
const existingPermian = { claimId: 'existing-permian-claim', status: 'Submitted', scope: permianExistingScope, compositeScopeKey: computeCompositeScopeKey(permianExistingScope), location: { lat: PERMIAN.lat, lon: PERMIAN.lon }, evidence: [{ digest: '0x' + 'ab'.repeat(32) }] };
const reduction = (label, scopeOverride, expectedCode, name) => add({ name, group: 'FIXED_BLIND_SPOT', category: label, claimType: RED, scope: { ...permianExistingScope, ...scopeOverride }, result: { value: 12.4, unit: 'tCO2e', baselineMethodology: 'EPA Subpart W' }, evidence: permianEvidence(), existingClaims: [existingPermian], expectedVerdict: 'REJECTED', expectedCode, isUnsafeClaim: true });
reduction('EXACT_DUPLICATE_CONTROL', {}, 'DUPLICATE_CLAIM_SCOPE_DETECTED', 'B0 control: identical scope under a new claim id');
reduction('OVERLAP_BOUNDARY_RELABEL', { boundary: 'Permian Wellhead #4' }, 'OVERLAPPING_CLAIM_SCOPE_DETECTED', 'B1 boundary relabelled "Permian Wellhead #4"');
reduction('OVERLAP_NESTED_PERIOD', { timeEpoch: '2026-10' }, 'OVERLAPPING_CLAIM_SCOPE_DETECTED', 'B2 October claimed inside an existing Q4 claim');
reduction('OVERLAP_ACTIVITY_SYNONYM', { activityType: 'leak_repair' }, 'OVERLAPPING_CLAIM_SCOPE_DETECTED', 'B3 activity reworded to "leak_repair"');
reduction('OVERLAP_DOMAIN_ALIAS', { domain: 'ch4_abatement' }, 'OVERLAPPING_CLAIM_SCOPE_DETECTED', 'B4 domain renamed "ch4_abatement"');
{
  const original = permianEvidence();
  const rewrapped = { ...permianEvidence(), notes: 'resubmitted with an extra wrapper field' };
  add({ name: 'B5 same measurements re-wrapped to obtain a new digest', group: 'FIXED_BLIND_SPOT', category: 'EVIDENCE_REWRAP', claimType: RED, scope: { ...permianExistingScope, boundary: 'another-boundary', timeEpoch: '2026-Q3', activityType: 'compressor_replacement', lat: 40, lon: -100 }, result: { value: 12.4, unit: 'tCO2e', baselineMethodology: 'EPA Subpart W' }, evidence: { ...rewrapped, location: { siteId: 'x', lat: 40, lon: -100 } }, existingClaims: [{ ...existingPermian, evidenceFingerprints: evidenceFingerprints(original) }], expectedVerdict: 'REJECTED', expectedCode: 'EVIDENCE_CONTENT_ALREADY_CLAIMED', isUnsafeClaim: true });
}
add({ name: 'C1 fresh download of a 2019 measurement', group: 'FIXED_BLIND_SPOT', category: 'STALE_DATA_LAUNDERING', claimType: OBS, scope: delhiScope, result: { value: 42.5 }, evidence: bundle({ site: DELHI, sourceId: 'monitor-old', measurements: [m('pm2_5', 42.5, 'ug/m3', 'OBSERVED_MONITOR', '2019-01-01T00:00:00Z')] }), expectedVerdict: 'REJECTED', expectedCode: 'EVIDENCE_STALE', isUnsafeClaim: true });
add({ name: 'C2a risk alert with a 9,999 hour horizon', group: 'FIXED_BLIND_SPOT', category: 'UNBOUNDED_FORECAST', claimType: RISK, scope: delhiScope, result: { value: 0.9 }, evidence: bundle({ site: DELHI, sourceId: 'burn-model', dataKind: 'PREDICTIVE_MODEL', basis: 'MODEL_FORECAST', measurements: [m('burn_risk_index', 0.9, 'index', 'MODEL_FORECAST', iso(-2))], extra: { forecastHorizonHours: 9999 } }), expectedVerdict: 'REJECTED', expectedCode: 'RISK_HORIZON_EXCEEDED', isUnsafeClaim: true });
add({ name: 'C2b risk alert resting on a forecast issued 100 hours ago', group: 'FIXED_BLIND_SPOT', category: 'STALE_FORECAST', claimType: RISK, scope: delhiScope, result: { value: 0.9 }, evidence: bundle({ site: DELHI, sourceId: 'burn-model', dataKind: 'PREDICTIVE_MODEL', basis: 'MODEL_FORECAST', retrievedAgoH: 100, measurements: [m('burn_risk_index', 0.9, 'index', 'MODEL_FORECAST', iso(-100))], extra: { forecastHorizonHours: 48 } }), expectedVerdict: 'REJECTED', expectedCode: 'FORECAST_STALE', isUnsafeClaim: true });
add({ name: 'D1 intervention manifest says CANCELLED', group: 'FIXED_BLIND_SPOT', category: 'INCOMPLETE_INTERVENTION', claimType: INT, scope: { ...delhiScope, activityType: 'baler_logistics' }, result: { statement: 'Straw cleared' }, evidence: bundle({ site: DELHI, sourceId: 'field-agent', basis: 'COMMUNITY_REPORT', measurements: [m('baler_dispatch', 1, 'job', 'COMMUNITY_REPORT', iso(-2))], extra: { manifest: { dispatchId: 'j1', status: 'CANCELLED' } } }), expectedVerdict: 'REJECTED', expectedCode: 'INTERVENTION_NOT_COMPLETED', isUnsafeClaim: true });
add({ name: 'D2 only a dispatch step, no completion', group: 'FIXED_BLIND_SPOT', category: 'DISPATCH_IS_NOT_COMPLETION', claimType: INT, scope: { ...delhiScope, activityType: 'baler_logistics' }, result: { statement: 'Straw cleared' }, evidence: (() => { const e = bundle({ site: DELHI, sourceId: 'field-agent', basis: 'COMMUNITY_REPORT', measurements: [m('baler_dispatch', 1, 'job', 'COMMUNITY_REPORT', iso(-2))] }); e.custody.push({ step: 'dispatched', at: iso(-1) }); return e; })(), expectedVerdict: 'REJECTED', expectedCode: 'DISPATCH_IS_NOT_COMPLETION', isUnsafeClaim: true });
add({ name: 'F2 invented claim type with a model-sourced 1e9 tCO2e', group: 'FIXED_BLIND_SPOT', category: 'UNKNOWN_CLAIM_TYPE', claimType: 'SUPER_CARBON_CREDIT', scope: delhiScope, result: { value: 1e9, unit: 'tCO2e' }, evidence: bundle({ site: DELHI, sourceId: 'cams-global', dataKind: 'GLOBAL_CLIMATE_MODEL', basis: 'MODEL_FORECAST', measurements: [m('co2_model', 1e9, 'tCO2e', 'MODEL_FORECAST', iso(-2))] }), expectedVerdict: 'UNKNOWN', expectedCode: 'UNKNOWN_CLAIM_TYPE', isUnsafeClaim: true });
add({ name: 'E1 genuine TROPOMI retrieval (basis RETRIEVAL) is NOT a modelled reading', group: 'FIXED_BLIND_SPOT', category: 'GENUINE_BUT_UNUSUAL_LABEL', claimType: OBS, scope: { ...delhiScope, analyte: 'no2' }, result: { value: 9e15 }, evidence: bundle({ site: DELHI, sourceId: 'sentinel-5p-tropomi', dataKind: 'REMOTE_SENSING_L2_RETRIEVAL', basis: 'RETRIEVAL', retrievedAgoH: 30, measurements: [m('no2_column', 9e15, 'molec/cm2', 'RETRIEVAL', iso(-30))] }), expectedVerdict: 'ACCEPTED', isUnsafeClaim: false });
add({ name: 'E3 monthly-mean claim resting on a 10-day-old satellite retrieval', group: 'FIXED_BLIND_SPOT', category: 'GENUINE_AVERAGING_PERIOD', claimType: OBS, scope: { ...delhiScope, activityType: 'monthly_mean' }, result: { value: 9e15, periodHours: 720 }, evidence: bundle({ site: DELHI, sourceId: 'sentinel-5p-tropomi', dataKind: 'SATELLITE_MEASURED', basis: 'SATELLITE_MEASURED', retrievedAgoH: 240, measurements: [m('no2_column', 9e15, 'molec/cm2', 'SATELLITE_MEASURED', iso(-240))] }), expectedVerdict: 'ACCEPTED', isUnsafeClaim: false });

// ------------------------------------------------------------------ SUBTYPE: methane-response
const mrScope = { domain: 'methane_abatement', boundary: PERMIAN.siteId, timeEpoch: '2026-10', activityType: 'wellhead_repair', lat: PERMIAN.lat, lon: PERMIAN.lon };
function methane({ name, post = 20, postAt = iso(-100), claimed = 100, verifier = 'independent-auditor', withPost = true, basis = 'SATELLITE_MEASURED', evidenceSite = PERMIAN, status = 'COMPLETED', expectedVerdict, expectedCode, unsafe }) {
  const measurements = [m('ch4_emission_rate', 450, 'kg/h', basis, iso(-300), { phase: 'baseline' })];
  if (withPost) measurements.push(m('ch4_emission_rate', post, 'kg/h', basis, postAt, { phase: 'post_repair' }));
  const evidence = bundle({ site: evidenceSite, sourceId: 'carbonmapper', dataKind: 'SATELLITE_MEASURED_CARBON_MAPPER', basis, measurements, extra: { manifest: { workOrder: 'WO-77', status, dispatchedAt: iso(-250), completedAt: iso(-200), verifier }, methodology: 'EPA Subpart W' } });
  add({ name, group: 'SUBTYPE', category: 'METHANE_RESPONSE', claimType: RED, claimSubtype: 'methane-response', scope: mrScope, claimant: 'operator-x', result: { value: claimed, unit: 'tCO2e', periodHours: 24, baselineMethodology: 'EPA Subpart W' }, evidence, expectedVerdict, expectedCode, isUnsafeClaim: unsafe });
}
methane({ name: 'M1 valid: measured rate drop 430 kg/h supports the claimed 100 tCO2e', expectedVerdict: 'ACCEPTED', unsafe: false });
methane({ name: 'M2 claimed 5,000 tCO2e but the rate drop supports at most ~310', claimed: 5000, expectedVerdict: 'REJECTED', expectedCode: 'CLAIM_EXCEEDS_MEASURED_REDUCTION', unsafe: true });
methane({ name: 'M3 no post-repair measurement', withPost: false, expectedVerdict: 'UNKNOWN', expectedCode: 'BASELINE_AND_POST_REPAIR_REQUIRED', unsafe: true });
methane({ name: 'M4 post-repair measurement predates the repair', postAt: iso(-260), expectedVerdict: 'REJECTED', expectedCode: 'POST_REPAIR_NOT_AFTER_REPAIR', unsafe: true });
methane({ name: 'M5 repair verified by the claimant itself', verifier: 'operator-x', expectedVerdict: 'HUMAN_REVIEW_REQUIRED', expectedCode: 'VERIFIER_NOT_INDEPENDENT', unsafe: true });
methane({ name: 'M6 modelled methane cannot prove a reduction', basis: 'MODEL_FORECAST', expectedVerdict: 'REJECTED', expectedCode: 'MODEL_CANNOT_PROVE_EMISSIONS_REDUCTION', unsafe: true });
methane({ name: 'M7 evidence collected 20 km from the claimed wellhead', evidenceSite: { siteId: 'permian-wellhead-4', lat: PERMIAN.lat + 0.18, lon: PERMIAN.lon }, expectedVerdict: 'REJECTED', expectedCode: 'EVIDENCE_NOT_AT_CLAIMED_LOCATION', unsafe: true });
methane({ name: 'M8 repair work order is still IN_PROGRESS', status: 'IN_PROGRESS', expectedVerdict: 'REJECTED', expectedCode: 'REPAIR_NOT_COMPLETED', unsafe: true });

// ------------------------------------------------------------------ SUBTYPE: livestock-traceability
const lsScope = { domain: 'livestock', boundary: FEEDLOT.siteId, timeEpoch: '2026-10', activityType: 'lot_traceability', lat: FEEDLOT.lat, lon: FEEDLOT.lon };
function livestock({ name, events, animals = ['BR-001', 'BR-002', 'BR-003', 'BR-004', 'BR-005'], registry = { registry: 'state-animal-registry', status: 'MATCHED', checkedBy: 'state-animal-registry' }, headCount = 5, existingClaims, expectedVerdict, expectedCode, unsafe }) {
  const traceability = { lotId: 'LOT-7', animalIds: animals, events, ...(registry ? { registryCrossCheck: registry } : {}) };
  const evidence = bundle({ site: FEEDLOT, sourceId: 'lot-ledger', basis: 'COMMUNITY_REPORT', measurements: [m('head_count', animals.length, 'animals', 'COMMUNITY_REPORT', iso(-2))], extra: { traceability, manifest: { status: 'COMPLETED', lotId: 'LOT-7' } } });
  add({ name, group: 'SUBTYPE', category: 'LIVESTOCK_TRACEABILITY', claimType: INT, claimSubtype: 'livestock-traceability', scope: lsScope, claimant: 'feedlot-c', result: { statement: 'Lot LOT-7 traced from birth farm to feedlot', headCount }, evidence, ...(existingClaims ? { existingClaims } : {}), expectedVerdict, expectedCode, isUnsafeClaim: unsafe });
}
const chain = [
  { type: 'birth', at: iso(-24 * 80), from: null, to: 'farm-a' },
  { type: 'move', at: iso(-24 * 50), from: 'farm-a', to: 'auction-b' },
  { type: 'move', at: iso(-24 * 40), from: 'auction-b', to: 'feedlot-c' },
];
livestock({ name: 'L1 valid: continuous custody, registry MATCHED, head count agrees', events: chain, expectedVerdict: 'ACCEPTED', unsafe: false });
livestock({ name: 'L2 custody break: animals left auction-b but next event starts at farm-z', events: [chain[0], chain[1], { ...chain[2], from: 'farm-z' }], expectedVerdict: 'REJECTED', expectedCode: 'CUSTODY_BREAK', unsafe: true });
livestock({ name: 'L3 sixty days unaccounted between two events', events: [chain[0], { type: 'move', at: iso(-24 * 10), from: 'farm-a', to: 'feedlot-c' }], expectedVerdict: 'HUMAN_REVIEW_REQUIRED', expectedCode: 'UNACCOUNTED_CUSTODY_GAP', unsafe: true });
livestock({ name: 'L4 animal BR-003 already belongs to another active claim (laundering)', events: chain, existingClaims: [{ claimId: 'other-lot-claim', status: 'Submitted', scope: { ...lsScope, boundary: 'other-farm', activityType: 'other_lot' }, animalIds: ['BR-003', 'BR-900'] }], expectedVerdict: 'REJECTED', expectedCode: 'ANIMAL_ALREADY_CLAIMED', unsafe: true });
livestock({ name: 'L5 no registry cross-check', events: chain, registry: null, expectedVerdict: 'UNKNOWN', expectedCode: 'REGISTRY_CROSS_CHECK_REQUIRED', unsafe: true });
livestock({ name: 'L6 claim states 9 animals, record lists 5', events: chain, headCount: 9, expectedVerdict: 'REJECTED', expectedCode: 'HEAD_COUNT_MISMATCH', unsafe: true });
livestock({ name: 'L7 registry reports UNMATCHED', events: chain, registry: { registry: 'state-animal-registry', status: 'UNMATCHED', checkedBy: 'state-animal-registry' }, expectedVerdict: 'REJECTED', expectedCode: 'REGISTRY_MISMATCH', unsafe: true });

// ------------------------------------------------------------------ SUBTYPE: air-quality
const aq = (name, claimResult, ev, expectedVerdict, expectedCode, unsafe, scope = delhiScope) => add({ name, group: 'SUBTYPE', category: 'AIR_QUALITY', claimType: OBS, claimSubtype: 'air-quality', scope, claimant: 'ngo-a', result: claimResult, evidence: ev, expectedVerdict, expectedCode, isUnsafeClaim: unsafe });
aq('Q1 valid: claimed PM2.5 matches the observed value', { analyte: 'pm2_5', value: 42.5, unit: 'µg/m³' }, pm(DELHI), 'ACCEPTED', undefined, false);
aq('Q2 claimed PM2.5 of 120 against an observed 42.5', { analyte: 'pm2_5', value: 120, unit: 'ug/m3' }, pm(DELHI), 'REJECTED', 'CLAIM_VALUE_MISMATCH', true);
aq('Q3 claims NO2 but the bundle only contains PM2.5', { analyte: 'no2', value: 42.5, unit: 'ug/m3' }, pm(DELHI), 'REJECTED', 'CLAIM_ANALYTE_NOT_IN_EVIDENCE', true);
aq('Q4 claims ppb while the bundle is in ug/m3', { analyte: 'pm2_5', value: 42.5, unit: 'ppb' }, pm(DELHI), 'REJECTED', 'UNIT_MISMATCH', true);

// ------------------------------------------------------------------ KNOWN_LIMITATION (expected ACCEPTED, unsafe)
add({ name: 'K1 fabricated-but-consistent: invented Delhi monitor reading with its own correct digest', group: 'KNOWN_LIMITATION', category: 'FABRICATED_EVIDENCE', claimType: OBS, claimSubtype: 'air-quality', scope: delhiScope, claimant: 'bad-actor', result: { analyte: 'pm2_5', value: 42.5, unit: 'ug/m3' }, evidence: pm(DELHI), expectedVerdict: 'ACCEPTED', isUnsafeClaim: true, knownLimitation: true });
add({ name: 'K2 same leak repair re-claimed ~8 km away under a different boundary label (outside the 0.05 degree overlap cell)', group: 'KNOWN_LIMITATION', category: 'OVERLAP_THRESHOLD_EVASION', claimType: RED, scope: { ...permianExistingScope, boundary: 'other-label', lat: PERMIAN.lat + 0.07, lon: PERMIAN.lon }, result: { value: 12.4, unit: 'tCO2e', baselineMethodology: 'EPA Subpart W' }, evidence: bundle({ site: { siteId: 'x', lat: PERMIAN.lat + 0.07, lon: PERMIAN.lon }, sourceId: 'carbonmapper', dataKind: 'SATELLITE_MEASURED_CARBON_MAPPER', basis: 'SATELLITE_MEASURED', measurements: [m('ch4_emission_rate', 449, 'kg/h', 'SATELLITE_MEASURED', iso(-31))], extra: { methodology: 'EPA Subpart W' } }), existingClaims: [existingPermian], expectedVerdict: 'ACCEPTED', isUnsafeClaim: true, knownLimitation: true });

const outPath = fileURLToPath(new URL('../fixtures/adversarial-claims-v2.json', import.meta.url));
writeFileSync(outPath, JSON.stringify(cases, null, 2));
console.log(`wrote ${cases.length} cases -> fixtures/adversarial-claims-v2.json`);
