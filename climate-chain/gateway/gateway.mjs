// Climate Chain unified gateway.
// One entry point for the merged product:
//   /api/services            health of the four upstreams
//   /api/junksnap/*          -> JunkSnap API          (waste)
//   /api/clearsky/*          -> clearsky API          (stubble fire)
//   /api/teesri/*            -> Teesri Shikayat API   (water)
//   /api/vayu/*              -> Vayu API              (air)
//   /api/unified/overview    normalized fan-out + cross-project feed
//   /api/v1/projects         registry of every merged project + app availability
//   /api/v1/knowledge/*      read-only workspace search: ranked, redacted excerpts with sources
//   /apps/<id>/...           standalone project apps from ../projects (same origin)
// It also serves the built frontend from ../frontend/dist.
// Zero dependencies: a supported Node release with global fetch, AbortController, and system CA support.

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SERVICES,
  fetchUpstream,
  normalizeWaste,
  normalizeFire,
  normalizeWater,
  normalizeAir,
  pm25Severity,
  buildCrossFeed,
  severityRank,
} from './services.mjs';
import { mockWaste, mockFire, mockWater, mockAir } from './mocks.mjs';
import {
  assessCascade,
  DEFAULT_CASCADE_THRESHOLDS,
  parseThreshold,
  validPoint,
} from './cascade.mjs';
import { handleAgentMemoryRequest, verifyMemoryIntegrity } from './agent-memory.mjs';
import { createMissionEngine, MissionEngineError } from './mission-engine.mjs';
import { attachFreshMissionMemory, MissionMemoryReadinessError } from './mission-readiness.mjs';
import { readWorkerStatus } from './worker-status.mjs';
import { createConnectorRegistry, ConnectorError, VAYU_CITY_PRESETS } from './connectors/registry.mjs';
import { appContentType, listProjectApps, loadRegistry, loadTracks, resolveAppFile } from './project-registry.mjs';
import { createPlaceService, PlaceServiceError, validatePlaceCoordinates } from './place-environment.mjs';
import { createFacilityService } from './place-facilities.mjs';
import { createKnowledgeService, KnowledgeError } from './knowledge-index.mjs';
import { createEvidenceAnchorService, EvidenceAnchorError, isValidEvidenceDigest } from './evidence-anchor.mjs';
import { createIntegrityService } from './integrity-service.mjs';
import {
  getDatasetsCatalog,
  getTimelineObservations,
  generateObservationEvidenceManifest,
  getLiveTelemetryTick,
  POLICY_EVENTS
} from './historical-service.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DIST_DIR = join(__dirname, '..', 'frontend', 'dist');
const PORT = Number(process.env.PORT || 8080);
const JODHPUR_BBOX = process.env.JUNKSNAP_BBOX || '72.85,26.15,73.15,26.45';
const AIR_PRESETS = VAYU_CITY_PRESETS;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(text);
}

function sendLocalJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

