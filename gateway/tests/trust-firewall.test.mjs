// Unit and adversarial benchmark tests for the Evidence-to-Claim Trust Firewall.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { runBenchmark } from '../benchmark-runner.mjs';
import {
  CLAIM_TYPES,
  POLICY_RULES,
  VERDICTS,
  computeCompositeScopeKey,
  evaluateClaimThroughFirewall,
} from '../trust-firewall.mjs';
import { digestOf } from '../integrity-evidence.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FIXTURES_FILE = join(ROOT, 'fixtures/adversarial-claims.json');

test('Trust Firewall: computeCompositeScopeKey generates deterministic collision-resistant hashes', () => {
  const scope1 = { domain: 'air_quality', boundary: 'delhi-anand-vihar', timeEpoch: '2026-10-24', activityType: 'pm25_audit' };
  const scope2 = { domain: 'air_quality', boundary: 'delhi-anand-vihar', timeEpoch: '2026-10-24', activityType: 'pm25_audit' };
  const scopeDifferentActivity = { domain: 'air_quality', boundary: 'delhi-anand-vihar', timeEpoch: '2026-10-24', activityType: 'tree_canopy_audit' };

  const key1 = computeCompositeScopeKey(scope1);
  const key2 = computeCompositeScopeKey(scope2);
  const key3 = computeCompositeScopeKey(scopeDifferentActivity);

  assert.equal(key1, key2, 'Identical scope parameters must yield identical composite keys.');
  assert.notEqual(key1, key3, 'Different activity types at same site and epoch must yield distinct keys.');
  assert.equal(key1.length, 64, 'Scope key must be a 64-char hex string.');
});

test('Trust Firewall: Model-to-Observation Prohibition strictly blocks simulated data', () => {
  const evidence = {
    sources: [{ sourceId: 'open-meteo-cams', dataKind: 'MODEL_FORECAST', basis: 'MODEL_FORECAST', retrievedAt: '2026-10-24T10:00:00Z' }],
    location: { lat: 28.6, lon: 77.2 },
    timeframe: { startUtc: '2026-10-24T00:00:00Z', endUtc: '2026-10-24T10:00:00Z' },
    measurements: [{ measurementId: 'pm25@1', analyte: 'pm2_5', basis: 'MODEL_FORECAST', value: 45.0, unit: 'μg/m³' }],
    custody: [{ step: 'retrieved' }, { step: 'bundled' }],
  };
  const digest = digestOf(evidence);
  const claim = {
    claimId: 'cl-illegal-model-claim',
    claimType: CLAIM_TYPES.ENVIRONMENTAL_OBSERVATION,
    scope: { domain: 'air', boundary: 'delhi', timeEpoch: '2026-10-24', activityType: 'pm25' },
    evidence: [{ digest }],
    result: { statement: 'Model used as ground truth' },
  };

  const result = evaluateClaimThroughFirewall({
    claim,
    evidence,
    expectedDigest: digest,
    claimType: CLAIM_TYPES.ENVIRONMENTAL_OBSERVATION,
    evaluationTime: new Date('2026-10-24T12:00:00Z'),
  });

  assert.equal(result.verdict, VERDICTS.REJECTED);
  assert.equal(result.eligibleForOnChainSubmission, false);
  assert.ok(result.errors.some((e) => /Model-to-Observation Prohibition/i.test(e)));
});

