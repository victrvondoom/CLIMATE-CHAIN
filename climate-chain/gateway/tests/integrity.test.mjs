import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hashEvidence } from '../cascade.mjs';
import {
  CLAIM_ID, CLAIM_LABEL, EVIDENCE_ID, buildChallenge, buildClaim, buildEvidenceBundle, canonicalJson, claimScope,
  digestOf, exclusivityKeyOf, metadataHashOf, recommendNextSteps, sha256Hex, tamperCopy, verifyBundle,
} from '../integrity-evidence.mjs';
import { SITES, SourceError, createAirQualitySource, parseAirQuality } from '../integrity-sources.mjs';

const fixturePath = (name) => fileURLToPath(new URL(`../fixtures/integrity/${name}`, import.meta.url));
const vector = JSON.parse(readFileSync(fixturePath('canonical-vector.json'), 'utf8'));
const capture = JSON.parse(readFileSync(fixturePath('open-meteo-cams-global-new-delhi.json'), 'utf8'));
const delhi = SITES.find((site) => site.id === 'new-delhi');

function parseCapture(overrides = {}) {
  return parseAirQuality(overrides.rawText ?? capture.rawText, {
    site: delhi,
    requestUrl: capture.requestUrl,
    retrievedAt: overrides.retrievedAt ?? capture.capturedAt,
    capturedAt: capture.capturedAt,
    retrievalMode: 'CACHED_HISTORICAL_EXAMPLE',
  });
}

function editedRaw(edit) {
  const body = JSON.parse(capture.rawText);
  edit(body);
  return JSON.stringify(body);
}

function expectSourceError(action, code) {
  assert.throws(action, (error) => error instanceof SourceError && error.code === code, `expected ${code}`);
}

async function expectSourceRejection(promise, code) {
  await assert.rejects(promise, (error) => error instanceof SourceError && error.code === code, `expected ${code}`);
}

// ---------------------------------------------------------------------------
// Canonical JSON and hashing
// ---------------------------------------------------------------------------

test('canonical JSON reproduces the shared test vector byte for byte', () => {
  assert.equal(canonicalJson(vector.input), vector.canonical);
  assert.equal(sha256Hex(vector.canonical), vector.sha256);
  assert.equal(digestOf(vector.input), vector.sha256);
});

test('canonical JSON matches the existing Cascade Review hash for valid JSON input', () => {
  assert.equal(hashEvidence(vector.input), vector.sha256);
});

test('canonical JSON refuses values JSON cannot represent', () => {
  assert.throws(() => canonicalJson({ a: undefined }), { code: 'undefined_value' });
  assert.throws(() => canonicalJson({ a: Number.NaN }), { code: 'non_finite_number' });
  assert.throws(() => canonicalJson({ a: Infinity }), { code: 'non_finite_number' });
  assert.throws(() => canonicalJson(new Map()), { code: 'unsupported_value' });
  assert.throws(() => canonicalJson({ a: () => 1 }), { code: 'unsupported_value' });
});

// ---------------------------------------------------------------------------
// Source adapter: real captured response and failure states
// ---------------------------------------------------------------------------

test('parses the captured Open-Meteo response with units, grid and model labels', () => {
  const parsed = parseCapture();
  assert.equal(parsed.sourceRecord.provider, 'Open-Meteo');
  assert.equal(parsed.sourceRecord.dataKind, 'MODEL_FORECAST');
  assert.equal(parsed.sourceRecord.retrievalMode, 'CACHED_HISTORICAL_EXAMPLE');
  assert.equal(parsed.sourceRecord.rawPayloadSha256, sha256Hex(capture.rawText));
  assert.equal(parsed.sourceRecord.sourceUrl, capture.requestUrl);
  assert.match(parsed.sourceRecord.spatialResolution, /0\.4°/);
  assert.ok(Number.isFinite(parsed.sourceRecord.grid.lat) && Number.isFinite(parsed.sourceRecord.grid.lon));
  for (const analyte of Object.keys(parsed.series)) {
    assert.equal(parsed.units[analyte], 'μg/m³');
    for (const point of parsed.series[analyte]) {
      assert.match(point.validTimeUtc, /^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/);
      assert.ok(Date.parse(point.validTimeUtc) <= Date.parse(capture.capturedAt), 'no forecast hour after retrieval');
    }
  }
});