async function withFallback(name, load, mock) {
  try {
    const r = await load();
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    return { mode: 'live', data: r.body };
  } catch (err) {
    console.warn(`[gateway] ${name} upstream failed (${err.message}); serving labelled mock`);
    return { mode: 'mock', data: mock() };
  }
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleServices(registry) {
  const entries = await Promise.all(registry.names().map(async (name) => {
    const health = await registry.health(name);
    return { ...health, ...registry.getStatus(name), status: health.status, checkedAt: health.checkedAt, http: health.http ?? 0 };
  }));
  return { services: entries, asOf: new Date().toISOString() };
}

function handleIntegrationEvidence(registry) {
  const upstreams = registry.listConfig().map((item) => ({
    name: item.name,
    label: item.label,
    domain: item.domain,
    configured: item.configured,
    endpoint: item.endpoint,
    healthPath: item.healthPath,
    operations: item.operations,
    apiKeyRequired: false,
    authentication: item.auth,
    evidence: 'The shared Climate Chain adapter uses read-only GET requests. Connector health and per-request source evidence are reported separately.',
  }));
  const openAqConfigured = Boolean(String(process.env.OPENAQ_API_KEY || '').trim());
  return {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    upstreams,
    credentials: [{
      provider: 'OpenAQ v3',
      variable: 'OPENAQ_API_KEY',
      required: false,
      configured: openAqConfigured,
      state: openAqConfigured ? 'configured_not_connected' : 'not_configured_not_connected',
      validated: false,
      usedByGateway: false,
      evidence: 'The central gateway has no OpenAQ adapter. A present value is not used or validated by this application.',
      secretValueReturned: false,
    }],
    mcp: {
      name: 'climate_chain_live_data',
      transport: 'stdio',
      available: true,
      configuration: 'Included in the generated MCP setup alongside the engineering-memory server.',
      gateway: `http://127.0.0.1:${Number(process.env.PORT || 8080)}`,
      tools: ['climate_chain_get_live_overview', 'climate_chain_check_public_sources', 'climate_chain_fetch_cascade_evidence'],
      sourceApiKeysRequired: false,
      access: 'Local read-only MCP process; it calls the loopback gateway and does not expose a public network listener.',
    },
    scope: 'This inventory covers Climate Chain shared connectors and its optional OpenAQ key only. Specialist projects keep their own credentials; the shared gateway does not read or forward them.',
  };
}

async function handleProxy(req, res, name, subPath) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    req.resume();
    return sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'The shared climate gateway exposes source data as read-only.' } });
  }
  const init = { method: req.method, headers: {} };
  const ct = req.headers['content-type'];
  if (ct) init.headers['content-type'] = ct;
  const auth = req.headers['authorization'];
  if (auth) init.headers.authorization = auth;
  try {
    const r = await fetchUpstream(name, '/' + subPath, init);
    if (name === 'teesri' && subPath.split('?')[0] === 'api/state') {
      if (!r.ok) return sendJson(res, r.status, { error: { code: 'source_request_failed', source: 'Teesri Shikayat', http: r.status } });
      if (!r.body || typeof r.body !== 'object' || !Array.isArray(r.body.homes)) {
        return sendJson(res, 502, { error: { code: 'source_contract_invalid', source: 'Teesri Shikayat' } });
      }
      const summary = normalizeWater(r.body);
      return sendJson(res, r.status, {
        source: 'Teesri Shikayat',
        mode: 'source_snapshot',
        capturedAt: new Date().toISOString(),
        reported: summary.reported,
        warned: summary.warned,
        inRing: summary.inRing,
        total: summary.total,
        statusCounts: summary.statusCounts,
        caseOpen: summary.reported >= 3,
        privacy: 'Household identifiers, message content and coordinates are omitted from the central response.',
      });
    }
    const isJson = typeof r.body !== 'string';
    res.writeHead(r.status, {
      'content-type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
      'x-climate-chain-source': SERVICES[name].label,
    });
    res.end(isJson ? JSON.stringify(r.body) : String(r.body));
  } catch (err) {
    sendJson(res, 502, { error: { code: 'upstream_unreachable', message: `${name}: ${err.message}` } });
  }
}

async function handleOverview(url, registry) {
  const cityKey = url.searchParams.get('city') || 'delhi';
  const city = AIR_PRESETS[cityKey] || AIR_PRESETS.delhi;

  const readWithFallback = async (name, operation, query, mock) => {
    try {
      const result = await registry.read(name, operation, { query });
      return { mode: 'live', data: result.data, provenance: result.provenance, error: null };
    } catch (error) {
      const code = error instanceof ConnectorError ? error.code : 'connector_error';
      console.warn(`[gateway] ${name} connector failed (${code}); serving labelled mock`);
      return { mode: 'mock', data: mock(), provenance: null, connection: code === 'schema_invalid' || code === 'invalid_json' ? 'contract_invalid' : 'disconnected', error: { code, message: error instanceof Error ? error.message : String(error) } };
    }
  };
  const [wasteR, fireR, waterR, airR] = await Promise.all([
    readWithFallback('junksnap', 'sites', { bbox: JODHPUR_BBOX }, mockWaste),
    readWithFallback('clearsky', 'stats', {}, mockFire),
    readWithFallback('teesri', 'state', {}, mockWater),
    readWithFallback('vayu', 'today', { lat: city.lat, lng: city.lng }, mockAir),
  ]);

  const waste = normalizeWaste(wasteR.data);
  const fire = normalizeFire(fireR.data);
  const water = normalizeWater(waterR.data);
  const air = normalizeAir(airR.data);
  const feed = buildCrossFeed({ waste, fire, water, air }, { cityName: city.name }).sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  return {
    asOf: new Date().toISOString(),
    city,
    sources: {
      junksnap: { mode: wasteR.mode, label: SERVICES.junksnap.label, connection: wasteR.provenance?.connection ?? wasteR.connection ?? 'disconnected', provenance: wasteR.provenance, error: wasteR.error },
      clearsky: { mode: fireR.mode, label: SERVICES.clearsky.label, connection: fireR.provenance?.connection ?? fireR.connection ?? 'disconnected', provenance: fireR.provenance, error: fireR.error },
      teesri: { mode: waterR.mode, label: SERVICES.teesri.label, connection: waterR.provenance?.connection ?? waterR.connection ?? 'disconnected', provenance: waterR.provenance, error: waterR.error },
      vayu: { mode: airR.mode, label: SERVICES.vayu.label, connection: airR.provenance?.connection ?? airR.connection ?? 'disconnected', provenance: airR.provenance, error: airR.error },
    },
    waste: { sites: waste, open: waste.filter((w) => w.status === 'open').length, verified: waste.filter((w) => w.verification === 'verified').length },
    fire,
    water: { ...water, caseOpen: water.reported >= 3 },
    air: { ...air, severity: pm25Severity(air.pm25Now) },
    feed,
  };
}

