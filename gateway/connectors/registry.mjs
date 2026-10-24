/**
 * Read-only connector contracts for the four Climate Chain source adapters.
 *
 * This module is deliberately independent of gateway.mjs so it can be tested
 * with deterministic local endpoints before the gateway adopts it. It does not
 * claim any connector is currently reachable.
 */

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isString = (value) => typeof value === 'string';

// Reviewed geographic presets shared by overview and mission workflows.
// Keeping these in the connector layer avoids drift between user-facing
// city labels and the worker's fixed, privacy-preserving query coordinates.
export const VAYU_CITY_PRESETS = Object.freeze({
  delhi: Object.freeze({ name: 'Delhi', lat: 28.61, lng: 77.23 }),
  jodhpur: Object.freeze({ name: 'Jodhpur', lat: 26.29, lng: 73.02 }),
  chandigarh: Object.freeze({ name: 'Chandigarh', lat: 30.73, lng: 76.78 }),
});

function issue(path, message) {
  return { path, message };
}

function validateJunkSnap(value) {
  const errors = [];
  if (!isRecord(value)) return [issue('$', 'must be an object')];
  if (value.type !== 'FeatureCollection') errors.push(issue('$.type', 'must equal FeatureCollection'));
  if (!Array.isArray(value.features)) return [...errors, issue('$.features', 'must be an array')];
  value.features.forEach((feature, index) => {
    const at = `$.features[${index}]`;
    if (!isRecord(feature)) {
      errors.push(issue(at, 'must be an object'));
      return;
    }
    if (feature.type !== 'Feature') errors.push(issue(`${at}.type`, 'must equal Feature'));
    if (!isRecord(feature.properties)) errors.push(issue(`${at}.properties`, 'must be an object'));
    if (feature.geometry != null) {
      if (!isRecord(feature.geometry)) errors.push(issue(`${at}.geometry`, 'must be an object or null'));
      else if (feature.geometry.type === 'Point') {
        const coordinates = feature.geometry.coordinates;
        if (!Array.isArray(coordinates) || coordinates.length < 2 || !coordinates.slice(0, 2).every(isFiniteNumber)) {
          errors.push(issue(`${at}.geometry.coordinates`, 'Point coordinates must contain finite longitude and latitude numbers'));
        }
      } else {
        errors.push(issue(`${at}.geometry.type`, 'only Point geometry is supported by the central adapter'));
      }
    }
  });
  return errors;
}

export const CLEARSKY_AGGREGATE_FIELDS = Object.freeze([
  'farmers', 'fields', 'acres_registered', 'acres_booked', 'acres_cleared',
  'tonnes_booked', 'tonnes_delivered', 'payouts_estimated_inr', 'red_fields',
  'yellow_fields', 'alerts_sent', 'bookings', 'bookings_done',
  'fields_saved_after_alert', 'today',
]);

const CLEARSKY_REQUIRED_NUMBERS = CLEARSKY_AGGREGATE_FIELDS.slice(0, 13);

function validateClearSky(value) {
  if (!isRecord(value)) return [issue('$', 'must be an object')];
  const errors = [];
  for (const key of CLEARSKY_REQUIRED_NUMBERS) {
    if (!isFiniteNumber(value[key])) errors.push(issue(`$.${key}`, 'must be a finite number'));
  }
  if (value.fields_saved_after_alert != null && !isFiniteNumber(value.fields_saved_after_alert)) {
    errors.push(issue('$.fields_saved_after_alert', 'must be a finite number or null'));
  }
  if (value.today != null && !isString(value.today)) errors.push(issue('$.today', 'must be a string when present'));
  if (value.demo_prices != null && typeof value.demo_prices !== 'boolean') errors.push(issue('$.demo_prices', 'must be a boolean when present'));
  return errors;
}

function validateTeesri(value) {
  if (!isRecord(value)) return [issue('$', 'must be an object')];
  if (!Array.isArray(value.homes)) return [issue('$.homes', 'must be an array')];
  const errors = [];
  value.homes.forEach((home, index) => {
    if (!isRecord(home)) errors.push(issue(`$.homes[${index}]`, 'must be an object'));
  });
  return errors;
}

