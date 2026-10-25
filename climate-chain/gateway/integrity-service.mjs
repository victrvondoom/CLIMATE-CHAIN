// Climate Integrity Lab service: builds evidence from a source, keeps it off-chain,
// anchors its digest on the local EVM chain, and runs the claim, challenge and
// correction flows against the two registries.
//
// Every chain value returned here is read back from the node over JSON-RPC: transaction
// hashes, receipts, block numbers, events and revert reasons. When the chain is not
// reachable the service reports OFFLINE / NOT ANCHORED. It never invents a receipt.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, JsonRpcProvider, ZeroHash, id as keccakText, isAddress } from 'ethers';
import {
  ANALYTES, CLAIM_ID, EVIDENCE_ID, IntegrityError, buildChallenge, buildClaim, buildEvidenceBundle,
  claimScope, digestOf, metadataHashOf, recommendNextSteps, sha256Hex, tamperCopy, verifyBundle,
} from './integrity-evidence.mjs';
import { AIR_ANALYTES, SITES, createAirQualitySource } from './integrity-sources.mjs';
import { evaluateClaimThroughFirewall, VERDICTS } from './trust-firewall.mjs';
import { animalIdsOf, evidenceFingerprints, isModelLike } from './claim-sufficiency.mjs';
import { createPlausibilityProvider } from './plausibility.mjs';
import { runAdversarialV2, runBenchmark } from './benchmark-runner.mjs';
import { StorageError, createFileStorage } from './storage.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DEFAULT_DEPLOYMENT = resolve(ROOT, 'blockchain/deployments/integrity-localhost.json');
const DEFAULT_DATA_DIR = resolve(ROOT, 'gateway/.integrity-data');
const DEFAULT_RPC_URL = 'http://127.0.0.1:18545';
const EXPECTED_CHAIN_ID = 31337;
const NETWORK = 'Hardhat local development chain';
// A fixed gas limit lets a known-bad call be mined, so the rejection has a real receipt.
const REJECTION_GAS_LIMIT = 600_000n;
const MAX_TIMELINE = 300;
// The firewall checks a new claim against every claim in the registry. Beyond this many it refuses to guess.
const REGISTRY_SCAN_LIMIT = 200;
const REGISTRY_READ_CONCURRENCY = 8;
export const CLAIM_STATUS = ['None', 'Submitted', 'Challenged', 'Rejected', 'Superseded'];
const ROLES = ['attester', 'claimant', 'reviewer', 'challenger'];

export class IntegrityServiceError extends Error {
  constructor(code, message, status = 400, extra = {}) {
    super(message);
    this.name = 'IntegrityServiceError';
    this.code = code;
    this.status = status;
    Object.assign(this, extra);
  }
}

const fail = (code, message, status, extra) => new IntegrityServiceError(code, message, status, extra);
const hex32 = (digest) => `0x${digest}`;
export const evidenceKeyOf = (evidenceId) => keccakText(evidenceId);
export const claimKeyOf = (claimId) => keccakText(claimId);
const iso = (seconds) => new Date(Number(seconds) * 1000).toISOString();

function isLoopbackUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

function requireEvidenceId(value) {
  if (typeof value !== 'string' || !EVIDENCE_ID.test(value)) throw fail('invalid_evidence_id', 'Evidence ids look like ev- followed by 24 hexadecimal characters.', 400);
  return value;
}

function requireClaimId(value) {
  if (typeof value !== 'string' || !CLAIM_ID.test(value)) throw fail('invalid_claim_id', 'Claim ids look like cl- followed by 24 hexadecimal characters.', 400);
  return value;
}

function requireNote(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < 10 || text.length > 600) throw fail('invalid_note', 'Describe the correction in 10 to 600 characters.', 400);
  return text;
}

// Pulls a decoded custom error out of an ethers error, if the revert data is present.
function decodeRevert(error, contract) {
  if (error?.revert?.name) return { name: error.revert.name, args: Array.from(error.revert.args ?? [], String) };
  const candidates = [error?.data, error?.info?.error?.data, error?.error?.data, error?.info?.error?.data?.data];
  for (const data of candidates) {
    if (typeof data !== 'string' || !data.startsWith('0x') || data.length < 10) continue;
    try {
      const parsed = contract.interface.parseError(data);
      if (parsed) return { name: parsed.name, args: Array.from(parsed.args, String) };
    } catch { /* not this contract's error */ }
  }
  return null;
}

function findTxHash(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 5) return null;
  for (const key of ['txHash', 'transactionHash', 'hash']) {
    if (typeof value[key] === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value[key])) return value[key];
  }
  for (const child of Object.values(value)) {
    const found = findTxHash(child, depth + 1);
    if (found) return found;
  }
  return null;
}

