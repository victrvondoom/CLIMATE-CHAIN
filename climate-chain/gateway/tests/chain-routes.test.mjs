// HTTP behaviour of the in-process chain: the read-only RPC and journal routes, and who may write.
// Writes from a non-loopback address are exercised for real by connecting to this machine's own LAN address.
import test from 'node:test';
import assert from 'node:assert/strict';
import { networkInterfaces } from 'node:os';
import { createGatewayServer, rateKey } from '../gateway.mjs';
import { createChainRuntime } from '../chain-runtime.mjs';
import { createMemoryStorage } from '../storage.mjs';
import { createIntegrityService } from '../integrity-service.mjs';
import { createEvidenceAnchorService } from '../evidence-anchor.mjs';
import { createAirQualitySource } from '../integrity-sources.mjs';

const SEED = 'route-test-seed-0123456789abcdef-0123456789abcdef';
const lanAddress = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
const offline = createAirQualitySource({ fetchImpl: async () => { throw new TypeError('network disabled for this test'); }, sleep: async () => {} });

async function start(env = {}) {
  const chain = createChainRuntime({ storage: createMemoryStorage(), seed: { source: 'test', seed: SEED }, env: {}, minRefreshMs: 0 });
  const server = createGatewayServer({
    chainRuntime: chain,
    integrityService: createIntegrityService({ chain, source: offline }),
    evidenceAnchorService: createEvidenceAnchorService({ chain }),
  });
  await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve));
  const port = server.address().port;
  const previous = {};
  for (const [key, value] of Object.entries(env)) { previous[key] = process.env[key]; process.env[key] = value; }
  return {
    chain,
    local: `http://127.0.0.1:${port}`,
    lan: lanAddress ? `http://${lanAddress}:${port}` : null,
    async stop() {
      for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
const rpc = (base, method, params = []) => fetch(`${base}/api/v1/chain/rpc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 7, method, params }) }).then((r) => r.json());
const post = (base, path, body = {}, headers = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('the read-only RPC lets a browser check the chain, and nothing else', async () => {
  const app = await start();
  try {
    assert.equal((await rpc(app.local, 'eth_chainId')).result, '0x7a69');
    const block = await rpc(app.local, 'eth_getBlockByNumber', ['0x0', false]);
    assert.match(block.result.hash, /^0x[0-9a-f]{64}$/);
    const { integrity } = await app.chain.deployments();
    const code = await rpc(app.local, 'eth_getCode', [integrity.evidenceRegistry.address, 'latest']);
    assert.ok(code.result.length > 100, 'the registry contract is deployed');
    for (const method of ['eth_sendRawTransaction', 'evm_mine', 'hardhat_setBalance', 'eth_sendTransaction']) {
      const out = await rpc(app.local, method, []);
      assert.equal(out.error?.code, -32601, method);
      assert.equal(out.result, undefined);
    }
    assert.equal((await rpc(app.local, 'eth_chainId')).id, 7, 'the request id is echoed');
    const bad = await fetch(`${app.local}/api/v1/chain/rpc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"nope":1}' });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, -32600);
    const oversized = await fetch(`${app.local}/api/v1/chain/rpc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'eth_call', params: ['x'.repeat(25_000)] }) });
    assert.equal(oversized.status, 400);
    assert.equal((await fetch(`${app.local}/api/v1/chain/rpc`)).status, 405);
  } finally { await app.stop(); }
});

test('status and journal routes describe the chain and publish a verifiable transaction log', async () => {
  const app = await start();
  try {
    const status = await (await fetch(`${app.local}/api/v1/chain/status`)).json();
    assert.equal(status.booted, true);
    assert.equal(status.mode, 'in-process');
    assert.equal(status.journal.entries, 5);
    assert.equal(status.persistence, 'memory');
    const journal = await (await fetch(`${app.local}/api/v1/chain/journal`)).json();
    assert.equal(journal.entries.length, 5);
    assert.equal(journal.head.seq, 5);
    assert.equal(journal.chainId, 31337);
    assert.match(journal.entries[0].rawTx, /^0x/);
  } finally { await app.stop(); }
});

test('the integrity lab and evidence anchoring work over HTTP on the in-process chain', async () => {
  const app = await start();
  try {
    const status = await (await fetch(`${app.local}/api/v1/integrity/status`)).json();
    assert.equal(status.ledgerMode, 'LOCAL_EVM', status.problem?.message);
    const built = await (await post(app.local, '/api/v1/integrity/evidence', { siteId: 'new-delhi', analyte: 'pm2_5' })).json();
    const anchored = await post(app.local, `/api/v1/integrity/evidence/${built.evidenceId}/anchor`);
    assert.equal(anchored.status, 201);
    const proof = await anchored.json();
    assert.equal(proof.receiptStatus, 1);
    // The browser's independent check reads the same chain through the public RPC.
    const receipt = await rpc(app.local, 'eth_getTransactionReceipt', [proof.transactionHash]);
    assert.equal(receipt.result.status, '0x1');
    const anchorStatus = await (await fetch(`${app.local}/api/v1/evidence-anchors/status`)).json();
    assert.equal(anchorStatus.available, true);
    assert.equal(anchorStatus.chainMode, 'in-process');
  } finally { await app.stop(); }
});

test('without a public-write deployment, a request from another address cannot write', { skip: !lanAddress && 'no LAN address to connect from' }, async () => {
  const app = await start();
  try {
    const built = await (await post(app.local, '/api/v1/integrity/evidence', { siteId: 'new-delhi', analyte: 'pm2_5' })).json();
    const denied = await post(app.lan, `/api/v1/integrity/evidence/${built.evidenceId}/anchor`);
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error.code, 'local_access_required');
    const deniedAnchor = await post(app.lan, '/api/v1/evidence-anchors', { manifest: {} });
    assert.equal(deniedAnchor.status, 403);
  } finally { await app.stop(); }
});

test('a public deployment lets visitors write from its own pages, refuses other sites, and rate-limits', { skip: !lanAddress && 'no LAN address to connect from' }, async () => {
  const app = await start({ CLIMATE_CHAIN_PUBLIC_WRITES: '1' });
  try {
    const built = await (await post(app.local, '/api/v1/integrity/evidence', { siteId: 'new-delhi', analyte: 'pm2_5' })).json();
    const url = `/api/v1/integrity/evidence/${built.evidenceId}/anchor`;

    const foreign = await post(app.lan, url, {}, { origin: 'https://evil.example' });
    assert.equal(foreign.status, 403);
    assert.equal((await foreign.json()).error.code, 'cross_origin_write_refused');

    const own = await post(app.lan, url, {}, { origin: app.lan });
    assert.equal(own.status, 201, JSON.stringify(await own.clone().json()));
    assert.equal((await own.json()).receiptStatus, 1);

    let limited = null;
    for (let i = 0; i < 60 && !limited; i += 1) {
      const response = await post(app.lan, '/api/v1/integrity/firewall/evaluate', {}, { origin: app.lan });
      if (response.status === 429) limited = response;
    }
    assert.ok(limited, 'a flood of writes is eventually refused');
    assert.ok(Number(limited.headers.get('retry-after')) >= 1);
    assert.equal((await limited.json()).error.code, 'rate_limited');
    assert.notEqual((await post(app.local, url, {}, {})).status, 429, 'the local operator is never rate-limited');
  } finally { await app.stop(); }
});

test('rate limits key IPv6 callers by /64 so rotating addresses inside one subscriber does not reset the quota', () => {
  assert.equal(rateKey('203.0.113.9'), '203.0.113.9');
  assert.equal(rateKey('::ffff:203.0.113.9'), '203.0.113.9');
  const key = rateKey('2001:db8:abcd:12::1');
  assert.equal(key, '2001:db8:abcd:12::/64');
  assert.equal(rateKey('2001:db8:abcd:12:ffff:ffff:ffff:ffff'), key);
  assert.equal(rateKey('2001:DB8:ABCD:12:0:0:0:7'), key);
  assert.notEqual(rateKey('2001:db8:abcd:13::1'), key);
  assert.equal(rateKey('::1'), rateKey('0:0:0:0:0:0:0:1'));
  assert.equal(rateKey(undefined), 'unknown');
});

test('on Vercel no caller is treated as local: an address that looks like loopback still faces the public rules', async () => {
  const app = await start({ VERCEL: '1' });
  try {
    const foreign = await post(app.local, '/api/v1/integrity/firewall/evaluate', {}, { origin: 'https://evil.example' });
    assert.equal(foreign.status, 403, 'cross-origin writes are refused even from a loopback socket');
    assert.equal((await foreign.json()).error.code, 'cross_origin_write_refused');
    let limited = false;
    for (let i = 0; i < 60 && !limited; i += 1) limited = (await post(app.local, '/api/v1/integrity/firewall/evaluate', {})).status === 429;
    assert.equal(limited, true, 'a loopback-looking caller is rate-limited like anyone else');
  } finally { await app.stop(); }
});

test('a gateway without an in-process chain says so instead of pretending', async () => {
  const server = createGatewayServer({ chainRuntime: null, integrityService: createIntegrityService({ source: offline, rpcUrl: 'http://127.0.0.1:1', chain: null }) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/chain/rpc`, { method: 'POST', body: '{}' });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'in_process_chain_disabled');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