async function handleCascade(url, res) {
  const siteId = url.searchParams.get('site');
  if (!siteId || !/^[A-Za-z0-9_-]{1,80}$/.test(siteId)) {
    return sendJson(res, 400, { error: { code: 'invalid_site', message: 'Provide a valid JunkSnap site id.' } });
  }
  const radiusKm = parseThreshold(url.searchParams.get('radiusKm'), DEFAULT_CASCADE_THRESHOLDS.radiusKm, 50);
  const timeWindowHours = parseThreshold(url.searchParams.get('timeWindowHours'), DEFAULT_CASCADE_THRESHOLDS.timeWindowHours, 168);
  if (radiusKm == null || timeWindowHours == null) {
    return sendJson(res, 400, { error: { code: 'invalid_threshold', message: 'radiusKm and timeWindowHours must be greater than 0 and no more than 50 km or 168 hours.' } });
  }

  if (url.searchParams.get('demo') === '1') {
    const capturedAt = new Date().toISOString();
    const demoSite = normalizeWaste(mockWaste()).find((candidate) => candidate.id === siteId);
    if (!demoSite) return sendJson(res, 404, { error: { code: 'demo_site_not_found' } });
    const site = {
      ...demoSite,
      lastReportedAt: new Date(Date.parse(capturedAt) - 30 * 60_000).toISOString(),
    };
    const air = {
      place: { name: 'Simulated query point', lat: site.lat, lng: site.lng },
      pm25Now: 58,
      provenance: {
        mode: 'model',
        source: 'test',
        stationId: null,
        stationName: 'Simulated monitor fixture',
        distanceKm: 1.2,
        observedAt: new Date(Date.parse(capturedAt) - 15 * 60_000).toISOString(),
        fetchedAt: capturedAt,
        asOf: capturedAt,
        ageMinutes: 15,
        simulated: true,
      },
    };
    const result = assessCascade({
      site,
      air,
      wasteMode: 'mock',
      airUpstreamMode: 'mock',
      thresholds: { radiusKm, timeWindowHours },
      capturedAt,
    });
    return sendJson(res, 200, { ...result, sources: { junksnap: 'mock', vayu: 'mock' }, demo: true });
  }

  let wasteResponse;
  try {
    wasteResponse = await fetchUpstream('junksnap', `/sites?bbox=${JODHPUR_BBOX}`);
  } catch {
    return sendJson(res, 502, { error: { code: 'source_unavailable', source: 'JunkSnap' } });
  }
  if (!wasteResponse.ok) return sendJson(res, 502, { error: { code: 'source_unavailable', source: 'JunkSnap', http: wasteResponse.status } });

  let sites;
  try {
    sites = normalizeWaste(wasteResponse.body);
  } catch {
    return sendJson(res, 502, { error: { code: 'source_contract_invalid', source: 'JunkSnap' } });
  }
  const site = sites.find((candidate) => candidate.id === siteId);
  if (!site) return sendJson(res, 404, { error: { code: 'site_not_found', source: 'JunkSnap' } });

  const thresholds = { radiusKm, timeWindowHours };
  const capturedAt = new Date().toISOString();
  if (site.status !== 'open' || !validPoint(site)) {
    const result = assessCascade({
      site,
      air: null,
      wasteMode: 'live',
      airUpstreamMode: 'not_requested',
      sourceUrls: { waste: wasteResponse.url },
      thresholds,
      capturedAt,
    });
    return sendJson(res, 200, { ...result, sources: { junksnap: 'live', vayu: 'not_requested' } });
  }

  const airPath = `/v1/today?lat=${encodeURIComponent(site.lat)}&lng=${encodeURIComponent(site.lng)}`;
  let airResponse;
  try {
    airResponse = await fetchUpstream('vayu', airPath);
  } catch {
    return sendJson(res, 502, { error: { code: 'source_unavailable', source: 'The Vayu Project' } });
  }
  if (!airResponse.ok) return sendJson(res, 502, { error: { code: 'source_unavailable', source: 'The Vayu Project', http: airResponse.status } });

  let air;
  try {
    air = normalizeAir(airResponse.body);
  } catch {
    return sendJson(res, 502, { error: { code: 'source_contract_invalid', source: 'The Vayu Project' } });
  }
  const result = assessCascade({
    site,
    air,
    wasteMode: 'live',
    airUpstreamMode: 'live',
    sourceUrls: { waste: wasteResponse.url, air: airResponse.url },
    thresholds,
    capturedAt,
  });
  return sendJson(res, 200, { ...result, sources: { junksnap: 'live', vayu: 'live' } });
}

