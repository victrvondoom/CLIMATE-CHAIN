import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, JsonRpcProvider, id, isAddress } from 'ethers';
import { hashEvidence } from './cascade.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DEFAULT_DEPLOYMENT = resolve(ROOT, 'blockchain/deployments/localhost.json');
const DEFAULT_RPC_URL = 'http://127.0.0.1:18545';
const EXPECTED_CHAIN_ID = 31337;
const EVIDENCE_TYPE = 'climate-chain:cascade-review:v1';
const NETWORK = 'Hardhat local development chain';

export class EvidenceAnchorError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'EvidenceAnchorError';
    this.code = code;
    this.status = status;
  }
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isLoopbackUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function validateCascadeManifest(manifest) {
  if (!isObject(manifest) || manifest.schemaVersion !== 1 || typeof manifest.id !== 'string'
    || !manifest.id.startsWith('cascade:') || !isObject(manifest.evidence) || !isObject(manifest.integrity)) {
    throw new EvidenceAnchorError('invalid_manifest', 'Only a version 1 Cascade Review manifest can be anchored.');
  }
  const digest = manifest.integrity.digest;
  if (manifest.integrity.algorithm !== 'SHA-256' || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) {
    throw new EvidenceAnchorError('invalid_manifest_digest', 'The manifest must contain a lowercase SHA-256 digest.');
  }
  const payload = Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'integrity'));
  const calculated = hashEvidence(payload);
  if (calculated !== digest) {
    throw new EvidenceAnchorError('manifest_digest_mismatch', 'The manifest contents do not match their SHA-256 digest. Refresh or export the unchanged manifest and retry.', 422);
  }
  return {
    digest: `0x${digest}`,
    manifestIdHash: id(manifest.id),
    evidenceTypeHash: id(EVIDENCE_TYPE),
    evidenceType: EVIDENCE_TYPE,
  };
}

function normalizeLimit(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : 25;
}

export function isValidEvidenceDigest(value) {
  return typeof value === 'string' && /^(?:0x)?[a-fA-F0-9]{64}$/.test(value);
}

