const { expect } = require('chai');
const { ethers } = require('hardhat');

// Same helper as EvidenceAnchor.test.js: decode the revert data and compare the custom error name.
async function expectCustomError(action, contract, expectedName) {
  let failure;
  try { await action; } catch (error) { failure = error; }
  expect(failure, 'expected the transaction to revert').to.exist;
  const data = failure.data || failure.info?.error?.data || failure.info?.error?.error?.data;
  expect(data, 'expected revert data').to.be.a('string');
  expect(contract.interface.parseError(data)?.name).to.equal(expectedName);
}

function eventNamed(contract, receipt, name) {
  return receipt.logs
    .map((log) => { try { return contract.interface.parseLog(log); } catch { return null; } })
    .find((entry) => entry?.name === name);
}

const Status = { None: 0n, Submitted: 1n, Challenged: 2n, Rejected: 3n, Superseded: 4n };
const evidenceKey = (label) => ethers.id(`ev-${label}`);
const digestOf = (label) => ethers.sha256(ethers.toUtf8Bytes(`bundle:${label}`));
const metadataOf = (label) => ethers.sha256(ethers.toUtf8Bytes(`metadata:${label}`));

describe('EnvironmentalEvidenceRegistry', () => {
  let registry;
  let admin;
  let outsider;

  beforeEach(async () => {
    [admin, outsider] = await ethers.getSigners();
    registry = await (await ethers.getContractFactory('EnvironmentalEvidenceRegistry')).deploy();
  });

  it('anchors a digest under an evidence id and exposes the record and event', async () => {
    const receipt = await (await registry.anchorEvidence(evidenceKey('a'), digestOf('a'), ethers.ZeroHash, metadataOf('a'))).wait();
    const event = eventNamed(registry, receipt, 'EvidenceAnchored');
    expect(event.args.evidenceId).to.equal(evidenceKey('a'));
    expect(event.args.digest).to.equal(digestOf('a'));
    expect(event.args.parentEvidenceId).to.equal(ethers.ZeroHash);
    expect(event.args.metadataHash).to.equal(metadataOf('a'));
    expect(event.args.attester).to.equal(admin.address);
    expect(event.args.blockNumber).to.equal(BigInt(receipt.blockNumber));

    const record = await registry.getEvidence(evidenceKey('a'));
    expect(record.digest).to.equal(digestOf('a'));
    expect(record.supersededBy).to.equal(ethers.ZeroHash);
    expect(await registry.evidenceIdForDigest(digestOf('a'))).to.equal(evidenceKey('a'));
    expect(await registry.verifyDigest(evidenceKey('a'), digestOf('a'))).to.equal(true);
    expect(await registry.verifyDigest(evidenceKey('a'), digestOf('tampered'))).to.equal(false);
    expect(await registry.isCurrent(evidenceKey('a'))).to.equal(true);
    expect(await registry.evidenceCount()).to.equal(1n);
  });

  it('accepts writes only from attesters, and attesters only from the admin', async () => {
    await expectCustomError(registry.connect(outsider).anchorEvidence(evidenceKey('x'), digestOf('x'), ethers.ZeroHash, ethers.ZeroHash), registry, 'NotAttester');
    await expectCustomError(registry.connect(outsider).setAttester(outsider.address, true), registry, 'NotAdmin');
    await expectCustomError(registry.setAttester(ethers.ZeroAddress, true), registry, 'ZeroAddress');

    await registry.setAttester(outsider.address, true);
    await registry.connect(outsider).anchorEvidence(evidenceKey('x'), digestOf('x'), ethers.ZeroHash, ethers.ZeroHash);
    await registry.setAttester(outsider.address, false);
    await expectCustomError(registry.connect(outsider).anchorEvidence(evidenceKey('y'), digestOf('y'), ethers.ZeroHash, ethers.ZeroHash), registry, 'NotAttester');
  });

  it('rejects empty ids and empty digests', async () => {
    await expectCustomError(registry.anchorEvidence(ethers.ZeroHash, digestOf('a'), ethers.ZeroHash, ethers.ZeroHash), registry, 'EmptyEvidenceId');
    await expectCustomError(registry.anchorEvidence(evidenceKey('a'), ethers.ZeroHash, ethers.ZeroHash, ethers.ZeroHash), registry, 'EmptyDigest');
  });

  it('rejects a replayed evidence id and the same bytes under a new id', async () => {
    await registry.anchorEvidence(evidenceKey('a'), digestOf('a'), ethers.ZeroHash, metadataOf('a'));
    await expectCustomError(registry.anchorEvidence(evidenceKey('a'), digestOf('a'), ethers.ZeroHash, metadataOf('a')), registry, 'EvidenceIdTaken');
    await expectCustomError(registry.anchorEvidence(evidenceKey('a'), digestOf('b'), ethers.ZeroHash, metadataOf('b')), registry, 'EvidenceIdTaken');
    await expectCustomError(registry.anchorEvidence(evidenceKey('b'), digestOf('a'), ethers.ZeroHash, metadataOf('a')), registry, 'DigestAlreadyAnchored');
    expect(await registry.evidenceCount()).to.equal(1n);
  });

  it('links a correction to its parent and keeps the parent record readable', async () => {
    await registry.anchorEvidence(evidenceKey('a'), digestOf('a'), ethers.ZeroHash, metadataOf('a'));
    const receipt = await (await registry.anchorEvidence(evidenceKey('a2'), digestOf('a2'), evidenceKey('a'), metadataOf('a2'))).wait();
    const superseded = eventNamed(registry, receipt, 'EvidenceSuperseded');
    expect(superseded.args.parentEvidenceId).to.equal(evidenceKey('a'));
    expect(superseded.args.evidenceId).to.equal(evidenceKey('a2'));

    const parent = await registry.getEvidence(evidenceKey('a'));
    expect(parent.digest).to.equal(digestOf('a'));
    expect(parent.supersededBy).to.equal(evidenceKey('a2'));
    expect(await registry.isCurrent(evidenceKey('a'))).to.equal(false);
    expect(await registry.isCurrent(evidenceKey('a2'))).to.equal(true);
    expect((await registry.getEvidence(evidenceKey('a2'))).parentEvidenceId).to.equal(evidenceKey('a'));
  });

  it('rejects an unknown parent and a second correction of the same parent', async () => {
    await expectCustomError(registry.anchorEvidence(evidenceKey('c'), digestOf('c'), evidenceKey('missing'), ethers.ZeroHash), registry, 'UnknownParent');
    await registry.anchorEvidence(evidenceKey('a'), digestOf('a'), ethers.ZeroHash, ethers.ZeroHash);
    await registry.anchorEvidence(evidenceKey('a2'), digestOf('a2'), evidenceKey('a'), ethers.ZeroHash);
    await expectCustomError(registry.anchorEvidence(evidenceKey('a3'), digestOf('a3'), evidenceKey('a'), ethers.ZeroHash), registry, 'ParentAlreadySuperseded');
  });

  it('keeps the anchor write within a bounded gas cost', async () => {
    const gas = await registry.anchorEvidence.estimateGas(evidenceKey('g'), digestOf('g'), ethers.ZeroHash, metadataOf('g'));
    expect(gas < 250_000n, `anchorEvidence estimated ${gas} gas`).to.equal(true);
  });
});

