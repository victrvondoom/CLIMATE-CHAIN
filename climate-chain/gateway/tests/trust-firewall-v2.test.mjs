// Trust Firewall v2: adversarial suite, claim-type sufficiency, plausibility envelope, enforcement gate, dataset.
// The adversarial cases are SYNTHETIC and author-written. These tests pin the behaviour; they are not an external
// accuracy claim. Cases in group KNOWN_LIMITATION assert what the firewall can NOT detect.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { runAdversarialV2, runBenchmark } from '../benchmark-runner.mjs';
import { evaluateClaimThroughFirewall, VERDICTS } from '../trust-firewall.mjs';
import { createChainRuntime } from '../chain-runtime.mjs';
import { createMemoryStorage } from '../storage.mjs';
import { createIntegrityService } from '../integrity-service.mjs';
import { createGatewayServer } from '../gateway.mjs';
import { createPlausibilityProvider, fitEnvelope, hourlyDatasetInfo, loadClimateHourly, queryHourly } from '../plausibility.mjs';
import { evaluate } from '../scripts/evaluate-plausibility.mjs';
import { generateObservationEvidenceManifest, getLiveTelemetryTick, getTimelineObservations } from '../historical-service.mjs';
import { evidenceFingerprints, isModelLike, isObservedBasis, isRecognisedMethodology, periodInterval, scopesOverlap, overlapProfile } from '../claim-sufficiency.mjs';
import { digestOf as digestOfEvidence } from '../integrity-evidence.mjs';

const DATA_DIR = fileURLToPath(new URL('../../data/climate-hourly/', import.meta.url));
const SEED = 'unit-test-seed-0123456789abcdef-0123456789abcdef';

test('v2 adversarial suite: every scored case matches its expected verdict AND rule code', async () => {
  const report = await runAdversarialV2();
  assert.deepEqual(report.failures, [], JSON.stringify(report.failures, null, 2));
  assert.equal(report.unsafeAccepted, 0);
  assert.equal(report.legitimateNotAccepted, 0);
  assert.ok(report.scoredCases >= 39, `expected at least 39 scored cases, got ${report.scoredCases}`);
  for (const group of ['FIXED_BLIND_SPOT', 'SUBTYPE']) assert.equal(report.byGroup[group].passed, report.byGroup[group].cases, group);
  assert.match(report.label, /not a blind held-out/);
});

test('v2 documents unsafe claims the firewall cannot detect (and says so)', async () => {
  const report = await runAdversarialV2();
  assert.ok(report.knownLimitations.length >= 2);
  for (const known of report.knownLimitations) {
    assert.equal(known.missedByDesign, true, `${known.name} is documented as missed; if it is now caught, move it to a scored group.`);
  }
  const result = evaluateClaimThroughFirewall({ claim: { claimType: 'ENVIRONMENTAL_OBSERVATION' }, evidence: {}, expectedDigest: 'x' });
  assert.ok(result.knownLimitations.some((l) => /fabricated bundle/i.test(l)));
  assert.match(result.limitsNotice, /cannot prove the bundle came from a real sensor/);
});

test('the v1 55-case regression suite is unchanged by the v2 rules', async () => {
  const v1 = (await runBenchmark()).results['Baseline C (Trust Firewall: Provenance & Tier Policies)'];
  assert.equal(v1.truePositives, 27);
  assert.equal(v1.trueNegatives, 28);
  assert.equal(v1.falsePositives, 0);
  assert.equal(v1.falseNegatives, 0);
});

test('labels are compared as whole tokens, not substrings', () => {
  assert.equal(isObservedBasis('MODEL_FORECAST', 'UNOBSERVED_MODEL_ESTIMATE'), false);
  assert.equal(isObservedBasis('OBSERVED_MONITOR', 'GROUND_STATION_OBSERVED'), true);
  assert.equal(isObservedBasis('RETRIEVAL', 'REMOTE_SENSING_L2_RETRIEVAL'), true);
  assert.equal(isModelLike('SYNTHETIC_SCENARIO'), true);
  assert.equal(isModelLike('GROUND_STATION_OBSERVED'), false);
});