test('Trust Firewall: Model-to-Carbon Prohibition strictly blocks model-derived emission credits', () => {
  const evidence = {
    sources: [{ sourceId: 'simulation-engine', dataKind: 'SIMULATED_MODEL', basis: 'MODEL_FORECAST', retrievedAt: '2026-10-24T10:00:00Z' }],
    location: { lat: 31.8, lon: -102.3 },
    timeframe: { startUtc: '2026-10-24T00:00:00Z', endUtc: '2026-10-24T10:00:00Z' },
    measurements: [{ measurementId: 'co2@1', analyte: 'co2', basis: 'MODEL_FORECAST', value: 120.0, unit: 'tCO2e' }],
    custody: [{ step: 'retrieved' }, { step: 'bundled' }],
  };
  const digest = digestOf(evidence);
  const claim = {
    claimId: 'cl-fake-carbon-credit',
    claimType: CLAIM_TYPES.QUANTIFIED_EMISSIONS_REDUCTION,
    scope: { domain: 'carbon', boundary: 'permian', timeEpoch: '2026-10-24', activityType: 'offset' },
    evidence: [{ digest }],
    result: { statement: 'Simulated reduction' },
  };

  const result = evaluateClaimThroughFirewall({
    claim,
    evidence,
    expectedDigest: digest,
    claimType: CLAIM_TYPES.QUANTIFIED_EMISSIONS_REDUCTION,
    evaluationTime: new Date('2026-10-24T12:00:00Z'),
  });

  assert.equal(result.verdict, VERDICTS.REJECTED);
  assert.equal(result.eligibleForOnChainSubmission, false);
  assert.ok(result.errors.some((e) => /Model-to-Carbon Prohibition/i.test(e)));
});

test('Trust Firewall: Hash tampering detection immediately rejects altered payload', () => {
  const evidence = {
    sources: [{ sourceId: 'delhi-cpcb-station', dataKind: 'GROUND_STATION_OBSERVED', basis: 'OBSERVED_MONITOR', retrievedAt: '2026-10-24T10:00:00Z' }],
    location: { lat: 28.6, lon: 77.2 },
    timeframe: { startUtc: '2026-10-24T00:00:00Z', endUtc: '2026-10-24T10:00:00Z' },
    measurements: [{ measurementId: 'pm25@1', analyte: 'pm2_5', basis: 'OBSERVED_MONITOR', value: 45.0, unit: 'μg/m³' }],
    custody: [{ step: 'retrieved' }, { step: 'bundled' }],
  };
  const authenticDigest = digestOf(evidence);

  // Tamper measurement value
  const tampered = structuredClone(evidence);
  tampered.measurements[0].value = 12.0; // Maliciously altered

  const claim = {
    claimId: 'cl-tampered-hash',
    claimType: CLAIM_TYPES.ENVIRONMENTAL_OBSERVATION,
    scope: { domain: 'air', boundary: 'delhi', timeEpoch: '2026-10-24', activityType: 'pm25' },
    evidence: [{ digest: authenticDigest }],
    result: { statement: 'Tampered reading' },
  };

  const result = evaluateClaimThroughFirewall({
    claim,
    evidence: tampered,
    expectedDigest: authenticDigest,
    evaluationTime: new Date('2026-10-24T12:00:00Z'),
  });

  assert.equal(result.verdict, VERDICTS.REJECTED);
  assert.ok(result.errors.some((e) => /Digest mismatch/i.test(e)));
});

