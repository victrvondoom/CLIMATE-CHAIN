// End-to-end path against a real local chain. Skipped unless CLIMATE_CHAIN_E2E=1, because it
// needs `npm run node` and `npm run deploy:local` running in blockchain/ first.
//
//   cd blockchain && npm run node            (terminal 1)
//   cd blockchain && npm run deploy:local    (terminal 2)
//   cd gateway && CLIMATE_CHAIN_E2E=1 node --test tests/integrity-e2e.test.mjs
//
// The source is forced offline so the run uses the labelled cached example and does not
// depend on the network. Every chain value asserted here is read back from the node.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIntegrityService } from '../integrity-service.mjs';
import { createAirQualitySource } from '../integrity-sources.mjs';

const enabled = process.env.CLIMATE_CHAIN_E2E === '1';
const txHash = /^0x[0-9a-f]{64}$/;

test('full path: evidence, anchor, verify, tamper, replay, claim, duplicate, challenge, correction', { skip: !enabled && 'set CLIMATE_CHAIN_E2E=1 with a local chain running' }, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'climate-integrity-e2e-'));
  const offlineSource = createAirQualitySource({ fetchImpl: async () => { throw new TypeError('network disabled for this test'); }, sleep: async () => {} });
  const service = createIntegrityService({ dataDir, source: offlineSource });
  try {
    const status = await service.status();
    assert.equal(status.ledgerMode, 'LOCAL_EVM', status.problem?.message);

    const built = await service.buildEvidence({ siteId: 'new-delhi', analyte: 'pm2_5', mode: 'live-or-cached' });
    assert.equal(built.bundle.sources[0].retrievalMode, 'CACHED_HISTORICAL_EXAMPLE');
    assert.equal(built.bundle.sources[0].liveError.code, 'source_unavailable');
    assert.equal(built.proof.anchored, false);

    const anchored = await service.anchor(built.evidenceId);
    assert.equal(anchored.alreadyAnchored, false);
    assert.equal(anchored.receiptStatus, 1);
    assert.ok(anchored.confirmations >= 1, `a mined receipt has at least one confirmation, got ${anchored.confirmations}`);
    assert.match(anchored.transactionHash, txHash);
    assert.equal(anchored.onChainDigest, `0x${built.digest}`);
    assert.equal((await service.anchor(built.evidenceId)).alreadyAnchored, true);

    const verified = await service.verify(built.evidenceId);
    assert.equal(verified.verified, true, JSON.stringify(verified.checks));

    const tampered = await service.tamper(built.evidenceId);
    assert.equal(tampered.result, 'FAIL');
    assert.equal(tampered.contractAcceptsTampered, false);
    assert.equal(tampered.contractAcceptsOriginal, true);
    assert.equal((await service.verify(built.evidenceId)).verified, true, 'the tamper test never changes the stored evidence');

    const replay = await service.replay(built.evidenceId);
    assert.equal(replay.errorName, 'EvidenceIdTaken');
    if (replay.mined) assert.equal(replay.receiptStatus, 0);

    const claim = await service.submitClaim({ evidenceId: built.evidenceId });
    assert.equal(claim.proof.status, 'Submitted');
    assert.equal(claim.proof.activeForScope, true);
    assert.equal(claim.claim.creditable, false);

    const duplicate = await service.duplicateClaim(claim.claim.claimId);
    assert.equal(duplicate.errorName, 'DuplicateClaim');
    assert.equal(duplicate.sameExclusivityKey, true);
    if (duplicate.mined) assert.equal(duplicate.receiptStatus, 0);

    const challenged = await service.challenge(claim.claim.claimId, { reasonCode: 'STALE_SOURCE', detail: 'This claim uses a cached historical example, not a live retrieval.' });
    assert.equal(challenged.proof.status, 'Challenged');

    const corrected = await service.correct(claim.claim.claimId, { note: 'Re-retrieved the source and linked the revised bundle to the original.' });
    assert.equal(corrected.originalClaim.proof.status, 'Superseded');
    assert.equal(corrected.originalClaim.proof.supersededByClaimId, corrected.correctedClaim.claim.claimId);
    assert.equal(corrected.correctedClaim.proof.status, 'Submitted');
    assert.equal(corrected.correctedClaim.proof.supersedesClaimId, claim.claim.claimId);
    assert.equal(corrected.revisedEvidence.proof.parentEvidenceId, built.evidenceId);
    assert.equal(corrected.originalEvidence.proof.current, false);
    assert.equal(corrected.originalEvidence.proof.supersededByEvidenceId, corrected.revisedEvidence.evidenceId);

    const original = await service.verify(built.evidenceId);
    assert.equal(original.verified, true, 'the original record stays readable and intact after correction');
    assert.equal(original.proof.current, false);

    const history = await service.history();
    const names = history.events.map((event) => event.event);
    for (const expected of ['EvidenceAnchored', 'EvidenceSuperseded', 'ClaimSubmitted', 'ClaimChallenged', 'ClaimSuperseded']) assert.ok(names.includes(expected), `history has ${expected}`);
    const kinds = history.timeline.map((entry) => entry.kind);
    for (const expected of ['replay-rejected', 'duplicate-claim-rejected', 'claim-corrected']) assert.ok(kinds.includes(expected), `timeline has ${expected}`);

    const run = await service.reset();
    assert.equal(run.demoRun, history.demoRun + 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
