const fs = require('node:fs');
const path = require('node:path');
const hre = require('hardhat');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const contract = await (await hre.ethers.getContractFactory('EvidenceAnchor')).deploy();
  await contract.waitForDeployment();
  const deploymentTx = await contract.deploymentTransaction().wait();
  const network = await hre.ethers.provider.getNetwork();
  const artifact = await hre.artifacts.readArtifact('EvidenceAnchor');
  const deployment = {
    network: hre.network.name,
    chainId: Number(network.chainId),
    address: await contract.getAddress(),
    deployBlock: deploymentTx.blockNumber,
    deployer: deployer.address,
    abi: artifact.abi,
  };

  // CLIMATE_CHAIN_DEPLOYMENTS_DIR lets a second test chain deploy without overwriting the
  // files the running launcher uses. start.ps1 leaves it unset.
  const dir = process.env.CLIMATE_CHAIN_DEPLOYMENTS_DIR || path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'localhost.json'), `${JSON.stringify(deployment, null, 2)}\n`, 'utf8');
  console.log(`EvidenceAnchor deployed on chain ${deployment.chainId} at ${deployment.address} (block ${deployment.deployBlock}).`);
  console.log(`Wrote ${path.join(dir, 'localhost.json')}`);

  await deployIntegrityRegistries(dir, network);
}

// Climate Integrity Lab registries. Roles go to separate Hardhat dev accounts so the demo
// shows separation of duties. These are public, deterministic test accounts, never real keys.
async function deployIntegrityRegistries(dir, network) {
  const [attester, claimant, reviewer, challenger] = await hre.ethers.getSigners();
  const deployed = async (name, args = []) => {
    const contract = await (await hre.ethers.getContractFactory(name)).deploy(...args);
    await contract.waitForDeployment();
    const receipt = await contract.deploymentTransaction().wait();
    const artifact = await hre.artifacts.readArtifact(name);
    return { contract, record: { address: await contract.getAddress(), deployTxHash: receipt.hash, deployBlock: receipt.blockNumber, abi: artifact.abi } };
  };

  const evidence = await deployed('EnvironmentalEvidenceRegistry');
  const claims = await deployed('ClimateClaimRegistry', [evidence.record.address]);
  await (await claims.contract.setClaimant(claimant.address, true)).wait();
  await (await claims.contract.setReviewer(reviewer.address, true)).wait();
  const genesis = await hre.ethers.provider.getBlock(0);

  const integrity = {
    network: hre.network.name,
    chainId: Number(network.chainId),
    genesisHash: genesis.hash,
    deployedAt: new Date().toISOString(),
    accounts: { attester: attester.address, claimant: claimant.address, reviewer: reviewer.address, challenger: challenger.address },
    evidenceRegistry: evidence.record,
    claimRegistry: claims.record,
  };
  fs.writeFileSync(path.join(dir, 'integrity-localhost.json'), `${JSON.stringify(integrity, null, 2)}\n`, 'utf8');
  console.log(`EnvironmentalEvidenceRegistry at ${evidence.record.address}; ClimateClaimRegistry at ${claims.record.address} (chain ${integrity.chainId}).`);
  console.log(`Wrote ${path.join(dir, 'integrity-localhost.json')}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
