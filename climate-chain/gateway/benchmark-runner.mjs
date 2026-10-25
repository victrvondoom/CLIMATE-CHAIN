// Benchmark Runner: Compares Baseline A (Hash-only), Baseline B (Existing Registry), and Baseline C (Trust Firewall).
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { digestOf } from './integrity-evidence.mjs';
import { evaluateClaimThroughFirewall, VERDICTS } from './trust-firewall.mjs';

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const FIXTURES_FILE = join(ROOT, 'fixtures/adversarial-claims.json');

/**
 * Baseline A: Hash-Only Verification
 * Simply checks if digestOf(evidence) matches expectedDigest.
 */
function evaluateBaselineA(testCase) {
  const { evidence, expectedDigest } = testCase;
  const recomputed = digestOf(evidence);
  const cleanExpected = String(expectedDigest || '').replace(/^0x/, '').toLowerCase();
  const valid = recomputed === cleanExpected;
  return {
    accepted: valid,
    verdict: valid ? 'ACCEPTED' : 'REJECTED',
    latencyMs: 0,
  };
}

/**
 * Baseline B: Existing Claim-Registry Rules
 * Checks hash integrity + basic exclusivityKey lock (exact match).
 * Does not check basis compatibility, staleness, broken custody, or composite scope evasion.
 */
function evaluateBaselineB(testCase) {
  const { evidence, expectedDigest, claim, existingClaims = [] } = testCase;
  const recomputed = digestOf(evidence);
  const cleanExpected = String(expectedDigest || '').replace(/^0x/, '').toLowerCase();
  if (recomputed !== cleanExpected) {
    return { accepted: false, verdict: 'REJECTED', reason: 'Digest mismatch' };
  }

  // Basic exclusivity check: exact scope digest
  const currentKey = digestOf(claim.scope || {});
  for (const existing of existingClaims) {
    const existingKey = digestOf(existing.scope || {});
    if (existingKey === currentKey && existing.status !== 'Rejected') {
      return { accepted: false, verdict: 'REJECTED', reason: 'Duplicate scope' };
    }
  }

  return { accepted: true, verdict: 'ACCEPTED' };
}

/**
 * Baseline C: Evidence-to-Claim Trust Firewall
 */
function evaluateBaselineC(testCase) {
  const result = evaluateClaimThroughFirewall({
    claim: testCase.claim,
    evidence: testCase.evidence,
    expectedDigest: testCase.expectedDigest,
    existingClaims: testCase.existingClaims || [],
    evaluationTime: new Date('2026-10-24T12:00:00Z'),
  });
  return {
    accepted: result.verdict === VERDICTS.ACCEPTED,
    verdict: result.verdict,
    receipt: result.receipt,
  };
}

export async function runBenchmark() {
  const raw = await readFile(FIXTURES_FILE, 'utf8');
  const cases = JSON.parse(raw);

  const systems = [
    { name: 'Baseline A (Hash-Only Verification)', evalFn: evaluateBaselineA },
    { name: 'Baseline B (Existing Claim-Registry Rules)', evalFn: evaluateBaselineB },
    { name: 'Baseline C (Trust Firewall: Provenance & Tier Policies)', evalFn: evaluateBaselineC },
  ];

  const results = {};

  for (const sys of systems) {
    let tp = 0; // Legitimate claim accepted
    let fp = 0; // Unsafe claim accepted
    let tn = 0; // Unsafe claim rejected
    let fn = 0; // Legitimate claim rejected
    const latencies = [];

    for (const tc of cases) {
      const start = performance.now();
      const res = sys.evalFn(tc);
      const end = performance.now();
      latencies.push(end - start);

      const isUnsafe = tc.isUnsafeClaim;
      const wasAccepted = res.accepted;

      if (!isUnsafe && wasAccepted) tp++;
      else if (isUnsafe && wasAccepted) fp++;
      else if (isUnsafe && !wasAccepted) tn++;
      else if (!isUnsafe && !wasAccepted) fn++;
    }

    const precision = (tp + fp) > 0 ? tp / (tp + fp) : 1;
    const recall = (tp + fn) > 0 ? tp / (tp + fn) : 1;
    const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    const unsafeAcceptanceRate = (fp + tn) > 0 ? fp / (fp + tn) : 0;
    const falseRejectionRate = (tp + fn) > 0 ? fn / (tp + fn) : 0;
    const avgLatencyMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;

    results[sys.name] = {
      totalCases: cases.length,
      truePositives: tp,
      falsePositives: fp,
      trueNegatives: tn,
      falseNegatives: fn,
      precision: Math.round(precision * 1000) / 1000,
      recall: Math.round(recall * 1000) / 1000,
      f1Score: Math.round(f1 * 1000) / 1000,
      unsafeAcceptanceRate: Math.round(unsafeAcceptanceRate * 1000) / 1000,
      falseRejectionRate: Math.round(falseRejectionRate * 1000) / 1000,
      avgLatencyMs: Math.round(avgLatencyMs * 1000) / 1000,
    };
  }

  return { timestamp: new Date().toISOString(), totalCases: cases.length, results };
}

const FIXTURES_V2_FILE = join(ROOT, 'fixtures/adversarial-claims-v2.json');
const V2_EVALUATION_TIME = new Date('2026-10-24T12:00:00Z');

