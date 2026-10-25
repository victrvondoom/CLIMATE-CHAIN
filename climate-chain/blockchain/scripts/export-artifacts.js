// Writes gateway/chain-artifacts.json: the ABI and creation bytecode of the three contracts, plus a hash of
// each Solidity source. The gateway uses it to run its own in-process chain where no Hardhat node exists
// (for example a serverless host). Run `npm run export:artifacts` after changing any contract; a gateway
// test fails when the committed file no longer matches the sources.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const hre = require('hardhat');

const NAMES = ['EvidenceAnchor', 'EnvironmentalEvidenceRegistry', 'ClimateClaimRegistry'];
const OUTPUT = path.join(__dirname, '..', '..', 'gateway', 'chain-artifacts.json');

// Line endings differ between Windows and Linux checkouts; hash the normalized text.
const sourceSha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');

async function main() {
  await hre.run('compile');
  const contracts = {};
  for (const name of NAMES) {
    const artifact = await hre.artifacts.readArtifact(name);
    contracts[name] = {
      sourceSha256: sourceSha256(path.join(__dirname, '..', 'contracts', `${name}.sol`)),
      abi: artifact.abi,
      bytecode: artifact.bytecode,
    };
  }
  const payload = { schemaVersion: 1, solc: require('solc/package.json').version, optimizer: { enabled: true, runs: 200 }, contracts };
  fs.writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${OUTPUT} (${NAMES.length} contracts, solc ${payload.solc}).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