test('flags stale data and refuses a response with no past hours', () => {
  const stale = parseCapture({ retrievedAt: '2026-10-25T12:00:00.000Z' });
  assert.equal(stale.sourceRecord.freshness.stale, true);
  assert.ok(stale.sourceRecord.freshness.ageHoursAtRetrieval > 6);
  expectSourceError(() => parseCapture({ retrievedAt: '2026-10-20T00:00:00.000Z' }), 'source_no_past_values');
});

test('rejects malformed, incomplete, mislabelled or non-UTC responses', () => {
  expectSourceError(() => parseCapture({ rawText: '{not json' }), 'source_invalid_json');
  expectSourceError(() => parseCapture({ rawText: '{"error":true,"reason":"Cannot initialize"}' }), 'source_error_response');
  expectSourceError(() => parseCapture({ rawText: editedRaw((body) => { delete body.hourly.ozone; }) }), 'source_missing_field');
  expectSourceError(() => parseCapture({ rawText: editedRaw((body) => { body.hourly_units.pm2_5 = 'ppm'; }) }), 'source_unit_mismatch');
  expectSourceError(() => parseCapture({ rawText: editedRaw((body) => { body.utc_offset_seconds = 19800; body.timezone = 'Asia/Kolkata'; }) }), 'source_contract_invalid');
  expectSourceError(() => parseCapture({ rawText: editedRaw((body) => { body.hourly.pm10[3] = 'high'; }) }), 'source_contract_invalid');
  expectSourceError(() => parseCapture({ rawText: editedRaw((body) => { body.hourly.time[2] = body.hourly.time[1]; }) }), 'source_contract_invalid');
});

test('times out, reports 429 without retrying, and retries 500 with capped backoff', async () => {
  const hanging = createAirQualitySource({ fetchImpl: () => new Promise(() => {}), timeoutMs: 20, retries: 0, now: () => Date.parse(capture.capturedAt) });
  await expectSourceRejection(hanging.load('new-delhi', { mode: 'live' }), 'source_timeout');

  let rateCalls = 0;
  const limited = createAirQualitySource({ fetchImpl: async () => { rateCalls += 1; return new Response('{}', { status: 429, headers: { 'retry-after': '30' } }); }, sleep: async () => {} });
  await assert.rejects(limited.load('new-delhi', { mode: 'live' }), (error) => error.code === 'source_rate_limited' && error.retryAfterSeconds === 30);
  assert.equal(rateCalls, 1);

  let serverCalls = 0;
  const waits = [];
  const failing = createAirQualitySource({ fetchImpl: async () => { serverCalls += 1; return new Response('oops', { status: 500 }); }, sleep: async (ms) => { waits.push(ms); } });
  await assert.rejects(failing.load('new-delhi', { mode: 'live' }), (error) => error.code === 'source_http_error' && error.httpStatus === 500);
  assert.equal(serverCalls, 3);
  assert.deepEqual(waits, [250, 500]);
});

test('offline live fetch fails loudly, or falls back to a labelled cached example', async () => {
  const offline = createAirQualitySource({ fetchImpl: async () => { throw new TypeError('fetch failed'); }, sleep: async () => {}, now: () => Date.parse('2026-10-24T00:00:00.000Z') });
  await expectSourceRejection(offline.load('new-delhi', { mode: 'live' }), 'source_unavailable');

  const fallback = await offline.load('new-delhi', { mode: 'live-or-cached' });
  assert.equal(fallback.sourceRecord.retrievalMode, 'CACHED_HISTORICAL_EXAMPLE');
  assert.equal(fallback.sourceRecord.liveError.code, 'source_unavailable');
  assert.equal(fallback.sourceRecord.retrievedAt, capture.capturedAt);
  assert.equal(fallback.sourceRecord.servedAt, '2026-10-24T00:00:00.000Z');

  const cached = await offline.load('chennai', { mode: 'cached' });
  assert.equal(cached.sourceRecord.retrievalMode, 'CACHED_HISTORICAL_EXAMPLE');
  assert.equal(cached.sourceRecord.liveError, null);
  await expectSourceRejection(offline.load('atlantis'), 'unknown_site');
});