async function handleEvidenceAnchors(req, res, url, service) {
  const base = '/api/v1/evidence-anchors';
  if (url.pathname === `${base}/status` && req.method === 'GET') {
    return sendLocalJson(res, 200, await service.status());
  }
  if (url.pathname === base && req.method === 'GET') {
    try {
      return sendLocalJson(res, 200, await service.list(url.searchParams.get('limit')));
    } catch (error) {
      const status = error instanceof EvidenceAnchorError ? error.status : 502;
      return sendLocalJson(res, status, { error: { code: error?.code || 'anchor_list_failed', message: error instanceof Error ? error.message : 'On-chain evidence could not be loaded.' } });
    }
  }
  if (url.pathname === base && req.method === 'POST') {
    if (!isLoopbackAddress(req.socket.remoteAddress) || !isLocalOrigin(req.headers.origin)) {
      req.resume();
      return sendLocalJson(res, 403, { error: { code: 'local_access_required', message: 'Evidence anchoring is available only from the local Climate Chain app.' } });
    }
    try {
      const body = await readJsonBody(req, 150_000);
      const result = await service.anchor(body.manifest);
      return sendLocalJson(res, result.alreadyAnchored ? 200 : 201, result);
    } catch (error) {
      const status = error instanceof EvidenceAnchorError ? error.status
        : error?.code === 'REQUEST_TOO_LARGE' ? 413
          : error?.code === 'INVALID_JSON' ? 400 : 502;
      return sendLocalJson(res, status, {
        error: {
          code: error?.code || 'anchor_failed',
          message: error instanceof Error ? error.message : 'Evidence could not be anchored.',
        },
      });
    }
  }
  const digestPath = url.pathname.startsWith(`${base}/`) ? url.pathname.slice(base.length + 1) : '';
  if (digestPath && req.method === 'GET') {
    if (!isValidEvidenceDigest(digestPath)) return sendLocalJson(res, 400, { error: { code: 'invalid_digest', message: 'Digest must be 64 hexadecimal SHA-256 characters.' } });
    try {
      return sendLocalJson(res, 200, await service.verify(digestPath));
    } catch (error) {
      const status = error instanceof EvidenceAnchorError ? error.status : 502;
      return sendLocalJson(res, status, { error: { code: error?.code || 'proof_lookup_failed', message: error instanceof Error ? error.message : 'On-chain proof could not be checked.' } });
    }
  }
  req.resume();
  return sendLocalJson(res, 405, { error: { code: 'method_not_allowed', message: 'Evidence anchor records are read-only; POST a Cascade Review manifest to create a digest commitment.' } });
}

// Climate Integrity Lab: evidence bundles, local-chain anchoring, claims, challenges and
// corrections. Reads are open to local clients; every write must come from loopback with a
// local origin, like evidence anchoring above.
const INTEGRITY_BASE = '/api/v1/integrity';

async function readOptionalJsonBody(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.byteLength;
    if (size > maxBytes) throw Object.assign(new Error(`Request body exceeds ${maxBytes} bytes.`), { code: 'REQUEST_TOO_LARGE', status: 413 });
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected object');
    return value;
  } catch {
    throw Object.assign(new Error('Request body must be a JSON object.'), { code: 'INVALID_JSON', status: 400 });
  }
}

async function routeIntegrity(service, method, parts, body) {
  const [resource, id, action] = parts;
  if (parts.length === 1) {
    if (method === 'GET' && resource === 'status') return service.status();
    if (method === 'GET' && resource === 'sites') return service.sites();
    if (method === 'GET' && resource === 'history') return service.history();
    if (method === 'POST' && resource === 'reset') return service.reset();
    if (method === 'POST' && resource === 'evidence') return service.buildEvidence({ siteId: body.siteId, analyte: body.analyte, mode: body.mode });
    if (method === 'POST' && resource === 'claims') return service.submitClaim({ evidenceId: body.evidenceId });
  }
  if (parts.length === 2 && method === 'GET') {
    if (resource === 'evidence') return service.getEvidence(id);
    if (resource === 'claims') return service.getClaim(id);
  }
  if (parts.length === 3 && resource === 'evidence') {
    if (method === 'GET' && action === 'verify') return service.verify(id);
    if (method === 'POST' && action === 'anchor') return service.anchor(id);
    if (method === 'POST' && action === 'tamper') return service.tamper(id);
    if (method === 'POST' && action === 'replay') return service.replay(id);
  }
  if (parts.length === 3 && resource === 'claims' && method === 'POST') {
    if (action === 'duplicate') return service.duplicateClaim(id);
    if (action === 'challenge') return service.challenge(id, { reasonCode: body.reasonCode, detail: body.detail });
    if (action === 'correct') return service.correct(id, { note: body.note });
    if (action === 'resolve') return service.resolve(id, { upheld: body.upheld });
    if (action === 'firewall') return service.evaluateClaimFirewall(id, body);
  }
  if (parts.length === 2 && resource === 'firewall') {
    if (method === 'POST' && id === 'evaluate') return service.evaluateFirewall(body);
    if (method === 'GET' && id === 'benchmark') return service.benchmarkFirewall();
  }
  return undefined;
}