test('overlap is judged by meaning: nested periods, synonyms and slugs', () => {
  assert.deepEqual(periodInterval('2026-Q4').map((t) => new Date(t).toISOString().slice(0, 7)), ['2026-10', '2027-01']);
  const base = overlapProfile({ domain: 'methane', boundary: 'permian-wellhead-4', timeEpoch: '2026-Q4', activityType: 'fugitive_leak_repair' });
  assert.equal(scopesOverlap(base, overlapProfile({ domain: 'CH4 abatement', boundary: 'Permian Wellhead #4', timeEpoch: '2026-10', activityType: 'leak_repair' })), true);
  assert.equal(scopesOverlap(base, overlapProfile({ domain: 'methane', boundary: 'permian-wellhead-4', timeEpoch: '2027-Q1', activityType: 'fugitive_leak_repair' })), false, 'a different quarter is a different claim');
  assert.equal(scopesOverlap(base, overlapProfile({ domain: 'methane', boundary: 'permian-wellhead-4', timeEpoch: '2026-Q4', activityType: 'compressor_audit' })), false, 'a distinct activity at the same place is allowed');
});

test('climate-hourly dataset: at least 20,000 real rows, hash matches the manifest, honestly labelled', () => {
  const info = hourlyDatasetInfo();
  assert.ok(info.rows >= 20000, `rows=${info.rows}`);
  assert.equal(info.rowsWithMethane, info.rows);
  const gz = readFileSync(`${DATA_DIR}climate-hourly.csv.gz`);
  assert.equal(createHash('sha256').update(gz).digest('hex'), info.sha256);
  const rows = loadClimateHourly();
  assert.equal(rows.length, info.rows);
  assert.match(info.honestLabel, /not station observations/);
  assert.match(info.classification['cams_*'], /MODELLED/);
  assert.match(info.classification['era5_*'], /REANALYSIS/);
  const header = gunzipSync(gz).toString('utf8').split('\n', 1)[0];
  assert.ok(!/observed/i.test(header), 'no column may be named as an observation');
});

test('plausibility envelope: real held-out false alarms stay low and large injected spikes are caught', () => {
  const report = evaluate(loadClimateHourly());
  const m = report.byMargin['0.25'];
  assert.ok(m.overallFalseAlarmRate < 0.01, `held-out false-alarm rate ${m.overallFalseAlarmRate}`);
  assert.ok(m.perColumn.cams_pm2_5.detection['10'] >= 0.9, `PM2.5 x10 detection ${m.perColumn.cams_pm2_5.detection['10']}`);
  assert.ok(m.perColumn.cams_methane.detection['3'] >= 0.9, `CH4 x3 detection ${m.perColumn.cams_methane.detection['3']}`);
  // Honest limit: small deviations are mostly NOT detected. Pin it so the docs cannot over-claim.
  assert.ok(m.perColumn.cams_pm2_5.detection['1.5'] < 0.25, 'x1.5 PM2.5 deviations are largely invisible to the envelope');
  assert.ok(report.dataset.testRows > 20000 && report.dataset.trainRows > 60000);
});

