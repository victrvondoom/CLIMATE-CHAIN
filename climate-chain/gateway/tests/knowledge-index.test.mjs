import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  KnowledgeError,
  buildIndex,
  chunkFeatureCatalogue,
  chunkMarkdown,
  chunkRegistry,
  createKnowledgeService,
  excerpt,
  redact,
  searchIndex,
  tokenize,
} from '../knowledge-index.mjs';

const climateChainRoot = fileURLToPath(new URL('../..', import.meta.url));

test('tokenize drops stopwords, folds accents and reduces plurals', () => {
  assert.deepEqual(tokenize('The rivers of Café Ünited'), ['river', 'cafe', 'united']);
  assert.deepEqual(tokenize('a an the of'), []);
  assert.deepEqual(tokenize('process class'), ['process', 'class']);
});

test('chunkMarkdown keeps headings, start lines and ignores hashes inside code fences', () => {
  const markdown = [
    '# Title here',
    '',
    'Intro paragraph with a [link](https://example.test) and **bold** words.',
    '',
    '## Methane section',
    'Satellite plumes are verified before repair.',
    '```bash',
    '# this is a shell comment, not a heading',
    '```',
  ].join('\n');
  const chunks = chunkMarkdown('docs/sample.md', markdown);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].title, 'Title here');
  assert.equal(chunks[0].heading, 'Title here');
  assert.equal(chunks[0].startLine, 1);
  assert.match(chunks[0].text, /Intro paragraph with a link and bold words\./);
  assert.equal(chunks[1].heading, 'Methane section');
  assert.equal(chunks[1].startLine, 5);
  assert.match(chunks[1].text, /shell comment, not a heading/);
});

test('chunkMarkdown splits long paragraphs into citable passages', () => {
  const long = Array.from({ length: 200 }, (_, index) => `word${index}`).join(' ');
  const chunks = chunkMarkdown('docs/long.md', `## Long\n${long}`);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.text.length <= 900));
  assert.equal(new Set(chunks.map((chunk) => chunk.id)).size, chunks.length);
});

test('redact removes key-shaped and token-shaped strings before they are stored', () => {
  const privateKey = `0x${'ab12'.repeat(16)}`;
  const text = `key ${privateKey} token sk_live_abcdefghijklmnop api_key = supersecretvalue AKIAABCDEFGHIJKLMNOP`;
  const cleaned = redact(text);
  assert.ok(!cleaned.includes(privateKey));
  assert.ok(!cleaned.includes('sk_live_abcdefghijklmnop'));
  assert.ok(!cleaned.includes('supersecretvalue'));
  assert.ok(!cleaned.includes('AKIAABCDEFGHIJKLMNOP'));
  assert.match(cleaned, /api_key = \[redacted\]/);
});

test('BM25 ranks the chunk with the rarer matching term first and respects the limit', () => {
  const chunks = [
    { id: 'a', source: 'a.md', title: 'a', heading: 'Air', startLine: 1, text: 'Air quality monitor readings and air sensor notes.' },
    { id: 'b', source: 'b.md', title: 'b', heading: 'Methane', startLine: 1, text: 'Methane plume detection from satellite passes.' },
    { id: 'c', source: 'c.md', title: 'c', heading: 'Misc', startLine: 1, text: 'General notes about the monitor and the sensor.' },
  ];
  const index = buildIndex(chunks);
  const hits = searchIndex(index, 'methane plume', 5);
  assert.equal(hits[0].chunk.id, 'b');
  assert.equal(hits.length, 1);
  assert.deepEqual(searchIndex(index, 'the of and', 5), []);
  assert.equal(searchIndex(index, 'monitor sensor', 1).length, 1);
});

test('excerpt centers on the first matching term and marks truncation', () => {
  const text = `${'filler '.repeat(60)}the methane signal is here ${'tail '.repeat(60)}`;
  const snippet = excerpt(text, ['methan']);
  assert.ok(snippet.startsWith('…'));
  assert.ok(snippet.endsWith('…'));
  assert.ok(snippet.includes('methane'));
});