function validateVayu(value) {
  if (!isRecord(value)) return [issue('$', 'must be an object')];
  const errors = [];
  const modes = ['live', 'replay', 'model', 'measured'];
  const bands = ['good', 'satisfactory', 'moderate', 'poor', 'very_poor', 'severe'];
  const windowKinds = ['walk', 'play', 'airing', 'assembly'];
  const hourKinds = ['observed', 'forecast', 'pattern'];
  if (value.schemaVersion !== 1) errors.push(issue('$.schemaVersion', 'must equal 1'));
  if (!isRecord(value.place)) errors.push(issue('$.place', 'must be an object'));
  else {
    for (const key of ['id', 'name']) if (!isString(value.place[key])) errors.push(issue(`$.place.${key}`, 'must be a string'));
    if (!['home', 'school', 'office', 'park', 'other'].includes(value.place.kind)) errors.push(issue('$.place.kind', 'has an unsupported place kind'));
    for (const key of ['lat', 'lng']) if (!isFiniteNumber(value.place[key])) errors.push(issue(`$.place.${key}`, 'must be a finite number'));
  }
  if (!isString(value.asOf)) errors.push(issue('$.asOf', 'must be a string'));
  if (!modes.includes(value.mode)) errors.push(issue('$.mode', 'has an unsupported data mode'));
  if (!Array.isArray(value.hours)) errors.push(issue('$.hours', 'must be an array'));
  else value.hours.forEach((hour, index) => {
    const at = `$.hours[${index}]`;
    if (!isRecord(hour)) {
      errors.push(issue(at, 'must be an object'));
      return;
    }
    if (!isString(hour.t)) errors.push(issue(`${at}.t`, 'must be a string'));
    if (hour.pm25 != null && !isFiniteNumber(hour.pm25)) errors.push(issue(`${at}.pm25`, 'must be a finite number or null'));
    if (!hourKinds.includes(hour.kind)) errors.push(issue(`${at}.kind`, 'has an unsupported hour kind'));
  });
  if (!Array.isArray(value.windows)) errors.push(issue('$.windows', 'must be an array'));
  else value.windows.forEach((window, index) => {
    const at = `$.windows[${index}]`;
    if (!isRecord(window)) {
      errors.push(issue(at, 'must be an object'));
      return;
    }
    if (!windowKinds.includes(window.kind)) errors.push(issue(`${at}.kind`, 'has an unsupported window kind'));
    if (!isString(window.start) || !isString(window.end)) errors.push(issue(at, 'start and end must be strings'));
    if (!isFiniteNumber(window.meanPm25)) errors.push(issue(`${at}.meanPm25`, 'must be a finite number'));
    if (!bands.includes(window.band)) errors.push(issue(`${at}.band`, 'has an unsupported air-quality band'));
    if (!Array.isArray(window.rationale) || !window.rationale.every(isString)) errors.push(issue(`${at}.rationale`, 'must be an array of strings'));
  });
  if (!isString(value.headline)) errors.push(issue('$.headline', 'must be a string'));
  if (!isRecord(value.prov)) errors.push(issue('$.prov', 'must be an object'));
  else {
    if (!modes.includes(value.prov.mode)) errors.push(issue('$.prov.mode', 'has an unsupported data mode'));
    if (!['Estimate', 'Nearby station', 'Your room'].includes(value.prov.label)) errors.push(issue('$.prov.label', 'has an unsupported trust label'));
    if (!['station', 'forecast', 'pattern', 'unit', 'model', 'test'].includes(value.prov.source)) errors.push(issue('$.prov.source', 'has an unsupported provenance source'));
    for (const key of ['fetchedAt', 'asOf']) if (!isString(value.prov[key])) errors.push(issue(`$.prov.${key}`, 'must be a string'));
    if (!isFiniteNumber(value.prov.ageMinutes)) errors.push(issue('$.prov.ageMinutes', 'must be a finite number'));
  }
  return errors;
}