test('plausibility is advisory: an implausible value goes to human review, never to rejection', () => {
  const rows = loadClimateHourly();
  const model = fitEnvelope(rows, { trainEndMs: Infinity });
  assert.ok(model.bands.size > 100);
  const provider = createPlausibilityProvider();
  const sample = rows.find((r) => r.city === 'delhi' && r.cams_pm2_5 !== null && r.t >= Date.parse('2026-03-10T06:00:00Z'));
  const bundle = (value) => ({
    schema: 'x', location: { siteId: 'delhi', lat: 28.6139, lon: 77.209 },
    sources: [{ sourceId: 'monitor', dataKind: 'GROUND_STATION_OBSERVED', basis: 'OBSERVED_MONITOR', retrievedAt: new Date(sample.t + 3600_000).toISOString() }],
    measurements: [{ measurementId: 'm', analyte: 'pm2_5', value, unit: 'µg/m³', basis: 'OBSERVED_MONITOR', validTimeUtc: new Date(sample.t).toISOString() }],
    uncertainty: ['x'], comparisons: [], custody: [{ step: 'retrieved' }, { step: 'bundled' }],
  });
  const run = (value) => provider({ claim: { scope: { lat: 28.6139, lon: 77.209 } }, evidence: bundle(value) });
  assert.equal(run(sample.cams_pm2_5).covered, true);
  assert.equal(run(sample.cams_pm2_5).outOfEnvelope.length, 0, 'a real held value is inside its own envelope');
  assert.equal(run(sample.cams_pm2_5 * 40).outOfEnvelope.length, 1);

  const evidence = bundle(sample.cams_pm2_5 * 40);
  const digest = createHash('sha256').update('x').digest('hex');
  const result = evaluateClaimThroughFirewall({
    claim: { claimId: 'p1', claimType: 'ENVIRONMENTAL_OBSERVATION', scope: { domain: 'air_quality', boundary: 'delhi', timeEpoch: '2026-03-10', activityType: 'monitoring', lat: 28.6139, lon: 77.209 }, evidence: [{ digest }] },
    evidence,
    expectedDigest: createHash('sha256').update('').digest('hex'),
    evaluationTime: new Date(sample.t + 2 * 3600_000),
    plausibility: provider,
  });
  assert.notEqual(result.verdict, VERDICTS.ACCEPTED);
  const rule = result.ruleResults.find((r) => r.ruleId === 'STATISTICAL_PLAUSIBILITY');
  assert.ok(rule && rule.passed === false);
  assert.ok(!result.errors.some((e) => /envelope/.test(e)), 'the plausibility rule never adds a hard error');
  const outside = provider({ claim: { scope: { lat: 51.5, lon: -0.12 } }, evidence: { ...bundle(1), location: { lat: 51.5, lon: -0.12 } } });
  assert.equal(outside.covered, false, 'silent outside the six covered cities');
});

test('enforcement gate: stale modelled evidence is refused with a 409 and never reaches the chain; the default stays advisory', async () => {
  const rt = createChainRuntime({ storage: createMemoryStorage(), seed: { source: 'test', seed: SEED }, env: {}, minRefreshMs: 0, bootBackoffMs: 0 });
  const later = () => '2026-10-30T00:00:00.000Z';
  for (const enforce of [true, false]) {
    const service = createIntegrityService({ chain: rt, enforceFirewall: enforce, now: later });
    const built = await service.buildEvidence({ siteId: 'new-delhi', analyte: 'pm2_5', mode: 'cached' });
    await service.anchor(built.evidenceId);
    if (enforce) {
      await assert.rejects(() => service.submitClaim({ evidenceId: built.evidenceId }), (error) => {
        assert.equal(error.code, 'firewall_not_accepted');
        assert.equal(error.status, 409);
        assert.match(error.message, /forecast was issued \d+ hours ago/);
        assert.equal(error.firewall.verdict, 'REJECTED');
        return true;
      });
      const history = await service.history();
      assert.ok(!history.events.some((event) => event.event === 'ClaimSubmitted'), 'a refused claim leaves no on-chain submission');
    } else {
      const claim = await service.submitClaim({ evidenceId: built.evidenceId });
      assert.equal(claim.proof.status, 'Submitted');
    }
    await service.reset();
  }
});