test('Trust Firewall: Duplicate scope with distinct claim ID is detected and rejected', () => {
  const scope = { domain: 'methane', boundary: 'permian-wellhead-4', timeEpoch: '2026-Q4', activityType: 'fugitive_leak_repair' };
  const evidence = {
    sources: [{ sourceId: 'carbon-mapper-plume', dataKind: 'SATELLITE_MEASURED', basis: 'SATELLITE_MEASURED', retrievedAt: '2026-10-24T10:00:00Z' }],
    location: { lat: 31.8, lon: -102.3 },
    timeframe: { startUtc: '2026-10-24T00:00:00Z', endUtc: '2026-10-24T10:00:00Z' },
    measurements: [{ measurementId: 'ch4@1', analyte: 'ch4', basis: 'SATELLITE_MEASURED', value: 350.0, unit: 'kg/hr' }],
    custody: [{ step: 'retrieved' }, { step: 'bundled' }],
    methodology: 'EPA Subpart W',
  };
  const digest = digestOf(evidence);
  const claim = {
    claimId: 'cl-brand-new-evasive-id-777',
    claimType: CLAIM_TYPES.QUANTIFIED_EMISSIONS_REDUCTION,
    scope,
    evidence: [{ digest }],
    result: { statement: 'Duplicate claim attempt', baselineMethodology: 'EPA Subpart W' },
  };

  const existingClaims = [{
    claimId: 'cl-original-claim-111',
    status: 'Submitted',
    scope,
    compositeScopeKey: computeCompositeScopeKey(scope),
    evidence: [{ digest: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' }],
  }];

  const result = evaluateClaimThroughFirewall({
    claim,
    evidence,
    expectedDigest: digest,
    existingClaims,
    evaluationTime: new Date('2026-10-24T12:00:00Z'),
  });

  assert.equal(result.verdict, VERDICTS.REJECTED);
  assert.ok(result.errors.some((e) => /Duplicate Claim Scope/i.test(e)));
});

test('Trust Firewall: Legitimate co-located distinct activities on same location are accepted', () => {
  const sharedSite = { boundary: 'punjab-ludhiana', timeEpoch: '2026-10-24', domain: 'agriculture' };
  const scope1 = { ...sharedSite, activityType: 'straw_baler_routing' };
  const scope2 = { ...sharedSite, activityType: 'solar_microgrid_installation' };

  const evidence = {
    sources: [{ sourceId: 'field-dispatch', dataKind: 'GROUND_STATION_OBSERVED', basis: 'OBSERVED_MONITOR', retrievedAt: '2026-10-24T10:00:00Z' }],
    location: { lat: 30.9, lon: 75.8 },
    timeframe: { startUtc: '2026-10-24T00:00:00Z', endUtc: '2026-10-24T10:00:00Z' },
    measurements: [{ measurementId: 'solar@1', analyte: 'solar_generation', basis: 'OBSERVED_MONITOR', value: 85.0, unit: 'kWh' }],
    custody: [{ step: 'retrieved' }, { step: 'bundled' }],
  };
  const digest = digestOf(evidence);
  const claim = {
    claimId: 'cl-solar-project-002',
    claimType: CLAIM_TYPES.ENVIRONMENTAL_OBSERVATION,
    scope: scope2, // Different activity!
    evidence: [{ digest }],
    result: { statement: 'Solar microgrid verified' },
  };

  const existingClaims = [{
    claimId: 'cl-straw-baler-001',
    status: 'Submitted',
    scope: scope1, // Straw baler at same location and epoch
    compositeScopeKey: computeCompositeScopeKey(scope1),
    evidence: [{ digest: '0xaaaabbbbccccddddeeeeffff0000111122223333444455556666777788889999' }],
  }];

  const result = evaluateClaimThroughFirewall({
    claim,
    evidence,
    expectedDigest: digest,
    existingClaims,
    evaluationTime: new Date('2026-10-24T12:00:00Z'),
  });

  assert.equal(result.verdict, VERDICTS.ACCEPTED);
  assert.equal(result.eligibleForOnChainSubmission, true);
});

test('Trust Firewall: Full 55-case Adversarial Benchmark meets precision and recall targets', async () => {
  const benchmark = await runBenchmark();
  assert.equal(benchmark.totalCases, 55);

  const baselineC = benchmark.results['Baseline C (Trust Firewall: Provenance & Tier Policies)'];
  assert.ok(baselineC, 'Baseline C must be evaluated in report.');
  assert.equal(baselineC.falsePositives, 0, 'Trust Firewall must have zero false positives (no unsafe claims accepted).');
  assert.equal(baselineC.falseNegatives, 0, 'Trust Firewall must have zero false negatives (no legitimate claims rejected).');
  assert.equal(baselineC.precision, 1.0);
  assert.equal(baselineC.recall, 1.0);
  assert.equal(baselineC.f1Score, 1.0);
  assert.equal(baselineC.unsafeAcceptanceRate, 0.0);
  assert.equal(baselineC.falseRejectionRate, 0.0);
  assert.ok(baselineC.avgLatencyMs < 2.0, `Verification latency (${baselineC.avgLatencyMs}ms) must be under 2ms.`);
});