async function handleIntegrity(req, res, url, service) {
  const parts = url.pathname.slice(INTEGRITY_BASE.length).split('/').filter(Boolean);
  const isWrite = req.method === 'POST';
  if (req.method !== 'GET' && !isWrite) {
    req.resume();
    return sendLocalJson(res, 405, { error: { code: 'method_not_allowed', message: 'The integrity lab accepts GET for reads and POST for local writes.' } });
  }
  if (isWrite && (!isLoopbackAddress(req.socket.remoteAddress) || !isLocalOrigin(req.headers.origin))) {
    req.resume();
    return sendLocalJson(res, 403, { error: { code: 'local_access_required', message: 'Integrity lab writes are available only from the local Climate Chain app.' } });
  }
  try {
    const body = isWrite ? await readOptionalJsonBody(req, 20_000) : {};
    if (!isWrite) req.resume();
    const result = await routeIntegrity(service, req.method, parts, body);
    if (result === undefined) return sendLocalJson(res, 404, { error: { code: 'not_found', message: `No integrity lab route for ${req.method} ${url.pathname}.` } });
    const created = isWrite && ((parts.length === 1 && ['evidence', 'claims'].includes(parts[0])) || (parts[2] === 'anchor' && !result.alreadyAnchored));
    return sendLocalJson(res, created ? 201 : 200, result);
  } catch (error) {
    const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
    return sendLocalJson(res, status, {
      error: {
        code: error?.code || 'integrity_failed',
        message: error instanceof Error ? error.message : 'The integrity lab request failed.',
        ...(error?.errorName ? { errorName: error.errorName, errorArgs: error.errorArgs } : {}),
        ...(error?.retryAfterSeconds != null ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
        ...(Array.isArray(error?.fields) ? { fields: error.fields } : {}),
      },
    });
  }
}

function handleHistory(req, res, url) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Historical climate endpoints are read-only.' } });
  }
  const subpath = url.pathname.slice('/api/v1/history/'.length);
  if (subpath === 'datasets') {
    return sendJson(res, 200, getDatasetsCatalog());
  }
  if (subpath === 'timeline') {
    const indicator = url.searchParams.get('indicator') || 'temperature_anomaly';
    const startYear = parseInt(url.searchParams.get('startYear') || '1826', 10);
    const endYear = parseInt(url.searchParams.get('endYear') || '2026', 10);
    return sendJson(res, 200, getTimelineObservations(indicator, startYear, endYear));
  }
  if (subpath === 'events') {
    return sendJson(res, 200, { events: POLICY_EVENTS });
  }
  if (subpath === 'observation-evidence') {
    const indicator = url.searchParams.get('indicator') || 'temperature_anomaly';
    const year = parseInt(url.searchParams.get('year') || '2024', 10);
    const manifest = generateObservationEvidenceManifest(indicator, year);
    if (manifest.error) {
      return sendJson(res, 400, { error: { code: 'invalid_observation_request', message: manifest.error } });
    }
    return sendJson(res, 200, manifest);
  }
  if (subpath === 'live-tick') {
    const indicator = url.searchParams.get('indicator') || 'temperature_anomaly';
    return sendJson(res, 200, getLiveTelemetryTick(indicator));
  }
  return sendJson(res, 404, { error: { code: 'not_found', message: `Unknown historical route: ${url.pathname}` } });
}

// ---------------------------------------------------------------------------
// Static serving
// ---------------------------------------------------------------------------

async function serveStatic(res, pathname) {
  let filePath = normalize(join(DIST_DIR, pathname));
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    filePath = join(DIST_DIR, 'index.html'); // SPA history fallback
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Build the frontend first: cd frontend && npm run build');
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

// Standalone project apps keep their own relative asset paths, so they are
// served from /apps/<id>/ with a trailing slash enforced by a redirect.
async function serveProjectApp(res, projects, pathname) {
  const match = /^\/apps\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!match) return sendJson(res, 404, { error: { code: 'not_found', message: `No project app at ${pathname}` } });
  const [, appId, rest] = match;
  if (rest === undefined) {
    res.writeHead(301, { location: `/apps/${appId}/` }).end();
    return;
  }
  const result = resolveAppFile(projects, appId, rest.slice(1));
  if (result.status !== 200) {
    const message = { 400: 'Bad app path', 403: 'Outside the app folder', 404: 'App file not found' }[result.status] || 'App unavailable';
    res.writeHead(result.status, { 'content-type': 'text/plain; charset=utf-8' }).end(message);
    return;
  }
  const data = await readFile(result.filePath);
  res.writeHead(200, {
    'content-type': appContentType(result.filePath),
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "frame-ancestors 'self'",
  });
  res.end(data);
}