test('GET /api/v1/history/hourly serves the dataset summary and bounded rows', async () => {
  const gateway = createGatewayServer({ missionEngine: {}, connectorRegistry: {}, projectRegistry: [], integrityService: {} });
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${gateway.address().port}/api/v1/history/hourly`;
    const info = await (await fetch(base)).json();
    assert.ok(info.rows >= 20000);
    assert.match(info.honestLabel, /not station observations/);
    const slice = await (await fetch(`${base}?city=chennai&from=2026-03-01T00:00:00Z&limit=5`)).json();
    assert.equal(slice.count, 5);
    assert.equal(slice.rows[0].city, 'chennai');
    assert.ok(Number.isFinite(slice.rows[0].cams_methane));
    const capped = await (await fetch(`${base}?city=delhi&limit=100000`)).json();
    assert.equal(capped.count, 500, 'responses are bounded');
  } finally {
    await new Promise((resolve, reject) => gateway.close((error) => (error ? reject(error) : resolve())));
  }
  assert.equal(queryHourly({ city: 'nowhere' }).error, 'unknown_city');
  assert.equal(queryHourly({ city: 'delhi', from: 'not a date' }).error, 'invalid_time');
  assert.equal(queryHourly({ city: '__proto__' }).error, 'unknown_city');
});

test('GET /api/v1/history/hourly rejects an unknown city with 400 and stays cheap after the first load', async () => {
  const gateway = createGatewayServer({ missionEngine: {}, connectorRegistry: {}, projectRegistry: [], integrityService: {} });
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${gateway.address().port}/api/v1/history/hourly`;
    assert.equal((await fetch(`${base}?city=atlantis`)).status, 400);
    assert.equal((await fetch(`${base}?city=delhi&from=garbage`)).status, 400);
    await (await fetch(`${base}?city=delhi&limit=1`)).json(); // first load parses the file
    const started = process.hrtime.bigint();
    for (let i = 0; i < 20; i++) assert.equal((await fetch(`${base}?city=chennai&from=2026-03-01&limit=24`)).status, 200);
    const perRequestMs = Number(process.hrtime.bigint() - started) / 1e6 / 20;
    assert.ok(perRequestMs < 50, `cached queries should be fast, got ${perRequestMs.toFixed(1)} ms each`);
  } finally {
    await new Promise((resolve, reject) => gateway.close((error) => (error ? reject(error) : resolve())));
  }
});

// ------------------------------------------------------------------ regressions found by the independent reviews

const T0 = '2026-10-24T12:00:00.000Z';
const goodEvidence = (extra = {}) => ({
  schema: 'x', location: { siteId: 's', lat: 28.6139, lon: 77.209 },
  sources: [{ sourceId: 'monitor-1', dataKind: 'GROUND_STATION_OBSERVED', basis: 'OBSERVED_MONITOR', retrievedAt: '2026-10-24T10:00:00.000Z' }],
  measurements: [{ measurementId: 'm1', analyte: 'pm2_5', value: 42.5, unit: 'ug/m3', basis: 'OBSERVED_MONITOR', validTimeUtc: '2026-10-24T10:00:00.000Z' }],
  uncertainty: ['x'], comparisons: [], custody: [{ step: 'retrieved' }, { step: 'bundled' }], ...extra,
});
const run = (evidence, claim = {}, options = {}) => {
  const digest = createHash('sha256').update('x').digest('hex');
  let expectedDigest = digest;
  try { expectedDigest = JSON.stringify(evidence) && digestOfEvidence(evidence); } catch { /* unserialisable evidence keeps the placeholder */ }
  return evaluateClaimThroughFirewall({
    claim: { claimId: 'r1', claimType: 'ENVIRONMENTAL_OBSERVATION', scope: { domain: 'air_quality', boundary: 'b', timeEpoch: '2026-10-24', activityType: 'monitoring', lat: 28.6139, lon: 77.209 }, evidence: [{ digest: expectedDigest }], ...claim },
    evidence, expectedDigest, evaluationTime: T0, ...options,
  });
};

