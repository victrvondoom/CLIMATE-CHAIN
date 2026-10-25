// The in-process chain, tested against the real EVM (EDR) and the real contracts. No mocks of the chain:
// failures are injected only into the storage layer underneath it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Contract, Wallet, id as keccakText } from 'ethers';
import {
  ChainRuntimeError, chainFingerprint, createChainRuntime, deriveRoleKeys, loadArtifacts, resolveSeed,
} from '../chain-runtime.mjs';
import { createJournal } from '../chain-journal.mjs';
import { createEdrEngine } from '../chain-engine.mjs';
import { StorageError, createMemoryStorage } from '../storage.mjs';
import { createIntegrityService } from '../integrity-service.mjs';
import { createEvidenceAnchorService } from '../evidence-anchor.mjs';
import { createAirQualitySource } from '../integrity-sources.mjs';

const SEED = 'unit-test-seed-0123456789abcdef-0123456789abcdef';
const HARDHAT_ACCOUNT_0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const artifacts = loadArtifacts();
const digestN = (n) => `0x${n.toString(16).padStart(64, '0')}`;
const runtimeOn = (storage, extra = {}) => createChainRuntime({ storage, seed: { source: 'test', seed: SEED }, env: {}, minRefreshMs: 0, bootBackoffMs: 0, ...extra });

async function anchorContract(rt) {
  const { evidenceAnchor } = await rt.deployments();
  return new Contract(evidenceAnchor.address, evidenceAnchor.abi, rt.signer('attester'));
}
const sendAnchor = async (rt, n) => {
  const tx = await (await anchorContract(rt)).anchor(digestN(n), keccakText(`manifest-${n}`), keccakText('test'));
  await tx.wait();
  return tx.hash;
};
const anchorN = (rt, n) => rt.write(() => sendAnchor(rt, n));
const isAnchored = async (rt, n) => (await (await anchorContract(rt)).anchors(digestN(n))).exists;

// Wraps a storage so the next journal appends can be made to conflict or fail.
function flaky(inner = createMemoryStorage(), delayMs = 0) {
  const rules = [];
  return {
    kind: 'memory',
    inner,
    inject: (match, mode, times = 1) => rules.push({ match, mode, times }),
    get: (key) => inner.get(key),
    put: (key, text) => inner.put(key, text),
    list: (prefix) => inner.list(prefix),
    async putIfAbsent(key, text) {
      if (delayMs && key.includes('/journal/')) await new Promise((resolve) => setTimeout(resolve, delayMs)); // a slow shared store
      const rule = rules.find((r) => r.times > 0 && key.includes(r.match));
      if (rule) {
        rule.times -= 1;
        if (rule.mode === 'conflict') return false;
        throw new StorageError('store_unwritable', 'injected storage failure', 503);
      }
      return inner.putIfAbsent(key, text);
    },
  };
}

test('role keys are derived from a secret, stable, distinct per role and never the published Hardhat keys', () => {
  const keys = deriveRoleKeys(SEED);
  assert.deepEqual(keys, deriveRoleKeys(SEED));
  assert.equal(new Set(Object.values(keys)).size, 4);
  assert.notDeepEqual(keys, deriveRoleKeys(`${SEED}-other`));
  for (const key of Object.values(keys)) assert.match(key, /^0x[0-9a-f]{64}$/);
  assert.notEqual(new Wallet(keys.attester).address, HARDHAT_ACCOUNT_0);
});

test('a seed must be long enough, and a hosted deployment refuses to guess one', async () => {
  assert.equal(resolveSeed({ CLIMATE_CHAIN_SIGNER_SEED: 'too-short' }), null);
  assert.equal(resolveSeed({ CLIMATE_CHAIN_SIGNER_SEED: 'a'.repeat(64) }), null, 'a repetitive seed is guessable');
  assert.deepEqual(resolveSeed({ CLIMATE_CHAIN_SIGNER_SEED: SEED }), { source: 'CLIMATE_CHAIN_SIGNER_SEED', seed: SEED });
  assert.equal(resolveSeed({ CLIMATE_CHAIN_MEMORY_KEY: 'k1m2e3y4'.repeat(6) }), null, 'the memory-vault key is a different secret and is never reused for chain keys');
  const hosted = createChainRuntime({ storage: createMemoryStorage(), env: { VERCEL: '1' }, createEngine: async () => { throw new Error('must not start'); } });
  await assert.rejects(() => hosted.ready(), (e) => e.code === 'chain_key_missing' && e.status === 503);
  await assert.rejects(() => hosted.deployments(), (e) => e.code === 'chain_key_missing', 'a failed boot is never cached as success');
});

