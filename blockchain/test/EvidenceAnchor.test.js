const { expect } = require('chai');
const { ethers } = require('hardhat');

async function expectCustomError(action, contract, expectedName) {
  let failure;
  try { await action; } catch (error) { failure = error; }
  expect(failure, 'expected the transaction to revert').to.exist;
  const data = failure.data || failure.info?.error?.data || failure.info?.error?.error?.data;
  expect(data, 'expected revert data').to.be.a('string');
  expect(contract.interface.parseError(data)?.name).to.equal(expectedName);
}

describe('EvidenceAnchor', () => {
  let anchor;
  let writer;

  beforeEach(async () => {
    [writer] = await ethers.getSigners();
    anchor = await (await ethers.getContractFactory('EvidenceAnchor')).deploy();
  });

  it('records a manifest digest and exposes the block commitment', async () => {
    const digest = ethers.sha256(ethers.toUtf8Bytes('{"review":"cascade"}'));
    const manifestIdHash = ethers.id('cascade:site-17');
    const evidenceTypeHash = ethers.id('climate-chain:cascade-review:v1');
    const tx = await anchor.anchor(digest, manifestIdHash, evidenceTypeHash);
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((log) => { try { return anchor.interface.parseLog(log); } catch { return null; } })
      .find((entry) => entry?.name === 'EvidenceAnchored');
    expect(event.args.digest).to.equal(digest);
    expect(event.args.manifestIdHash).to.equal(manifestIdHash);
    expect(event.args.evidenceTypeHash).to.equal(evidenceTypeHash);
    expect(event.args.anchorer).to.equal(writer.address);
    expect(event.args.blockNumber).to.equal(BigInt(receipt.blockNumber));
    expect(event.args.anchoredAt > 0n).to.equal(true);

    const record = await anchor.anchors(digest);
    expect(record.manifestIdHash).to.equal(manifestIdHash);
    expect(record.evidenceTypeHash).to.equal(evidenceTypeHash);
    expect(record.anchorer).to.equal(writer.address);
    expect(record.blockNumber).to.equal(BigInt(receipt.blockNumber));
    expect(record.exists).to.equal(true);
    expect(await anchor.anchorCount()).to.equal(1n);
  });

  it('rejects a duplicate digest instead of creating a second proof', async () => {
    const digest = ethers.sha256(ethers.toUtf8Bytes('same manifest'));
    await anchor.anchor(digest, ethers.ZeroHash, ethers.ZeroHash);

    await expectCustomError(anchor.anchor(digest, ethers.ZeroHash, ethers.ZeroHash), anchor, 'DigestAlreadyAnchored');
    expect(await anchor.anchorCount()).to.equal(1n);
  });

  it('rejects an empty digest', async () => {
    await expectCustomError(anchor.anchor(ethers.ZeroHash, ethers.ZeroHash, ethers.ZeroHash), anchor, 'EmptyDigest');
  });
});