function isLoopbackAddress(address = '') {
  return address === '::1' || address === '::ffff:127.0.0.1' || /^127(?:\.\d{1,3}){3}$/.test(address);
}

function isLocalOrigin(origin) {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname);
  } catch { return false; }
}

async function readJsonBody(req, maxBytes = 1_048_576) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new MissionEngineError('REQUEST_TOO_LARGE', `Request body exceeds ${maxBytes} bytes.`);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected object');
    return value;
  } catch {
    throw new MissionEngineError('INVALID_JSON', 'Request body must be a JSON object.');
  }
}

function missionErrorStatus(error) {
  if (['MISSION_NOT_FOUND', 'TASK_NOT_FOUND'].includes(error.code)) return 404;
  if (['INVALID_TRANSITION', 'MISSION_EXISTS', 'IDEMPOTENCY_CONFLICT', 'STORE_LOCK_TIMEOUT'].includes(error.code)) return 409;
  if (['STORE_CORRUPT', 'STORE_VERSION_UNSUPPORTED', 'STORE_READ_FAILED', 'STORE_NOT_INITIALIZED'].includes(error.code)) return 503;
  if (error.code?.startsWith('INVALID_') || ['TASK_NOT_ALLOWED', 'DEPENDENCY_CYCLE', 'INVALID_DEPENDENCY', 'INVALID_REFERENCE', 'INPUT_TOO_LARGE', 'REQUEST_TOO_LARGE'].includes(error.code)) return 400;
  return 500;
}

async function handleMissions(req, res, url, engine) {
  const send = (status, body) => sendLocalJson(res, status, body);
  if (!isLoopbackAddress(req.socket.remoteAddress) || !isLocalOrigin(req.headers.origin)) {
    return send(403, { error: { code: 'local_access_required', message: 'Mission execution is available only from a loopback client and local browser origin.' } });
  }
  const pathParts = url.pathname.split('/').filter(Boolean).slice(2).map((part) => decodeURIComponent(part));
  const [missionId, action, taskId] = pathParts;
  try {
    if (!missionId) {
      if (req.method === 'GET') return send(200, { missions: await engine.listMissions(), integrity: await engine.verifyIntegrity(), persistence: 'local-user-data' });
      if (req.method === 'POST') {
        const definition = await readJsonBody(req);
        const mission = await engine.createMission(definition, { idempotencyKey: req.headers['idempotency-key'] });
        return send(201, { mission });
      }
      return send(405, { error: { code: 'method_not_allowed' } });
    }
    if (!action) {
      if (req.method !== 'GET') return send(405, { error: { code: 'method_not_allowed' } });
      return send(200, { mission: await engine.getMission(missionId), events: await engine.getEvents(missionId) });
    }
    if (req.method === 'POST' && action === 'validate') return send(200, { mission: await engine.validateMission(missionId) });
    if (req.method === 'POST' && action === 'queue') return send(200, { mission: await engine.queueMission(missionId) });
    if (req.method === 'POST' && action === 'run') {
      try {
        await attachFreshMissionMemory(engine, missionId);
        const prepared = await engine.getMission(missionId);
        return send(202, { status: 'queued_for_worker', mission: prepared });
      } catch (error) {
        if (error instanceof MissionMemoryReadinessError) {
          return send(error.status, { error: { code: error.code, message: error.message, action: error.action, conflicts: error.conflicts } });
        }
        console.error('[gateway] mission memory readiness gate failed', { code: error?.code || 'memory_gate_error' });
        return send(503, { error: { code: 'CLIMATE_CHAIN_MEMORY_UNAVAILABLE', message: 'Mission execution was stopped because engineering memory readiness could not be established.', action: 'Open Memory Studio and verify the local vault before retrying.' } });
      }
    }
    if (req.method === 'POST' && action === 'pause') return send(200, { mission: await engine.pauseMission(missionId) });
    if (req.method === 'POST' && action === 'resume') return send(200, { mission: await engine.resumeMission(missionId) });
    if (req.method === 'POST' && action === 'cancel') return send(200, { mission: await engine.cancelMission(missionId) });
    if (req.method === 'POST' && action === 'approve' && taskId) return send(200, { mission: await engine.approveTask(missionId, taskId, await readJsonBody(req)) });
    if (req.method === 'POST' && action === 'retry' && taskId) return send(200, { mission: await engine.retryTask(missionId, taskId, await readJsonBody(req)) });
    if (req.method === 'GET' && action === 'evidence' && taskId) return send(200, { evidence: await engine.getExecutionEvidence(missionId, taskId) });
    if (req.method === 'GET' && action === 'export') return send(200, await engine.exportMission(missionId));
    return send(404, { error: { code: 'mission_route_not_found' } });
  } catch (error) {
    const status = error instanceof MissionEngineError ? missionErrorStatus(error) : 500;
    if (status === 500) console.error('[gateway] mission operation failed', { code: error?.code || 'unexpected_error', message: error?.message || 'unknown error' });
    return send(status, { error: { code: error?.code || 'mission_operation_failed', message: error instanceof Error ? error.message : 'Mission operation failed.' } });
  }
}