test('the fingerprint changes with the keys or the contract code, so a journal never replays onto the wrong chain', () => {
  const a = chainFingerprint({ attester: '0x1' }, artifacts);
  assert.equal(a, chainFingerprint({ attester: '0x1' }, artifacts));
  assert.notEqual(a, chainFingerprint({ attester: '0x2' }, artifacts));
  const changed = structuredClone(artifacts);
  changed.contracts.EvidenceAnchor.bytecode += '00';
  assert.notEqual(a, chainFingerprint({ attester: '0x1' }, changed));
});

test('the committed artifacts match the Solidity sources they were built from', async () => {
  const { readFile } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const dir = new URL('../../blockchain/contracts/', import.meta.url);
  for (const [name, item] of Object.entries(artifacts.contracts)) {
    let source;
    try { source = await readFile(new URL(`${name}.sol`, dir), 'utf8'); } catch { return; /* sources are not shipped to this host */ }
    const sha = createHash('sha256').update(source.replace(/\r\n/g, '\n')).digest('hex');
    assert.equal(item.sourceSha256, sha, `${name}.sol changed: run \`npm run export:artifacts\` in blockchain/ and commit gateway/chain-artifacts.json`);
  }
});

test('first boot deploys the contracts onto a chain with id 31337 and journals every setup transaction', async () => {
  const storage = createMemoryStorage();
  const rt = runtimeOn(storage);
  const { evidenceAnchor, integrity } = await rt.deployments();
  assert.equal(await rt.provider.send('eth_chainId', []), '0x7a69');
  for (const address of [evidenceAnchor.address, integrity.evidenceRegistry.address, integrity.claimRegistry.address]) {
    assert.notEqual(await rt.provider.getCode(address), '0x');
  }
  assert.deepEqual([evidenceAnchor.deployBlock, integrity.evidenceRegistry.deployBlock, integrity.claimRegistry.deployBlock], [1, 2, 3]);
  assert.notEqual(integrity.accounts.attester, HARDHAT_ACCOUNT_0);
  assert.equal(await rt.provider.getBalance(HARDHAT_ACCOUNT_0), 0n, 'the published Hardhat account holds nothing here');
  assert.ok(await rt.provider.getBalance(integrity.accounts.attester) > 0n);
  const info = rt.describe();
  assert.equal(info.journal.entries, 5);
  assert.equal(info.keySource, 'configured', 'the response says a seed exists, never which variable holds it');
  assert.equal(info.epoch, 0);
  const journal = await rt.journal();
  assert.deepEqual(journal.entries.map((e) => e.label), ['deploy EvidenceAnchor', 'deploy EnvironmentalEvidenceRegistry', 'deploy ClimateClaimRegistry', 'grant claimant role', 'grant reviewer role']);
});

test('a brand-new instance replays the journal into the identical chain: same blocks, receipts and contract state', async () => {
  const storage = createMemoryStorage();
  const first = runtimeOn(storage);
  const hashes = [await anchorN(first, 1), await anchorN(first, 2)];
  const head = await first.provider.getBlock('latest');

  const second = runtimeOn(storage);
  await second.ready();
  assert.equal(second.describe().replayedOnBoot, 7);
  const replayed = await second.provider.getBlock('latest');
  assert.equal(replayed.hash, head.hash, 'the latest block hash is reproduced exactly');
  assert.equal(replayed.number, head.number);
  assert.equal(replayed.timestamp, head.timestamp);
  assert.equal((await second.provider.getBlock(0)).hash, (await first.provider.getBlock(0)).hash);
  for (const hash of hashes) {
    const [a, b] = await Promise.all([first.provider.getTransactionReceipt(hash), second.provider.getTransactionReceipt(hash)]);
    assert.equal(b.blockHash, a.blockHash);
    assert.equal(b.gasUsed, a.gasUsed);
    assert.equal(b.status, 1);
  }
  assert.equal(await isAnchored(second, 1), true);
  assert.equal(await isAnchored(second, 3), false);
  assert.deepEqual((await first.deployments()).integrity, (await second.deployments()).integrity);
});