/** Source-shaped contracts used by the current central read adapters. */
export const SOURCE_CONNECTORS = Object.freeze({
  junksnap: Object.freeze({
    name: 'junksnap', label: 'JunkSnap', domain: 'Waste', env: 'JUNKSNAP_API_URL',
    defaultUrl: 'https://d2s7tf4ua41hzf.cloudfront.net', healthPath: '/healthz',
    endpoints: Object.freeze({ sites: Object.freeze({ path: '/sites', schema: 'junksnap-feature-collection', validate: validateJunkSnap }) }),
    auth: 'optional upstream auth may be forwarded by the existing proxy; registry reads are unauthenticated GETs',
  }),
  clearsky: Object.freeze({
    name: 'clearsky', label: 'clearsky', domain: 'Fire', env: 'CLEARSKY_API_URL',
    defaultUrl: 'https://h5n589so32.execute-api.ap-south-1.amazonaws.com', healthPath: '/api/stats',
    endpoints: Object.freeze({ stats: Object.freeze({ path: '/api/stats', schema: 'clearsky-public-stats', validate: validateClearSky }) }),
    auth: 'public read endpoint',
  }),
  teesri: Object.freeze({
    name: 'teesri', label: 'Teesri Shikayat', domain: 'Water', env: 'TEESRI_API_URL',
    defaultUrl: 'https://eirioqqhvtvve3aw5xhpje2wju0jztrl.lambda-url.ap-south-1.on.aws', healthPath: '/api/state',
    endpoints: Object.freeze({ state: Object.freeze({ path: '/api/state', schema: 'teesri-public-state', validate: validateTeesri }) }),
    auth: 'public state endpoint masks/rounds resident data; console POST actions require a token and are out of scope',
  }),
  vayu: Object.freeze({
    name: 'vayu', label: 'The Vayu Project', domain: 'Air', env: 'VAYU_API_URL',
    defaultUrl: 'https://niu33luxo8.execute-api.ap-south-1.amazonaws.com', healthPath: '/v1/health',
    endpoints: Object.freeze({ today: Object.freeze({ path: '/v1/today', schema: 'vayu-today', validate: validateVayu }) }),
    auth: 'public read endpoint',
  }),
});

export class ConnectorError extends Error {
  constructor(message, { code, connector, operation = null, status = null, attempts = 0, retryable = false, details = null } = {}) {
    super(message);
    this.name = 'ConnectorError';
    this.code = code || 'connector_error';
    this.connector = connector || null;
    this.operation = operation;
    this.status = status;
    this.attempts = attempts;
    this.retryable = retryable;
    this.details = details;
  }
}

function safeUrl(url) {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

function parseJson(text, connector, operation) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ConnectorError('Source returned invalid JSON', {
      code: 'invalid_json', connector, operation, retryable: false,
      details: { reason: error instanceof Error ? error.message : String(error) },
    });
  }
}

function validateConfig(config) {
  const url = new URL(config.url);
  if (!['https:', 'http:'].includes(url.protocol)) throw new TypeError(`Unsupported URL protocol for ${config.name}`);
  if (url.username || url.password) throw new TypeError(`Credentials must not be embedded in ${config.name} URL`);
  return url;
}

function abortError(signal) {
  return signal?.reason instanceof Error ? signal.reason : new Error('Request aborted');
}

