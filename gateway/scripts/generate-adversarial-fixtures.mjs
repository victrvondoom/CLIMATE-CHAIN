// Generates 55 reproducible, labelled adversarial claim fixtures for the Trust Firewall benchmark.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, digestOf, sha256Hex } from '../integrity-evidence.mjs';
import { CLAIM_TYPES, computeCompositeScopeKey } from '../trust-firewall.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FIXTURES_DIR = join(ROOT, 'fixtures');
const FIXTURES_FILE = join(FIXTURES_DIR, 'adversarial-claims.json');

const SITES = [
  { id: 'delhi-anand-vihar', label: 'Anand Vihar, Delhi', lat: 28.6469, lon: 77.3160 },
  { id: 'punjab-ludhiana', label: 'Ludhiana Agricultural Belt', lat: 30.9010, lon: 75.8573 },
  { id: 'permian-basin-tx', label: 'Permian Basin Wellhead #4', lat: 31.8900, lon: -102.3200 },
  { id: 'niger-delta-flaring', label: 'Oloibiri Wellflow #2', lat: 4.6850, lon: 6.2400 },
  { id: 'amazon-acre-forest', label: 'Acre Conservation Block C', lat: -9.9700, lon: -67.8100 },
];

function buildBaseEvidence({ site, analyte = 'pm2_5', basis = 'OBSERVED_MONITOR', dataKind = 'GROUND_STATION_OBSERVED', value = 42.5, unit = 'μg/m³', ageHours = 2, brokenCustody = false, contradictions = false, nullValues = false }) {
  const now = new Date('2026-10-24T12:00:00Z');
  const retrievedAt = new Date(now.getTime() - ageHours * 3600 * 1000).toISOString();
  
  const sources = [{
    sourceId: `source-${site.id}-${analyte}`,
    dataKind,
    basis,
    retrievedAt,
    spatialResolution: 'Point sensor (10m)',
    temporalResolution: '1 hour',
  }];

  const measurements = nullValues ? [
    { measurementId: `${analyte}@1`, analyte, basis, value: null, unit },
  ] : [
    { measurementId: `${analyte}@1`, analyte, basis, value, unit, validTimeUtc: retrievedAt },
  ];

  const custody = brokenCustody ? [
    { step: 'retrieved', at: retrievedAt, actor: 'sensor-gateway' },
    // missing bundled step
  ] : [
    { step: 'retrieved', at: retrievedAt, actor: 'sensor-gateway' },
    { step: 'normalised', actor: 'normalizer-v1' },
    { step: 'bundled', actor: 'trust-firewall' },
  ];

  const comparisons = contradictions ? [{
    with: 'Secondary Reference Monitor #2',
    status: 'CONTRADICTORY',
    reason: 'Primary monitor reported 185 μg/m³ while collocated reference monitor reported 22 μg/m³ (8.4x discrepancy).',
  }] : [];

  const evidence = {
    schema: 'climate-chain:evidence-bundle:v1',
    evidenceId: `ev-${sha256Hex(site.id + analyte + retrievedAt).slice(0, 24)}`,
    location: { siteId: site.id, lat: site.lat, lon: site.lon },
    timeframe: { startUtc: retrievedAt, endUtc: retrievedAt },
    sources,
    measurements,
    uncertainty: ['Sensor factory calibration tolerance +/- 5%'],
    comparisons,
    custody,
  };

  return evidence;
}