// Evidence bundles, claim documents and the session live behind the storage interface, so the same service
// runs on local files or on a store shared by every serverless instance.
function createStore(storage) {
  const path = {
    evidence: (id) => `evidence/${id}.json`,
    raw: (sha) => `raw/${sha}.txt`,
    claim: (id) => `claims/${id}.json`,
    challenge: (hash) => `challenges/${hash}.json`,
    session: (key) => `sessions/${key}.json`,
  };
  const keys = new Map();
  let indexedAt = 0;

  // A storage failure is reported as a visible 503, never as "not found".
  async function guarded(task) {
    try { return await task(); }
    catch (error) {
      if (error instanceof StorageError) throw fail(error.code, error.message, error.status);
      throw error;
    }
  }
  const write = (target, text) => guarded(() => storage.put(target, text));
  const readText = (target) => guarded(() => storage.get(target));
  async function readJson(target) {
    const text = await readText(target);
    if (text === null) return null;
    try { return JSON.parse(text); } catch { throw fail('store_corrupt', 'A stored evidence file is not valid JSON.', 500); }
  }
  // Another instance may have stored records this one has not seen, so a miss re-reads the listing
  // (at most once every few seconds).
  async function buildIndex() {
    if (Date.now() - indexedAt < 3000) return;
    indexedAt = Date.now();
    for (const [folder, toKey] of [['evidence', evidenceKeyOf], ['claims', claimKeyOf]]) {
      const names = await guarded(() => storage.list(`${folder}/`)).catch(() => []);
      for (const name of names) {
        const file = name.slice(folder.length + 1);
        if (file.endsWith('.json')) keys.set(toKey(file.slice(0, -5)), file.slice(0, -5));
      }
    }
  }

  return {
    async saveEvidence(entry) { keys.set(evidenceKeyOf(entry.evidenceId), entry.evidenceId); await write(path.evidence(entry.evidenceId), JSON.stringify(entry, null, 2)); },
    readEvidence: (id) => readJson(path.evidence(id)),
    async saveRaw(sha, text) { if (sha256Hex(text) !== sha) throw fail('raw_digest_mismatch', 'Raw payload does not match its digest.', 500); if (await readText(path.raw(sha)) === null) await write(path.raw(sha), text); },
    readRaw: (sha) => readText(path.raw(sha)),
    async saveClaim(entry) { keys.set(claimKeyOf(entry.claim.claimId), entry.claim.claimId); await write(path.claim(entry.claim.claimId), JSON.stringify(entry, null, 2)); },
    readClaim: (id) => readJson(path.claim(id)),
    // Every stored claim document, for duplicate/overlap checks across the registry. Reads run a few at a time. When
    // there are more claims than `limit` the result says so, because a partial view must never be treated as complete.
    async listClaims(limit = REGISTRY_SCAN_LIMIT) {
      const all = (await guarded(() => storage.list('claims/'))).filter((n) => n.endsWith('.json'));
      const names = all.slice(0, limit);
      const entries = [];
      for (let i = 0; i < names.length; i += REGISTRY_READ_CONCURRENCY) {
        const chunk = await Promise.all(names.slice(i, i + REGISTRY_READ_CONCURRENCY).map((name) => readJson(name)));
        for (const entry of chunk) if (entry?.claim) entries.push(entry);
      }
      return { entries, truncated: all.length > limit };
    },
    saveChallenge: (entry) => write(path.challenge(entry.reasonHash), JSON.stringify(entry, null, 2)),
    readSession: (key) => readJson(path.session(key)),
    saveSession: (session) => write(path.session(session.sessionKey), JSON.stringify(session, null, 2)),
    // The demo-run number is its own append-only record (one create-if-absent file per run), so a stale
    // timeline write from another request or instance can never move it backwards.
    async runs(sessionKey) {
      const names = await guarded(() => storage.list(`sessions/${sessionKey}-run-`));
      return names.map((name) => Number(/-run-(\d{6})\.json$/.exec(name)?.[1] ?? 0)).filter((n) => n > 0);
    },
    createRun: (sessionKey, run) => guarded(() => storage.putIfAbsent(`sessions/${sessionKey}-run-${String(run).padStart(6, '0')}.json`, JSON.stringify({ run }))),
    async idForKey(key) {
      if (!key || key === ZeroHash) return null;
      if (!keys.has(key)) await buildIndex();
      return keys.get(key) ?? null;
    },
  };
}