/**
 * v2 adversarial suite. Unlike the v1 runner it compares the EXPECTED VERDICT and the expected rule code, so a case
 * rejected for the wrong reason counts as a failure. Cases in group KNOWN_LIMITATION are unsafe claims the firewall
 * cannot detect (expected ACCEPTED); they are reported separately and never counted as passes of the firewall.
 */
export async function runAdversarialV2() {
  const cases = JSON.parse(await readFile(FIXTURES_V2_FILE, 'utf8'));
  const rows = [];
  for (const tc of cases) {
    const result = evaluateClaimThroughFirewall({
      claim: tc.claim,
      evidence: tc.evidence,
      expectedDigest: tc.expectedDigest,
      existingClaims: tc.existingClaims || [],
      claimSubtype: tc.options?.claimSubtype || undefined,
      requireSubtype: Boolean(tc.options?.requireSubtype),
      evaluationTime: V2_EVALUATION_TIME,
    });
    const codeSeen = !tc.expectedCode || result.ruleResults.some((r) => r.code === tc.expectedCode);
    rows.push({
      id: tc.id, name: tc.name, group: tc.group, category: tc.category, isUnsafeClaim: tc.isUnsafeClaim, knownLimitation: Boolean(tc.knownLimitation),
      expectedVerdict: tc.expectedVerdict, actualVerdict: result.verdict, expectedCode: tc.expectedCode, codeSeen,
      pass: result.verdict === tc.expectedVerdict && codeSeen,
    });
  }
  const scored = rows.filter((r) => !r.knownLimitation);
  const known = rows.filter((r) => r.knownLimitation);
  const unsafe = scored.filter((r) => r.isUnsafeClaim);
  const legit = scored.filter((r) => !r.isUnsafeClaim);
  const byGroup = {};
  for (const r of scored) {
    byGroup[r.group] ||= { cases: 0, passed: 0 };
    byGroup[r.group].cases += 1;
    if (r.pass) byGroup[r.group].passed += 1;
  }
  return {
    totalCases: rows.length,
    scoredCases: scored.length,
    passed: scored.filter((r) => r.pass).length,
    failures: scored.filter((r) => !r.pass),
    unsafeAccepted: unsafe.filter((r) => r.actualVerdict === VERDICTS.ACCEPTED).length,
    legitimateNotAccepted: legit.filter((r) => r.actualVerdict !== VERDICTS.ACCEPTED).length,
    byGroup,
    knownLimitations: known.map((r) => ({ id: r.id, name: r.name, category: r.category, firewallVerdict: r.actualVerdict, missedByDesign: r.actualVerdict === VERDICTS.ACCEPTED })),
    label: 'Synthetic adversarial suite authored by the project team after probing the v1 firewall; a targeted regression and threat-model suite, not a blind held-out evaluation.',
  };
}

// If run directly from CLI
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--v2')) {
  runAdversarialV2().then((r) => {
    console.log('\n=== TRUST FIREWALL v2 ADVERSARIAL SUITE (synthetic, author-written) ===');
    console.log(`${r.passed}/${r.scoredCases} scored cases pass (verdict AND rule code). Unsafe accepted: ${r.unsafeAccepted}. Legitimate not accepted: ${r.legitimateNotAccepted}.`);
    for (const [g, v] of Object.entries(r.byGroup)) console.log(`  ${g}: ${v.passed}/${v.cases}`);
    for (const f of r.failures) console.log(`  FAIL #${f.id} ${f.name}: expected ${f.expectedVerdict}${f.expectedCode ? `/${f.expectedCode}` : ''}, got ${f.actualVerdict}${f.codeSeen ? '' : ' (code not seen)'}`);
    console.log(`Known limitations (unsafe claims the firewall does NOT catch): ${r.knownLimitations.filter((k) => k.missedByDesign).length}/${r.knownLimitations.length}`);
    for (const k of r.knownLimitations) console.log(`  ${k.missedByDesign ? 'MISSED' : 'caught'} #${k.id} ${k.name}`);
    if (r.failures.length) process.exitCode = 1; // lets CI gate on the suite
  }).catch((error) => { console.error(error); process.exitCode = 1; });
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runBenchmark().then((report) => {
    console.log('\n=== ADVERSARIAL CLIMATE TRUST FIREWALL BENCHMARK RESULTS ===');
    console.log(`Evaluated on ${report.totalCases} labelled test cases.\n`);
    for (const [name, stats] of Object.entries(report.results)) {
      console.log(`--- ${name} ---`);
      console.log(`  TP: ${stats.truePositives} | FP: ${stats.falsePositives} | TN: ${stats.trueNegatives} | FN: ${stats.falseNegatives}`);
      console.log(`  Precision:               ${(stats.precision * 100).toFixed(1)}%`);
      console.log(`  Recall:                  ${(stats.recall * 100).toFixed(1)}%`);
      console.log(`  F1 Score:                ${stats.f1Score.toFixed(3)}`);
      console.log(`  Unsafe Acceptance Rate:  ${(stats.unsafeAcceptanceRate * 100).toFixed(1)}% (Lower is better)`);
      console.log(`  False Rejection Rate:    ${(stats.falseRejectionRate * 100).toFixed(1)}% (Lower is better)`);
      console.log(`  Avg Latency:             ${stats.avgLatencyMs.toFixed(3)} ms\n`);
    }
  }).catch(console.error);
}
