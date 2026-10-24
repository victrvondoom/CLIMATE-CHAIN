// Builds one canonical, deduplicated feature catalogue from the per-project
// source audits and project registry. Project-specific implementations and
// evidence remain attached to their canonical feature.
// Usage: node scripts/build-feature-catalogue.mjs

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditDir = path.join(root, 'docs', 'feature-audit');
const registryPath = path.join(root, 'registry', 'projects.json');
const catalogPath = path.join(root, 'registry', 'features.json');
const markdownPath = path.join(root, 'docs', 'FEATURE_CATALOG.md');
const CORE_AUDIT_FOLDER = 'climate-chain-core';

const normalize = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const sameFeature = (a, b) => normalize(a) !== '' && normalize(a) === normalize(b);

// These repeated audit IDs describe the same cross-project capability. Their
// distinct project behavior is preserved in separate implementation records.
const canonicalAliases = new Map([
  ['api-health', 'health-endpoint'],
  ['health-endpoint', 'health-endpoint'],
  ['telegram-webhook', 'telegram-bot-webhook'],
  ['anchor-script', 'on-chain-anchor-workflow'],
  ['evaluation-harness', 'evaluation-harness'],
]);
const canonicalNames = new Map([
  ['health-endpoint', 'Service health endpoint'],
  ['telegram-bot-webhook', 'Telegram webhook intake'],
  ['on-chain-anchor-workflow', 'On-chain anchor workflow'],
  ['evaluation-harness', 'Evaluation harness'],
]);

async function loadAudits() {
  const files = (await readdir(auditDir)).filter((name) => name.endsWith('.json')).sort();
  const audits = [];
  for (const file of files) {
    const parsed = JSON.parse(await readFile(path.join(auditDir, file), 'utf8'));
    const entries = Array.isArray(parsed.projects) ? parsed.projects : [parsed];
    for (const entry of entries) audits.push({ ...entry, auditFile: `docs/feature-audit/${file}` });
  }
  return audits;
}

function slug(value) {
  return normalize(value).replace(/ /g, '-').slice(0, 72) || 'feature';
}

function featureKey(feature) {
  const alias = canonicalAliases.get(feature.localId);
  return alias ? `canonical:${alias}` : `name:${normalize(feature.name)}`;
}

function mergeFeatureRecords(records) {
  // Group exact normalized titles and explicitly mapped repeated capability IDs.
  const groups = new Map();
  for (const record of records) {
    const key = featureKey(record);
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }

  const usedIds = new Set();
  const features = [];
  const recordToCanonical = new Map();
  for (const [key, implementations] of groups) {
    const aliasId = key.startsWith('canonical:') ? key.slice('canonical:'.length) : null;
    const name = canonicalNames.get(aliasId) ?? implementations[0].name;
    const baseId = aliasId ?? slug(name);
    let id = baseId;
    if (usedIds.has(id)) id = `${slug(name)}-${slug(implementations[0].projectId)}`;
    for (let n = 2; usedIds.has(id); n += 1) id = `${baseId}-${n}`;
    usedIds.add(id);

    const sortedImplementations = implementations
      .slice()
      .sort((a, b) => a.projectName.localeCompare(b.projectName) || a.name.localeCompare(b.name));
    for (const implementation of implementations) recordToCanonical.set(implementation.recordKey, id);
    features.push({
      id,
      name,
      implementations: sortedImplementations.map(({ recordKey, ...implementation }) => implementation),
    });
  }
  return { features: features.sort((a, b) => a.name.localeCompare(b.name)), recordToCanonical };
}

const esc = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function markdown(catalog) {
  const { totals } = catalog;
  const lines = [
    '# Canonical feature catalogue',
    '',
    'Generated from `docs/feature-audit/` and `registry/projects.json` by `scripts/build-feature-catalogue.mjs`.',
    'Each capability appears once. When projects implement the same capability, their distinct behavior, status, and evidence are listed under that canonical feature. Project records link to feature IDs instead of repeating feature data. Registry claims without a code match remain explicitly unverified.',
    '',
    `Totals: ${totals.projects} projects, ${totals.features} canonical features, ${totals.implementations} project implementations, ${totals.mergedGroups} merged cross-project features, and ${totals.registryFeatures} registry claims (${totals.registryOnly} unverified).`,
    '',
    '| Canonical feature | Implementations and evidence |',
    '| --- | --- |',
  ];
  for (const feature of catalog.features) {
    const implementations = feature.implementations.map((item) => {
      const evidence = item.evidence.map((source) => `\`${esc(source)}\``).join(', ') || 'no code evidence';
      return `**${esc(item.projectName)}** (${esc(item.kind)}, ${esc(item.status)}): ${esc(item.summary)} Evidence: ${evidence}.`;
    }).join('<br>');
    lines.push(`| ${esc(feature.name)} | ${implementations} |`);
  }
  lines.push('', '## Project index', '', '| Project | IEEE tracks | Canonical features | Registry claims |', '| --- | --- | ---: | ---: |');
  for (const project of catalog.projects) {
    const tracks = project.tracks.map((id) => catalog.tracks.find((track) => track.id === id)?.label ?? id).join('<br>');
    lines.push(`| ${esc(project.name)} | ${tracks || '—'} | ${project.featureIds.length} | ${project.registryFeatures.length} |`);
  }
  return lines.join('\n');
}