function generateCases() {
  const cases = [];
  let id = 1;

  // Category 1: Valid Environmental Observations (10 cases) - EXPECT: ACCEPTED
  for (let i = 0; i < 10; i++) {
    const site = SITES[i % SITES.length];
    const evidence = buildBaseEvidence({ site, analyte: `analyte_${i}`, value: 15 + i * 2, ageHours: 4 });
    const digest = digestOf(evidence);
    const scope = { domain: 'air_quality', boundary: site.id, timeEpoch: '2026-10-24', activityType: `monitoring_${i}` };
    const claim = {
      claimId: `cl-valid-obs-${id}`,
      claimType: CLAIM_TYPES.ENVIRONMENTAL_OBSERVATION,
      scope,
      evidence: [{ evidenceId: evidence.evidenceId, digest }],
      result: { statement: 'Observed ambient concentration', value: 15 + i * 2, basis: 'OBSERVED_MONITOR' },
    };
    cases.push({
      id: id++,
      name: `Valid Environmental Observation ${i + 1} (${site.label})`,
      category: 'VALID_OBSERVATION',
      expectedVerdict: 'ACCEPTED',
      isUnsafeClaim: false,
      claim,
      evidence,
      expectedDigest: digest,
    });
  }

  // Category 2: Valid Environmental Risk Alerts (5 cases) - EXPECT: ACCEPTED
  for (let i = 0; i < 5; i++) {
    const site = SITES[i % SITES.length];
    const evidence = buildBaseEvidence({ site, analyte: 'burn_risk_index', basis: 'MODEL_FORECAST', dataKind: 'PREDICTIVE_MODEL', value: 0.82 });
    evidence.forecastHorizonHours = 48;
    const digest = digestOf(evidence);
    const scope = { domain: 'fire_prevention', boundary: site.id, timeEpoch: '2026-10-24', activityType: 'burn_risk_alert' };
    const claim = {
      claimId: `cl-valid-risk-${id}`,
      claimType: CLAIM_TYPES.ENVIRONMENTAL_RISK_ALERT,
      scope,
      evidence: [{ evidenceId: evidence.evidenceId, digest }],
      result: { statement: 'High fire ignition probability in next 48 hours', value: 0.82, basis: 'PREDICTIVE_RADAR' },
    };
    cases.push({
      id: id++,
      name: `Valid Risk Alert ${i + 1} (${site.label})`,
      category: 'VALID_RISK_ALERT',
      expectedVerdict: 'ACCEPTED',
      isUnsafeClaim: false,
      claim,
      evidence,
      expectedDigest: digest,
    });
  }

  // Category 3: Valid Intervention Completions (5 cases) - EXPECT: ACCEPTED
  for (let i = 0; i < 5; i++) {
    const site = SITES[i % SITES.length];
    const evidence = buildBaseEvidence({ site, analyte: 'baler_dispatch', basis: 'COMMUNITY_REPORT', value: 1.0 });
    evidence.manifest = { dispatchId: `baler-job-${i}`, status: 'COMPLETED', balesCollectedTons: 45.2, verifier: 'punjab-field-agent' };
    const digest = digestOf(evidence);
    const scope = { domain: 'agriculture_residue', boundary: site.id, timeEpoch: '2026-10-24', activityType: 'baler_logistics' };
    const claim = {
      claimId: `cl-valid-intervention-${id}`,
      claimType: CLAIM_TYPES.INTERVENTION_COMPLETION,
      scope,
      evidence: [{ evidenceId: evidence.evidenceId, digest }],
      result: { statement: 'Paddy straw residue cleared and delivered to boiler', basis: 'FIELD_DISPATCH_MANIFEST' },
    };
    cases.push({
      id: id++,
      name: `Valid Intervention Completion ${i + 1} (${site.label})`,
      category: 'VALID_INTERVENTION',
      expectedVerdict: 'ACCEPTED',
      isUnsafeClaim: false,
      claim,
      evidence,
      expectedDigest: digest,
    });
  }

  // Category 4: Valid Quantified Emissions Reductions (4 cases) - EXPECT: ACCEPTED
  for (let i = 0; i < 4; i++) {
    const site = SITES[2]; // Permian Basin
    const evidence = buildBaseEvidence({ site, analyte: 'ch4_plume', basis: 'SATELLITE_MEASURED', dataKind: 'SATELLITE_MEASURED_CARBON_MAPPER', value: 450.0, unit: 'kg/hr' });
    evidence.methodology = 'EPA Subpart W + FLIR optical camera confirmation';
    const digest = digestOf(evidence);
    const scope = { domain: 'methane_abatement', boundary: site.id, timeEpoch: `2026-Q${i + 1}`, activityType: `wellhead_repair_${i}` };
    const claim = {
      claimId: `cl-valid-emissions-${id}`,
      claimType: CLAIM_TYPES.QUANTIFIED_EMISSIONS_REDUCTION,
      scope,
      evidence: [{ evidenceId: evidence.evidenceId, digest }],
      result: { statement: 'Direct leak repair avoiding 12.4 tCO2e/day', baselineMethodology: 'EPA Subpart W 98.233(r)', value: 12.4, unit: 'tCO2e/day', basis: 'EMPIRICAL_MEASUREMENT' },
    };
    cases.push({
      id: id++,
      name: `Valid Quantified Emissions Reduction ${i + 1} (Permian CH4)`,
      category: 'VALID_REDUCTION',
      expectedVerdict: 'ACCEPTED',
      isUnsafeClaim: false,
      claim,
      evidence,
      expectedDigest: digest,
    });
  }

  // Category 5: Tampered Evidence / Hash Mismatch (5 cases) - EXPECT: REJECTED
  for (let i = 0; i < 5; i++) {
    const site = SITES[i % SITES.length];
    const evidence = buildBaseEvidence({ site, analyte: 'pm2_5', value: 25.0 });
    const authenticDigest = digestOf(evidence);
    // Tamper the payload after digest generation
    const tamperedEvidence = structuredClone(evidence);
    tamperedEvidence.measurements[0].value = 999.9; // Malicious modification
    const scope = { domain: 'air_quality', boundary: site.id, timeEpoch: '2026-10-24', activityType: `tampered_${i}` };
    const claim = {
      claimId: `cl-tampered-${id}`,
      claimType: CLAIM_TYPES.ENVIRONMENTAL_OBSERVATION,
      scope,
      evidence: [{ evidenceId: evidence.evidenceId, digest: authenticDigest }],
      result: { statement: 'Falsified observation with replayed authentic hash', value: 999.9 },
    };
    cases.push({
      id: id++,
      name: `Tampered Evidence with Stale Digest ${i + 1} (${site.label})`,
      category: 'TAMPERED_HASH_MISMATCH',
      expectedVerdict: 'REJECTED',
      isUnsafeClaim: true,
      claim,
      evidence: tamperedEvidence,
      expectedDigest: authenticDigest,
    });
  }

  // Category 6: Model Forecast claiming Physical Observation (5 cases) - EXPECT: REJECTED
  for (let i = 0; i < 5; i++) {
    const site = SITES[i % SITES.length];
    const evidence = buildBaseEvidence({ site, analyte: 'pm2_5', basis: 'MODEL_FORECAST', dataKind: 'CAMS_MODEL_REANALYSIS', value: 65.0 });
    const digest = digestOf(evidence);
    const scope = { domain: 'air_quality', boundary: site.id, timeEpoch: '2026-10-24', activityType: `model_as_obs_${i}` };
    const claim = {
      claimId: `cl-model-as-obs-${id}`,
      claimType: CLAIM_TYPES.ENVIRONMENTAL_OBSERVATION, // Model masquerading as observation!
      scope,
      evidence: [{ evidenceId: evidence.evidenceId, digest }],
      result: { statement: 'Claiming Open-Meteo CAMS forecast as physical monitor reading', value: 65.0, basis: 'MODEL_FORECAST' },
    };
    cases.push({
      id: id++,
      name: `Modelled Forecast Claimed as Physical Observation ${i + 1}`,
      category: 'MODEL_AS_OBSERVATION',
      expectedVerdict: 'REJECTED',
      isUnsafeClaim: true,
      claim,
      evidence,
      expectedDigest: digest,
    });
  }

  // Category 7: Model Forecast claiming Quantified Emissions Reduction (5 cases) - EXPECT: REJECTED
  for (let i = 0; i < 5; i++) {
    const site = SITES[i % SITES.length];
    const evidence = buildBaseEvidence({ site, analyte: 'co2_model', basis: 'MODEL_FORECAST', dataKind: 'GLOBAL_CLIMATE_MODEL', value: 500.0 });
    const digest = digestOf(evidence);
    const scope = { domain: 'carbon_offset', boundary: site.id, timeEpoch: '2026-10-24', activityType: `model_offset_${i}` };
    const claim = {
      claimId: `cl-model-carbon-${id}`,
      claimType: CLAIM_TYPES.QUANTIFIED_EMISSIONS_REDUCTION, // Unbacked model carbon claim!
      scope,
      evidence: [{ evidenceId: evidence.evidenceId, digest }],
      result: { statement: 'Simulated atmospheric model used to claim 500 tCO2e carbon credits', value: 500.0, basis: 'MODEL_FORECAST' },
    };
    cases.push({
      id: id++,
      name: `Model Forecast Claimed as Quantified Carbon Cut ${i + 1}`,
      category: 'MODEL_AS_CARBON_REDUCTION',
      expectedVerdict: 'REJECTED',
      isUnsafeClaim: true,
      claim,
      evidence,
      expectedDigest: digest,
    });
  }

  // Category 8: Stale Evidence (>48h old) (5 cases) - EXPECT: REJECTED
  for (let i = 0; i < 5; i++) {
    const site = SITES[i % SITES.length];
    const evidence = buildBaseEvidence({ site, analyte: 'pm2_5', value: 30.0, ageHours: 96 + i * 24 }); // 4 to 8 days old!
    const digest = digestOf(evidence);
    const scope = { domain: 'air_quality', boundary: site.id, timeEpoch: '2026-10-24', activityType: `stale_${i}` };
    const claim = {
      claimId: `cl-stale-${id}`,
      claimType: CLAIM_TYPES.ENVIRONMENTAL_OBSERVATION,
      scope,
      evidence: [{ evidenceId: evidence.evidenceId, digest }],
      result: { statement: 'Outdated observation claiming current air quality status', value: 30.0 },
    };
    cases.push({
      id: id++,
      name: `Stale Physical Observation (${96 + i * 24}h old) ${i + 1}`,
      category: 'STALE_EVIDENCE',
      expectedVerdict: 'REJECTED',
      isUnsafeClaim: true,
      claim,
      evidence,
      expectedDigest: digest,
    });
  }

  // Category 9: Duplicate Claim Scope Evading via New ID (4 cases) - EXPECT: REJECTED
  for (let i = 0; i < 4; i++) {
    const site = SITES[0];
    const evidence = buildBaseEvidence({ site, analyte: 'pm2_5', value: 50.0, ageHours: 3 });
    const digest = digestOf(evidence);
    const scope = { domain: 'air_quality', boundary: site.id, timeEpoch: '2026-10-24', activityType: 'annual_air_audit' };
    const claim = {
      claimId: `cl-duplicate-evasion-${id}`, // New ID!
      claimType: CLAIM_TYPES.ENVIRONMENTAL_OBSERVATION,
      scope,
      evidence: [{ evidenceId: evidence.evidenceId, digest }],
      result: { statement: 'Attempt to duplicate air quality claim using brand new claim ID', value: 50.0 },
    };
    cases.push({
      id: id++,
      name: `Duplicate Scope Evasion via New Claim ID ${i + 1}`,
      category: 'DUPLICATE_SCOPE_EVASION',
      expectedVerdict: 'REJECTED',
      isUnsafeClaim: true,
      claim,
      evidence,
      expectedDigest: digest,
      // Provide an existing active claim that already holds this exact scope
      existingClaims: [{
        claimId: 'cl-original-established-claim-001',
        status: 'Submitted',
        scope,
        compositeScopeKey: computeCompositeScopeKey(scope),
        evidence: [{ digest: '0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff' }],
      }],
    });
  }

  // Category 10: Legitimate Co-located Distinct Activities (3 cases) - EXPECT: ACCEPTED
  for (let i = 0; i < 3; i++) {
    const site = SITES[1]; // Ludhiana
    const activities = ['straw_baling_collection', 'solar_pump_installation', 'methane_digester_audit'];
    const evidence = buildBaseEvidence({ site, analyte: activities[i], basis: 'OBSERVED_MONITOR', value: 100.0, ageHours: 2 });
    const digest = digestOf(evidence);
    const scope = { domain: 'punjab_decarb', boundary: site.id, timeEpoch: '2026-10-24', activityType: activities[i] };
    const claim = {
      claimId: `cl-colocated-legit-${id}`,
      claimType: CLAIM_TYPES.ENVIRONMENTAL_OBSERVATION,
      scope,
      evidence: [{ evidenceId: evidence.evidenceId, digest }],
      result: { statement: `Legitimate distinct activity on shared boundary: ${activities[i]}`, value: 100.0 },
    };
    cases.push({
      id: id++,
      name: `Legitimate Co-located Activity (${activities[i]})`,
      category: 'LEGITIMATE_COLOCATED',
      expectedVerdict: 'ACCEPTED',
      isUnsafeClaim: false,
      claim,
      evidence,
      expectedDigest: digest,
      // Existing claim is at SAME site and SAME time, but DIFFERENT activity!
      existingClaims: [{
        claimId: 'cl-prior-different-activity-999',
        status: 'Submitted',
        scope: { domain: 'punjab_decarb', boundary: site.id, timeEpoch: '2026-10-24', activityType: 'canal_irrigation_monitoring' },
        compositeScopeKey: computeCompositeScopeKey({ domain: 'punjab_decarb', boundary: site.id, timeEpoch: '2026-10-24', activityType: 'canal_irrigation_monitoring' }),
        evidence: [{ digest: '0x9999888877776666555544443333222211110000aaaabbbbccccddddeeeeffff' }],
      }],
    });
  }

  // Category 11: Missing Provenance / Broken Custody (2 cases) - EXPECT: REJECTED
  for (let i = 0; i < 2; i++) {
    const site = SITES[i];
    const evidence = buildBaseEvidence({ site, analyte: 'pm2_5', value: 40.0, brokenCustody: true });
    const digest = digestOf(evidence);
    const scope = { domain: 'air_quality', boundary: site.id, timeEpoch: '2026-10-24', activityType: `broken_custody_${i}` };
    const claim = {
      claimId: `cl-broken-custody-${id}`,
      claimType: CLAIM_TYPES.ENVIRONMENTAL_OBSERVATION,
      scope,
      evidence: [{ evidenceId: evidence.evidenceId, digest }],
      result: { statement: 'Data with unverified transformation pipeline', value: 40.0 },
    };
    cases.push({
      id: id++,
      name: `Missing Provenance Custody Trail ${i + 1}`,
      category: 'MISSING_PROVENANCE',
      expectedVerdict: 'REJECTED',
      isUnsafeClaim: true,
      claim,
      evidence,
      expectedDigest: digest,
    });
  }

  // Category 12: Contradictory Dual-Sensor Inputs (2 cases) - EXPECT: HUMAN_REVIEW_REQUIRED
  for (let i = 0; i < 2; i++) {
    const site = SITES[i];
    const evidence = buildBaseEvidence({ site, analyte: 'pm2_5', value: 185.0, contradictions: true });
    const digest = digestOf(evidence);
    const scope = { domain: 'air_quality', boundary: site.id, timeEpoch: '2026-10-24', activityType: `contradictory_${i}` };
    const claim = {
      claimId: `cl-contradictory-${id}`,
      claimType: CLAIM_TYPES.ENVIRONMENTAL_OBSERVATION,
      scope,
      evidence: [{ evidenceId: evidence.evidenceId, digest }],
      result: { statement: 'Observation with unresolved collocated discrepancy', value: 185.0 },
    };
    cases.push({
      id: id++,
      name: `Contradictory Dual-Sensor Assertions ${i + 1}`,
      category: 'CONTRADICTORY_EVIDENCE',
      expectedVerdict: 'HUMAN_REVIEW_REQUIRED',
      isUnsafeClaim: true, // Needs manual human intervention before accepting
      claim,
      evidence,
      expectedDigest: digest,
    });
  }

  return cases;
}

async function main() {
  await mkdir(FIXTURES_DIR, { recursive: true });
  const cases = generateCases();
  console.log(`Generated ${cases.length} labelled adversarial test cases.`);
  await writeFile(FIXTURES_FILE, JSON.stringify(cases, null, 2), 'utf8');
  console.log(`Saved fixtures to ${FIXTURES_FILE}`);
}

main().catch(console.error);
