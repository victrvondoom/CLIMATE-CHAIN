// Climate Chain unified gateway.
// One entry point for the merged product:
//   /api/services            health of the four upstreams
//   /api/junksnap/*          -> JunkSnap API          (waste)
//   /api/clearsky/*          -> clearsky API          (stubble fire)
//   /api/teesri/*            -> Teesri Shikayat API   (water)
//   /api/vayu/*              -> Vayu API              (air)
//   /api/unified/overview    normalized fan-out + cross-project feed
//   /api/v1/projects         registry of every merged project + app availability
//   /apps/<id>/...           standalone project apps from ../projects (same origin)
// It also serves the built frontend from ../frontend/dist.
// Zero dependencies: node >= 20 (uses global fetch and AbortController).

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
import { appContentType, listProjectApps, loadRegistry, resolveAppFile } from './project-registry.mjs';

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

export function createGatewayServer({ missionEngine, connectorRegistry, missionStorePath, projectRegistry } = {}) {
  const missions = missionEngine || createMissionEngine({ storePath: missionStorePath });
  const connectors = connectorRegistry || createConnectorRegistry({ env: process.env });
  const projects = projectRegistry || loadRegistry();
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
    if (p === '/api/health' && req.method === 'GET') {
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
      return sendJson(res, ready ? 200 : 503, {
        status: ready ? 'ready' : 'degraded', correlationId, uptimeSeconds: Math.floor(process.uptime()),
        memory, missions: { status: missionStore.valid ? 'ready' : 'unavailable', count: missionStore.missions ?? null, events: missionStore.events ?? null, errorCode: missionStore.code || null },
        worker, connectors: connectorStatuses, checkedAt: new Date().toISOString(),
      });
    }
    if (p === '/api/services') return sendJson(res, 200, await handleServices(connectors));
    if (p === '/api/connectors' && req.method === 'GET') return sendJson(res, 200, { connectors: connectors.listConfig(), status: connectors.listStatus(), asOf: new Date().toISOString() });
    if (p === '/api/unified/overview') return sendJson(res, 200, await handleOverview(url, connectors));
    if (p === '/api/v1/cascade') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'Cascade review is read-only.' } });
      return handleCascade(url, res);
    }

    if (p === '/api/v1/projects') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: { code: 'method_not_allowed', message: 'The project registry is read-only.' } });
      return sendJson(res, 200, { projects, apps: listProjectApps(projects), asOf: new Date().toISOString() });
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