test('the firewall never throws on hostile input; it rejects', () => {
  // Shapes that remove something the claim needs must never be accepted.
  const unacceptable = [
    goodEvidence({ measurements: 'x' }), goodEvidence({ measurements: { a: 1 } }), goodEvidence({ measurements: [null, 5, 'z'] }),
    goodEvidence({ sources: [null] }), goodEvidence({ custody: [null] }), null, 'string', 42, [],
  ];
  for (const evidence of unacceptable) {
    let result;
    assert.doesNotThrow(() => { result = run(evidence); }, JSON.stringify(evidence)?.slice(0, 80));
    assert.notEqual(result.verdict, VERDICTS.ACCEPTED, JSON.stringify(evidence)?.slice(0, 80));
  }
  // Malformed but irrelevant fields are ignored, never thrown on.
  for (const evidence of [goodEvidence({ comparisons: [null] }), goodEvidence({ comparisons: {} }), goodEvidence({ location: 'nowhere' })]) {
    assert.doesNotThrow(() => run(evidence), JSON.stringify(evidence).slice(0, 80));
  }
  for (const subtype of ['constructor', '__proto__', 'toString', 7, {}]) {
    let result;
    assert.doesNotThrow(() => { result = run(goodEvidence(), {}, { claimSubtype: subtype }); });
    assert.notEqual(result.verdict, VERDICTS.ACCEPTED);
  }
  for (const claim of [null, 'abc', 7, []]) {
    const result = evaluateClaimThroughFirewall({ claim, evidence: goodEvidence(), expectedDigest: 'x', evaluationTime: T0 });
    assert.equal(result.verdict, VERDICTS.REJECTED);
  }
  assert.doesNotThrow(() => evaluateClaimThroughFirewall({ claim: {}, evidence: goodEvidence(), existingClaims: [null, undefined, 5], evaluationTime: 'garbage' }));
  assert.doesNotThrow(() => evaluateClaimThroughFirewall({ claim: {}, evidence: goodEvidence(), existingClaims: 'x', evaluationTime: T0 }));
  assert.doesNotThrow(() => evaluateClaimThroughFirewall({ claim: { claimId: 'x', claimType: 'ENVIRONMENTAL_OBSERVATION' }, evidence: goodEvidence({ measurements: [{ analyte: 'pm2_5', value: Infinity, unit: 'ug/m3' }] }), expectedDigest: 'x', evaluationTime: T0 }));
});

test('a claimant-supplied periodHours cannot make old evidence fresh', () => {
  const old = goodEvidence({ measurements: [{ measurementId: 'm', analyte: 'pm2_5', value: 42.5, unit: 'ug/m3', basis: 'OBSERVED_MONITOR', validTimeUtc: '2019-01-01T00:00:00Z' }] });
  assert.equal(run(old).verdict, VERDICTS.REJECTED);
  assert.equal(run(old, { result: { periodHours: 1e9 } }).verdict, VERDICTS.REJECTED, 'a huge period is ignored');
  assert.equal(run(old, { result: { periodHours: 720 } }).verdict, VERDICTS.REJECTED, 'a month does not make 2019 current');
});

test('non-numeric measurement values and unusable coordinates cannot slip through', () => {
  const na = goodEvidence({ measurements: [{ measurementId: 'm', analyte: 'pm2_5', value: 'n/a', unit: 'ug/m3', basis: 'OBSERVED_MONITOR', validTimeUtc: '2026-10-24T10:00:00.000Z' }] });
  const r = run(na, { result: { analyte: 'pm2_5', value: 9999, unit: 'ug/m3' } }, { claimSubtype: 'air-quality' });
  assert.notEqual(r.verdict, VERDICTS.ACCEPTED);
  assert.equal(run(goodEvidence({ location: { siteId: 's', lat: 'abc', lon: 'zzz' } })).verdict, VERDICTS.REJECTED);
  assert.equal(run(goodEvidence({ location: { siteId: 's', lat: 28.6 } })).verdict, VERDICTS.REJECTED, 'half a coordinate is not borrowed from the claim scope');
  const noTime = goodEvidence({ sources: [{ sourceId: 'monitor-1', dataKind: 'GROUND_STATION_OBSERVED', basis: 'OBSERVED_MONITOR' }] });
  const reduction = run(noTime, { claimType: 'QUANTIFIED_EMISSIONS_REDUCTION', result: { baselineMethodology: 'EPA Subpart W' } });
  assert.equal(reduction.verdict, VERDICTS.REJECTED, 'a missing retrieval time is never treated as epoch 0');
});