describe('ClimateClaimRegistry', () => {
  let evidence;
  let claims;
  let admin;
  let claimant;
  let reviewer;
  let challenger;
  let outsider;
  const scope = (label) => ethers.id(`scope:${label}`);
  const claimKey = (label) => ethers.id(`cl-${label}`);
  const claimHash = (label) => ethers.sha256(ethers.toUtf8Bytes(`claim:${label}`));
  const reason = ethers.sha256(ethers.toUtf8Bytes('reason:stale source'));

  beforeEach(async () => {
    [admin, claimant, reviewer, challenger, outsider] = await ethers.getSigners();
    evidence = await (await ethers.getContractFactory('EnvironmentalEvidenceRegistry')).deploy();
    claims = await (await ethers.getContractFactory('ClimateClaimRegistry')).deploy(await evidence.getAddress());
    await claims.setClaimant(claimant.address, true);
    await claims.setReviewer(reviewer.address, true);
    await evidence.anchorEvidence(evidenceKey('e1'), digestOf('e1'), ethers.ZeroHash, metadataOf('e1'));
    await evidence.anchorEvidence(evidenceKey('e2'), digestOf('e2'), ethers.ZeroHash, metadataOf('e2'));
  });

  it('records a claim against anchored evidence and locks its scope', async () => {
    const receipt = await (await claims.connect(claimant).submitClaim(claimKey('1'), scope('delhi'), evidenceKey('e1'), claimHash('1'))).wait();
    const event = eventNamed(claims, receipt, 'ClaimSubmitted');
    expect(event.args.claimId).to.equal(claimKey('1'));
    expect(event.args.exclusivityKey).to.equal(scope('delhi'));
    expect(event.args.claimant).to.equal(claimant.address);

    const record = await claims.getClaim(claimKey('1'));
    expect(record.status).to.equal(Status.Submitted);
    expect(record.evidenceId).to.equal(evidenceKey('e1'));
    expect(await claims.activeClaimForKey(scope('delhi'))).to.equal(claimKey('1'));
    expect(await claims.activeClaimForEvidence(evidenceKey('e1'))).to.equal(claimKey('1'));
  });

  it('accepts claims only from claimants and roles only from the admin', async () => {
    await expectCustomError(claims.connect(outsider).submitClaim(claimKey('1'), scope('delhi'), evidenceKey('e1'), claimHash('1')), claims, 'NotClaimant');
    await expectCustomError(claims.connect(outsider).setReviewer(outsider.address, true), claims, 'NotAdmin');
    await expectCustomError(claims.connect(outsider).setClaimant(outsider.address, true), claims, 'NotAdmin');
  });

  it('rejects a second active claim for the same scope, the same evidence, or the same claim id', async () => {
    await claims.connect(claimant).submitClaim(claimKey('1'), scope('delhi'), evidenceKey('e1'), claimHash('1'));
    await expectCustomError(claims.connect(claimant).submitClaim(claimKey('2'), scope('delhi'), evidenceKey('e2'), claimHash('2')), claims, 'DuplicateClaim');
    await expectCustomError(claims.connect(claimant).submitClaim(claimKey('3'), scope('chennai'), evidenceKey('e1'), claimHash('3')), claims, 'EvidenceAlreadyClaimed');
    await expectCustomError(claims.connect(claimant).submitClaim(claimKey('1'), scope('chennai'), evidenceKey('e2'), claimHash('1')), claims, 'ClaimIdTaken');
    expect(await claims.claimCount()).to.equal(1n);
  });

  it('refuses claims backed by missing or superseded evidence, and empty fields', async () => {
    await expectCustomError(claims.connect(claimant).submitClaim(claimKey('1'), scope('delhi'), evidenceKey('none'), claimHash('1')), claims, 'EvidenceNotAnchored');
    await evidence.anchorEvidence(evidenceKey('e1b'), digestOf('e1b'), evidenceKey('e1'), metadataOf('e1b'));
    await expectCustomError(claims.connect(claimant).submitClaim(claimKey('1'), scope('delhi'), evidenceKey('e1'), claimHash('1')), claims, 'EvidenceNotCurrent');
    await expectCustomError(claims.connect(claimant).submitClaim(ethers.ZeroHash, scope('delhi'), evidenceKey('e2'), claimHash('1')), claims, 'EmptyClaimId');
    await expectCustomError(claims.connect(claimant).submitClaim(claimKey('1'), ethers.ZeroHash, evidenceKey('e2'), claimHash('1')), claims, 'EmptyExclusivityKey');
    await expectCustomError(claims.connect(claimant).submitClaim(claimKey('1'), scope('delhi'), evidenceKey('e2'), ethers.ZeroHash), claims, 'EmptyClaimHash');
  });

  it('lets anyone challenge, but only an unconflicted reviewer decide', async () => {
    await claims.connect(claimant).submitClaim(claimKey('1'), scope('delhi'), evidenceKey('e1'), claimHash('1'));
    await expectCustomError(claims.connect(challenger).challengeClaim(claimKey('1'), ethers.ZeroHash), claims, 'EmptyReason');
    await expectCustomError(claims.connect(challenger).challengeClaim(claimKey('missing'), reason), claims, 'UnknownClaim');
    const receipt = await (await claims.connect(challenger).challengeClaim(claimKey('1'), reason)).wait();
    expect(eventNamed(claims, receipt, 'ClaimChallenged').args.challenger).to.equal(challenger.address);
    expect((await claims.getClaim(claimKey('1'))).status).to.equal(Status.Challenged);
    await expectCustomError(claims.connect(challenger).challengeClaim(claimKey('1'), reason), claims, 'InvalidStatus');

    await expectCustomError(claims.connect(challenger).resolveChallenge(claimKey('1'), true), claims, 'NotReviewer');
    await claims.setReviewer(claimant.address, true);
    await expectCustomError(claims.connect(claimant).resolveChallenge(claimKey('1'), true), claims, 'ConflictOfInterest');
  });

  it('returns a dismissed challenge to Submitted and releases the scope when upheld', async () => {
    await claims.connect(claimant).submitClaim(claimKey('1'), scope('delhi'), evidenceKey('e1'), claimHash('1'));
    await claims.connect(challenger).challengeClaim(claimKey('1'), reason);
    await claims.connect(reviewer).resolveChallenge(claimKey('1'), false);
    expect((await claims.getClaim(claimKey('1'))).status).to.equal(Status.Submitted);

    await claims.connect(challenger).challengeClaim(claimKey('1'), reason);
    await claims.connect(reviewer).resolveChallenge(claimKey('1'), true);
    expect((await claims.getClaim(claimKey('1'))).status).to.equal(Status.Rejected);
    expect(await claims.activeClaimForKey(scope('delhi'))).to.equal(ethers.ZeroHash);
    await expectCustomError(claims.connect(reviewer).resolveChallenge(claimKey('1'), true), claims, 'InvalidStatus');

    await claims.connect(claimant).submitClaim(claimKey('2'), scope('delhi'), evidenceKey('e2'), claimHash('2'));
    expect(await claims.activeClaimForKey(scope('delhi'))).to.equal(claimKey('2'));
  });

  it('supersedes a challenged claim with a correction and keeps the lineage readable', async () => {
    await claims.connect(claimant).submitClaim(claimKey('1'), scope('delhi'), evidenceKey('e1'), claimHash('1'));
    await expectCustomError(claims.connect(reviewer).approveCorrection(claimKey('1'), claimKey('1b'), evidenceKey('e2'), claimHash('1b')), claims, 'InvalidStatus');
    await claims.connect(challenger).challengeClaim(claimKey('1'), reason);
    await evidence.anchorEvidence(evidenceKey('e1b'), digestOf('e1b'), evidenceKey('e1'), metadataOf('e1b'));

    const receipt = await (await claims.connect(reviewer).approveCorrection(claimKey('1'), claimKey('1b'), evidenceKey('e1b'), claimHash('1b'))).wait();
    const superseded = eventNamed(claims, receipt, 'ClaimSuperseded');
    expect(superseded.args.originalClaimId).to.equal(claimKey('1'));
    expect(superseded.args.correctedClaimId).to.equal(claimKey('1b'));
    expect(superseded.args.reviewer).to.equal(reviewer.address);

    const original = await claims.getClaim(claimKey('1'));
    const corrected = await claims.getClaim(claimKey('1b'));
    expect(original.status).to.equal(Status.Superseded);
    expect(original.supersededBy).to.equal(claimKey('1b'));
    expect(original.claimHash).to.equal(claimHash('1'));
    expect(corrected.status).to.equal(Status.Submitted);
    expect(corrected.supersedes).to.equal(claimKey('1'));
    expect(corrected.claimant).to.equal(claimant.address);
    expect(corrected.exclusivityKey).to.equal(scope('delhi'));
    expect(await claims.activeClaimForKey(scope('delhi'))).to.equal(claimKey('1b'));
    expect(await claims.activeClaimForEvidence(evidenceKey('e1'))).to.equal(ethers.ZeroHash);
    expect(await claims.activeClaimForEvidence(evidenceKey('e1b'))).to.equal(claimKey('1b'));
    await expectCustomError(claims.connect(claimant).submitClaim(claimKey('3'), scope('delhi'), evidenceKey('e2'), claimHash('3')), claims, 'DuplicateClaim');
  });

  it('exposes no token, transfer or minting surface', async () => {
    const names = claims.interface.fragments.filter((fragment) => fragment.type === 'function').map((fragment) => fragment.name);
    for (const forbidden of ['transfer', 'transferFrom', 'mint', 'approve', 'balanceOf', 'safeTransferFrom']) {
      expect(names, `unexpected ${forbidden}`).to.not.include(forbidden);
    }
  });

  it('keeps claim submission within a bounded gas cost', async () => {
    const gas = await claims.connect(claimant).submitClaim.estimateGas(claimKey('g'), scope('gas'), evidenceKey('e1'), claimHash('g'));
    expect(gas < 300_000n, `submitClaim estimated ${gas} gas`).to.equal(true);
  });
});