export function createIntegrityService({
  rpcUrl = process.env.CLIMATE_CHAIN_RPC_URL || DEFAULT_RPC_URL,
  deploymentPath = process.env.CLIMATE_CHAIN_INTEGRITY_DEPLOYMENT || DEFAULT_DEPLOYMENT,
  dataDir = process.env.CLIMATE_CHAIN_INTEGRITY_DATA || DEFAULT_DATA_DIR,
  providerFactory = (url) => new JsonRpcProvider(url, EXPECTED_CHAIN_ID, { staticNetwork: true, pollingInterval: 250 }),
  source = createAirQualitySource(),
  now = () => new Date().toISOString(),
  openAqConfigured = Boolean(process.env.OPENAQ_API_KEY),
  // `chain` is an in-process chain runtime (chain-runtime.mjs). Without it the service talks to the JSON-RPC
  // node at rpcUrl, exactly as before. `storage` overrides where evidence and claim documents are kept.
  chain = null,
  storage = null,
  // Opt-in gate: when true, submitClaim runs the Trust Firewall first and refuses (409) anything not ACCEPTED.
  // Off by default so existing demo flows are unchanged; the firewall verdict is then advisory.
  enforceFirewall = process.env.CLIMATE_CHAIN_FIREWALL_ENFORCE === '1',
  plausibility = createPlausibilityProvider(),
} = {}) {
  const store = createStore(storage ?? chain?.storage ?? createFileStorage(dataDir));
  const localRpc = chain ? true : isLoopbackUrl(rpcUrl);
  const network = chain?.label ?? NETWORK;
  const shownRpcUrl = chain?.rpcUrl ?? rpcUrl;
  let provider = null;
  let queue = Promise.resolve();
  // Chain writes run one at a time so dev-account nonces never race. An in-process chain also serializes
  // against the shared journal and retries when another instance mined first.
  const exclusive = chain
    ? (task) => chain.write(task)
    : (task) => {
      const run = queue.then(task, task);
      queue = run.catch(() => {});
      return run;
    };

  async function readDeployment() {
    let deployment;
    if (chain) {
      try { deployment = (await chain.deployments()).integrity; }
      catch (error) { throw fail(error.code || 'chain_unavailable', error.message || 'The in-process chain could not start.', error.status || 503); }
    } else try {
      deployment = JSON.parse(await readFile(deploymentPath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') throw fail('chain_not_deployed', 'The integrity registries are not deployed. Run start.ps1, or `npm run deploy:local` in blockchain/ with the local node running.', 503);
      throw fail('deployment_unavailable', 'The integrity deployment file could not be read.', 503);
    }
    const valid = deployment?.chainId === EXPECTED_CHAIN_ID
      && typeof deployment.genesisHash === 'string'
      && ROLES.every((role) => isAddress(deployment.accounts?.[role]))
      && ['evidenceRegistry', 'claimRegistry'].every((name) => isAddress(deployment[name]?.address) && Array.isArray(deployment[name]?.abi) && Number.isInteger(deployment[name]?.deployBlock));
    if (!valid) throw fail('invalid_deployment', 'The integrity deployment file is invalid or names an unsupported chain.', 503);
    return deployment;
  }

  async function connect() {
    if (!localRpc) throw fail('local_chain_required', 'The integrity lab only writes to the local development chain.', 503);
    if (chain) await chain.refresh().catch((error) => { throw fail(error.code || 'chain_unavailable', error.message || 'The in-process chain could not sync.', error.status || 503); });
    const deployment = await readDeployment();
    provider ??= chain ? chain.provider : providerFactory(rpcUrl);
    let chainId;
    let genesis;
    try {
      chainId = Number(await provider.send('eth_chainId', []));
      genesis = await provider.getBlock(0);
    } catch {
      throw fail('chain_unavailable', `The local chain is not reachable at ${rpcUrl}. Start it with start.ps1 or \`npm run node\` in blockchain/.`, 503);
    }
    if (chainId !== EXPECTED_CHAIN_ID) throw fail('chain_id_mismatch', `Expected chain ${EXPECTED_CHAIN_ID}; the RPC reported ${chainId}.`, 503);
    if (genesis?.hash !== deployment.genesisHash) {
      throw fail('deployment_stale', 'The local chain was restarted after these contracts were deployed. Run `npm run deploy:local` in blockchain/ (start.ps1 does this).', 503);
    }
    const [evidenceCode, claimCode] = await Promise.all([
      provider.getCode(deployment.evidenceRegistry.address),
      provider.getCode(deployment.claimRegistry.address),
    ]);
    if (evidenceCode === '0x' || claimCode === '0x') throw fail('contract_missing', 'No contract code at the deployed addresses. Redeploy with `npm run deploy:local`.', 503);
    return {
      deployment,
      provider,
      evidence: new Contract(deployment.evidenceRegistry.address, deployment.evidenceRegistry.abi, provider),
      claims: new Contract(deployment.claimRegistry.address, deployment.claimRegistry.abi, provider),
      sessionKey: `${EXPECTED_CHAIN_ID}-${genesis.hash.slice(2, 14)}-${deployment.evidenceRegistry.address.slice(2, 10).toLowerCase()}`,
      signer: (role) => (chain ? chain.signer(role) : provider.getSigner(deployment.accounts[role])),
    };
  }

  // ethers caches getBlockNumber between polls, which can trail a receipt just awaited.
  // Ask the node directly so confirmation counts are never understated.
  const latestBlock = async (ctx) => Number(await ctx.provider.send('eth_blockNumber', []));

  // The current demo run. A store on a chain that already holds claims starts numbering after them, so the
  // first claim scope cannot collide with a run recorded earlier. Runs are create-if-absent records, so
  // every instance agrees on the number.
  async function currentRun(ctx) {
    let runs = await store.runs(ctx.sessionKey);
    if (!runs.length) {
      await store.createRun(ctx.sessionKey, Number(await ctx.claims.claimCount()) + 1);
      runs = await store.runs(ctx.sessionKey);
    }
    return Math.max(...runs);
  }

  async function loadSession(ctx) {
    const [existing, demoRun] = await Promise.all([store.readSession(ctx.sessionKey), currentRun(ctx)]);
    return { sessionKey: ctx.sessionKey, createdAt: existing?.createdAt ?? now(), demoRun, timeline: existing?.timeline ?? [] };
  }

  // The timeline is display history only; it never carries the run number.
  async function note(ctx, entry) {
    const existing = (await store.readSession(ctx.sessionKey)) ?? { sessionKey: ctx.sessionKey, createdAt: now(), timeline: [] };
    await store.saveSession({ sessionKey: existing.sessionKey, createdAt: existing.createdAt, timeline: [...(existing.timeline ?? []), { at: now(), ...entry }].slice(-MAX_TIMELINE) });
  }

  async function send(ctx, contract, role, method, args) {
    const writer = contract.connect(await ctx.signer(role));
    let tx;
    try {
      tx = await writer[method](...args);
    } catch (error) {
      const revert = decodeRevert(error, contract);
      if (revert) throw fail('contract_rejected', `The contract rejected ${method}: ${revert.name}.`, 409, { errorName: revert.name, errorArgs: revert.args });
      throw fail('transaction_failed', `${method} could not be sent: ${error?.shortMessage || error?.message || 'unknown chain error'}`, 502);
    }
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) throw fail('transaction_failed', `${method} was not confirmed by the chain.`, 502);
    return receipt;
  }

  // Shows a rejection the honest way: eth_call reads the revert reason first, and only a
  // call the contract would refuse is then sent, with a fixed gas limit so it is mined.
  async function attemptRejected(ctx, contract, role, method, args) {
    const signer = await ctx.signer(role);
    const from = await signer.getAddress();
    const to = await contract.getAddress();
    const data = contract.interface.encodeFunctionData(method, args);
    let simulated = null;
    try {
      await ctx.provider.call({ from, to, data });
    } catch (error) {
      simulated = decodeRevert(error, contract);
      if (!simulated) throw fail('rejection_unreadable', 'The call failed, but its revert reason could not be decoded.', 502);
    }
    if (!simulated) throw fail('rejection_not_observed', 'The chain would accept this call, so it was not sent.', 409);

    let transactionHash = null;
    let submissionError = null;
    try {
      transactionHash = (await signer.sendTransaction({ to, data, gasLimit: REJECTION_GAS_LIMIT })).hash;
    } catch (error) {
      // A ledger conflict is not a rejection by the contract: stop here instead of waiting on a receipt that never comes.
      const lost = chain?.consumeInfrastructureFailure?.();
      if (lost) throw lost;
      transactionHash = findTxHash(error);
      submissionError = error?.shortMessage || error?.message || null;
    }
    const receipt = transactionHash ? await ctx.provider.waitForTransaction(transactionHash, 1, 10_000).catch(() => null) : null;
    return {
      rejected: true,
      errorName: simulated.name,
      errorArgs: simulated.args,
      method,
      from,
      contractAddress: to,
      transactionHash,
      mined: Boolean(receipt),
      receiptStatus: receipt ? receipt.status : null,
      blockNumber: receipt?.blockNumber ?? null,
      gasUsed: receipt ? receipt.gasUsed.toString() : null,
      submissionError,
      note: receipt ? 'Mined with status 0: the contract reverted and no state changed.' : 'The node refused the transaction before mining; the revert reason was read with eth_call.',
    };
  }

  async function evidenceProof(ctx, evidenceId) {
    const key = evidenceKeyOf(evidenceId);
    const record = await ctx.evidence.getEvidence(key);
    const base = { evidenceId, evidenceKey: key, chainId: EXPECTED_CHAIN_ID, network, contractAddress: ctx.deployment.evidenceRegistry.address };
    if (record.digest === ZeroHash) return { ...base, anchored: false };
    const events = await ctx.evidence.queryFilter(ctx.evidence.filters.EvidenceAnchored(key), ctx.deployment.evidenceRegistry.deployBlock, 'latest');
    const event = events.at(-1);
    const receipt = event ? await ctx.provider.getTransactionReceipt(event.transactionHash) : null;
    const latest = await latestBlock(ctx);
    const supersededByKey = record.supersededBy === ZeroHash ? null : record.supersededBy;
    const parentKey = record.parentEvidenceId === ZeroHash ? null : record.parentEvidenceId;
    return {
      ...base,
      anchored: true,
      onChainDigest: record.digest,
      metadataHash: record.metadataHash,
      parentEvidenceKey: parentKey,
      parentEvidenceId: await store.idForKey(parentKey),
      supersededByKey,
      supersededByEvidenceId: await store.idForKey(supersededByKey),
      current: supersededByKey === null,
      attester: record.attester,
      blockNumber: Number(record.blockNumber),
      anchoredAt: iso(record.anchoredAt),
      transactionHash: event?.transactionHash ?? null,
      blockHash: receipt?.blockHash ?? null,
      receiptStatus: receipt?.status ?? null,
      confirmations: receipt ? latest - receipt.blockNumber + 1 : null,
      gasUsed: receipt ? receipt.gasUsed.toString() : null,
      eventMatchesRecord: Boolean(event && event.args.digest === record.digest && event.args.attester === record.attester
        && BigInt(event.args.blockNumber) === BigInt(record.blockNumber)),
    };
  }

  async function claimProof(ctx, claimId) {
    const key = claimKeyOf(claimId);
    const record = await ctx.claims.getClaim(key);
    const status = CLAIM_STATUS[Number(record.status)] ?? 'Unknown';
    const base = { claimId, claimKey: key, chainId: EXPECTED_CHAIN_ID, network, contractAddress: ctx.deployment.claimRegistry.address };
    if (status === 'None') return { ...base, recorded: false, status };
    const events = await ctx.claims.queryFilter(ctx.claims.filters.ClaimSubmitted(key), ctx.deployment.claimRegistry.deployBlock, 'latest');
    const event = events.at(-1);
    const receipt = event ? await ctx.provider.getTransactionReceipt(event.transactionHash) : null;
    return {
      ...base,
      recorded: true,
      status,
      exclusivityKey: record.exclusivityKey,
      activeForScope: (await ctx.claims.activeClaimForKey(record.exclusivityKey)) === key,
      evidenceKey: record.evidenceId,
      evidenceId: await store.idForKey(record.evidenceId),
      claimHash: record.claimHash,
      supersedesClaimId: await store.idForKey(record.supersedes),
      supersededByClaimId: await store.idForKey(record.supersededBy),
      challengeReasonHash: record.challengeReasonHash === ZeroHash ? null : record.challengeReasonHash,
      claimant: record.claimant,
      challenger: record.challenger === '0x0000000000000000000000000000000000000000' ? null : record.challenger,
      submittedBlock: Number(record.submittedBlock),
      transactionHash: event?.transactionHash ?? null,
      receiptStatus: receipt?.status ?? null,
    };
  }

  async function mustEvidence(evidenceId) {
    const entry = await store.readEvidence(requireEvidenceId(evidenceId));
    if (!entry) throw fail('evidence_not_found', `No evidence bundle ${evidenceId} is stored on this gateway.`, 404);
    return entry;
  }

  async function mustClaim(claimId) {
    const entry = await store.readClaim(requireClaimId(claimId));
    if (!entry) throw fail('claim_not_found', `No claim document ${claimId} is stored on this gateway.`, 404);
    return entry;
  }

  async function chainOrProblem(task) {
    try {
      return { value: await task(await connect()), problem: null };
    } catch (error) {
      if (error instanceof IntegrityServiceError && error.status === 503) return { value: null, problem: { code: error.code, message: error.message } };
      throw error;
    }
  }

  function sourceStatus() {
    return {
      openMeteo: { status: 'NO_KEY_REQUIRED', dataKind: 'MODEL_FORECAST', note: 'Live fetch with a labelled cached historical example if the network fails.' },
      openAq: openAqConfigured
        ? { status: 'KEY_CONFIGURED_NOT_USED', note: 'OPENAQ_API_KEY is set, but no OpenAQ adapter ships in this build; no comparison is made.' }
        : { status: 'NOT_CONFIGURED', note: 'OpenAQ requires a free API key (OPENAQ_API_KEY). No observed station comparison is made.' },
    };
  }

  async function status() {
    const base = { ledgerMode: 'OFFLINE', network, chainId: EXPECTED_CHAIN_ID, rpcUrl: shownRpcUrl, localOnly: !chain, chainMode: chain ? 'in-process' : 'external-rpc', sources: sourceStatus() };
    try {
      const ctx = await connect();
      const [blockNumber, evidenceCount, claimCount, session] = await Promise.all([
        latestBlock(ctx), ctx.evidence.evidenceCount(), ctx.claims.claimCount(), loadSession(ctx),
      ]);
      return {
        ...base,
        ledgerMode: 'LOCAL_EVM',
        latestBlock: blockNumber,
        genesisHash: ctx.deployment.genesisHash,
        deployedAt: ctx.deployment.deployedAt ?? null,
        contracts: {
          evidenceRegistry: { name: 'EnvironmentalEvidenceRegistry', address: ctx.deployment.evidenceRegistry.address, deployBlock: ctx.deployment.evidenceRegistry.deployBlock, deployTxHash: ctx.deployment.evidenceRegistry.deployTxHash ?? null },
          claimRegistry: { name: 'ClimateClaimRegistry', address: ctx.deployment.claimRegistry.address, deployBlock: ctx.deployment.claimRegistry.deployBlock, deployTxHash: ctx.deployment.claimRegistry.deployTxHash ?? null },
        },
        accounts: ctx.deployment.accounts,
        accountsNote: chain
          ? 'Role accounts derived from a secret seed, so their keys are not public. All are internal test actors; none is an independent verifier.'
          : 'Public Hardhat development accounts. All are internal test actors; none is an independent verifier.',
        ...(chain ? { ledger: chain.describe() } : {}),
        evidenceCount: Number(evidenceCount),
        claimCount: Number(claimCount),
        sessionKey: ctx.sessionKey,
        demoRun: session.demoRun,
      };
    } catch (error) {
      if (!(error instanceof IntegrityServiceError)) throw error;
      return { ...base, anchored: false, problem: { code: error.code, message: error.message } };
    }
  }

  function sites() {
    return { sites: SITES, analytes: AIR_ANALYTES.map((id) => ANALYTES[id]) };
  }

  async function buildEvidence({ siteId, analyte = 'pm2_5', mode = 'live-or-cached', parentEvidenceId = null, revisionNote = null } = {}) {
    if (!AIR_ANALYTES.includes(analyte)) throw fail('unknown_analyte', `analyte must be one of ${AIR_ANALYTES.join(', ')}.`, 400);
    if (parentEvidenceId !== null) await mustEvidence(parentEvidenceId);
    const loaded = await source.load(siteId, { mode });
    const built = buildEvidenceBundle({ site: loaded.site, analyte, source: loaded, parentEvidenceId, revisionNote });
    await store.saveRaw(loaded.sourceRecord.rawPayloadSha256, loaded.rawText);
    await store.saveEvidence({ evidenceId: built.bundle.evidenceId, digest: built.digest, metadataHash: built.metadataHash, createdAt: now(), bundle: built.bundle });
    const { value: proof, problem } = await chainOrProblem(async (ctx) => {
      await note(ctx, { kind: 'evidence-built', evidenceId: built.bundle.evidenceId, digest: built.digest, retrievalMode: loaded.sourceRecord.retrievalMode });
      return evidenceProof(ctx, built.bundle.evidenceId);
    });
    return {
      evidenceId: built.bundle.evidenceId,
      digest: built.digest,
      metadataHash: built.metadataHash,
      bundle: built.bundle,
      proof,
      ledgerMode: problem ? 'OFFLINE' : 'LOCAL_EVM',
      chainProblem: problem,
      recommendations: recommendNextSteps(built.bundle),
    };
  }

  async function getEvidence(evidenceId) {
    const entry = await mustEvidence(evidenceId);
    const { value: proof, problem } = await chainOrProblem((ctx) => evidenceProof(ctx, evidenceId));
    return { ...entry, proof, ledgerMode: problem ? 'OFFLINE' : 'LOCAL_EVM', chainProblem: problem, recommendations: recommendNextSteps(entry.bundle) };
  }

  const anchor = (evidenceId) => exclusive(async () => {
    const entry = await mustEvidence(evidenceId);
    if (!verifyBundle(entry.bundle, entry.digest).matches) {
      throw fail('store_digest_mismatch', 'The stored bundle no longer matches its digest; it changed on disk and will not be anchored.', 409);
    }
    const ctx = await connect();
    const existing = await evidenceProof(ctx, evidenceId);
    if (existing.anchored) return { ...existing, alreadyAnchored: true };
    const parentKey = entry.bundle.parentEvidenceId ? evidenceKeyOf(entry.bundle.parentEvidenceId) : ZeroHash;
    const receipt = await send(ctx, ctx.evidence, 'attester', 'anchorEvidence', [evidenceKeyOf(evidenceId), hex32(entry.digest), parentKey, hex32(entry.metadataHash)]);
    await note(ctx, { kind: 'evidence-anchored', evidenceId, transactionHash: receipt.hash, blockNumber: receipt.blockNumber });
    return { ...await evidenceProof(ctx, evidenceId), alreadyAnchored: false };
  });

  async function verify(evidenceId) {
    const entry = await mustEvidence(evidenceId);
    const recomputed = verifyBundle(entry.bundle, entry.digest);
    const recomputedMetadata = metadataHashOf(entry.bundle);
    const rawSha = entry.bundle.sources[0].rawPayloadSha256;
    const raw = await store.readRaw(rawSha);
    const checks = [
      { id: 'bundle-digest', label: 'Stored bundle re-hashes to its recorded SHA-256', ok: recomputed.matches, detail: recomputed.recomputedDigest },
      { id: 'raw-payload', label: 'Stored provider response re-hashes to the raw digest inside the bundle', ok: raw !== null && sha256Hex(raw) === rawSha, detail: raw === null ? 'Raw response not stored on this gateway.' : rawSha },
    ];
    const { value: proof, problem } = await chainOrProblem(async (ctx) => {
      const found = await evidenceProof(ctx, evidenceId);
      const contractCall = found.anchored ? await ctx.evidence.verifyDigest(found.evidenceKey, hex32(recomputed.recomputedDigest)) : false;
      checks.push(
        { id: 'on-chain-record', label: 'Registry holds a record for this evidence id', ok: found.anchored, detail: found.evidenceKey },
        { id: 'on-chain-digest', label: 'On-chain digest equals the recomputed digest', ok: found.anchored && found.onChainDigest === hex32(recomputed.recomputedDigest), detail: found.onChainDigest ?? 'not anchored' },
        { id: 'on-chain-metadata', label: 'On-chain metadata hash equals the recomputed metadata hash', ok: found.anchored && found.metadataHash === hex32(recomputedMetadata), detail: found.metadataHash ?? 'not anchored' },
        { id: 'receipt', label: 'Anchoring transaction receipt has status 1 and its event matches the record', ok: found.receiptStatus === 1 && found.eventMatchesRecord, detail: found.transactionHash ?? 'no transaction' },
        { id: 'contract-call', label: 'Contract verifyDigest(evidenceId, recomputed digest) returns true', ok: contractCall === true, detail: String(contractCall) },
      );
      return found;
    });
    if (problem) checks.push({ id: 'chain', label: 'Local chain reachable', ok: false, detail: problem.message });
    return {
      evidenceId,
      verified: checks.every((check) => check.ok),
      ledgerMode: problem ? 'OFFLINE' : 'LOCAL_EVM',
      recomputedDigest: recomputed.recomputedDigest,
      checks,
      proof,
      chainProblem: problem,
      note: 'verified means these bytes match the anchored digest. It does not mean the modelled value is correct.',
    };
  }

  async function tamper(evidenceId) {
    const entry = await mustEvidence(evidenceId);
    const { tampered, change } = tamperCopy(entry.bundle);
    const tamperedDigest = digestOf(tampered);
    const { value: chain, problem } = await chainOrProblem(async (ctx) => {
      const found = await evidenceProof(ctx, evidenceId);
      if (!found.anchored) return { onChainDigest: null, contractAcceptsTampered: null, contractAcceptsOriginal: null };
      return {
        onChainDigest: found.onChainDigest,
        contractAcceptsTampered: await ctx.evidence.verifyDigest(found.evidenceKey, hex32(tamperedDigest)),
        contractAcceptsOriginal: await ctx.evidence.verifyDigest(found.evidenceKey, hex32(entry.digest)),
      };
    });
    const matchesOnChain = chain?.onChainDigest ? chain.onChainDigest === hex32(tamperedDigest) : null;
    return {
      evidenceId,
      controlledTest: true,
      label: 'CONTROLLED TEST DATA: a modified copy. The stored and anchored evidence is unchanged. No real-world fraud is alleged.',
      change,
      originalDigest: entry.digest,
      tamperedDigest,
      onChainDigest: chain?.onChainDigest ?? null,
      matchesOriginal: tamperedDigest === entry.digest,
      matchesOnChain,
      contractAcceptsTampered: chain?.contractAcceptsTampered ?? null,
      contractAcceptsOriginal: chain?.contractAcceptsOriginal ?? null,
      result: matchesOnChain === true ? 'PASS' : matchesOnChain === false ? 'FAIL' : 'NOT_ANCHORED',
      ledgerMode: problem ? 'OFFLINE' : 'LOCAL_EVM',
      chainProblem: problem,
      tamperedBundle: tampered,
    };
  }

  const replay = (evidenceId) => exclusive(async () => {
    const entry = await mustEvidence(evidenceId);
    const ctx = await connect();
    if (!(await evidenceProof(ctx, evidenceId)).anchored) throw fail('evidence_not_anchored', 'Anchor the evidence before replaying it.', 409);
    const parentKey = entry.bundle.parentEvidenceId ? evidenceKeyOf(entry.bundle.parentEvidenceId) : ZeroHash;
    const rejection = await attemptRejected(ctx, ctx.evidence, 'attester', 'anchorEvidence', [evidenceKeyOf(evidenceId), hex32(entry.digest), parentKey, hex32(entry.metadataHash)]);
    await note(ctx, { kind: 'replay-rejected', evidenceId, errorName: rejection.errorName, transactionHash: rejection.transactionHash, blockNumber: rejection.blockNumber });
    return { evidenceId, controlledTest: true, ...rejection };
  });

  // Claims already in this registry, shaped for the firewall's duplicate, overlap and animal-reuse checks. Claims from
  // other demo runs (scope.project) are separate records, and a correction supersedes the claim it replaces.
  // Facts the firewall needs about a stored claim's evidence. They are immutable once the claim exists, so new claims
  // carry them in their own document and older ones are read once and remembered.
  const factsOf = (bundle) => ({ location: bundle?.location ?? null, evidenceFingerprints: evidenceFingerprints(bundle), animalIds: animalIdsOf(bundle) });
  const registryFacts = new Map();
  async function factsFor(entry) {
    const c = entry.claim;
    if (entry.registry) return entry.registry;
    if (registryFacts.has(c.claimId)) return registryFacts.get(c.claimId);
    const stored = await store.readEvidence(c.evidence?.[0]?.evidenceId);
    if (!stored) throw fail('firewall_registry_unavailable', `The evidence behind stored claim ${c.claimId} is missing, so duplicate checks cannot be completed.`, 503);
    const facts = factsOf(stored.bundle);
    registryFacts.set(c.claimId, facts);
    return facts;
  }

  // `project` and `excludeClaimIds` must come from the server (a stored claim or a claim this service just built),
  // never from the client's submitted claim. A registry that cannot be read completely fails closed (503).
  async function registryClaims({ project = null, excludeClaimIds = [] } = {}) {
    const { entries, truncated } = await store.listClaims();
    if (truncated) throw fail('firewall_registry_too_large', `The claim registry holds more than ${REGISTRY_SCAN_LIMIT} claims; duplicate checks cannot be completed, so nothing is accepted.`, 503);
    const superseded = new Set(entries.map((e) => e.claim.supersedes).filter(Boolean));
    const excluded = new Set(excludeClaimIds);
    const live = entries.filter((entry) => {
      const c = entry.claim;
      if (entry.notSubmitted || excluded.has(c.claimId)) return false;
      return !(project && c.scope?.project && c.scope.project !== project);
    });
    const out = [];
    for (let i = 0; i < live.length; i += REGISTRY_READ_CONCURRENCY) {
      const facts = await Promise.all(live.slice(i, i + REGISTRY_READ_CONCURRENCY).map(factsFor));
      live.slice(i, i + REGISTRY_READ_CONCURRENCY).forEach((entry, k) => {
        const c = entry.claim;
        out.push({ claimId: c.claimId, status: superseded.has(c.claimId) ? 'Superseded' : 'Submitted', scope: c.scope, evidence: c.evidence, ...facts[k] });
      });
    }
    return out;
  }

  // Lab claims are advisory information claims. Modelled evidence belongs to the risk-alert tier (it may inform,
  // never prove); only non-model evidence is held to the observation tier.
  const inferClaimType = (bundle) => (isModelLike(bundle?.sources?.[0]?.dataKind, bundle?.sources?.[0]?.basis, bundle?.measurements?.[0]?.basis)
    ? 'ENVIRONMENTAL_RISK_ALERT'
    : 'ENVIRONMENTAL_OBSERVATION');

  // An emissions-reduction claim without a supported evidence profile has nothing that could bind its quantity to the
  // evidence, so profile selection is required for that tier unless the caller explicitly opts out.
  async function runFirewall({ claim, bundle, expectedDigest, claimType, claimSubtype, requireSubtype, project = null, excludeClaimIds = [] }) {
    const tier = claimType || claim?.claimType;
    return evaluateClaimThroughFirewall({
      claim,
      evidence: bundle,
      expectedDigest,
      claimType,
      claimSubtype: typeof claimSubtype === 'string' ? claimSubtype : undefined,
      requireSubtype: requireSubtype ?? tier === 'QUANTIFIED_EMISSIONS_REDUCTION',
      existingClaims: await registryClaims({ project, excludeClaimIds }),
      plausibility,
      evaluationTime: new Date(now()),
    });
  }

  // The opt-in gate. It is applied to every claim this service builds itself (submit and correction), where the claim,
  // its scope and the project are server-derived. Returns the receipt to store, or null when the gate is off.
  async function gateClaim({ claim, bundle, digest, project, excludeClaimIds = [] }) {
    if (!enforceFirewall) return null;
    const gate = await runFirewall({ claim, bundle, expectedDigest: digest, claimType: inferClaimType(bundle), project, excludeClaimIds });
    if (gate.verdict !== VERDICTS.ACCEPTED) {
      const why = [...gate.errors, ...(gate.notes || [])].join(' ') || 'No rule detail was produced.';
      throw new IntegrityServiceError('firewall_not_accepted', `Trust Firewall verdict ${gate.verdict}; the claim was not submitted. ${why}`, 409, { firewall: { verdict: gate.verdict, receiptId: gate.receiptId, errors: gate.errors, notes: gate.notes } });
    }
    return gate.receipt;
  }

  const submitClaim = ({ evidenceId } = {}) => exclusive(async () => {
    const entry = await mustEvidence(evidenceId);
    const ctx = await connect();
    const found = await evidenceProof(ctx, evidenceId);
    if (!found.anchored) throw fail('evidence_not_anchored', 'Anchor the evidence before using it in a claim.', 409);
    if (!found.current) throw fail('evidence_superseded', 'This evidence was corrected. Use the newest record.', 409);
    const session = await loadSession(ctx);
    const built = buildClaim({ bundle: entry.bundle, digest: entry.digest, claimant: ctx.deployment.accounts.claimant, scope: claimScope(entry.bundle, session.demoRun), createdAt: now() });
    const firewallReceipt = await gateClaim({ claim: built.claim, bundle: entry.bundle, digest: entry.digest, project: built.claim.scope.project });
    const document = { claim: built.claim, claimHash: built.claimHash, registry: factsOf(entry.bundle), ...(firewallReceipt ? { firewallReceipt } : {}) };
    await store.saveClaim(document);
    let receipt;
    try {
      receipt = await send(ctx, ctx.claims, 'claimant', 'submitClaim', [claimKeyOf(built.claim.claimId), hex32(built.exclusivityKey), evidenceKeyOf(evidenceId), hex32(built.claimHash)]);
    } catch (error) {
      // The chain did not take the claim. Keep the document for the record, but stop it blocking later claims.
      await store.saveClaim({ ...document, notSubmitted: true }).catch(() => {});
      throw error;
    }
    await note(ctx, { kind: 'claim-submitted', claimId: built.claim.claimId, evidenceId, transactionHash: receipt.hash, blockNumber: receipt.blockNumber });
    return { claim: built.claim, claimHash: built.claimHash, proof: await claimProof(ctx, built.claim.claimId) };
  });

  const duplicateClaim = (claimId) => exclusive(async () => {
    const original = await mustClaim(claimId);
    const evidenceId = original.claim.evidence[0].evidenceId;
    const entry = await mustEvidence(evidenceId);
    const ctx = await connect();
    // The attempt is returned to the caller but never stored: the chain refuses it, so it is not a record.
    const attempt = buildClaim({ bundle: entry.bundle, digest: entry.digest, claimant: ctx.deployment.accounts.claimant, scope: original.claim.scope, createdAt: now() });
    const rejection = await attemptRejected(ctx, ctx.claims, 'claimant', 'submitClaim', [claimKeyOf(attempt.claim.claimId), hex32(attempt.exclusivityKey), evidenceKeyOf(evidenceId), hex32(attempt.claimHash)]);
    await note(ctx, { kind: 'duplicate-claim-rejected', claimId: attempt.claim.claimId, duplicateOf: claimId, errorName: rejection.errorName, transactionHash: rejection.transactionHash, blockNumber: rejection.blockNumber });
    return { duplicateOf: claimId, attemptedClaim: attempt.claim, sameExclusivityKey: attempt.exclusivityKey === original.claim.exclusivityKey, controlledTest: true, ...rejection };
  });

  const challenge = (claimId, { reasonCode, detail } = {}) => exclusive(async () => {
    await mustClaim(claimId);
    const ctx = await connect();
    const built = buildChallenge({ claimId, challenger: ctx.deployment.accounts.challenger, reasonCode, detail, createdAt: now() });
    await store.saveChallenge(built);
    const receipt = await send(ctx, ctx.claims, 'challenger', 'challengeClaim', [claimKeyOf(claimId), hex32(built.reasonHash)]);
    await note(ctx, { kind: 'claim-challenged', claimId, reasonCode, transactionHash: receipt.hash, blockNumber: receipt.blockNumber });
    return { challenge: built.challenge, reasonHash: built.reasonHash, transactionHash: receipt.hash, blockNumber: receipt.blockNumber, proof: await claimProof(ctx, claimId) };
  });

  const resolve = (claimId, { upheld } = {}) => exclusive(async () => {
    if (typeof upheld !== 'boolean') throw fail('invalid_decision', 'upheld must be true or false.', 400);
    await mustClaim(claimId);
    const ctx = await connect();
    const receipt = await send(ctx, ctx.claims, 'reviewer', 'resolveChallenge', [claimKeyOf(claimId), upheld]);
    await note(ctx, { kind: upheld ? 'challenge-upheld' : 'challenge-dismissed', claimId, transactionHash: receipt.hash, blockNumber: receipt.blockNumber });
    return { claimId, upheld, transactionHash: receipt.hash, blockNumber: receipt.blockNumber, proof: await claimProof(ctx, claimId) };
  });

  // A correction re-retrieves the same signal, anchors the revised bundle with the original
  // as its parent, then has the reviewer replace the challenged claim in the same scope.
  const correct = (claimId, { note: text } = {}) => exclusive(async () => {
    const correctionNote = requireNote(text);
    const original = await mustClaim(claimId);
    const ctx = await connect();
    const before = await claimProof(ctx, claimId);
    if (before.status !== 'Challenged') throw fail('claim_not_challenged', `Only a challenged claim can be corrected; this claim is ${before.status}.`, 409);
    const originalEvidenceId = original.claim.evidence[0].evidenceId;
    const originalEvidence = await mustEvidence(originalEvidenceId);

    const loaded = await source.load(originalEvidence.bundle.location.siteId, { mode: 'live-or-cached' });
    const revised = buildEvidenceBundle({ site: loaded.site, analyte: originalEvidence.bundle.focusAnalyte, source: loaded, parentEvidenceId: originalEvidenceId, revisionNote: correctionNote });
    await store.saveRaw(loaded.sourceRecord.rawPayloadSha256, loaded.rawText);
    await store.saveEvidence({ evidenceId: revised.bundle.evidenceId, digest: revised.digest, metadataHash: revised.metadataHash, createdAt: now(), bundle: revised.bundle });
    const anchorReceipt = await send(ctx, ctx.evidence, 'attester', 'anchorEvidence', [evidenceKeyOf(revised.bundle.evidenceId), hex32(revised.digest), evidenceKeyOf(originalEvidenceId), hex32(revised.metadataHash)]);

    const corrected = buildClaim({ bundle: revised.bundle, digest: revised.digest, claimant: original.claim.claimant.account, scope: original.claim.scope, supersedes: claimId, correctionNote, createdAt: now() });
    // The claim being replaced no longer counts as a competing claim.
    const correctionReceipt = await gateClaim({ claim: corrected.claim, bundle: revised.bundle, digest: revised.digest, project: corrected.claim.scope.project, excludeClaimIds: [claimId] });
    await store.saveClaim({ claim: corrected.claim, claimHash: corrected.claimHash, registry: factsOf(revised.bundle), ...(correctionReceipt ? { firewallReceipt: correctionReceipt } : {}) });
    const approval = await send(ctx, ctx.claims, 'reviewer', 'approveCorrection', [claimKeyOf(claimId), claimKeyOf(corrected.claim.claimId), evidenceKeyOf(revised.bundle.evidenceId), hex32(corrected.claimHash)]);
    await note(ctx, { kind: 'claim-corrected', claimId, correctedClaimId: corrected.claim.claimId, revisedEvidenceId: revised.bundle.evidenceId, transactionHash: approval.hash, blockNumber: approval.blockNumber });

    return {
      originalClaimId: claimId,
      revisedEvidence: { evidenceId: revised.bundle.evidenceId, digest: revised.digest, bundle: revised.bundle, anchorTransactionHash: anchorReceipt.hash, proof: await evidenceProof(ctx, revised.bundle.evidenceId) },
      correctedClaim: { claim: corrected.claim, claimHash: corrected.claimHash, approvalTransactionHash: approval.hash, proof: await claimProof(ctx, corrected.claim.claimId) },
      originalClaim: { proof: await claimProof(ctx, claimId) },
      originalEvidence: { proof: await evidenceProof(ctx, originalEvidenceId) },
    };
  });

  async function getClaim(claimId) {
    const entry = await mustClaim(claimId);
    const { value: proof, problem } = await chainOrProblem((ctx) => claimProof(ctx, claimId));
    return { ...entry, proof, ledgerMode: problem ? 'OFFLINE' : 'LOCAL_EVM', chainProblem: problem };
  }

  async function describeEvent(log, contractName) {
    const args = log.args ?? {};
    const details = {};
    for (const [name, value] of Object.entries(args.toObject ? args.toObject() : {})) details[name] = typeof value === 'bigint' ? value.toString() : value;
    for (const [field, label] of [['evidenceId', 'evidence'], ['parentEvidenceId', 'parentEvidence'], ['claimId', 'claim'], ['originalClaimId', 'originalClaim'], ['correctedClaimId', 'correctedClaim']]) {
      if (typeof details[field] === 'string') details[`${label}Readable`] = await store.idForKey(details[field]);
    }
    return { contract: contractName, event: log.eventName ?? log.fragment?.name ?? 'unknown', blockNumber: log.blockNumber, logIndex: log.index, transactionHash: log.transactionHash, details };
  }

  async function history() {
    const ctx = await connect();
    const [evidenceLogs, claimLogs, session] = await Promise.all([
      ctx.evidence.queryFilter('*', ctx.deployment.evidenceRegistry.deployBlock, 'latest'),
      ctx.claims.queryFilter('*', ctx.deployment.claimRegistry.deployBlock, 'latest'),
      loadSession(ctx),
    ]);
    const events = [];
    for (const log of evidenceLogs) events.push(await describeEvent(log, 'EnvironmentalEvidenceRegistry'));
    for (const log of claimLogs) events.push(await describeEvent(log, 'ClimateClaimRegistry'));
    events.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
    return { network, chainId: EXPECTED_CHAIN_ID, sessionKey: ctx.sessionKey, demoRun: session.demoRun, events, timeline: session.timeline };
  }

  // Starts a fresh demo run on the same chain. Nothing on-chain is erased; the run number is
  // part of the claim scope, so a new run can submit its own first claim.
  const reset = () => exclusive(async () => {
    const ctx = await connect();
    await store.createRun(ctx.sessionKey, (await currentRun(ctx)) + 1);
    const demoRun = await currentRun(ctx);
    await note(ctx, { kind: 'demo-run-started', demoRun });
    return { demoRun, sessionKey: ctx.sessionKey, note: 'On-chain records from earlier runs remain readable.' };
  });

  // Evaluates a custom claim and evidence bundle through the Trust Firewall.
  // Duplicate and overlap checks see the claims stored in this registry (and nothing outside it).
  async function evaluateFirewall({ claim, evidence, expectedDigest, claimType, claimSubtype, requireSubtype } = {}) {
    if (!claim || typeof claim !== 'object' || Array.isArray(claim) || !evidence || typeof evidence !== 'object') {
      throw fail('invalid_request', 'claim and evidence objects are required for firewall evaluation.', 400);
    }
    // A client cannot be allowed to pick which claims it is compared with. The claim id must be new (otherwise the
    // firewall would skip the stored claim it copies), and every project's claims are checked.
    if (typeof claim.claimId === 'string' && CLAIM_ID.test(claim.claimId) && await store.readClaim(claim.claimId)) {
      throw fail('claim_id_in_use', 'That claim id is already stored. Evaluate the stored claim with POST /claims/:id/firewall instead.', 409);
    }
    let digest = expectedDigest || claim.evidence?.[0]?.digest;
    if (!digest) {
      try { digest = digestOf(evidence); } catch { throw fail('invalid_request', 'The evidence cannot be canonically serialised.', 400); }
    }
    return runFirewall({ claim, bundle: evidence, expectedDigest: digest, claimType, claimSubtype, requireSubtype, project: null, excludeClaimIds: [] });
  }

  // Evaluates an existing saved claim in the registry through the Trust Firewall.
  async function evaluateClaimFirewall(claimId, { claimType, claimSubtype, requireSubtype } = {}) {
    const entry = await mustClaim(claimId);
    const evidenceId = entry.claim.evidence[0].evidenceId;
    const evidenceEntry = await mustEvidence(evidenceId);
    return runFirewall({
      claim: entry.claim,
      bundle: evidenceEntry.bundle,
      expectedDigest: entry.claim.evidence[0].digest,
      claimType: claimType || entry.claim.claimType,
      claimSubtype,
      requireSubtype,
      project: entry.claim.scope?.project ?? null,
      excludeClaimIds: [claimId],
    });
  }

  // Runs the reproducible benchmarks. Both suites are synthetic and author-written; the labels say so.
  async function benchmarkFirewall() {
    const regression = await runBenchmark();
    return {
      ...regression,
      label: 'Synthetic regression suite written by the project authors (55 cases). Not an external accuracy or security evaluation.',
      adversarialV2: await runAdversarialV2(),
    };
  }

  return Object.freeze({
    status, sites, buildEvidence, getEvidence, anchor, verify, tamper, replay,
    submitClaim, duplicateClaim, challenge, resolve, correct, getClaim, history, reset,
    evaluateFirewall, evaluateClaimFirewall, benchmarkFirewall,
  });
}

export { IntegrityError };