test('a successful live fetch is labelled LIVE_FETCH and reused within the rate window', async () => {
  let calls = 0;
  const live = createAirQualitySource({
    fetchImpl: async () => { calls += 1; return new Response(capture.rawText, { status: 200, headers: { 'content-type': 'application/json' } }); },
    now: () => Date.parse(capture.capturedAt),
  });
  const first = await live.load('new-delhi', { mode: 'live' });
  const second = await live.load('new-delhi', { mode: 'live' });
  assert.equal(first.sourceRecord.retrievalMode, 'LIVE_FETCH');
  assert.equal(first.sourceRecord.rawPayloadSha256, sha256Hex(capture.rawText));
  assert.equal(second.sourceRecord.reusedRecentResponse, true);
  assert.equal(calls, 1);
});

// ---------------------------------------------------------------------------
// Evidence bundle, tamper test, claims and challenges
// ---------------------------------------------------------------------------

test('builds a deterministic bundle with model labels, provenance and uncertainty', () => {
  const source = parseCapture();
  const first = buildEvidenceBundle({ site: delhi, analyte: 'pm2_5', source });
  const second = buildEvidenceBundle({ site: delhi, analyte: 'pm2_5', source: parseCapture() });
  assert.equal(first.digest, second.digest);
  assert.equal(first.bundle.evidenceId, second.bundle.evidenceId);
  assert.match(first.bundle.evidenceId, EVIDENCE_ID);
  assert.equal(first.digest, digestOf(first.bundle));
  assert.equal(first.metadataHash, metadataHashOf(first.bundle));

  const focus = first.bundle.measurements.filter((item) => item.analyte === 'pm2_5');
  assert.equal(focus.length, 24);
  assert.ok(first.bundle.measurements.every((item) => item.basis === 'MODEL_FORECAST' && item.measured === false && item.unit === 'μg/m³'));
  assert.equal(first.bundle.sources[0].dataKind, 'MODEL_FORECAST');
  assert.equal(first.bundle.comparisons[0].status, 'NOT_PERFORMED');
  assert.equal(first.bundle.derived[0].hoursUsed + first.bundle.derived[0].hoursMissing, 24);
  assert.ok(first.bundle.cannotProve.some((line) => /emission reduction/.test(line)));
  assert.ok(first.bundle.custody.every((step) => typeof step.step === 'string'));
});

test('a one-character change anywhere in the bundle changes the digest', () => {
  const built = buildEvidenceBundle({ site: delhi, analyte: 'pm2_5', source: parseCapture() });
  const edited = structuredClone(built.bundle);
  edited.sources[0].sourceUrl = edited.sources[0].sourceUrl.replace('cams_global', 'cams_globaX');
  assert.notEqual(digestOf(edited), built.digest);
  assert.equal(verifyBundle(built.bundle, built.digest).matches, true);
  assert.equal(verifyBundle(edited, built.digest).matches, false);
});

test('the tamper test alters a copy and leaves the original intact', () => {
  const built = buildEvidenceBundle({ site: delhi, analyte: 'pm2_5', source: parseCapture() });
  const before = structuredClone(built.bundle);
  const { tampered, change } = tamperCopy(built.bundle);
  assert.notEqual(change.before, change.after);
  assert.notEqual(digestOf(tampered), built.digest);
  assert.deepEqual(built.bundle, before);
  assert.equal(digestOf(built.bundle), built.digest);
});

