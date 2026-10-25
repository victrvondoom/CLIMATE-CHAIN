// The in-process chain: a real EVM (EDR, the engine inside Hardhat) running inside the gateway, so the contracts
// work on hosts that cannot keep a node alive, such as Vercel serverless functions.
//
// How it stays one coherent chain across short-lived instances:
//   * Keys.    The four role accounts are derived from a secret seed (HMAC-SHA256), so their keys are neither
//              Hardhat's published development keys nor guessable. Transactions are signed locally with ethers
//              Wallets and enter the chain only as raw signed bytes.
//   * Journal. Every mined transaction is appended to a hash-linked journal (chain-journal.mjs) in shared
//              storage, together with the block timestamp it used. A cold instance replays the journal on a fresh
//              engine with a fixed genesis, which rebuilds byte-identical blocks, receipts and contract state.
//   * Races.   Slot N of the journal is created with create-if-absent. If another instance wins it, this one
//              rolls its engine back, replays what it missed, and retries (or reports a clear 409 when part of a
//              multi-transaction operation has already been sent).
//   * Epochs.  A full ledger rolls into a fresh, empty chain (a new epoch) rather than refusing writes, so
//              nobody can brick the demo by filling it.
//
// Nothing here simulates a result: every receipt, hash and revert reason the services show was produced by
// the EVM executing the contract bytecode.
//
// Concurrency model, kept deliberately explicit: one lock serializes everything that changes the chain; the
// holder of that lock is `active`; a transaction being mined is `committing` until it is journaled or rolled
// back, and every read waits for that, so no reader ever sees a block that may still vanish. Nothing depends on
// async-context propagation, which ethers' request batching does not preserve.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BrowserProvider, ContractFactory, Interface, Wallet, getCreateAddress, keccak256 } from 'ethers';
import { createJournal, verifyJournal } from './chain-journal.mjs';
import { ENGINE_CONFIG, ENGINE_ID, GENESIS_TIME_SECONDS, createEdrEngine } from './chain-engine.mjs';

export const CHAIN_ID = 31337;
export const ROLES = ['attester', 'claimant', 'reviewer', 'challenger'];
export const RPC_PATH = '/api/v1/chain/rpc';
const DEPLOY_GAS = 3_000_000n;
const ROLE_GAS = 200_000n;
const GAS_PRICE = 20_000_000_000n;
const SETUP_LABELS = ['deploy EvidenceAnchor', 'deploy EnvironmentalEvidenceRegistry', 'deploy ClimateClaimRegistry', 'grant claimant role', 'grant reviewer role'];
// A cold start replays every entry, and a hosted store answers in hundreds of milliseconds, so the ledger is kept
// small. When it fills, the chain rolls into a fresh epoch instead of refusing writes.
const DEFAULT_MAX_ENTRIES = 200;
const MIN_MAX_ENTRIES = 8;
const MAX_LOCK_QUEUE = 32;
const MAX_PUBLIC_CALLS = 4;
const PUBLIC_CALL_GAS = 5_000_000n;
const CALL_KEYS = new Set(['from', 'to', 'data', 'input', 'value', 'gas', 'gasPrice']);

// Read methods a visitor's browser may call through the gateway to check the chain independently.
export const PUBLIC_RPC_METHODS = new Set([
  'eth_chainId', 'net_version', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getCode',
  'eth_call', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getLogs', 'eth_getBalance', 'eth_getTransactionCount',
]);
const BLOCKED_METHOD = /^(evm_|hardhat_|debug_|personal_|anvil_|ganache_|miner_|txpool_)|^eth_(sendTransaction|sign|signTransaction|signTypedData\w*|accounts|requestAccounts)$/;

export class ChainRuntimeError extends Error {
  constructor(code, message, status = 503) {
    super(message);
    this.name = 'ChainRuntimeError';
    this.code = code;
    this.status = status;
  }
}

/** Another instance mined the next journal slot first, or the chain moved to a new epoch. */
export class LedgerConflictError extends Error {
  constructor() {
    super('The shared ledger moved on while this transaction was being mined.');
    this.name = 'LedgerConflictError';
    this.code = 'ledger_conflict';
    this.status = 409;
  }
}

const rpcError = (code, message) => Object.assign(new Error(message), { code });

// Failures of the ledger machinery itself (as opposed to a contract rejecting a call) outrank whatever
// message ethers wrapped them in.
const isInfrastructure = (failure) => Boolean(failure && (failure instanceof LedgerConflictError || failure instanceof ChainRuntimeError
  || failure.name === 'JournalError' || failure.name === 'StorageError'));

