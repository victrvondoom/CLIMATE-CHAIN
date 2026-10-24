import test from 'node:test';
import assert from 'node:assert/strict';
import { createGatewayServer } from '../gateway.mjs';
import { KnowledgeError } from '../knowledge-index.mjs';

async function withGateway(knowledgeService, run) {
  const gateway = createGatewayServer({ missionEngine: {}, connectorRegistry: {}, projectRegistry: [], knowledgeService });
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${gateway.address().port}`); }
  finally { await new Promise((resolve, reject) => gateway.close((error) => error ? reject(error) : resolve())); }
}

test('knowledge search route passes the query and limit through and returns ranked excerpts', async () => {
  const calls = [];
  const service = {
    async search(query, limit) {
      calls.push({ query, limit });
      return { query, mode: 'lexical-bm25', answered: false, results: [{ id: 'abc', source: 'registry/projects.json', snippet: 'Methane detection' }] };
    },
    async sources() { return { documents: [], skipped: [], totals: { documents: 0, chunks: 0 } }; },
  };
  await withGateway(service, async (base) => {
    const response = await fetch(`${base}/api/v1/knowledge/search?q=methane&limit=3`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.answered, false);
    assert.equal(body.results[0].source, 'registry/projects.json');
    assert.deepEqual(calls, [{ query: 'methane', limit: '3' }]);
    const defaults = await fetch(`${base}/api/v1/knowledge/search?q=methane`);
    assert.equal(defaults.status, 200);
    assert.equal(calls[1].limit, undefined);
  });
});

test('knowledge search route maps validation errors to 400 and rejects writes', async () => {
  const service = {
    async search(query) { if (query.length < 2) throw new KnowledgeError('query_too_short', 'q must be at least 2 characters.'); return { results: [] }; },
    async sources() { return { documents: [] }; },
  };
  await withGateway(service, async (base) => {
    const short = await fetch(`${base}/api/v1/knowledge/search?q=a`);
    assert.equal(short.status, 400);
    assert.equal((await short.json()).error.code, 'query_too_short');
    const write = await fetch(`${base}/api/v1/knowledge/search?q=methane`, { method: 'POST' });
    assert.equal(write.status, 405);
    const sources = await fetch(`${base}/api/v1/knowledge/sources`);
    assert.equal(sources.status, 200);
    assert.deepEqual(await sources.json(), { documents: [] });
  });
});
test('an unexpected search failure returns a generic 503 without exposing the underlying message', async () => {
  const service = {
    async search() { throw new Error('EPERM: operation not permitted, stat C:\\Users\\secret\\file.md'); },
    async sources() { return { documents: [] }; },
  };
  await withGateway(service, async (base) => {
    const response = await fetch(`${base}/api/v1/knowledge/search?q=methane`);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, 'knowledge_unavailable');
    assert.ok(!JSON.stringify(body).includes('C:\\Users'));
  });
});