import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const registry = JSON.parse(await readFile(new URL('../../registry/projects.json', import.meta.url), 'utf8'));
const catalogue = JSON.parse(await readFile(new URL('../../registry/features.json', import.meta.url), 'utf8'));
const normalize = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const featuresById = new Map(catalogue.features.map((feature) => [feature.id, feature]));

test('every registry project links to a catalogue project under the same id', () => {
  const byId = new Map(catalogue.projects.map((project) => [project.id, project]));
  for (const project of registry.projects) {
    const entry = byId.get(project.id);
    assert.ok(entry, `missing catalogue entry for ${project.id}`);
    assert.deepEqual(entry.tracks, project.tracks, `track mapping changed for ${project.id}`);
  }
  assert.equal(catalogue.projects.length, registry.projects.length);
});

test('canonical features have unique names and ids, with implementations retained', () => {
  const names = catalogue.features.map((feature) => normalize(feature.name));
  const ids = catalogue.features.map((feature) => feature.id);
  assert.equal(new Set(names).size, names.length, 'duplicate canonical feature name');
  assert.equal(new Set(ids).size, ids.length, 'duplicate canonical feature id');
  assert.equal(catalogue.totals.features, catalogue.features.length);
  assert.equal(catalogue.totals.implementations, catalogue.features.reduce((count, feature) => count + feature.implementations.length, 0));
  assert.ok(catalogue.totals.features >= 600, 'expected the full audited catalogue, not a partial one');
  for (const feature of catalogue.features) assert.ok(feature.implementations.length > 0, `feature has no implementations: ${feature.id}`);
});

test('every registry claim links to its project implementation and nothing is dropped', () => {
  for (const project of registry.projects) {
    const entry = catalogue.projects.find((item) => item.id === project.id);
    const registered = project.features ?? [];
    assert.equal(entry.registryFeatures.length, registered.length, `${project.id} registry feature count changed`);
    assert.equal(new Set(entry.featureIds).size, entry.featureIds.length, `duplicate feature reference in ${project.id}`);
    for (const text of registered) {
      const link = entry.registryFeatures.find((item) => item.text === text);
      assert.ok(link, `registry feature not carried through for ${project.id}: ${text}`);
      assert.ok(entry.featureIds.includes(link.matchedBy), `registry claim is not linked from ${project.id}: ${text}`);
      assert.ok(featuresById.get(link.matchedBy)?.implementations.some((item) => item.projectId === project.id), `missing implementation for ${project.id}: ${text}`);
    }
  }
});

test('shared capabilities merge under one feature while retaining each project proof', () => {
  const health = featuresById.get('health-endpoint');
  assert.equal(health.implementations.length, 5);
  assert.deepEqual([...new Set(health.implementations.map((item) => item.projectId))].sort(), ['carbonshield', 'climate-chain', 'climateproof', 'junksnap', 'rantai']);
  for (const id of ['telegram-bot-webhook', 'on-chain-anchor-workflow', 'evaluation-harness']) {
    assert.equal(featuresById.get(id).implementations.length, 2, `${id} implementations were not merged`);
  }
});

test('catalogue totals and registry-only features are labelled accurately', () => {
  const implementations = catalogue.features.flatMap((feature) => feature.implementations);
  assert.equal(catalogue.totals.registryOnly, catalogue.features.filter((feature) => feature.implementations.every((item) => item.source === 'registry')).length);
  for (const implementation of implementations.filter((item) => item.source === 'registry')) {
    assert.equal(implementation.status, 'unverified');
    assert.equal(implementation.kind, 'registry');
  }
});

test('the catalogue covers every project folder that the registry names', () => {
  const folders = registry.projects.map((project) => project.folder).filter(Boolean);
  for (const folder of folders) {
    const entry = catalogue.projects.find((item) => item.folder === folder);
    assert.ok(entry && entry.featureIds.length > 0, `no audited features for ${folder} (root ${root})`);
  }
});