test('two instances racing to write both succeed, and converge on one history', async () => {
  const storage = createMemoryStorage();
  const a = runtimeOn(storage);
  const b = runtimeOn(storage);
  await Promise.all([a.ready(), b.ready()]);
  await Promise.all([anchorN(a, 10), anchorN(b, 20), anchorN(a, 11), anchorN(b, 21)]);
  await Promise.all([a.refresh({ force: true }), b.refresh({ force: true })]);
  assert.equal(a.describe().journal.entries, 9);
  assert.equal(b.describe().journal.entries, 9);
  assert.equal(a.describe().journal.head, b.describe().journal.head);
  assert.equal((await a.provider.getBlock('latest')).hash, (await b.provider.getBlock('latest')).hash);
  for (const n of [10, 11, 20, 21]) assert.equal(await isAnchored(a, n) && await isAnchored(b, n), true, `digest ${n} is anchored on both instances`);
});

test('losing a race before sending anything is retried transparently', async () => {
  const store = flaky();
  const rt = runtimeOn(store);
  await rt.ready();
  store.inject('/00000006.json', 'conflict', 2);
  const hash = await anchorN(rt, 5);
  assert.match(hash, /^0x[0-9a-f]{64}$/);
  assert.equal(await isAnchored(rt, 5), true);
  assert.equal(rt.describe().journal.entries, 6);
});

test('losing a race halfway through a multi-step operation is reported as a 409 and leaves a consistent chain', async () => {
  const store = flaky();
  const rt = runtimeOn(store);
  await rt.ready();
  store.inject('/00000007.json', 'conflict', 1);
  await assert.rejects(
    () => rt.write(async () => { await sendAnchor(rt, 1); await sendAnchor(rt, 2); }),
    (error) => error instanceof ChainRuntimeError && error.code === 'ledger_conflict' && error.status === 409,
  );
  assert.equal(await isAnchored(rt, 1), true, 'the first step is recorded');
  assert.equal(await isAnchored(rt, 2), false, 'the conflicting step was rolled back');
  assert.equal(rt.describe().journal.entries, 6);
  await anchorN(rt, 2);
  assert.equal(await isAnchored(rt, 2), true);
  const fresh = runtimeOn(store.inner);
  await fresh.ready();
  assert.equal(fresh.describe().journal.entries, 7);
  assert.equal((await fresh.provider.getBlock('latest')).hash, (await rt.provider.getBlock('latest')).hash);
});

test('a storage failure after mining rolls the engine back, so the next transaction still has the right nonce', async () => {
  const store = flaky();
  const rt = runtimeOn(store);
  await rt.ready();
  store.inject('/00000006.json', 'fail', 1);
  await assert.rejects(() => anchorN(rt, 7), (error) => error.code === 'store_unwritable' && error.status === 503);
  assert.equal(await isAnchored(rt, 7), false, 'nothing is on the chain that is not in the journal');
  assert.equal(rt.describe().journal.entries, 5);
  await anchorN(rt, 7);
  assert.equal(await isAnchored(rt, 7), true);
  assert.equal(rt.describe().journal.entries, 6);
});

test('a tampered journal stops the chain from booting; repairing it lets the next request succeed', async () => {
  const storage = createMemoryStorage();
  const seeded = runtimeOn(storage);
  await anchorN(seeded, 1);
  const key = (await storage.list('chain/')).find((k) => k.endsWith('/00000006.json'));
  const original = await storage.get(key);
  const forged = JSON.parse(original);
  forged.rawTx = `${forged.rawTx.slice(0, -2)}00`;
  await storage.put(key, JSON.stringify(forged));
  const victim = runtimeOn(storage);
  await assert.rejects(() => victim.ready(), (e) => e.code === 'journal_tampered');
  await storage.put(key, original);
  await victim.ready();
  assert.equal(victim.describe().journal.entries, 6);
});