export function loadArtifacts() {
  return JSON.parse(readFileSync(new URL('./chain-artifacts.json', import.meta.url), 'utf8'));
}

/**
 * The seed that makes role keys strong and stable across instances. Null when none is configured. It must be
 * its own secret: the addresses and fingerprint are public, so a guessable seed would let anyone derive the keys.
 */
export function resolveSeed(env = process.env) {
  const value = typeof env.CLIMATE_CHAIN_SIGNER_SEED === 'string' ? env.CLIMATE_CHAIN_SIGNER_SEED.trim() : '';
  if (value.length < 32 || new Set(value).size < 10) return null;
  return { source: 'CLIMATE_CHAIN_SIGNER_SEED', seed: value };
}

export function deriveRoleKeys(seed) {
  return Object.fromEntries(ROLES.map((role) => {
    for (let counter = 0; ; counter += 1) {
      const key = `0x${createHmac('sha256', seed).update(`climate-chain/in-process-chain/v1/${role}/${counter}`).digest('hex')}`;
      try { new Wallet(key); return [role, key]; } catch { /* outside the curve order (practically never): try the next counter */ }
    }
  }));
}

/** Names this exact chain. A journal is only ever replayed onto an engine with the same fingerprint. */
export function chainFingerprint(addresses, artifacts) {
  const bytecodes = Object.fromEntries(Object.entries(artifacts.contracts).map(([name, item]) => [name, createHash('sha256').update(item.bytecode).digest('hex')]));
  return createHash('sha256').update(JSON.stringify({
    v: 2, engine: ENGINE_ID, engineConfig: ENGINE_CONFIG, chainId: CHAIN_ID, genesis: GENESIS_TIME_SECONDS, addresses, bytecodes,
    gas: [String(DEPLOY_GAS), String(ROLE_GAS), String(GAS_PRICE)],
  })).digest('hex').slice(0, 16);
}

const epochFolder = (fingerprint) => `chain/${fingerprint}/epochs/`;
const epochKey = (fingerprint, epoch) => `${epochFolder(fingerprint)}${String(epoch).padStart(6, '0')}.json`;
async function currentEpoch(storage, fingerprint) {
  const found = (await storage.list(epochFolder(fingerprint))).map((key) => Number(/\/(\d{6})\.json$/.exec(key)?.[1] ?? 0));
  return found.length ? Math.max(...found) : 0;
}

