// The EVM the in-process chain runs on: EDR, the engine inside Hardhat, driven directly. It needs no Hardhat
// package, config file or disk access, and ships one native binary per platform (a 36 MB linux-x64 build is
// what Vercel installs). Pin the version: the options below were tested against 0.12.0-next.17, the exact
// version Hardhat 2.28 uses.
//
// This module only turns EDR into a plain `request({ method, params })` function. Everything about what goes
// onto the chain (journal, keys, timestamps) lives in chain-runtime.mjs.
import { computeAddress } from 'ethers';

export const ENGINE_ID = 'edr-0.12.0-next.17';
// Fixed on purpose: a different genesis time would change every block hash on replay.
export const GENESIS_TIME_SECONDS = 1_699_990_000;
const ETHER = 10n ** 18n;
// Everything that shapes block and state hashes. The chain fingerprint includes it, so changing any value here
// starts a new chain instead of replaying an old journal onto an engine that would disagree with it.
export const ENGINE_CONFIG = Object.freeze({
  hardfork: 'Shanghai', chainId: 31337, fundedBalanceEther: 10_000, initialBaseFeeGwei: 1, blockGasLimit: 30_000_000,
  coinbase: 'c014ba5ec014ba5ec014ba5ec014ba5ec014ba5e', allowBlocksWithSameTimestamp: true,
});

export class ChainEngineError extends Error {
  constructor(code, message, status = 503) {
    super(message);
    this.name = 'ChainEngineError';
    this.code = code;
    this.status = status;
  }
}

let loading = null;
// EDR allows one context per process, shared by every chain created in it.
function loadEdr() {
  loading ??= (async () => {
    let module;
    try { module = await import('@nomicfoundation/edr'); }
    catch (error) {
      throw new ChainEngineError('chain_engine_unavailable', `The EVM engine could not be loaded on this host: ${error?.message ?? 'unknown error'}`);
    }
    const edr = module.EdrContext ? module : module.default;
    const context = new edr.EdrContext();
    await context.registerProviderFactory(edr.GENERIC_CHAIN_TYPE, edr.genericChainProviderFactory());
    return { edr, context };
  })().catch((error) => { loading = null; throw error; });
  return loading;
}

/** `keys` are 0x-prefixed private keys; each is funded in the genesis state. */
export async function createEdrEngine({ keys, genesisTimeSeconds = GENESIS_TIME_SECONDS }) {
  const { edr, context } = await loadEdr();
  const hardfork = edr.l1HardforkFromString(ENGINE_CONFIG.hardfork); // the contracts use neither PUSH0 nor MCOPY
  const genesisState = edr.l1GenesisState(hardfork);
  for (const key of keys) {
    genesisState.push({ address: Buffer.from(computeAddress(key).slice(2), 'hex'), balance: BigInt(ENGINE_CONFIG.fundedBalanceEther) * ETHER, code: new Uint8Array() });
  }
  let provider;
  try {
    provider = await context.createProvider(edr.GENERIC_CHAIN_TYPE, {
      allowBlocksWithSameTimestamp: ENGINE_CONFIG.allowBlocksWithSameTimestamp,
      allowUnlimitedContractSize: false,
      // A reverting call is a JSON-RPC error carrying the revert data; a reverting transaction is still mined
      // and reports status 0, so a rejection can be shown with a real receipt.
      bailOnCallFailure: true,
      bailOnTransactionFailure: false,
      blockGasLimit: BigInt(ENGINE_CONFIG.blockGasLimit),
      chainId: BigInt(ENGINE_CONFIG.chainId),
      networkId: BigInt(ENGINE_CONFIG.chainId),
      coinbase: Buffer.from(ENGINE_CONFIG.coinbase, 'hex'),
      precompileOverrides: [],
      genesisState,
      hardfork: edr.l1HardforkToString(hardfork),
      initialDate: BigInt(genesisTimeSeconds),
      initialBaseFeePerGas: BigInt(ENGINE_CONFIG.initialBaseFeeGwei) * 1_000_000_000n,
      minGasPrice: 0n,
      mining: { autoMine: true, memPool: { order: edr.MineOrdering.Priority } },
      observability: {},
      ownedAccounts: keys,
    }, { enable: false, decodeConsoleLogInputsCallback: () => [], printLineCallback: () => {} },
    { subscriptionCallback: () => {} }, edr.ContractDecoder.withContracts({}));
  } catch (error) {
    throw new ChainEngineError('chain_engine_unavailable', `The EVM engine could not start: ${error?.message ?? 'unknown error'}`);
  }

  let nextId = 0;
  async function request({ method, params = [] }) {
    const response = await provider.handleRequest(JSON.stringify({ jsonrpc: '2.0', id: ++nextId, method, params }));
    const body = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    if (body.error) {
      const error = new Error(body.error.message);
      error.code = body.error.code;
      // ethers decodes a revert only when `data` is the bare hex string, so flatten EDR's nested shape.
      const data = body.error.data;
      error.data = data && typeof data.data === 'string' ? data.data : data;
      throw error;
    }
    return body.result;
  }
  return { id: ENGINE_ID, request };
}
