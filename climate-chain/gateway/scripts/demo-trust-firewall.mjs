// End-to-end Trust Firewall demonstration on an in-memory in-process chain (no node, no keys, no persisted state).
//   node scripts/demo-trust-firewall.mjs
//
// Shows: one real source (Open-Meteo CAMS, falling back to a cached capture that is labelled as such), one false claim
// the firewall rejects, one inflated claim it rejects by comparing the claim with the evidence, one valid claim it
// accepts, an enforced submission with a real local-chain receipt, the chain's own duplicate rejection, and the claims
// the firewall cannot catch. Every hash, block and status printed is read back from the chain.

import { createChainRuntime } from '../chain-runtime.mjs';
import { createMemoryStorage } from '../storage.mjs';
import { createIntegrityService } from '../integrity-service.mjs';

const line = (text = '') => console.log(text);
const head = (text) => { line(); line(`== ${text}`); };

const rt = createChainRuntime({ storage: createMemoryStorage(), seed: { source: 'demo', seed: 'demo-seed-0123456789abcdef-0123456789abcdef-aa' }, env: {}, minRefreshMs: 0, bootBackoffMs: 0 });
const advisory = createIntegrityService({ chain: rt, enforceFirewall: false });
const enforced = createIntegrityService({ chain: rt, enforceFirewall: true });

head('1. One real source');
const built = await advisory.buildEvidence({ siteId: 'new-delhi', analyte: 'pm2_5', mode: 'live-or-cached' });
const bundle = built.bundle;
const source = bundle.sources[0];
line(`provider: ${source.provider} / ${source.dataProvider}`);
line(`retrieval: ${source.retrievalMode}   dataKind: ${source.dataKind}   retrievedAt: ${source.retrievedAt}`);
if (source.retrievalMode !== 'LIVE_FETCH') line('NOTE: the network fetch failed, so this run uses the CACHED HISTORICAL EXAMPLE; the firewall will find it stale.');
line(`evidence digest (sha256): ${built.digest}`);
const focus = bundle.focusAnalyte;
const series = bundle.measurements.filter((m) => m.analyte === focus && typeof m.value === 'number');
const latest = series[series.length - 1];
line(`${focus} latest modelled value: ${latest.value} ${latest.unit} at ${latest.validTimeUtc} (MODELLED, not a station reading)`);

head('2. Anchor the digest on the local chain');
const anchored = await advisory.anchor(built.evidenceId);
line(`tx ${anchored.transactionHash}  block ${anchored.blockNumber}  receipt status ${anchored.receiptStatus}  on-chain digest matches: ${anchored.onChainDigest === `0x${built.digest}`}`);

const scope = (extra = {}) => ({ domain: 'air_quality', boundary: bundle.location.siteId, timeEpoch: bundle.timeframe.endUtc.slice(0, 10), activityType: focus, lat: bundle.location.lat, lon: bundle.location.lon, ...extra });
const claimOf = (claimType, value) => ({
  claimId: `cl-demo-${claimType.slice(14, 20).toLowerCase()}-${String(value).replace('.', '')}`,
  claimType,
  scope: scope(),
  evidence: [{ evidenceId: built.evidenceId, digest: built.digest }],
  result: { statement: `PM2.5 claim at ${bundle.location.label}`, analyte: focus, value, unit: latest.unit, aggregation: 'latest' },
});
const show = (label, r) => {
  line(`${label}: ${r.verdict}  eligible-for-anchoring=${r.eligibleForOnChainSubmission}  receipt=${r.receiptId}`);
  for (const reason of [...r.errors, ...(r.notes ?? [])]) line(`   - ${reason}`);
};

head('3. A FALSE claim is rejected: modelled data presented as an observation');
show('"observed pollution"', await advisory.evaluateFirewall({ claim: claimOf('ENVIRONMENTAL_OBSERVATION', latest.value), evidence: bundle, expectedDigest: built.digest, claimType: 'ENVIRONMENTAL_OBSERVATION', claimSubtype: 'air-quality' }));

head('4. An INFLATED claim is rejected: claim-type-aware sufficiency compares the claim with the evidence');
const inflated = Math.round(latest.value * 3);
show(`risk alert claiming ${inflated} (3x the evidence)`, await advisory.evaluateFirewall({ claim: claimOf('ENVIRONMENTAL_RISK_ALERT', inflated), evidence: bundle, expectedDigest: built.digest, claimType: 'ENVIRONMENTAL_RISK_ALERT', claimSubtype: 'air-quality' }));

head('5. A VALID claim is accepted (as what it is: a modelled risk advisory, not an observation)');
show(`risk alert claiming ${latest.value}`, await advisory.evaluateFirewall({ claim: claimOf('ENVIRONMENTAL_RISK_ALERT', latest.value), evidence: bundle, expectedDigest: built.digest, claimType: 'ENVIRONMENTAL_RISK_ALERT', claimSubtype: 'air-quality' }));

head('6. Enforced submission: the firewall runs first, then the claim reaches the chain');
try {
  const submitted = await enforced.submitClaim({ evidenceId: built.evidenceId });
  line(`ACCEPTED -> claim ${submitted.claim.claimId}  status ${submitted.proof.status}  tx ${submitted.proof.transactionHash}  block ${submitted.proof.submittedBlock}  receipt status ${submitted.proof.receiptStatus}`);
  const duplicate = await advisory.duplicateClaim(submitted.claim.claimId);
  line(`same claim again -> chain revert ${duplicate.errorName}  tx ${duplicate.transactionHash}  mined with status ${duplicate.receiptStatus}`);
} catch (error) {
  line(`REFUSED by the firewall gate (${error.code}): ${error.message}`);
}

head('7. What the firewall can NOT catch');
const known = (await advisory.benchmarkFirewall()).adversarialV2;
for (const k of known.knownLimitations) line(`${k.missedByDesign ? 'MISSED' : 'caught'}: ${k.name}`);
line(`${known.passed}/${known.scoredCases} synthetic adversarial cases pass; they were written after probing the v1 blind spots, so this is a regression suite, not a blind test.`);
process.exit(0);