test('a correction links to its parent and gets its own id and metadata hash', () => {
  const original = buildEvidenceBundle({ site: delhi, analyte: 'pm2_5', source: parseCapture() });
  const revised = buildEvidenceBundle({ site: delhi, analyte: 'pm2_5', source: parseCapture(), parentEvidenceId: original.bundle.evidenceId, revisionNote: 'Re-fetched after a stale-source challenge.' });
  assert.equal(revised.bundle.parentEvidenceId, original.bundle.evidenceId);
  assert.notEqual(revised.bundle.evidenceId, original.bundle.evidenceId);
  assert.notEqual(revised.metadataHash, original.metadataHash);
  assert.throws(() => buildEvidenceBundle({ site: delhi, analyte: 'pm2_5', source: parseCapture(), parentEvidenceId: 'not-an-id' }), { code: 'invalid_parent' });
  assert.throws(() => buildEvidenceBundle({ site: delhi, analyte: 'methane', source: parseCapture() }), { code: 'unknown_analyte' });
});

test('claim scope ignores which evidence backs it, so swapping evidence cannot re-claim the same scope', () => {
  const original = buildEvidenceBundle({ site: delhi, analyte: 'pm2_5', source: parseCapture() });
  const revised = buildEvidenceBundle({ site: delhi, analyte: 'pm2_5', source: parseCapture(), parentEvidenceId: original.bundle.evidenceId, revisionNote: 'Different evidence, same scope.' });
  assert.deepEqual(claimScope(original.bundle, 1), claimScope(revised.bundle, 1));
  assert.equal(exclusivityKeyOf(claimScope(original.bundle, 1)), exclusivityKeyOf(claimScope(revised.bundle, 1)));
  assert.notEqual(exclusivityKeyOf(claimScope(original.bundle, 1)), exclusivityKeyOf(claimScope(original.bundle, 2)));
});

test('a claim is labelled as a non-creditable demo and hashes deterministically', () => {
  const built = buildEvidenceBundle({ site: delhi, analyte: 'pm2_5', source: parseCapture() });
  const args = { bundle: built.bundle, digest: built.digest, claimant: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', scope: claimScope(built.bundle, 1), createdAt: '2026-10-23T13:10:00.000Z' };
  const claim = buildClaim(args);
  assert.deepEqual(buildClaim(args), claim);
  assert.match(claim.claim.claimId, CLAIM_ID);
  assert.equal(claim.claim.label, CLAIM_LABEL);
  assert.equal(claim.claim.creditable, false);
  assert.match(claim.claim.baseline, /No emission reduction/);
  assert.match(claim.claim.verificationState, /No independent verifier/);
  assert.equal(claim.claimHash, digestOf(claim.claim));
  assert.equal(claim.claim.evidence[0].evidenceId, built.bundle.evidenceId);
});

test('a challenge needs a known reason and a real description', () => {
  const base = { claimId: `cl-${'a'.repeat(24)}`, challenger: '0x90F79bf6EB2c4f870365E785982E1f101E93b906', createdAt: '2026-10-23T13:12:00.000Z' };
  assert.throws(() => buildChallenge({ ...base, reasonCode: 'BECAUSE', detail: 'The model value is a forecast.' }), { code: 'invalid_reason' });
  assert.throws(() => buildChallenge({ ...base, reasonCode: 'STALE_SOURCE', detail: 'stale' }), { code: 'invalid_detail' });
  const challenge = buildChallenge({ ...base, reasonCode: 'MODEL_NOT_OBSERVATION', detail: 'The claim relies on a 45 km model value, not a monitor.' });
  assert.equal(challenge.reasonHash, digestOf(challenge.challenge));
});

test('recommendations are deterministic, bounded and never claim a cause', () => {
  const built = buildEvidenceBundle({ site: delhi, analyte: 'pm2_5', source: parseCapture() });
  const steps = recommendNextSteps(built.bundle);
  assert.deepEqual(recommendNextSteps(built.bundle), steps);
  assert.ok(steps.some((step) => /reference-grade station/.test(step.action)));
  assert.ok(steps.some((step) => /Re-fetch live data/.test(step.action)), 'a cached example asks for a fresh retrieval');
  assert.ok(steps.some((step) => /Do not attribute/.test(step.action)));
  assert.ok(recommendNextSteps(built.bundle, { claimStatus: 'Challenged' }).some((step) => /open challenge/.test(step.action)));
});