const registry = JSON.parse(await readFile(registryPath, 'utf8'));
const audits = await loadAudits();
const byFolder = new Map(audits.map((audit) => [audit.folder, audit]));
const claimed = new Set();
const problems = [];
const rawProjects = [];
const records = [];
let nextRecord = 0;

for (const project of registry.projects) {
  const folder = project.folder ?? (project.id === 'climate-chain' ? CORE_AUDIT_FOLDER : null);
  const audit = folder ? byFolder.get(folder) : null;
  if (!audit) problems.push(`no audit record for ${project.id} (${folder ?? 'no folder'})`);
  if (audit) claimed.add(audit.folder);

  const projectRecords = [];
  for (const feature of audit?.features ?? []) {
    const record = {
      recordKey: `record-${nextRecord++}`,
      projectId: project.id,
      projectName: project.name,
      localId: feature.id,
      name: feature.name,
      kind: feature.kind,
      status: feature.status,
      summary: feature.summary,
      evidence: feature.evidence ?? [],
      registryMatch: feature.registry_match ?? null,
      source: 'audit',
    };
    records.push(record);
    projectRecords.push(record);
  }

  const registryFeatures = [];
  for (const text of project.features ?? []) {
    const match = projectRecords.find((feature) => sameFeature(feature.registryMatch, text));
    if (match) {
      registryFeatures.push({ text, recordKey: match.recordKey });
      continue;
    }
    const record = {
      recordKey: `record-${nextRecord++}`,
      projectId: project.id,
      projectName: project.name,
      localId: `registry-${slug(text)}`,
      name: text,
      kind: 'registry',
      status: 'unverified',
      summary: 'Listed in the project registry. The code audit did not map this claim to a specific feature, so check it before relying on it.',
      evidence: [],
      registryMatch: text,
      source: 'registry',
    };
    records.push(record);
    projectRecords.push(record);
    registryFeatures.push({ text, recordKey: record.recordKey });
  }
  rawProjects.push({
    id: project.id,
    name: project.name,
    folder: project.folder ?? null,
    tracks: project.tracks ?? [],
    stages: project.stages ?? [],
    auditFile: audit?.auditFile ?? null,
    projectRecords,
    registryFeatures,
    registryNotFoundInCode: audit?.registry_not_found_in_code ?? [],
    limits: audit?.limits ?? [],
  });
}

for (const audit of audits) {
  if (!claimed.has(audit.folder)) problems.push(`audit record ${audit.folder} (${audit.auditFile}) does not match any registry project`);
}

const { features, recordToCanonical } = mergeFeatureRecords(records);
const featureById = new Map(features.map((feature) => [feature.id, feature]));
const projects = rawProjects.map((project) => {
  const featureIds = [...new Set(project.projectRecords.map((record) => recordToCanonical.get(record.recordKey)))];
  const registryFeatures = project.registryFeatures.map(({ text, recordKey }) => ({
    text,
    matchedBy: recordToCanonical.get(recordKey),
  }));
  for (const link of registryFeatures) {
    const canonical = featureById.get(link.matchedBy);
    if (!canonical?.implementations.some((implementation) => implementation.projectId === project.id)) {
      problems.push(`registry feature lost: ${project.id}: ${link.text}`);
    }
  }
  return {
    id: project.id,
    name: project.name,
    folder: project.folder,
    tracks: project.tracks,
    stages: project.stages,
    auditFile: project.auditFile,
    featureIds,
    registryFeatures,
    registryNotFoundInCode: project.registryNotFoundInCode,
    limits: project.limits,
  };
});

const catalog = {
  $comment: 'Generated by scripts/build-feature-catalogue.mjs. Canonical features appear once; project-specific implementations and evidence are nested under each canonical feature.',
  totals: {
    projects: projects.length,
    features: features.length,
    implementations: records.length,
    mergedGroups: features.filter((feature) => feature.implementations.length > 1).length,
    registryFeatures: projects.reduce((count, project) => count + project.registryFeatures.length, 0),
    registryOnly: features.filter((feature) => feature.implementations.every((item) => item.source === 'registry')).length,
  },
  tracks: registry.tracks ?? [],
  features,
  projects,
};

if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else {
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, `${markdown(catalog)}\n`, 'utf8');
  console.log(`features=${catalog.totals.features} implementations=${catalog.totals.implementations} mergedGroups=${catalog.totals.mergedGroups} registryFeatures=${catalog.totals.registryFeatures} registryOnly=${catalog.totals.registryOnly} projects=${catalog.totals.projects}`);
}