export function createGatewayServer({ missionEngine, connectorRegistry, missionStorePath, projectRegistry, trackRegistry, placeService, facilitiesService, knowledgeService, evidenceAnchorService, integrityService } = {}) {
  const missions = missionEngine || createMissionEngine({ storePath: missionStorePath });
  const connectors = connectorRegistry || createConnectorRegistry({ env: process.env });
  const projects = projectRegistry || loadRegistry();
  const tracks = trackRegistry || loadTracks();
  const places = placeService || createPlaceService();
  const facilities = facilitiesService || createFacilityService();
  const knowledge = knowledgeService || createKnowledgeService({ root: join(__dirname, '..') });
  const evidenceAnchors = evidenceAnchorService || createEvidenceAnchorService();
  const integrity = integrityService || createIntegrityService();
  return http.createServer(async (req, res) => {
  const suppliedCorrelationId = req.headers['x-correlation-id'];
  const correlationId = typeof suppliedCorrelationId === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(suppliedCorrelationId) ? suppliedCorrelationId : randomUUID();
  res.setHeader('x-correlation-id', correlationId);
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  // The memory vault is a local-only service with a dedicated sandbox and
  // tighter origin checks than the public climate signal routes.
  if (p.startsWith('/api/agent-memory')) return handleAgentMemoryRequest(req, res, url);

  if (p === '/api/missions' || p.startsWith('/api/missions/')) return handleMissions(req, res, url, missions);

  // The application is a local-first workspace. Reflect only loopback origins
  // so local browser clients can read responses without exposing the API to
  // arbitrary websites through wildcard CORS.
  if (isLocalOrigin(req.headers.origin) && req.headers.origin) {
    res.setHeader('access-control-allow-origin', req.headers.origin);
    res.setHeader('vary', 'Origin');
  }

  if (req.method === 'OPTIONS') {
    if (!isLocalOrigin(req.headers.origin)) return sendJson(res, 403, { error: { code: 'local_origin_required' } });
    res.writeHead(204, {
      'access-control-allow-methods': 'GET,HEAD,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization',
      'cache-control': 'no-store',
    });
    return res.end();
  }

  try {
    // /api/health is the readiness probe: 503 while degraded. /api/status returns the same body
    // with 200, so the app can poll it without the browser logging every degraded poll as a
    // failed request.
    if ((p === '/api/health' || p === '/api/status') && req.method === 'GET') {
      let memory;
      try {
        const verified = await verifyMemoryIntegrity();
        memory = { status: verified.valid && verified.complete ? 'ready' : 'unavailable', count: verified.count, schemaVersion: verified.schemaVersion, encryption: verified.encryption };
      } catch (error) {
        memory = { status: 'unavailable', errorCode: error?.code || 'MEMORY_READ_FAILED' };
      }
      const missionStore = await missions.verifyIntegrity();
      let worker;
      try { worker = await readWorkerStatus(); }
      catch (error) {
        worker = { status: 'unavailable', available: false, workerId: null, pid: null, restartCount: 0, backoffMs: null, startedAt: null, lastHeartbeatAt: null, ageMs: null, errorCode: error?.code || 'WORKER_STATUS_UNAVAILABLE' };
      }
      const connectorStatuses = connectors.listStatus().map((item) => ({
        name: item.name, status: item.status, breaker: item.breaker, latencyMs: item.latencyMs,
        lastCheckAt: item.lastCheckAt, lastSuccessAt: item.lastSuccessAt, errorCode: item.lastError?.code || null,
      }));
      const ready = memory.status === 'ready' && missionStore.valid && worker.available;
      return sendJson(res, ready || p === '/api/status' ? 200 : 503, {
        status: ready ? 'ready' : 'degraded', correlationId, uptimeSeconds: Math.floor(process.uptime()),
        memory, missions: { status: missionStore.valid ? 'ready' : 'unavailable', count: missionStore.missions ?? null, events: missionStore.events ?? null, errorCode: missionStore.code || null },
        worker, connectors: connectorStatuses, checkedAt: new Date().toISOString(),
      });
    }
    if (p === '/api/services') return sendJson(res, 200, await handleServices(connectors));
    if (p === '/api/connectors' && req.method === 'GET') return sendJson(res, 200, { connectors: connectors.listConfig(), status: connectors.listStatus(), asOf: new Date().toISOString() });
    if (p === '/api/v1/evidence/integrations' && req.method === 'GET') return sendJson(res, 200, handleIntegrationEvidence(connectors));
    if (p === '/api/unified/overview') return sendJson(res, 200, await handleOverview(url, connectors));
    if (p === '/api/v1/place' || p === '/api/v1/places/search' || p === '/api/v1/place/facilities') {
      if (req.method !== 'GET') { req.resume(); return sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Place environment and geographic discovery are read-only.' } }); }
      try {
        if (p === '/api/v1/places/search') return sendJson(res, 200, await places.searchPlaces(url.searchParams.get('q')));
        const point = validatePlaceCoordinates({ lat: url.searchParams.get('lat'), lng: url.searchParams.get('lng') });
        if (p === '/api/v1/place/facilities') {
          const radius = url.searchParams.has('radiusKm') ? url.searchParams.get('radiusKm') : 15;
          if (String(radius).trim() === '' || !Number.isFinite(Number(radius)) || Number(radius) <= 0 || Number(radius) > 25) throw new PlaceServiceError('invalid_radius', 'radiusKm must be greater than zero and no more than 25 km.', 400);
          return sendJson(res, 200, await facilities.nearby(point.lat, point.lng, Number(radius)));
        }
        return sendJson(res, 200, await places.inspectPlace(point));
      } catch (error) {
        const status = error instanceof PlaceServiceError ? error.status : error instanceof TypeError || error instanceof RangeError ? 400 : 502;
        return sendJson(res, status, { error: { code: error instanceof PlaceServiceError ? error.code : status === 400 ? 'invalid_place_query' : 'place_source_unavailable', message: error instanceof PlaceServiceError || status === 400 ? error.message : 'The geographic source could not be reached. Retry shortly.' } });
      }
    }
    if (p === '/api/v1/cascade') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Cascade review is read-only.' } });
      return handleCascade(url, res);
    }
    if (p === '/api/v1/evidence-anchors' || p.startsWith('/api/v1/evidence-anchors/')) {
      return handleEvidenceAnchors(req, res, url, evidenceAnchors);
    }
    if (p === INTEGRITY_BASE || p.startsWith(`${INTEGRITY_BASE}/`)) {
      return handleIntegrity(req, res, url, integrity);
    }
    if (p.startsWith('/api/v1/history/')) {
      return handleHistory(req, res, url);
    }

    if (p === '/api/v1/projects') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'The project registry is read-only.' } });
      return sendJson(res, 200, { tracks, projects, apps: listProjectApps(projects), asOf: new Date().toISOString() });
    }
    if (p === '/api/v1/knowledge/search' || p === '/api/v1/knowledge/sources') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Workspace search is read-only.' } });
      try {
        if (p === '/api/v1/knowledge/sources') return sendJson(res, 200, await knowledge.sources());
        return sendJson(res, 200, await knowledge.search(url.searchParams.get('q'), url.searchParams.get('limit') ?? undefined));
      } catch (error) {
        if (error instanceof KnowledgeError) return sendJson(res, error.status, { error: { code: error.code, message: error.message } });
        console.error('[gateway] workspace search failed', { code: error?.code || 'unexpected_error' });
        return sendJson(res, 503, { error: { code: 'knowledge_unavailable', message: 'Workspace search is unavailable right now. Try again shortly.' } });
      }
    }
    if (p === '/apps' || p.startsWith('/apps/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Project apps are read-only.' } });
      return serveProjectApp(res, projects, p);
    }

    for (const prefix of ['junksnap', 'clearsky', 'teesri', 'vayu']) {
      if (p.startsWith(`/api/${prefix}/`)) {
        return handleProxy(req, res, prefix, p.slice(`/api/${prefix}/`.length) + url.search);
      }
    }
    if (p.startsWith('/api/')) {
      return sendJson(res, 404, { error: { code: 'not_found', message: `No gateway route for ${p}` } });
    }
    await serveStatic(res, p);
  } catch (err) {
    sendJson(res, 500, { error: { code: 'gateway_error', message: err.message } });
  }
  });
}

const server = createGatewayServer();
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Climate Chain gateway on http://localhost:${PORT}`);
    console.log(`Upstreams: ${Object.values(SERVICES).map((s) => s.label).join(', ')}`);
    console.log(`Frontend dist: ${DIST_DIR}`);
  });
}
