import test from 'node:test';
import assert from 'node:assert/strict';
import { createGatewayServer } from '../gateway.mjs';

async function withGateway(run) {
  const calls = [];
  const evidenceAnchorService = {
    async status() { return { available: true, chainId: 31337 }; },
    async list(limit) { return { anchors: [], limit }; },
    async verify(digest) { return { digest, anchored: false, proofVerified: false }; },
    async anchor(manifest) { calls.push(manifest); return { digest: manifest.integrity.digest, anchored: true, proofVerified: true, alreadyAnchored: false }; },
  };
  const gateway = createGatewayServer({
    missionEngine: {}, connectorRegistry: {}, projectRegistry: [], evidenceAnchorService,
  });
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${gateway.address().port}`, calls); }
  finally { await new Promise((resolve, reject) => gateway.close((error) => error ? reject(error) : resolve())); }
}

test('evidence anchor routes expose status, list, digest lookup, and local manifest writes', async () => {
  await withGateway(async (base, calls) => {
    assert.deepEqual(await (await fetch(`${base}/api/v1/evidence-anchors/status`)).json(), { available: true, chainId: 31337 });
    assert.deepEqual(await (await fetch(`${base}/api/v1/evidence-anchors?limit=10`)).json(), { anchors: [], limit: '10' });
    const digest = 'a'.repeat(64);
    assert.deepEqual(await (await fetch(`${base}/api/v1/evidence-anchors/${digest}`)).json(), { digest, anchored: false, proofVerified: false });

    const manifest = { id: 'cascade:site-17', integrity: { digest } };
    const response = await fetch(`${base}/api/v1/evidence-anchors`, {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:8080', 'content-type': 'application/json' },
      body: JSON.stringify({ manifest }),
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).proofVerified, true);
    assert.deepEqual(calls, [manifest]);
  });
});

test('evidence anchor writes reject non-local browser origins', async () => {
  await withGateway(async (base, calls) => {
    const response = await fetch(`${base}/api/v1/evidence-anchors`, {
      method: 'POST',
      headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
      body: JSON.stringify({ manifest: {} }),
    });
    assert.equal(response.status, 403);
    assert.equal(calls.length, 0);
  });
});