export function createEvidenceAnchorService({
  rpcUrl = process.env.CLIMATE_CHAIN_RPC_URL || DEFAULT_RPC_URL,
  deploymentPath = process.env.CLIMATE_CHAIN_DEPLOYMENT || DEFAULT_DEPLOYMENT,
  providerFactory = (url) => new JsonRpcProvider(url),
  // An in-process chain runtime (chain-runtime.mjs). Without it the service uses the JSON-RPC node at rpcUrl.
  chain = null,
} = {}) {
  const localRpc = chain ? true : isLoopbackUrl(rpcUrl);
  const network = chain?.label ?? NETWORK;
  const shownRpcUrl = chain?.rpcUrl ?? rpcUrl;

  async function readDeployment() {
    let deployment;
    try {
      deployment = chain ? (await chain.deployments()).evidenceAnchor : JSON.parse(await readFile(deploymentPath, 'utf8'));
    } catch (error) {
      if (chain) throw new EvidenceAnchorError(error.code || 'chain_unavailable', error.message || 'The in-process chain could not start.', error.status || 503);
      if (error?.code === 'ENOENT') throw new EvidenceAnchorError('chain_not_deployed', 'The local evidence contract has not been deployed. Start the full Climate Chain launcher.', 503);
      throw new EvidenceAnchorError('deployment_unavailable', 'The local evidence contract deployment file could not be read.', 503);
    }
    if (deployment.chainId !== EXPECTED_CHAIN_ID || !isAddress(deployment.address) || !Array.isArray(deployment.abi) || deployment.abi.length === 0) {
      throw new EvidenceAnchorError('invalid_deployment', 'The local evidence contract deployment is invalid or uses an unsupported chain.', 503);
    }
    return deployment;
  }

  async function connect() {
    if (!localRpc) throw new EvidenceAnchorError('local_chain_required', 'Evidence anchoring is restricted to the local development chain.', 503);
    if (chain) await chain.refresh().catch((error) => { throw new EvidenceAnchorError(error.code || 'chain_unavailable', error.message || 'The in-process chain could not sync.', error.status || 503); });
    const deployment = await readDeployment();
    const provider = chain ? chain.provider : providerFactory(rpcUrl);
    try {
      const network = await provider.getNetwork();
      if (Number(network.chainId) !== EXPECTED_CHAIN_ID) {
        throw new EvidenceAnchorError('chain_id_mismatch', `Expected local chain ${EXPECTED_CHAIN_ID}; RPC returned ${network.chainId}.`, 503);
      }
      const contract = new Contract(deployment.address, deployment.abi, provider);
      return { deployment, provider, contract };
    } catch (error) {
      if (error instanceof EvidenceAnchorError) throw error;
      throw new EvidenceAnchorError('chain_unavailable', 'The local development chain is not reachable. Restart it with the full Climate Chain launcher.', 503);
    }
  }

  async function readProof(context, digest) {
    const record = await context.contract.anchors(digest);
    if (!record.exists) return { digest, anchored: false, proofVerified: false };

    const events = await context.contract.queryFilter(
      context.contract.filters.EvidenceAnchored(digest),
      context.deployment.deployBlock,
      'latest',
    );
    const event = events.at(-1);
    const receipt = event ? await context.provider.getTransactionReceipt(event.transactionHash) : null;
    const block = receipt ? await context.provider.getBlock(receipt.blockNumber) : null;
    const eventMatches = Boolean(event && receipt?.status === 1
      && event.args.manifestIdHash === record.manifestIdHash
      && event.args.evidenceTypeHash === record.evidenceTypeHash
      && event.args.anchorer === record.anchorer
      && BigInt(event.args.blockNumber) === BigInt(record.blockNumber));
    return {
      digest,
      anchored: true,
      proofVerified: eventMatches,
      evidenceType: EVIDENCE_TYPE,
      manifestIdHash: record.manifestIdHash,
      evidenceTypeHash: record.evidenceTypeHash,
      anchorer: record.anchorer,
      blockNumber: Number(record.blockNumber),
      anchoredAt: new Date(Number(record.anchoredAt) * 1000).toISOString(),
      blockHash: block?.hash ?? null,
      transactionHash: event?.transactionHash ?? null,
      transactionStatus: receipt?.status === 1 ? 'success' : receipt ? 'failed' : 'missing',
    };
  }

  async function status() {
    const base = {
      network,
      localOnly: !chain,
      chainMode: chain ? 'in-process' : 'external-rpc',
      chainId: EXPECTED_CHAIN_ID,
      rpcUrl: shownRpcUrl,
      contractAddress: null,
      deployBlock: null,
      anchorCount: null,
      latestBlock: null,
      available: false,
    };
    if (!localRpc) return { ...base, state: 'unsupported_rpc' };
    try {
      const context = await connect();
      const [count, latestBlock] = await Promise.all([
        context.contract.anchorCount(),
        context.provider.getBlockNumber(),
      ]);
      return {
        ...base,
        state: 'connected',
        available: true,
        contractAddress: context.deployment.address,
        deployBlock: context.deployment.deployBlock,
        anchorCount: Number(count),
        latestBlock,
      };
    } catch (error) {
      return { ...base, state: error.code || 'chain_unavailable', message: error.message };
    }
  }

  async function verify(value) {
    if (!isValidEvidenceDigest(value)) throw new EvidenceAnchorError('invalid_digest', 'Digest must be 64 hexadecimal SHA-256 characters.');
    const digest = `0x${value.replace(/^0x/i, '').toLowerCase()}`;
    const context = await connect();
    return {
      ...await readProof(context, digest),
      network,
      chainId: EXPECTED_CHAIN_ID,
      contractAddress: context.deployment.address,
    };
  }

  async function anchorOnce(proofInput) {
    const context = await connect();
    const existing = await readProof(context, proofInput.digest);
    if (existing.anchored) return { ...existing, alreadyAnchored: true, chainId: EXPECTED_CHAIN_ID, contractAddress: context.deployment.address };

    try {
      const signer = chain ? chain.signer('attester') : await context.provider.getSigner(context.deployment.deployer);
      const writer = new Contract(context.deployment.address, context.deployment.abi, signer);
      const tx = await writer.anchor(proofInput.digest, proofInput.manifestIdHash, proofInput.evidenceTypeHash);
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) throw new Error('The chain did not confirm the evidence transaction.');
      return {
        ...await readProof(context, proofInput.digest),
        alreadyAnchored: false,
        chainId: EXPECTED_CHAIN_ID,
        contractAddress: context.deployment.address,
      };
    } catch (error) {
      if (error instanceof EvidenceAnchorError) throw error;
      throw new EvidenceAnchorError('anchor_transaction_failed', `The evidence transaction failed: ${error.shortMessage || error.message || 'unknown chain error'}`, 502);
    }
  }

  // On an in-process chain a write runs serialized against the shared ledger; see chain-runtime.mjs.
  async function anchor(manifest) {
    const proofInput = validateCascadeManifest(manifest);
    if (!chain) return anchorOnce(proofInput);
    try { return await chain.write(() => anchorOnce(proofInput)); }
    catch (error) {
      if (error instanceof EvidenceAnchorError) throw error;
      throw new EvidenceAnchorError(error.code || 'anchor_transaction_failed', error.message || 'The evidence transaction failed.', error.status || 502);
    }
  }

  async function list(value) {
    const context = await connect();
    const limit = normalizeLimit(value);
    const events = await context.contract.queryFilter(
      context.contract.filters.EvidenceAnchored(),
      context.deployment.deployBlock,
      'latest',
    );
    const recent = events.slice(-limit).reverse();
    const anchors = await Promise.all(recent.map((event) => readProof(context, event.args.digest)));
    return {
      network,
      chainId: EXPECTED_CHAIN_ID,
      contractAddress: context.deployment.address,
      anchors,
    };
  }

  return Object.freeze({ status, verify, anchor, list });
}
