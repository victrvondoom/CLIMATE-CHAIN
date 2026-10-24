import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGatewayServer } from '../gateway.mjs';
import {
  PROJECTS_DIR,
  listProjectApps,
  loadRegistry,
  loadTracks,
  parseRegistry,
  resolveAppFile,
} from '../project-registry.mjs';

const projects = loadRegistry();
const byId = Object.fromEntries(projects.map((project) => [project.id, project]));
let tempDir;
let server;
let baseUrl;

// Raw requests keep dot segments and encoded separators exactly as sent,
// which the WHATWG URL parser of fetch would otherwise normalise away.
function rawRequest(method, requestPath) {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: url.hostname, port: url.port, method, path: requestPath }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'cc-registry-'));
  server = createGatewayServer({ projectRegistry: projects, missionStorePath: path.join(tempDir, 'missions.json') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(tempDir, { recursive: true, force: true });
});

test('registry lists every merged folder exactly once', () => {
  assert.equal(projects.length, 19, 'climate-chain plus the 18 project folders');
  const folders = projects.map((project) => project.folder).filter(Boolean);
  assert.equal(new Set(folders).size, folders.length, 'no folder is listed twice');
  assert.equal(folders.length, 18);
  for (const folder of folders) {
    assert.ok(existsSync(path.join(PROJECTS_DIR, folder)), `${folder} is merged under projects/`);
  }
});

test('registry rejects duplicate ids, unknown stages and nested folders', () => {
  const valid = { id: 'demo', folder: 'Demo-main', stages: ['sense'] };
  assert.throws(() => parseRegistry({ projects: [valid, valid] }), /duplicate project id demo/);
  assert.throws(() => parseRegistry({ projects: [{ ...valid, stages: ['launch'] }] }), /unknown stage/);
  assert.throws(() => parseRegistry({ projects: [{ ...valid, folder: '../escape' }] }), /single folder name/);
  assert.throws(() => parseRegistry({ projects: [{ ...valid, id: 'Bad Id' }] }), /invalid project id/);
  assert.throws(() => parseRegistry({ projects: [{ id: 'x', folder: null, stages: [], local: { root: '.' } }] }), /needs a folder and a root/);
});

test('registry track assignments use the four declared IEEE tracks', () => {
  const tracks = loadTracks();
  const trackIds = new Set(tracks.map((track) => track.id));
  assert.deepEqual(tracks.map((track) => track.label), [
    'Carbon Markets & Emissions Transparency',
    'Renewable Energy & Energy Trading',
    'Sustainable Supply Chains',
    'Climate Data & Environmental Monitoring',
  ]);
  for (const project of projects) {
    assert.ok(project.tracks.length > 0, `${project.id} has at least one track`);
    assert.equal(new Set(project.tracks).size, project.tracks.length, `${project.id} has no repeated track assignment`);
    assert.ok(project.tracks.every((track) => trackIds.has(track)), `${project.id} only uses declared tracks`);
  }
  for (const track of tracks) assert.ok(projects.some((project) => project.tracks.includes(track.id)), `${track.id} has mapped projects`);
  assert.throws(() => parseRegistry({ tracks: [{ id: 'valid-track', label: 'Track' }], projects: [{ id: 'demo', stages: ['sense'], tracks: ['missing-track'] }] }), /unknown or missing track/);
});

test('Clearsky maps estimated farmer payouts into the sustainable supply chain finance stage', () => {
  const clearsky = byId.clearsky;
  assert.ok(clearsky.stages.includes('finance'));
  assert.ok(clearsky.tracks.includes('sustainable-supply-chains'));
  assert.ok(clearsky.features.some((feature) => feature.toLowerCase().includes('estimated farmer payouts')));
  assert.match(clearsky.evidence, /estimates from demo prices/i);
});

test('standalone apps are available only when their entry page exists', () => {
  const apps = Object.fromEntries(listProjectApps(projects).map((app) => [app.id, app]));
  for (const id of ['aquaquest', 'flarewatch', 'plotlock', 'carbontwin', 'hourmatch', 'ecograph']) {
    assert.equal(apps[id].available, true, `${id} serves its index.html`);
    assert.equal(apps[id].path, `/apps/${id}/`);
  }
  assert.equal(apps.carbonlens.build, 'python scripts/build_dashboard.py', 'carbonlens declares its build step');
});

test('path resolution stays inside the declared app root', () => {
  const root = path.resolve(PROJECTS_DIR, byId.flarewatch.folder, 'web');
  assert.equal(resolveAppFile(projects, 'flarewatch', '').status, 200);
  assert.equal(resolveAppFile(projects, 'flarewatch', '').filePath, path.join(root, 'index.html'));
  assert.equal(resolveAppFile(projects, 'flarewatch', '../package.json').status, 403);
  assert.equal(resolveAppFile(projects, 'flarewatch', '%2e%2e%2f%2e%2e%2fgateway.mjs').status, 403);
  assert.equal(resolveAppFile(projects, 'flarewatch', 'missing.js').status, 404);
  assert.equal(resolveAppFile(projects, 'flarewatch', 'app.js%00.txt').status, 400);
  assert.equal(resolveAppFile(projects, 'junksnap', 'index.html').status, 404, 'projects without a local app are not served');
  assert.equal(resolveAppFile(projects, 'not-a-project', '').status, 404);
});

test('gateway serves merged apps from /apps with a trailing-slash redirect', async () => {
  const redirect = await rawRequest('GET', '/apps/aquaquest');
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.location, '/apps/aquaquest/');

  const page = await rawRequest('GET', '/apps/aquaquest/');
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  assert.match(page.body, /<title>AquaQuest/);

  const asset = await rawRequest('GET', '/apps/aquaquest/css/main.css');
  assert.equal(asset.status, 200);
  assert.match(asset.headers['content-type'], /text\/css/);
});

test('gateway refuses traversal from /apps, even with encoded dot segments', async () => {
  // WHATWG URL parsing collapses %2e%2e segments before routing, so this request
  // never reaches the app resolver. It falls through to the SPA shell, and the
  // gateway source must still not be returned.
  const dotted = await rawRequest('GET', '/apps/flarewatch/%2e%2e/%2e%2e/gateway/gateway.mjs');
  assert.match(dotted.headers['content-type'], /text\/html/);
  assert.ok(!dotted.body.includes('createGatewayServer'), 'gateway source is never returned');

  const literal = await rawRequest('GET', '/apps/flarewatch/..%2f..%2fpackage.json');
  assert.equal(literal.status, 403);
});

test('gateway rejects writes to project apps and the registry', async () => {
  assert.equal((await rawRequest('POST', '/apps/aquaquest/')).status, 405);
  assert.equal((await rawRequest('POST', '/api/v1/projects')).status, 405);
});

test('/api/v1/projects returns the registry and app availability', async () => {
  const response = await rawRequest('GET', '/api/v1/projects');
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.projects.length, 19);
  assert.equal(body.tracks.length, 4);
  assert.ok(body.projects.some((project) => project.id === 'gridproof' && project.tracks.includes('renewable-energy-energy-trading')));
  assert.ok(body.projects.some((project) => project.id === 'gridproof' && project.stages.includes('finance')));
  const aquaquest = body.apps.find((app) => app.id === 'aquaquest');
  assert.deepEqual(aquaquest, { id: 'aquaquest', path: '/apps/aquaquest/', available: true, build: null });
  assert.ok(body.asOf);
});