test('model labels cannot be dressed up: camelCase, plurals, proxies and negations', () => {
  for (const label of ['ModelEstimate', 'MODELS', 'MODELLING', 'proxy', 'IMPUTED', 'assumed', 'NOT_MEASURED', 'interpolated']) {
    assert.equal(isModelLike(label), true, label);
    assert.equal(isObservedBasis(label, 'GROUND_STATION_OBSERVED'), false, label);
  }
  const labelled = (basis) => goodEvidence({ measurements: [{ measurementId: 'm', analyte: 'ch4', value: 450, unit: 'kg/h', basis, validTimeUtc: '2026-10-24T10:00:00.000Z' }], sources: [{ sourceId: 's', dataKind: 'SATELLITE_MEASURED', basis, retrievedAt: '2026-10-24T10:00:00.000Z' }] });
  for (const basis of ['ModelEstimate', 'proxy', 'assumed']) {
    const result = run(labelled(basis), { claimType: 'QUANTIFIED_EMISSIONS_REDUCTION', result: { baselineMethodology: 'EPA Subpart W' } });
    assert.equal(result.verdict, VERDICTS.REJECTED, basis);
  }
  assert.equal(isRecognisedMethodology('Not IPCC'), false);
  assert.equal(isRecognisedMethodology('Macro estimate by me'), false);
  assert.equal(isRecognisedMethodology('SACRED method'), false);
  assert.equal(isRecognisedMethodology('IPCC 2019 Tier 3'), true);
  assert.equal(isRecognisedMethodology('EPA Subpart W 98.233(r)'), true);
});

test('methane response: ex-ante credits, wrong units and negative rates are refused', async () => {
  const cases = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/adversarial-claims-v2.json', import.meta.url)), 'utf8'));
  const valid = cases.find((c) => c.name.startsWith('M1 '));
  const evaluateWith = (mutate, resultPatch = {}) => {
    const evidence = structuredClone(valid.evidence);
    mutate?.(evidence);
    const claim = structuredClone(valid.claim);
    claim.result = { ...claim.result, ...resultPatch };
    const digest = digestOfEvidence(evidence);
    claim.evidence = [{ digest }];
    return evaluateClaimThroughFirewall({ claim, evidence, expectedDigest: digest, claimSubtype: 'methane-response', evaluationTime: '2026-10-24T12:00:00Z' });
  };
  assert.equal(evaluateWith().verdict, VERDICTS.ACCEPTED);
  assert.match(evaluateWith(null, { periodHours: 8760, value: 20000 }).errors.join(' '), /future reductions cannot be credited|only \d+ h have passed/);
  assert.notEqual(evaluateWith(null, { value: 5, unit: 'MtCO2e' }).verdict, VERDICTS.ACCEPTED, 'megatonnes are not tonnes');
  assert.notEqual(evaluateWith(null, { periodHours: 1e9, value: 99999 }).verdict, VERDICTS.ACCEPTED);
  assert.equal(evaluateWith(null, { unit: 't CO2e' }).verdict, VERDICTS.ACCEPTED, 'a spaced unit is still tonnes');
  const negative = evaluateWith((e) => { e.measurements.find((m) => m.phase === 'post_repair').value = -1e6; });
  assert.equal(negative.verdict, VERDICTS.REJECTED);
  const withContext = evaluateWith((e) => { e.measurements.push({ measurementId: 'ctx', analyte: 'ch4', value: 1900, unit: 'ppb', basis: 'SATELLITE_MEASURED', validTimeUtc: '2026-10-24T11:00:00.000Z' }); });
  assert.equal(withContext.verdict, VERDICTS.ACCEPTED, 'an ambient ppb reading is context, not a rate, and must not fail the bundle');
  const stale = evaluateWith((e) => { e.measurements.find((m) => m.phase === 'baseline').validTimeUtc = '2026-01-01T00:00:00.000Z'; });
  assert.equal(stale.verdict, VERDICTS.REJECTED, 'a baseline months before the repair is not a baseline');
});