test('a full ledger rolls into a fresh epoch instead of refusing writes, and other instances follow', async () => {
  const storage = createMemoryStorage();
  const rt = runtimeOn(storage, { maxJournalEntries: 8 });
  const follower = runtimeOn(storage, { maxJournalEntries: 8 });
  await Promise.all([rt.ready(), follower.ready()]);
  for (const n of [1, 2, 3]) await anchorN(rt, n); // 5 setup + 3 = full
  assert.equal(rt.describe().journal.entries, 8);
  await anchorN(rt, 4); // the write that finds the ledger full starts a new epoch and completes there
  assert.equal(rt.describe().epoch, 1);
  assert.equal(rt.describe().journal.entries, 6, 'a fresh chain: 5 setup transactions plus the new write');
  assert.equal(await isAnchored(rt, 4), true);
  assert.equal(await isAnchored(rt, 1), false, 'the old epoch is gone from the live chain');
  await follower.refresh({ force: true });
  assert.equal(follower.describe().epoch, 1, 'another instance follows the epoch change');
  assert.equal(await isAnchored(follower, 4), true);
  assert.equal((await follower.provider.getBlock('latest')).hash, (await rt.provider.getBlock('latest')).hash);
  const cold = runtimeOn(storage, { maxJournalEntries: 8 });
  await cold.ready();
  assert.equal(cold.describe().epoch, 1, 'a cold instance boots straight into the current epoch');
  assert.equal((await rt.journal()).epoch, 1);
});

test('reads and writes can overlap without deadlocking the ledger lock', async () => {
  const rt = runtimeOn(createMemoryStorage());
  await rt.ready();
  let stop = false;
  const readers = (async () => { while (!stop) { await rt.provider.send('eth_blockNumber', []); await rt.provider.getBalance((await rt.deployments()).integrity.accounts.attester); } })();
  const writes = (async () => { for (const n of [1, 2, 3, 4, 5, 6]) await anchorN(rt, n); })();
  const outcome = await Promise.race([writes.then(() => 'done'), new Promise((resolve) => setTimeout(() => resolve('deadlocked'), 20_000))]);
  stop = true;
  await readers;
  assert.equal(outcome, 'done', 'six writes finish while reads hammer the same provider');
  assert.equal(rt.describe().journal.entries, 11);
});

test('a conflict is never reported as success just because an earlier send in the same operation failed', async () => {
  const store = flaky();
  const rt = runtimeOn(store);
  await rt.ready();
  store.inject('/00000006.json', 'conflict', 10);
  const attester = rt.signer('attester');
  await assert.rejects(
    () => rt.write(async () => {
      await attester.sendTransaction({ to: Wallet.createRandom().address, value: 0n, nonce: 0 }).catch(() => {}); // the engine refuses this: nonce too low
      await sendAnchor(rt, 9).catch(() => {}); // the lost race is swallowed too
    }),
    (error) => error.code === 'ledger_conflict' && error.status === 409,
  );
  assert.equal(await isAnchored(rt, 9), false);
  assert.equal(rt.describe().journal.entries, 5);
});

