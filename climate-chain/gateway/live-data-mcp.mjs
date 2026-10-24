// Read-only MCP bridge for Climate Chain's public, live source reads.
// It calls the local gateway so source validation, privacy filters and provenance stay authoritative.
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';

const PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_PROTOCOLS = new Set(['2024-11-05', '2025-03-26', PROTOCOL_VERSION]);
const TOOL_NAMES = [
  'climate_chain_get_live_overview',
  'climate_chain_check_public_sources',
  'climate_chain_fetch_cascade_evidence',
];
const gatewayUrl = process.env.CLIMATE_CHAIN_GATEWAY_URL || `http://127.0.0.1:${Number(process.env.PORT || 8080)}`;

function validateGatewayUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('CLIMATE_CHAIN_GATEWAY_URL must be a loopback HTTP origin with no path, credentials, query, or fragment.');
  }
  return url;
}

const gateway = validateGatewayUrl(gatewayUrl);

async function getJson(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(new URL(path, gateway), {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`Gateway returned non-JSON HTTP ${response.status}.`); }
    if (!response.ok) {
      const code = data?.error?.code;
      throw new Error(`Gateway HTTP ${response.status}${code ? ` (${code})` : ''}.`);
    }
    return { data, http: response.status };
  } finally {
    clearTimeout(timer);
  }
}

const tools = [
  {
    name: TOOL_NAMES[0],
    description: 'Fetch the current four-source Climate Chain overview through the validated gateway. Inspect each source mode and provenance; SIMULATED data is not live evidence, and a live response is not proof of causality or impact.',
    inputSchema: {
      type: 'object',
      properties: { city: { type: 'string', enum: ['delhi', 'jodhpur', 'chandigarh'], default: 'delhi' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: TOOL_NAMES[1],
    description: 'Run live health probes against the four public GET sources and return HTTP status, latency, last check and connector state. No API keys are required for these shared read operations.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: TOOL_NAMES[2],
    description: 'Fetch a read-only JunkSnap-to-Vayu Cascade Review for one real public site. The gateway rejects simulated data for this route and returns a SHA-256 manifest. A candidate is only a proximity review lead, never causation.',
    inputSchema: {
      type: 'object',
      properties: {
        siteId: { type: 'string', minLength: 1, maxLength: 80, pattern: '^[A-Za-z0-9_-]+$' },
        radiusKm: { type: 'number', exclusiveMinimum: 0, maximum: 50, default: 5 },
        timeWindowHours: { type: 'number', exclusiveMinimum: 0, maximum: 168, default: 24 },
      },
      required: ['siteId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
];

function toolResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value, isError: false };
}

async function callTool(name, args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new TypeError('Tool arguments must be an object.');
  const requestId = randomUUID();
  if (name === TOOL_NAMES[0]) {
    const city = args.city || 'delhi';
    if (!['delhi', 'jodhpur', 'chandigarh'].includes(city)) throw new TypeError('city must be delhi, jodhpur, or chandigarh.');
    const { data, http } = await getJson(`/api/unified/overview?city=${encodeURIComponent(city)}`);
    return { requestId, gatewayRoute: '/api/unified/overview', http, capturedAt: new Date().toISOString(), evidenceMode: 'per-source', snapshot: data };
  }
  if (name === TOOL_NAMES[1]) {
    const { data, http } = await getJson('/api/services');
    return { requestId, gatewayRoute: '/api/services', http, checkedAt: data.asOf, sources: data.services };
  }
  if (name === TOOL_NAMES[2]) {
    const siteId = args.siteId;
    if (typeof siteId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(siteId)) throw new TypeError('siteId must contain 1 to 80 letters, numbers, underscores, or hyphens.');
    const radiusKm = args.radiusKm ?? 5;
    const timeWindowHours = args.timeWindowHours ?? 24;
    if (typeof radiusKm !== 'number' || !Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 50) throw new TypeError('radiusKm must be greater than 0 and no more than 50.');
    if (typeof timeWindowHours !== 'number' || !Number.isFinite(timeWindowHours) || timeWindowHours <= 0 || timeWindowHours > 168) throw new TypeError('timeWindowHours must be greater than 0 and no more than 168.');
    const query = new URLSearchParams({ site: siteId, radiusKm: String(radiusKm), timeWindowHours: String(timeWindowHours) });
    const { data, http } = await getJson(`/api/v1/cascade?${query}`);
    return { requestId, gatewayRoute: '/api/v1/cascade', http, capturedAt: new Date().toISOString(), review: data };
  }
  throw Object.assign(new Error(`Unknown tool: ${String(name)}`), { code: -32602 });
}

function send(message) { process.stdout.write(JSON.stringify(message) + '\n'); }
function response(id, result) { send({ jsonrpc: '2.0', id, result }); }
function rpcError(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string' || message.id === undefined) return;
  const id = message.id;
  try {
    if (message.method === 'initialize') {
      const requested = message.params?.protocolVersion;
      response(id, {
        protocolVersion: SUPPORTED_PROTOCOLS.has(requested) ? requested : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'climate-chain-live-data', version: '1.0.0' },
        instructions: 'Read-only live-data tools call the local Climate Chain gateway and its public GET sources. Inspect per-source mode, timestamp, schema and provenance. Reject SIMULATED records as current observations. No source API key is needed for these shared reads. Cascade is a proximity review lead, not causation; no tool writes, anchors or approves actions.',
      });
      return;
    }
    if (message.method === 'ping') { response(id, {}); return; }
    if (message.method === 'tools/list') { response(id, { tools }); return; }
    if (message.method === 'tools/call') {
      try { response(id, toolResult(await callTool(message.params?.name, message.params?.arguments || {}))); }
      catch (error) {
        const messageText = error instanceof Error ? error.message : 'Live data request failed.';
        response(id, { content: [{ type: 'text', text: messageText }], isError: true });
      }
      return;
    }
    rpcError(id, -32601, `Method not found: ${message.method}`);
  } catch (error) {
    rpcError(id, -32603, error instanceof Error ? error.message : 'MCP request failed.');
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  let message;
  try { message = JSON.parse(line); }
  catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } }); return; }
  void handle(message);
});