test('overlap and re-wrap detection resist formatting tricks', () => {
  assert.equal(periodInterval('2026-13'), null);
  assert.equal(periodInterval('2026-00'), null);
  assert.equal(periodInterval('2026-02-30'), null);
  assert.equal(periodInterval('2026-10-24xxxx'), null);
  assert.deepEqual(periodInterval('2026-10-01/2026-10-31').map((t) => new Date(t).toISOString().slice(0, 10)), ['2026-10-01', '2026-11-01'], 'a range end that is a date is inclusive');
  const base = overlapProfile({ domain: 'methane', boundary: 'site-1', timeEpoch: '2026-Q4', activityType: 'leak_repair' });
  assert.equal(scopesOverlap(base, overlapProfile({ domain: 'methane', boundary: 'site-1', timeEpoch: 'October 2026', activityType: 'leak_repair' })), true, 'an unparseable period fails closed');
  assert.equal(scopesOverlap(base, overlapProfile({ domain: 'methane', boundary: 'site-1', timeEpoch: '2026-10-24', activityType: 'leak_repair' })), true);
  assert.equal(overlapProfile({ domain: 'repair shop' }).domain, 'repair_shop'.toUpperCase().replace(/_/g, '_'), '"repair" is not "air"');
  const a = [{ measurementId: 'a', analyte: 'pm2_5', value: 12, validTimeUtc: '2026-10-24T10:00:00Z' }];
  const b = [{ measurementId: 'b', analyte: 'PM2_5', value: '12.0', validTimeUtc: '2026-10-24T10:00:00.000Z' }];
  assert.deepEqual(evidenceFingerprints({ measurements: a, sources: [{ sourceId: 'one' }] }), evidenceFingerprints({ measurements: b, sources: [{ sourceId: 'two' }] }), 'number formatting, time formatting and the source label do not change the fingerprint');
});

test('the plausibility envelope tolerates real station peaks that CAMS under-predicts', () => {
  const provider = createPlausibilityProvider();
  const rows = loadClimateHourly();
  const sample = rows.find((r) => r.city === 'delhi' && r.t >= Date.parse('2026-01-05T20:00:00Z') && r.cams_pm2_5 !== null);
  const ev = (value, basis) => ({ location: { lat: 28.6139, lon: 77.209 }, measurements: [{ analyte: 'pm2_5', value, unit: 'ug/m3', basis, validTimeUtc: new Date(sample.t).toISOString() }] });
  const peak = sample.cams_pm2_5 * 1.6; // a station reading above what CAMS predicted
  const observed = provider({ claim: {}, evidence: ev(peak, 'OBSERVED_MONITOR') });
  const modelled = provider({ claim: {}, evidence: ev(sample.cams_pm2_5 * 40, 'MODEL_FORECAST') });
  assert.equal(observed.covered, true);
  assert.equal(modelled.outOfEnvelope.length, 1, 'an absurd modelled value is still flagged');
  const absurd = provider({ claim: {}, evidence: ev(sample.cams_pm2_5 * 40, 'OBSERVED_MONITOR') });
  assert.equal(absurd.outOfEnvelope.length, 1, 'an absurd observed value is still flagged');
  const many = { location: { lat: 28.6139, lon: 77.209 }, measurements: Array.from({ length: 300 }, (_, i) => ({ analyte: 'pm2_5', value: 1e6, unit: 'ug/m3', basis: 'OBSERVED_MONITOR', validTimeUtc: new Date(sample.t + i * 3600_000).toISOString() })) };
  assert.ok(provider({ claim: {}, evidence: many }).outOfEnvelope.length <= 20, 'reported anomalies are capped');
});