async function readBoundedBody(response, maxResponseBytes, connector, operation) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
    try { await response.body?.cancel(); } catch { /* Body is already closed. */ }
    throw new ConnectorError('Source response exceeded the configured size limit', {
      code: 'response_too_large', connector, operation, retryable: false,
      details: { maxResponseBytes },
    });
  }

  if (typeof response.body?.getReader !== 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxResponseBytes) {
      throw new ConnectorError('Source response exceeded the configured size limit', {
        code: 'response_too_large', connector, operation, retryable: false,
        details: { maxResponseBytes },
      });
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxResponseBytes) {
        try { await reader.cancel(); } catch { /* Preserve the size-limit error. */ }
        throw new ConnectorError('Source response exceeded the configured size limit', {
          code: 'response_too_large', connector, operation, retryable: false,
          details: { maxResponseBytes },
        });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

/**
 * Create a local, read-only registry. Retry/breaker settings are intentionally
 * bounded and injectable so failure paths can be tested without real upstreams.
 */
export function createConnectorRegistry({
  connectors = SOURCE_CONNECTORS,
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 7000,
  maxResponseBytes = 2 * 1024 * 1024,
  maxRetries = 1,
  cacheTtlMs = 15_000,
  maxCacheEntries = 128,
  maxCacheBytes = 16 * 1024 * 1024,
  breakerThreshold = 3,
  breakerCooldownMs = 15000,
  now = () => Date.now(),
  delay = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(abortError(signal)); }, { once: true });
  }),
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('timeoutMs must be a positive integer');
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 64 * 1024 * 1024) throw new TypeError('maxResponseBytes must be between 1 and 67108864');
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) throw new TypeError('maxRetries must be between 0 and 5');
  if (!Number.isInteger(cacheTtlMs) || cacheTtlMs < 0 || cacheTtlMs > 300_000) throw new TypeError('cacheTtlMs must be between 0 and 300000');
  if (!Number.isInteger(maxCacheEntries) || maxCacheEntries < 1 || maxCacheEntries > 2048) throw new TypeError('maxCacheEntries must be between 1 and 2048');
  if (!Number.isInteger(maxCacheBytes) || maxCacheBytes < 1 || maxCacheBytes > 256 * 1024 * 1024) throw new TypeError('maxCacheBytes must be between 1 and 268435456');
  if (!Number.isInteger(breakerThreshold) || breakerThreshold < 1) throw new TypeError('breakerThreshold must be a positive integer');
  if (!Number.isInteger(breakerCooldownMs) || breakerCooldownMs < 1) throw new TypeError('breakerCooldownMs must be a positive integer');

  const states = new Map();
  const configs = new Map();
  const cache = new Map();
  let cacheBytes = 0;

  function deleteCacheEntry(key) {
    const entry = cache.get(key);
    if (!entry) return;
    cacheBytes -= entry.sizeBytes;
    cache.delete(key);
  }
  for (const [name, definition] of Object.entries(connectors)) {
    if (!definition || definition.name !== name || !definition.env || !definition.defaultUrl) {
      throw new TypeError(`Invalid connector descriptor: ${name}`);
    }
    const url = String(env[definition.env] || definition.defaultUrl).replace(/\/$/, '');
    validateConfig({ name, url });
    configs.set(name, { ...definition, url });
    states.set(name, { breaker: 'closed', failures: 0, openedAt: null, halfOpenInFlight: false, lastCheckAt: null, lastSuccessAt: null, lastError: null, latencyMs: null, requestCount: 0 });
  }

  function config(name) {
    const item = configs.get(name);
    if (!item) throw new ConnectorError(`Unknown connector: ${name}`, { code: 'unknown_connector', connector: name });
    return item;
  }

  function state(name) {
    const item = states.get(name);
    if (!item) throw new ConnectorError(`Unknown connector: ${name}`, { code: 'unknown_connector', connector: name });
    return item;
  }

  function buildUrl(item, operation, query) {
    const endpoint = item.endpoints[operation];
    if (!endpoint) throw new ConnectorError(`Unknown operation ${operation} for ${item.name}`, { code: 'unknown_operation', connector: item.name, operation });
    const base = new URL(item.url);
    const result = new URL(endpoint.path, `${base.origin}${base.pathname.replace(/\/$/, '')}/`);
    // Only the exact configured endpoint path may be requested by this registry.
    const expected = new URL(endpoint.path, `${base.origin}${base.pathname.replace(/\/$/, '')}/`);
    if (result.origin !== base.origin || result.pathname !== expected.pathname) {
      throw new ConnectorError('Connector path escaped configured origin', { code: 'unsafe_path', connector: item.name, operation });
    }
    for (const [key, value] of Object.entries(query || {})) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) || (!isString(value) && !isFiniteNumber(value))) {
        throw new ConnectorError('Query parameters must use safe names and string/finite-number values', { code: 'invalid_query', connector: item.name, operation });
      }
      result.searchParams.set(key, String(value));
    }
    return result;
  }

  function admit(name) {
    const current = state(name);
    if (current.breaker === 'open') {
      if (now() - current.openedAt < breakerCooldownMs) {
        throw new ConnectorError('Connector circuit is open; retry after cooldown', { code: 'circuit_open', connector: name, retryable: true });
      }
      current.breaker = 'half_open';
      current.halfOpenInFlight = false;
    }
    if (current.breaker === 'half_open') {
      if (current.halfOpenInFlight) throw new ConnectorError('Connector recovery probe is already in flight', { code: 'circuit_half_open', connector: name, retryable: true });
      current.halfOpenInFlight = true;
    }
    return current;
  }

  function recordFailure(current, counted = true) {
    if (current.breaker === 'half_open' || current.halfOpenInFlight) {
      current.breaker = 'open';
      current.openedAt = now();
      current.halfOpenInFlight = false;
      current.failures = Math.max(current.failures + (counted ? 1 : 0), breakerThreshold);
      return;
    }
    if (counted) current.failures += 1;
    if (current.failures >= breakerThreshold) {
      current.breaker = 'open';
      current.openedAt = now();
    }
  }

  function recordSuccess(current, elapsedMs) {
    current.breaker = 'closed';
    current.failures = 0;
    current.openedAt = null;
    current.halfOpenInFlight = false;
    current.lastSuccessAt = new Date(now()).toISOString();
    current.lastError = null;
    current.latencyMs = elapsedMs;
  }

  async function execute(name, operation, { query = {}, signal } = {}) {
    if (signal?.aborted) throw new ConnectorError('Connector request aborted by caller', { code: 'aborted', connector: name, operation, attempts: 0 });
    const item = config(name);
    const endpoint = item.endpoints[operation];
    const url = buildUrl(item, operation, query);
    const cacheKey = `${name}:${operation}:${url.href}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > now()) {
      return {
        data: structuredClone(cached.data), status: cached.status,
        provenance: { ...cached.provenance, cacheHit: true },
      };
    }
    if (cached) deleteCacheEntry(cacheKey);
    const current = admit(name);
    const startedAt = now();
    current.requestCount += 1;
    current.lastCheckAt = new Date(startedAt).toISOString();
    current.lastError = null;
    let lastError;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      if (signal?.aborted) {
        const err = new ConnectorError('Connector request aborted by caller', { code: 'aborted', connector: name, operation, attempts: attempt - 1 });
        current.lastError = { code: err.code, message: err.message };
        recordFailure(current, false);
        throw err;
      }
      const controller = new AbortController();
      const onAbort = () => controller.abort(abortError(signal));
      signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
      try {
        const response = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' }, signal: controller.signal });
        const text = await readBoundedBody(response, maxResponseBytes, name, operation);
        if (!response.ok) {
          const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
          lastError = new ConnectorError(`Connector returned HTTP ${response.status}`, {
            code: 'http_error', connector: name, operation, status: response.status, attempts: attempt, retryable,
          });
          if (retryable && attempt <= maxRetries) {
            await delay(Math.min(100 * (2 ** (attempt - 1)), 1000), signal);
            continue;
          }
          if (retryable) recordFailure(current);
          else recordFailure(current, false);
          current.lastError = { code: lastError.code, status: lastError.status, message: lastError.message };
          current.latencyMs = Math.max(0, now() - startedAt);
          throw lastError;
        }
        const data = parseJson(text, name, operation);
        const errors = endpoint.validate(data);
        if (errors.length) {
          lastError = new ConnectorError('Source response failed schema validation', {
            code: 'schema_invalid', connector: name, operation, attempts: attempt, retryable: false,
            details: { schema: endpoint.schema, errors },
          });
          recordFailure(current);
          current.lastError = { code: lastError.code, message: lastError.message, details: lastError.details };
          current.latencyMs = Math.max(0, now() - startedAt);
          throw lastError;
        }
        const elapsedMs = Math.max(0, now() - startedAt);
        recordSuccess(current, elapsedMs);
        const result = {
          data,
          status: response.status,
          provenance: {
            source: name,
            label: item.label,
            operation,
            schema: endpoint.schema,
            // Transport success describes only reachability. Preserve a source
            // mode such as Vayu's "model" instead of implying measured/live data.
            mode: isString(data?.mode) ? data.mode : 'source_snapshot',
            connection: 'connected',
            transport: 'http',
            url: safeUrl(url.href),
            fetchedAt: new Date(now()).toISOString(),
            elapsedMs,
            attempts: attempt,
            requestId: response.headers?.get?.('x-request-id') || null,
            cacheHit: false,
          },
        };
        if (cacheTtlMs > 0) {
          // Bound aggregate cached payload size using serialized UTF-8 bytes;
          // parsed-object heap overhead is higher and is not directly measured.
          const sizeBytes = Buffer.byteLength(text, 'utf8');
          if (sizeBytes <= maxCacheBytes) {
            while (cache.size >= maxCacheEntries || cacheBytes + sizeBytes > maxCacheBytes) {
              deleteCacheEntry(cache.keys().next().value);
            }
            cache.set(cacheKey, { data: structuredClone(data), status: response.status, provenance: result.provenance, expiresAt: now() + cacheTtlMs, sizeBytes });
            cacheBytes += sizeBytes;
          }
        }
        return result;
      } catch (error) {
        if (error instanceof ConnectorError) {
          // HTTP failures and schema failures update breaker state at their
          // source; malformed JSON is also an upstream contract failure.
          if (error.code === 'invalid_json' || error.code === 'response_too_large') {
            recordFailure(current);
            current.lastError = { code: error.code, message: error.message };
            current.latencyMs = Math.max(0, now() - startedAt);
          }
          throw error;
        }
        const externallyAborted = signal?.aborted === true;
        const timedOut = controller.signal.aborted && !externallyAborted;
        lastError = new ConnectorError(timedOut ? `Connector timed out after ${timeoutMs}ms` : externallyAborted ? 'Connector request aborted by caller' : 'Connector network request failed', {
          code: externallyAborted ? 'aborted' : timedOut ? 'timeout' : 'network_error',
          connector: name, operation, attempts: attempt, retryable: !externallyAborted,
          details: { reason: error instanceof Error ? error.message : String(error) },
        });
        if (!externallyAborted && attempt <= maxRetries) {
          await delay(Math.min(100 * (2 ** (attempt - 1)), 1000), signal);
          continue;
        }
        if (externallyAborted) recordFailure(current, false);
        else recordFailure(current);
        current.lastError = { code: lastError.code, message: lastError.message };
        current.latencyMs = Math.max(0, now() - startedAt);
        throw lastError;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    }
    throw lastError;
  }

  async function read(name, operation, options = {}) {
    return execute(name, operation, options);
  }

  async function health(name, { signal } = {}) {
    const item = config(name);
    const current = state(name);
    const started = now();
    try {
      // Health probes use the connector's documented public health/read path but
      // do not impose a second endpoint schema beyond HTTP + valid JSON.
      const url = new URL(item.healthPath, `${new URL(item.url).origin}${new URL(item.url).pathname.replace(/\/$/, '')}/`);
      if (url.origin !== new URL(item.url).origin) throw new ConnectorError('Unsafe health path', { code: 'unsafe_path', connector: name });
      const result = await healthRequest(item, url, signal);
      current.lastCheckAt = new Date(started).toISOString();
      return { ...result, name, label: item.label, domain: item.domain, checkedAt: new Date(now()).toISOString() };
    } catch (error) {
      current.lastCheckAt = new Date(started).toISOString();
      return {
        name, label: item.label, domain: item.domain, status: 'disconnected',
        checkedAt: new Date(now()).toISOString(), error: error instanceof ConnectorError ? { code: error.code, message: error.message, status: error.status } : { code: 'health_error', message: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  async function healthRequest(item, url, signal) {
    const current = state(item.name);
    // Share the same circuit and timeout settings as data reads.
    admit(item.name);
    const started = now();
    current.requestCount += 1;
    let last;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      const controller = new AbortController();
      const onAbort = () => controller.abort(abortError(signal));
      signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
      try {
        const response = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' }, signal: controller.signal });
        const text = await readBoundedBody(response, maxResponseBytes, item.name, 'health');
        if (!response.ok) {
          const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
          last = new ConnectorError(`Health endpoint returned HTTP ${response.status}`, { code: 'http_error', connector: item.name, status: response.status, attempts: attempt, retryable });
          if (retryable && attempt <= maxRetries) {
            await delay(Math.min(100 * (2 ** (attempt - 1)), 1000), signal);
            continue;
          }
          if (retryable) recordFailure(current);
          else recordFailure(current, false);
          current.lastError = { code: last.code, status: last.status, message: last.message };
          throw last;
        }
        // Ensure the endpoint returned a parseable JSON body. The adapter may
        // expose text; current configured health endpoints are JSON.
        parseJson(text, item.name, 'health');
        recordSuccess(current, Math.max(0, now() - started));
        return { status: 'connected', http: response.status, latencyMs: Math.max(0, now() - started), breaker: current.breaker };
      } catch (error) {
        if (error instanceof ConnectorError) {
          if (error.code === 'invalid_json' || error.code === 'response_too_large') {
            recordFailure(current);
            current.lastError = { code: error.code, message: error.message };
            current.latencyMs = Math.max(0, now() - started);
          }
          throw error;
        }
        const timedOut = controller.signal.aborted && !signal?.aborted;
        last = new ConnectorError(timedOut ? `Health check timed out after ${timeoutMs}ms` : 'Health check network failure', {
          code: timedOut ? 'timeout' : signal?.aborted ? 'aborted' : 'network_error', connector: item.name, attempts: attempt, retryable: !signal?.aborted,
        });
        if (!signal?.aborted && attempt <= maxRetries) {
          await delay(Math.min(100 * (2 ** (attempt - 1)), 1000), signal);
          continue;
        }
        recordFailure(current, !signal?.aborted);
        current.lastError = { code: last.code, message: last.message };
        throw last;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    }
    throw last;
  }

  function getConfig(name) {
    const item = config(name);
    const parsed = new URL(item.url);
    return {
      name, label: item.label, domain: item.domain, env: item.env,
      configured: Boolean(env[item.env] || item.defaultUrl),
      endpoint: `${parsed.origin}${parsed.pathname}`,
      healthPath: item.healthPath,
      operations: Object.entries(item.endpoints).map(([operation, descriptor]) => ({ operation, path: descriptor.path, schema: descriptor.schema })),
      auth: item.auth,
    };
  }

  function getStatus(name) {
    const item = config(name);
    const current = state(name);
    let breaker = current.breaker;
    if (breaker === 'open' && now() - current.openedAt >= breakerCooldownMs) breaker = 'half_open';
    return {
      name, label: item.label, domain: item.domain,
      configured: true,
      status: current.lastError ? (current.lastSuccessAt ? 'degraded' : 'disconnected') : current.lastSuccessAt ? 'connected' : 'unknown',
      breaker,
      failures: current.failures,
      requestCount: current.requestCount,
      latencyMs: current.latencyMs,
      lastCheckAt: current.lastCheckAt,
      lastSuccessAt: current.lastSuccessAt,
      lastError: current.lastError,
      endpoint: getConfig(name).endpoint,
      cacheEntries: [...cache.keys()].filter((key) => key.startsWith(`${name}:`)).length,
    };
  }

  return Object.freeze({
    names: () => [...configs.keys()],
    getConfig: (name) => getConfig(name),
    listConfig: () => [...configs.keys()].map(getConfig),
    getStatus: (name) => getStatus(name),
    listStatus: () => [...configs.keys()].map(getStatus),
    read,
    health,
  });
}