export function createChainRuntime({
  storage,
  env = process.env,
  seed = null,
  createEngine = createEdrEngine,
  artifacts = loadArtifacts(),
  now = () => Date.now(),
  minRefreshMs = 1000,
  maxJournalEntries = DEFAULT_MAX_ENTRIES,
  bootBackoffMs = 5000,
} = {}) {
  if (!(maxJournalEntries >= MIN_MAX_ENTRIES)) throw new RangeError(`maxJournalEntries must be at least ${MIN_MAX_ENTRIES}.`);
  // Hosted deployments must configure a seed: without one every instance would invent its own keys and its
  // own chain. Elsewhere an unconfigured seed means a throwaway chain that lasts as long as the process.
  const seedInfo = seed ?? resolveSeed(env) ?? (env.VERCEL ? null : { source: 'ephemeral-random', seed: randomBytes(32).toString('hex') });

  let resolvedStorage = null;
  let storageKind = 'pending';
  const getStorage = () => (resolvedStorage ??= Promise.resolve(typeof storage === 'function' ? storage() : storage).then((value) => {
    if (!value) throw new ChainRuntimeError('storage_unavailable', 'The chain has no storage backend.', 503);
    storageKind = value.kind ?? 'custom';
    return value;
  }).catch((error) => { resolvedStorage = null; throw error; }));
  const lazyStorage = {
    get kind() { return storageKind; },
    get: async (key) => (await getStorage()).get(key),
    put: async (key, text) => (await getStorage()).put(key, text),
    putIfAbsent: async (key, text) => (await getStorage()).putIfAbsent(key, text),
    list: async (prefix) => (await getStorage()).list(prefix),
  };

  let state = null;         // the live chain; replaced only by a complete boot
  let bootPromise = null;
  let bootFailure = null;
  let lastRefresh = 0;
  let tail = Promise.resolve();
  let queued = 0;
  let active = null;        // { sent, failure } of the write that holds the lock
  let committing = null;    // settles when the transaction being mined is journaled or rolled back
  let publicCalls = 0;

  const lock = (task) => {
    if (queued >= MAX_LOCK_QUEUE) return Promise.reject(new ChainRuntimeError('chain_busy', 'The chain is busy. Please retry in a moment.', 503));
    queued += 1;
    const run = tail.then(task);
    const done = () => { queued -= 1; };
    tail = run.then(done, done);
    return run;
  };
  const call = (engine, method, params = []) => engine.request({ method, params });
  const noteFailure = (error) => {
    if (!active) return;
    if (!active.failure || (isInfrastructure(error) && !isInfrastructure(active.failure))) active.failure = error;
  };
  // Throws the engine away so the next request rebuilds it from the journal, the source of truth.
  const invalidate = (s) => { if (state === s) { state = null; bootPromise = null; } };

  // ---- engine primitives -------------------------------------------------------------------------
  async function replayEntry(engine, entry) {
    try {
      await call(engine, 'evm_setNextBlockTimestamp', [entry.timestamp]);
      await call(engine, 'eth_sendRawTransaction', [entry.rawTx]);
    } catch (error) {
      throw new ChainRuntimeError('replay_diverged', `Journal entry ${entry.seq} could not be replayed: ${error.message}`, 500);
    }
    if (!(await call(engine, 'eth_getTransactionReceipt', [keccak256(entry.rawTx)]))) {
      throw new ChainRuntimeError('replay_diverged', `Journal entry ${entry.seq} was not mined on replay.`, 500);
    }
  }

  // Mines one signed transaction and records it. Callers hold the ledger lock (or are booting a new chain).
  async function submitRawLocked(s, raw, label, internal = false) {
    const hash = keccak256(raw);
    let release;
    committing = new Promise((resolve) => { release = resolve; });
    let committed = false;
    try {
      if (!internal && s !== state) throw new LedgerConflictError(); // this engine was replaced meanwhile
      if (!internal && s.head.seq >= maxJournalEntries) {
        await s.storage.putIfAbsent(epochKey(s.fingerprint, s.epoch + 1), JSON.stringify({ startedAt: new Date(now()).toISOString(), reason: 'ledger_full' }));
        invalidate(s);
        throw new LedgerConflictError(); // the operation restarts, on the fresh chain
      }
      const timestamp = Math.max(Math.floor(now() / 1000), (s.head.timestamp || GENESIS_TIME_SECONDS) + 1);
      const snapshot = await call(s.engine, 'evm_snapshot');
      try {
        await call(s.engine, 'evm_setNextBlockTimestamp', [timestamp]);
        await call(s.engine, 'eth_sendRawTransaction', [raw]);
        if (!(await call(s.engine, 'eth_getTransactionReceipt', [hash]))) throw new ChainRuntimeError('transaction_not_mined', 'The chain did not mine the transaction.', 502);
        const appended = await s.journal.append(s.head, { timestamp, rawTx: raw, label });
        if (!appended.ok) throw new LedgerConflictError();
        s.head = appended.head;
        s.entries.push(appended.entry);
        committed = true;
        if (active && !internal) active.sent += 1;
        return hash;
      } finally {
        // Whatever went wrong, the engine must never hold a transaction the shared journal does not.
        if (!committed) {
          const rolledBack = await call(s.engine, 'evm_revert', [snapshot]).then(() => true, () => false);
          if (!rolledBack) invalidate(s); // cannot trust this engine any more: rebuild it from the journal
        }
      }
    } catch (error) {
      noteFailure(error);
      throw error;
    } finally {
      committing = null;
      release();
    }
  }

  function submitRaw(s, raw) {
    if (typeof raw !== 'string' || !/^0x[0-9a-fA-F]{2,}$/.test(raw)) throw rpcError(-32602, 'A raw signed transaction is required.');
    // Only the lock holder can be sending: public RPC cannot send, and signers are used inside write().
    return active ? submitRawLocked(s, raw, 'tx') : lock(() => submitRawLocked(s, raw, 'tx'));
  }

  // ---- setup transactions (deployments and role grants) --------------------------------------------
  async function setupTx(step, keys, addresses) {
    const attester = new Wallet(keys.attester);
    const base = { chainId: CHAIN_ID, type: 0, gasPrice: GAS_PRICE, nonce: step - 1, value: 0 };
    const factory = (name) => new ContractFactory(artifacts.contracts[name].abi, artifacts.contracts[name].bytecode);
    const evidenceAddress = getCreateAddress({ from: attester.address, nonce: 1 });
    const claimsAddress = getCreateAddress({ from: attester.address, nonce: 2 });
    const claimsInterface = new Interface(artifacts.contracts.ClimateClaimRegistry.abi);
    if (step === 1) return attester.signTransaction({ ...base, gasLimit: DEPLOY_GAS, data: (await factory('EvidenceAnchor').getDeployTransaction()).data });
    if (step === 2) return attester.signTransaction({ ...base, gasLimit: DEPLOY_GAS, data: (await factory('EnvironmentalEvidenceRegistry').getDeployTransaction()).data });
    if (step === 3) return attester.signTransaction({ ...base, gasLimit: DEPLOY_GAS, data: (await factory('ClimateClaimRegistry').getDeployTransaction(evidenceAddress)).data });
    const method = step === 4 ? 'setClaimant' : 'setReviewer';
    const account = step === 4 ? addresses.claimant : addresses.reviewer;
    return attester.signTransaction({ ...base, gasLimit: ROLE_GAS, to: claimsAddress, data: claimsInterface.encodeFunctionData(method, [account, true]) });
  }

  // Replays whatever other instances journaled since this engine's head. Null head means nothing was new.
  async function catchUp(s) {
    const { entries, head } = await s.journal.since(s.head.seq, s.head.hash, s.head.timestamp);
    if (!head) return;
    for (const entry of entries) await replayEntry(s.engine, entry);
    s.head = head;
    s.entries.push(...entries);
    s.replayed += entries.length;
  }

  async function ensureSetup(s) {
    for (let guard = 0; guard < 20 && s.head.seq < SETUP_LABELS.length; guard += 1) {
      const step = s.head.seq + 1;
      const raw = await setupTx(step, s.keys, s.addresses);
      try { await submitRawLocked(s, raw, SETUP_LABELS[step - 1], true); }
      catch (error) {
        if (!(error instanceof LedgerConflictError)) throw error;
        await catchUp(s); // another instance finished this step; learn from the journal and continue
      }
    }
    if (s.head.seq < SETUP_LABELS.length) throw new ChainRuntimeError('setup_incomplete', 'The chain could not finish deploying its contracts.', 503);
  }

  async function buildDeployments(s) {
    const { engine, keys, addresses } = s;
    const attester = addresses.attester;
    const at = { anchor: getCreateAddress({ from: attester, nonce: 0 }), evidence: getCreateAddress({ from: attester, nonce: 1 }), claims: getCreateAddress({ from: attester, nonce: 2 }) };
    for (const address of Object.values(at)) {
      if ((await call(engine, 'eth_getCode', [address, 'latest'])) === '0x') throw new ChainRuntimeError('setup_inconsistent', 'The replayed chain is missing a deployed contract.', 500);
    }
    const receiptOf = async (step) => call(engine, 'eth_getTransactionReceipt', [keccak256(await setupTx(step, keys, addresses))]);
    const [r1, r2, r3] = [await receiptOf(1), await receiptOf(2), await receiptOf(3)];
    const genesis = await call(engine, 'eth_getBlockByNumber', ['0x0', false]);
    const first = await call(engine, 'eth_getBlockByNumber', ['0x1', false]);
    const blockOf = (receipt) => Number(BigInt(receipt.blockNumber));
    return {
      known: new Set(Object.values(at).map((address) => address.toLowerCase())),
      deployments: {
        evidenceAnchor: { network: 'in-process', chainId: CHAIN_ID, address: at.anchor, deployBlock: blockOf(r1), deployer: attester, abi: artifacts.contracts.EvidenceAnchor.abi },
        integrity: {
          network: 'in-process', chainId: CHAIN_ID, genesisHash: genesis.hash,
          deployedAt: new Date(Number(BigInt(first.timestamp)) * 1000).toISOString(),
          accounts: { ...addresses },
          evidenceRegistry: { address: at.evidence, deployTxHash: r2.transactionHash, deployBlock: blockOf(r2), abi: artifacts.contracts.EnvironmentalEvidenceRegistry.abi },
          claimRegistry: { address: at.claims, deployTxHash: r3.transactionHash, deployBlock: blockOf(r3), abi: artifacts.contracts.ClimateClaimRegistry.abi },
        },
      },
    };
  }

  // ---- boot and sync -------------------------------------------------------------------------------
  // Builds a complete chain and returns it; `state` is only replaced once this succeeds, so a failed rebuild
  // never leaves anything half-made for other requests to trip over.
  async function boot() {
    const started = Date.now();
    if (!seedInfo) throw new ChainRuntimeError('chain_key_missing', 'This deployment needs CLIMATE_CHAIN_SIGNER_SEED (32 or more characters) so every instance derives the same strong chain keys.', 503);
    const journalStorage = await getStorage();
    const keys = deriveRoleKeys(seedInfo.seed);
    const addresses = Object.fromEntries(ROLES.map((role) => [role, new Wallet(keys[role]).address]));
    const fingerprint = chainFingerprint(addresses, artifacts);
    const epoch = await currentEpoch(journalStorage, fingerprint);
    const engine = await createEngine({ keys: ROLES.map((role) => keys[role]) });
    const journal = createJournal({ storage: journalStorage, scope: epoch ? `${fingerprint}-e${epoch}` : fingerprint });
    const loaded = await journal.load();
    for (const entry of loaded.entries) await replayEntry(engine, entry);
    const next = {
      engine, journal, storage: journalStorage, head: loaded.head, entries: [...loaded.entries], keys, addresses, fingerprint, epoch,
      replayed: loaded.entries.length, bootedAt: new Date(now()).toISOString(), bootMs: 0, deployments: null, known: null,
    };
    await ensureSetup(next);
    Object.assign(next, await buildDeployments(next));
    next.bootMs = Date.now() - started;
    lastRefresh = now();
    return next;
  }

  function ready() {
    if (!bootPromise) {
      if (bootFailure && now() - bootFailure.at < bootBackoffMs) return Promise.reject(bootFailure.error);
      bootPromise = boot().then((next) => { state = next; bootFailure = null; return next; }, (error) => {
        bootPromise = null;
        bootFailure = { error, at: now() };
        throw error;
      });
    }
    return bootPromise;
  }

  // Brings this instance up to date with the shared ledger. When it cannot be reconciled it is rebuilt.
  async function syncLocked(s) {
    try {
      if ((await currentEpoch(s.storage, s.fingerprint)) !== s.epoch) throw new ChainRuntimeError('epoch_changed', 'The ledger started a new epoch.', 409);
      await catchUp(s);
      return s;
    } catch (error) {
      if (['journal_diverged', 'replay_diverged', 'epoch_changed'].includes(error?.code)) { invalidate(s); return ready(); }
      throw error;
    }
  }

  // Readers never queue behind writes: a write in progress or waiting syncs the ledger itself when it starts,
  // so a read that finds the lock busy simply reads the committed state it already has.
  async function refresh({ force = false } = {}) {
    await ready();
    if (active || (!force && queued > 0)) return;
    await lock(async () => {
      if (!force && now() - lastRefresh < minRefreshMs) return;
      await syncLocked(await ready());
      lastRefresh = now();
    });
  }

  // Runs a chain-writing operation: serialized, started from the latest shared ledger, and retried when another
  // instance mines first, provided this operation has not sent anything yet. Once part of a multi-step
  // operation is on the chain, a conflict is reported rather than replayed, because replaying would repeat it.
  async function write(task) {
    for (let attempt = 1; ; attempt += 1) {
      const frame = { sent: 0, failure: null };
      try {
        return await lock(async () => {
          await syncLocked(await ready());
          lastRefresh = now();
          active = frame;
          try {
            const result = await task();
            // A task may swallow an error it did not expect; a failure to record a transaction is never ignorable.
            if (isInfrastructure(frame.failure)) throw frame.failure;
            return result;
          } finally { active = null; }
        });
      } catch (error) {
        const cause = isInfrastructure(frame.failure) ? frame.failure : error;
        if (!(cause instanceof LedgerConflictError)) throw cause;
        if (frame.sent === 0 && attempt < 4) continue;
        throw new ChainRuntimeError('ledger_conflict', 'Another visitor wrote to the shared ledger at the same moment. Nothing was lost; please repeat the step.', 409);
      }
    }
  }

  // ---- what the services and routes use -----------------------------------------------------------
  async function providerRequest(method, params = []) {
    const s = await ready();
    if (method === 'eth_sendRawTransaction') return submitRaw(s, params[0]);
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [];
    if (BLOCKED_METHOD.test(method)) throw rpcError(-32601, `${method} is not available on this chain.`);
    if (committing) await committing; // readers only ever see blocks that are already journaled
    return call(s.engine, method, params);
  }

  // A visitor may only call the Climate Chain contracts, with bounded gas and a plain block tag.
  function checkPublicCall(s, params) {
    if (!Array.isArray(params) || params.length < 1 || params.length > 2) throw rpcError(-32602, 'eth_call takes a call object and an optional block tag.');
    const [tx, tag = 'latest'] = params;
    if (!tx || typeof tx !== 'object' || Array.isArray(tx) || Object.keys(tx).some((key) => !CALL_KEYS.has(key))) throw rpcError(-32602, 'That eth_call has fields this endpoint does not accept.');
    if (typeof tx.to !== 'string' || !s.known.has(tx.to.toLowerCase())) throw rpcError(-32602, 'eth_call is limited to the Climate Chain contracts.');
    if (typeof tag !== 'string' || !(['latest', 'pending'].includes(tag) || /^0x[0-9a-fA-F]{1,16}$/.test(tag))) throw rpcError(-32602, 'Use latest, pending or a block number.');
    let gas = PUBLIC_CALL_GAS;
    if (tx.gas !== undefined) {
      try { gas = BigInt(tx.gas); } catch { throw rpcError(-32602, 'gas must be a number.'); }
      if (gas > PUBLIC_CALL_GAS) gas = PUBLIC_CALL_GAS;
    }
    return [{ ...tx, gas: `0x${gas.toString(16)}` }, tag];
  }

  const provider = new BrowserProvider({ request: ({ method, params }) => providerRequest(method, params) }, CHAIN_ID, { staticNetwork: true, cacheTimeout: -1 });
  provider.pollingInterval = 5;

  return Object.freeze({
    mode: 'in-process',
    label: 'In-process EVM chain (Hardhat EDR engine, chain ID 31337)',
    rpcUrl: RPC_PATH,
    storage: lazyStorage,
    provider,
    ready,
    refresh,
    write,
    deployments: async () => (await ready()).deployments,
    signer(role) {
      if (!state || !ROLES.includes(role)) throw new ChainRuntimeError('chain_not_ready', 'The chain has not started.', 503);
      return new Wallet(state.keys[role], provider);
    },
    // The ledger failure, if any, that happened during the current write. A service that deliberately sends a
    // transaction expected to fail calls this so it can stop at once instead of waiting on a receipt that will never come.
    consumeInfrastructureFailure() {
      return active && isInfrastructure(active.failure) ? active.failure : null;
    },
    // Read-only JSON-RPC for a visitor's browser, so it can check the chain without trusting the gateway's own views.
    async rpc(method, params = []) {
      if (!PUBLIC_RPC_METHODS.has(method)) throw rpcError(-32601, `${method} is not available on this endpoint.`);
      const s = await ready();
      await refresh().catch(() => {});
      if (method !== 'eth_call') {
        if (committing) await committing;
        return call(s.engine, method, params);
      }
      const checked = checkPublicCall(s, params);
      if (publicCalls >= MAX_PUBLIC_CALLS) throw rpcError(-32005, 'The chain is busy with other calls. Retry shortly.');
      publicCalls += 1;
      try {
        if (committing) await committing;
        return await call(s.engine, method, checked);
      } finally { publicCalls -= 1; }
    },
    // The tamper-evident journal, verified. Anyone can replay it on EDR with the same fingerprint.
    async journal() {
      const s = await ready();
      await refresh().catch(() => {});
      const entries = [...s.entries];
      return { fingerprint: s.fingerprint, epoch: s.epoch, engine: s.engine.id, genesisTimeSeconds: GENESIS_TIME_SECONDS, chainId: CHAIN_ID, head: verifyJournal(entries), entries };
    },
    describe() {
      if (!state) return { mode: 'in-process', booted: false, persistence: storageKind, keySource: seedInfo ? (seedInfo.source === 'ephemeral-random' ? 'ephemeral' : 'configured') : 'missing' };
      return {
        mode: 'in-process', booted: true, engine: state.engine.id, persistence: storageKind,
        sharedAcrossInstances: storageKind === 'blob', survivesRestart: storageKind === 'blob' || storageKind === 'file',
        keySource: seedInfo.source === 'ephemeral-random' ? 'ephemeral' : 'configured', fingerprint: state.fingerprint, epoch: state.epoch,
        journal: { entries: state.head.seq, head: state.head.hash, capacity: maxJournalEntries },
        replayedOnBoot: state.replayed, bootMs: state.bootMs, bootedAt: state.bootedAt,
      };
    },
  });
}