test('the registry check fails closed: a client cannot choose its own project or reuse a stored claim id', async () => {
  const rt = createChainRuntime({ storage: createMemoryStorage(), seed: { source: 'test', seed: SEED }, env: {}, minRefreshMs: 0, bootBackoffMs: 0 });
  const service = createIntegrityService({ chain: rt, now: () => '2026-10-24T12:00:00.000Z' });
  const built = await service.buildEvidence({ siteId: 'new-delhi', analyte: 'pm2_5', mode: 'cached' });
  await service.anchor(built.evidenceId);
  const stored = await service.submitClaim({ evidenceId: built.evidenceId });
  assert.ok(stored.claim.claimId);
  // Re-sending the stored claim under its own id is refused instead of silently skipping itself.
  await assert.rejects(() => service.evaluateFirewall({ claim: stored.claim, evidence: built.bundle, expectedDigest: built.digest, claimType: 'ENVIRONMENTAL_RISK_ALERT' }), (error) => error.code === 'claim_id_in_use' && error.status === 409);
  // Same claim, new id, a made-up project: the stored claim still blocks it.
  const copy = { ...structuredClone(stored.claim), claimId: 'cl-' + 'f'.repeat(24), scope: { ...stored.claim.scope, project: 'zzz-not-a-real-project' } };
  const result = await service.evaluateFirewall({ claim: copy, evidence: built.bundle, expectedDigest: built.digest, claimType: 'ENVIRONMENTAL_RISK_ALERT' });
  assert.equal(result.verdict, VERDICTS.REJECTED);
  assert.ok(result.ruleResults.some((r) => r.ruleId === 'DUPLICATE_SCOPE_EXCLUSIVITY' && r.passed === false));
});

test('historical data is labelled honestly: simulated tick, reproducible digest, interpolated years marked', () => {
  const tick = getLiveTelemetryTick('co2_concentration');
  assert.equal(tick.simulated, true);
  assert.equal(tick.mode, 'SIMULATED');
  for (const forbidden of ['proof_hash', 'block_number', 'station']) assert.ok(!(forbidden in tick), `${forbidden} must not be invented`);

  const a = generateObservationEvidenceManifest('co2_concentration', 2000);
  const b = generateObservationEvidenceManifest('co2_concentration', 2000);
  assert.equal(a.sha256_digest, b.sha256_digest, 'the digest covers the payload only, so it is reproducible');
  assert.ok(a.generated_at && !('generated_at' in a.payload));
  assert.ok(!JSON.stringify(a).includes('TIER_1_CERTIFIED'));
  assert.equal(a.payload.verification.evidence_class, 'HAND_KEYED_REFERENCE');
  assert.notEqual(a.payload.source_attribution.source_url, 'https://climatechain.ieee.org');
  const interpolated = generateObservationEvidenceManifest('co2_concentration', 1999);
  assert.equal(interpolated.payload.verification.evidence_class, 'INTERPOLATED');

  const span = getTimelineObservations('renewable_share', 1965, 2026);
  assert.ok(span.value_count > span.anchor_count, 'interpolated years are counted as values, not as anchors');
  assert.equal(span.observations.filter((o) => !o.is_gap && !/^INTERPOLATED/.test(o.classification)).length, span.anchor_count);
  assert.ok(!('observation_count' in span));
  const temperature = getTimelineObservations('temperature_anomaly', 2000, 2000).observations[0];
  assert.match(temperature.unit, /1951-1980/);
});