test('callers queued behind a failed rebuild get a clear error, and the next request recovers', async () => {
  const storage = createMemoryStorage();
  let creations = 0;
  const rt = runtimeOn(storage, {
    bootBackoffMs: 300, // callers arriving during the outage share the failure instead of each retrying
    createEngine: async (options) => {
      creations += 1;
      if (creations === 2) throw new ChainRuntimeError('chain_engine_unavailable', 'The EVM engine could not start (injected).', 503);
      return createEdrEngine(options);
    },
  });
  await rt.ready();
  await storage.putIfAbsent(`chain/${rt.describe().fingerprint}/epochs/000001.json`, '{}'); // forces every instance to rebuild
  const settled = await Promise.allSettled([anchorN(rt, 1), rt.refresh({ force: true }), anchorN(rt, 2)]);
  for (const result of settled) {
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason.code, 'chain_engine_unavailable', `a clean error, not a TypeError: ${result.reason?.message}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 350)); // the outage window passes
  await anchorN(rt, 3);
  assert.equal(rt.describe().epoch, 1);
  assert.equal(await isAnchored(rt, 3), true);
});

test('a failed boot is remembered briefly, so an outage is not hammered with rebuild attempts', async () => {
  let creations = 0;
  const rt = runtimeOn(createMemoryStorage(), {
    bootBackoffMs: 250,
    createEngine: async (options) => { creations += 1; if (creations === 1) throw new ChainRuntimeError('chain_engine_unavailable', 'injected', 503); return createEdrEngine(options); },
  });
  await assert.rejects(() => rt.ready(), (e) => e.code === 'chain_engine_unavailable');
  await assert.rejects(() => rt.ready(), (e) => e.code === 'chain_engine_unavailable');
  assert.equal(creations, 1, 'the second request did not try to boot again');
  await new Promise((resolve) => setTimeout(resolve, 300));
  await rt.ready();
  assert.equal(creations, 2);
});

test('readers never see a block that is later rolled back', async () => {
  const store = flaky(createMemoryStorage(), 250);
  const rt = runtimeOn(store);
  await rt.ready();
  store.inject('/00000006.json', 'conflict', 1);
  const seen = [];
  let stop = false;
  const poll = (async () => { while (!stop) { seen.push(Number(BigInt(await rt.rpc('eth_blockNumber')))); await new Promise((resolve) => setTimeout(resolve, 15)); } })();
  await anchorN(rt, 1); // first attempt mines block 6, loses the journal slot, is rolled back; the retry commits block 6
  stop = true;
  await poll;
  assert.ok(seen.length > 5, 'the reader sampled during the write');
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b), `block numbers never went backwards: ${seen.join(',')}`);
});

test('if rolling an engine back fails, the engine is discarded and rebuilt from the journal', async () => {
  const store = flaky();
  const failure = { revert: true };
  const rt = runtimeOn(store, {
    createEngine: async (options) => {
      const engine = await createEdrEngine(options);
      return { ...engine, request: (req) => (failure.revert && req.method === 'evm_revert' ? Promise.reject(new Error('revert failed (injected)')) : engine.request(req)) };
    },
  });
  await rt.ready();
  store.inject('/00000006.json', 'conflict', 1);
  await anchorN(rt, 1); // the rollback of the lost attempt fails; the retry runs on a rebuilt engine
  failure.revert = false;
  assert.equal(await isAnchored(rt, 1), true);
  assert.equal(rt.describe().journal.entries, 6);
  const fresh = runtimeOn(store.inner);
  await fresh.ready();
  assert.equal((await fresh.provider.getBlock('latest')).hash, (await rt.provider.getBlock('latest')).hash, 'no phantom transaction survived');
});

test('the lock queue is bounded: a flood is told the chain is busy instead of piling up', async () => {
  const rt = runtimeOn(createMemoryStorage());
  await rt.ready();
  const outcomes = await Promise.allSettled(Array.from({ length: 50 }, () => rt.write(() => new Promise((resolve) => setTimeout(resolve, 20)))));
  const busy = outcomes.filter((o) => o.status === 'rejected' && o.reason.code === 'chain_busy');
  assert.ok(busy.length > 0, 'some callers were turned away');
  assert.ok(outcomes.some((o) => o.status === 'fulfilled'), 'the others were served');
  await anchorN(rt, 1);
  assert.equal(await isAnchored(rt, 1), true, 'the chain is healthy after the flood');
});

test('public eth_call is limited to the Climate Chain contracts with bounded gas', async () => {
  const rt = runtimeOn(createMemoryStorage());
  const { integrity } = await rt.deployments();
  const { Interface } = await import('ethers');
  const data = new Interface(integrity.evidenceRegistry.abi).encodeFunctionData('evidenceCount');
  const ok = await rt.rpc('eth_call', [{ to: integrity.evidenceRegistry.address, data }, 'latest']);
  assert.equal(BigInt(ok), 0n);
  const refuse = (params, pattern) => assert.rejects(() => rt.rpc('eth_call', params), (e) => e.code === -32602 && pattern.test(e.message));
  await refuse([{ to: Wallet.createRandom().address, data }, 'latest'], /limited to the Climate Chain contracts/);
  await refuse([{ data }, 'latest'], /limited to the Climate Chain contracts/);
  await refuse([{ to: integrity.evidenceRegistry.address, data, stateOverride: {} }, 'latest'], /fields/);
  await refuse([{ to: integrity.evidenceRegistry.address, data }, 'latest', { '0x1': {} }], /optional block tag/);
  await refuse([{ to: integrity.evidenceRegistry.address, data }, { toString: 'x' }], /latest, pending/);
  await refuse([{ to: integrity.evidenceRegistry.address, data, gas: 'nope' }, 'latest'], /gas must be a number/);
  const huge = await rt.rpc('eth_call', [{ to: integrity.evidenceRegistry.address, data, gas: '0xffffffff' }, 'latest']);
  assert.equal(BigInt(huge), 0n, 'an oversized gas request is clamped, not rejected');
});

test('visitors can read the chain but cannot control it', async () => {
  const rt = runtimeOn(createMemoryStorage());
  await rt.ready();
  assert.equal(await rt.rpc('eth_chainId'), '0x7a69');
  assert.ok(Number(BigInt(await rt.rpc('eth_blockNumber'))) >= 5);
  for (const method of ['eth_sendRawTransaction', 'evm_mine', 'hardhat_setBalance', 'eth_sendTransaction', 'debug_traceTransaction', 'eth_accounts']) {
    await assert.rejects(() => rt.rpc(method, []), (e) => e.code === -32601, method);
  }
  for (const method of ['evm_mine', 'hardhat_reset', 'eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4']) {
    await assert.rejects(() => rt.provider.send(method, []), /not available/i, method);
  }
  assert.deepEqual(await rt.provider.send('eth_accounts', []), []);
  await assert.rejects(() => rt.provider.broadcastTransaction('0xzz'), /./);
});

test('the integrity lab runs its whole flow on the in-process chain, with real receipts and reverts', async () => {
  const storage = createMemoryStorage();
  const rt = runtimeOn(storage);
  const offline = createAirQualitySource({ fetchImpl: async () => { throw new TypeError('network disabled for this test'); }, sleep: async () => {} });
  const service = createIntegrityService({ chain: rt, source: offline });

  const status = await service.status();
  assert.equal(status.ledgerMode, 'LOCAL_EVM', status.problem?.message);
  assert.equal(status.chainMode, 'in-process');
  assert.equal(status.rpcUrl, '/api/v1/chain/rpc');
  assert.equal(status.localOnly, false);
  assert.notEqual(status.accounts.attester, HARDHAT_ACCOUNT_0);
  assert.match(status.accountsNote, /not public/);
  assert.equal(status.ledger.persistence, 'memory');

  const built = await service.buildEvidence({ siteId: 'new-delhi', analyte: 'pm2_5', mode: 'live-or-cached' });
  assert.equal(built.proof.anchored, false);
  const anchored = await service.anchor(built.evidenceId);
  assert.equal(anchored.alreadyAnchored, false);
  assert.equal(anchored.receiptStatus, 1);
  assert.ok(anchored.confirmations >= 1);
  assert.equal(anchored.onChainDigest, `0x${built.digest}`);
  assert.equal((await service.anchor(built.evidenceId)).alreadyAnchored, true);
  assert.equal((await service.verify(built.evidenceId)).verified, true);

  const tampered = await service.tamper(built.evidenceId);
  assert.equal(tampered.result, 'FAIL');
  assert.equal(tampered.contractAcceptsTampered, false);
  assert.equal(tampered.contractAcceptsOriginal, true);

  const replay = await service.replay(built.evidenceId);
  assert.equal(replay.errorName, 'EvidenceIdTaken');
  assert.equal(replay.mined, true, 'the rejected transaction is mined, so the rejection has a real receipt');
  assert.equal(replay.receiptStatus, 0);

  const claim = await service.submitClaim({ evidenceId: built.evidenceId });
  assert.equal(claim.proof.status, 'Submitted');
  const duplicate = await service.duplicateClaim(claim.claim.claimId);
  assert.equal(duplicate.errorName, 'DuplicateClaim');
  assert.equal(duplicate.receiptStatus, 0);
  const challenged = await service.challenge(claim.claim.claimId, { reasonCode: 'STALE_SOURCE', detail: 'This claim uses a cached historical example, not a live retrieval.' });
  assert.equal(challenged.proof.status, 'Challenged');
  const corrected = await service.correct(claim.claim.claimId, { note: 'Re-retrieved the source and linked the revised bundle to the original.' });
  assert.equal(corrected.originalClaim.proof.status, 'Superseded');
  assert.equal(corrected.correctedClaim.proof.status, 'Submitted');
  assert.equal(corrected.originalEvidence.proof.current, false);

  const history = await service.history();
  const names = history.events.map((event) => event.event);
  for (const expected of ['EvidenceAnchored', 'EvidenceSuperseded', 'ClaimSubmitted', 'ClaimChallenged', 'ClaimSuperseded']) assert.ok(names.includes(expected), `history has ${expected}`);
  assert.equal(history.network, rt.label);
  assert.equal((await service.reset()).demoRun, history.demoRun + 1);

  // A different instance, with nothing in memory, serves the same state from the shared journal and store.
  const other = createIntegrityService({ chain: runtimeOn(storage), source: offline });
  const reread = await other.verify(built.evidenceId);
  assert.equal(reread.verified, true, JSON.stringify(reread.checks));
  assert.equal(reread.proof.transactionHash, anchored.transactionHash);
  assert.equal((await other.getClaim(claim.claim.claimId)).proof.status, 'Superseded');
  assert.equal((await other.status()).evidenceCount, (await service.status()).evidenceCount);
});

test('cascade manifests are anchored through the in-process chain and read back by another instance', async () => {
  const { hashEvidence } = await import('../cascade.mjs');
  const storage = createMemoryStorage();
  const payload = { schemaVersion: 1, id: 'cascade:delhi:test', evidence: { site: 'New Delhi', reading: 42 } };
  const manifest = { ...payload, integrity: { algorithm: 'SHA-256', digest: hashEvidence(payload) } };
  const service = createEvidenceAnchorService({ chain: runtimeOn(storage) });
  assert.equal((await service.status()).available, true);
  const anchored = await service.anchor(manifest);
  assert.equal(anchored.anchored, true);
  assert.equal(anchored.proofVerified, true);
  assert.equal(anchored.transactionStatus, 'success');
  assert.equal((await service.anchor(manifest)).alreadyAnchored, true);
  const reader = createEvidenceAnchorService({ chain: runtimeOn(storage) });
  const found = await reader.verify(manifest.integrity.digest);
  assert.equal(found.proofVerified, true);
  assert.equal(found.transactionHash, anchored.transactionHash);
  assert.equal((await reader.list(5)).anchors.length, 1);
  assert.equal((await reader.status()).anchorCount, 1);
});

test('when the engine cannot start the services report the chain as unavailable instead of failing', async () => {
  const rt = createChainRuntime({
    storage: createMemoryStorage(), seed: { source: 'test', seed: SEED }, env: {},
    createEngine: async () => { throw new ChainRuntimeError('chain_engine_unavailable', 'The EVM engine could not be loaded on this host.', 503); },
  });
  const status = await createIntegrityService({ chain: rt }).status();
  assert.equal(status.ledgerMode, 'OFFLINE');
  assert.equal(status.problem.code, 'chain_engine_unavailable');
  const anchorStatus = await createEvidenceAnchorService({ chain: rt }).status();
  assert.equal(anchorStatus.available, false);
  assert.equal(anchorStatus.state, 'chain_engine_unavailable');
});

test('journal entries are signed transactions: the journal alone proves who sent what', async () => {
  const storage = createMemoryStorage();
  const rt = runtimeOn(storage);
  await anchorN(rt, 1);
  const { entries, fingerprint } = await rt.journal();
  const { Transaction } = await import('ethers');
  const attester = (await rt.deployments()).integrity.accounts.attester;
  for (const entry of entries) assert.equal(Transaction.from(entry.rawTx).from, attester, `entry ${entry.seq} is signed by the attester key`);
  assert.equal((await createJournal({ storage, scope: fingerprint }).load()).head.seq, 6);
});