test('registry and feature catalogue chunks carry their project label and evidence', () => {
  const registryChunks = chunkRegistry('registry/projects.json', {
    tracks: [{ id: 'carbon', label: 'Carbon Markets & Emissions Transparency' }],
    projects: [{ id: 'plume', name: 'MethaneMend', descriptor: 'Methane detection', domain: 'Methane', stages: ['sense'], tracks: ['carbon'], features: ['Repair priority'], evidence: 'Field run', readiness: 'Ready', stack: ['Next.js'] }],
  });
  assert.equal(registryChunks.length, 1);
  assert.equal(registryChunks[0].heading, 'MethaneMend');
  assert.match(registryChunks[0].text, /Repair priority/);
  assert.match(registryChunks[0].text, /Carbon Markets & Emissions Transparency/);

  const catalogueChunks = chunkFeatureCatalogue('registry/features.json', {
    features: [{ name: 'Plume mapping', implementations: [{ projectName: 'MethaneMend', projectId: 'plume', kind: 'ml', status: 'implemented', summary: 'Maps plumes.', evidence: ['src/map.py:10'] }] }],
  });
  assert.equal(catalogueChunks[0].heading, 'Plume mapping (1 projects)');
  assert.match(catalogueChunks[0].text, /src\/map\.py:10/);
});

test('service validates the query and the limit before it searches', async () => {
  const service = createKnowledgeService({
    root: 'unused',
    load: async () => ({
      documents: [{ source: 'a.md', chunks: 1 }],
      chunks: [{ id: 'x', source: 'a.md', title: 'a', heading: 'Plume', startLine: 1, text: 'Plume verification steps for operators.' }],
      skipped: [],
    }),
  });
  await assert.rejects(service.search('a'), (error) => error instanceof KnowledgeError && error.code === 'query_too_short' && error.status === 400);
  await assert.rejects(service.search('x'.repeat(201)), (error) => error.code === 'query_too_long');
  await assert.rejects(service.search('plume', 0), (error) => error.code === 'invalid_limit');
  await assert.rejects(service.search('plume', 21), (error) => error.code === 'invalid_limit');
  const result = await service.search('plume verification', 3);
  assert.equal(result.answered, false);
  assert.equal(result.mode, 'lexical-bm25');
  assert.equal(result.results[0].source, 'a.md');
  assert.equal(result.index.chunks, 1);
});

test('the real workspace corpus is indexed from allowlisted roots and never leaks a raw key shape', async () => {
  const service = createKnowledgeService({ root: climateChainRoot });
  const sources = await service.sources();
  assert.ok(sources.totals.documents > 10, 'expected the root docs and project READMEs to be indexed');
  assert.ok(sources.documents.some((document) => document.source === 'registry/projects.json'));
  assert.ok(sources.documents.some((document) => document.source.startsWith('projects/')));
  assert.ok(sources.documents.every((document) => !document.source.includes('node_modules')));

  const result = await service.search('methane detection repair priority', 8);
  assert.ok(result.results.length > 0);
  for (const hit of result.results) {
    assert.ok(!/0x[a-fA-F0-9]{64}/.test(hit.snippet), 'snippet must not contain a 64-byte hex key');
    assert.ok(hit.snippet.length <= 282);
  }
});

test('underscores inside identifiers survive chunking and secrets written as KEY=value are redacted through the real pipeline', () => {
  const chunks = chunkMarkdown('docs/config.md', [
    '## Setup',
    'Evidence is recorded at stacked_verifier.py:20 and the verifier is stacked_verifier.',
    'Set STRIPE_SECRET_KEY=abcd1234efgh5678 and use sk_live_abcdefghijklmnop for billing.',
  ].join('\n'));
  const text = chunks.map((chunk) => chunk.text).join(' ');
  assert.match(text, /stacked_verifier\.py:20/);
  assert.ok(!text.includes('abcd1234efgh5678'));
  assert.ok(!text.includes('sk_live_abcdefghijklmnop'));
});

test('markdown headings keep trailing hash characters and a fence closes only on a matching marker', () => {
  const chunks = chunkMarkdown('docs/fence.md', [
    '## Learning C#',
    'Notes about C# tooling in the workspace.',
    '````',
    '```',
    '## not a heading inside a longer fence',
    '````',
    '## Real heading',
    'Body text after the fence.',
  ].join('\n'));
  assert.ok(chunks.some((chunk) => chunk.heading === 'Learning C#'));
  assert.ok(chunks.some((chunk) => chunk.heading === 'Real heading'));
  assert.ok(!chunks.some((chunk) => chunk.heading === 'not a heading inside a longer fence'));
});
