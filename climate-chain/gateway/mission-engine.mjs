// Durable local mission engine.
//
// This module intentionally ships only small, deterministic offline task
// handlers. It does not grant missions shell, filesystem, database, or network
// access. A host may expose the engine through an authenticated local API, but
// must keep that API's authorization boundary outside this module.

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { VAYU_CITY_PRESETS } from './connectors/registry.mjs';

// Windows can refuse to replace the store for a few milliseconds while a reader
// or a scanner holds it. Retry only those transient codes, and only on win32.
const TRANSIENT_REPLACE_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
async function replaceFile(fromPath, toPath) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(fromPath, toPath);
      return;
    } catch (error) {
      if (process.platform !== 'win32' || !TRANSIENT_REPLACE_CODES.has(error?.code) || attempt >= 8) throw error;
      await delay(15 * attempt);
    }
  }
}

export const MISSION_STATES = Object.freeze([
  'CREATED', 'VALIDATED', 'QUEUED', 'RUNNING', 'WAITING_APPROVAL',
  'PAUSED', 'RETRYING', 'FAILED', 'CANCELLED', 'BLOCKED', 'COMPLETED',
]);

export const TASK_STATES = Object.freeze([
  'PENDING', 'READY', 'RUNNING', 'WAITING_APPROVAL', 'RETRYING',
  'FAILED', 'CANCELLED', 'BLOCKED', 'COMPLETED',
]);

export const ALLOWED_TASK_TYPES = Object.freeze([
  'climate.observation_summary',
  'climate.emissions_scenario',
  'climate.connector_snapshot',
  'report.render',
]);

// Only explicitly reviewed source contracts may be persisted by mission tasks.
// AshAlert exposes aggregate statistics. AirPulse is queried only at a configured
// city center and its persisted projection omits place/station identifiers.
export const MISSION_CONNECTOR_OPERATIONS = Object.freeze({ clearsky: 'stats', vayu: 'today' });
export const MISSION_VAYU_CITY_PRESETS = VAYU_CITY_PRESETS;

export function isAllowedMissionConnectorInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || !Object.hasOwn(MISSION_CONNECTOR_OPERATIONS, input.connector)) return false;
  if (input.connector === 'clearsky') return Object.keys(input).length === 1;
  return input.connector === 'vayu' && Object.keys(input).length === 2
    && Object.hasOwn(input, 'city') && typeof input.city === 'string'
    && Object.hasOwn(MISSION_VAYU_CITY_PRESETS, input.city);
}

const SCHEMA_VERSION = 1;
const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TASKS = 100;
const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_OBSERVATIONS = 5000;
const MAX_EVENTS = 50_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const APPROVAL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$/;

const MISSION_TRANSITIONS = {
  CREATED: new Set(['VALIDATED', 'CANCELLED']),
  VALIDATED: new Set(['QUEUED', 'CANCELLED']),
  QUEUED: new Set(['RUNNING', 'WAITING_APPROVAL', 'PAUSED', 'BLOCKED', 'CANCELLED', 'COMPLETED']),
  RUNNING: new Set(['QUEUED', 'WAITING_APPROVAL', 'PAUSED', 'RETRYING', 'FAILED', 'BLOCKED', 'CANCELLED', 'COMPLETED']),
  WAITING_APPROVAL: new Set(['QUEUED', 'PAUSED', 'BLOCKED', 'CANCELLED']),
  PAUSED: new Set(['QUEUED', 'COMPLETED', 'CANCELLED']),
  RETRYING: new Set(['QUEUED', 'RUNNING', 'FAILED', 'BLOCKED', 'PAUSED', 'CANCELLED']),
  FAILED: new Set(['QUEUED', 'CANCELLED']),
  BLOCKED: new Set(['QUEUED', 'CANCELLED']),
  COMPLETED: new Set(),
  CANCELLED: new Set(),
};

const TASK_TRANSITIONS = {
  PENDING: new Set(['READY', 'BLOCKED', 'CANCELLED']),
  READY: new Set(['RUNNING', 'WAITING_APPROVAL', 'BLOCKED', 'CANCELLED']),
  RUNNING: new Set(['COMPLETED', 'RETRYING', 'FAILED', 'CANCELLED']),
  WAITING_APPROVAL: new Set(['READY', 'FAILED', 'CANCELLED']),
  RETRYING: new Set(['READY', 'RUNNING', 'FAILED', 'CANCELLED']),
  FAILED: new Set(['READY', 'CANCELLED']),
  BLOCKED: new Set(['READY', 'PENDING', 'CANCELLED']),
  COMPLETED: new Set(),
  CANCELLED: new Set(),
};

export class MissionEngineError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'MissionEngineError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function assertJson(value, label = 'value') {
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new MissionEngineError('INVALID_JSON', `${label} must be JSON serializable.`);
  }
  if (encoded === undefined || encoded.includes('"__proto__"')) {
    throw new MissionEngineError('INVALID_JSON', `${label} must be plain JSON data.`);
  }
  return encoded;
}

function requiredString(value, label, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new MissionEngineError('INVALID_MISSION', `${label} must be a non-empty string of at most ${max} characters.`);
  }
  return value.trim();
}

function safeDate(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new MissionEngineError('INVALID_TASK_INPUT', `${label} must be an ISO-compatible timestamp.`);
  }
  return new Date(value).toISOString();
}

function assertTransition(current, next, transitions, kind) {
  if (!transitions[current]?.has(next)) {
    throw new MissionEngineError('INVALID_TRANSITION', `Cannot transition ${kind} from ${current} to ${next}.`, { current, next, kind });
  }
}

function initialState() {
  return { schemaVersion: SCHEMA_VERSION, missions: {}, idempotency: {}, events: [] };
}

function envelopeFor(state) {
  const payload = canonical(state);
  return JSON.stringify({ format: 'climate-chain-missions', schemaVersion: SCHEMA_VERSION, checksum: digest(payload), payload });
}

function readEnvelope(text) {
  let envelope;
  try { envelope = JSON.parse(text); } catch {
    throw new MissionEngineError('STORE_CORRUPT', 'Mission store is not valid JSON; it was left untouched.');
  }
  if (!envelope || envelope.format !== 'climate-chain-missions' || envelope.schemaVersion !== SCHEMA_VERSION
      || typeof envelope.payload !== 'string' || typeof envelope.checksum !== 'string') {
    throw new MissionEngineError('STORE_VERSION_UNSUPPORTED', 'Mission store has an unsupported or malformed envelope; it was left untouched.');
  }
  const actual = digest(envelope.payload);
  const expectedBuf = Buffer.from(envelope.checksum, 'hex');
  const actualBuf = Buffer.from(actual, 'hex');
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    throw new MissionEngineError('STORE_CORRUPT', 'Mission store checksum verification failed; it was left untouched.');
  }
  let state;
  try { state = JSON.parse(envelope.payload); } catch {
    throw new MissionEngineError('STORE_CORRUPT', 'Mission store payload is malformed; it was left untouched.');
  }
  if (!state || state.schemaVersion !== SCHEMA_VERSION || !state.missions || !state.idempotency || !Array.isArray(state.events)) {
    throw new MissionEngineError('STORE_CORRUPT', 'Mission store state failed structural validation; it was left untouched.');
  }
  return state;
}

function topologicalOrder(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const marks = new Map();
  const order = [];
  function visit(id, chain = []) {
    const task = byId.get(id);
    if (!task) throw new MissionEngineError('INVALID_DEPENDENCY', `Task dependency does not exist: ${id}`);
    const mark = marks.get(id);
    if (mark === 'done') return;
    if (mark === 'visiting') throw new MissionEngineError('DEPENDENCY_CYCLE', `Mission dependency cycle: ${[...chain, id].join(' -> ')}`);
    marks.set(id, 'visiting');
    for (const dependencyId of task.dependsOn) {
      if (dependencyId === id) throw new MissionEngineError('DEPENDENCY_CYCLE', `Task ${id} cannot depend on itself.`);
      visit(dependencyId, [...chain, id]);
    }
    marks.set(id, 'done');
    order.push(id);
  }
  for (const task of tasks) visit(task.id);
  return order;
}

function scanRefs(value, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) scanRefs(item, found);
    return found;
  }
  if (!value || typeof value !== 'object') return found;
  if (Object.keys(value).length === 1 && value.$ref && typeof value.$ref === 'object') {
    found.push(value.$ref);
    return found;
  }
  for (const item of Object.values(value)) scanRefs(item, found);
  return found;
}

function validateTaskDefinition(task) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) throw new MissionEngineError('INVALID_MISSION', 'Each task must be an object.');
  if (!ID_RE.test(task.id ?? '')) throw new MissionEngineError('INVALID_MISSION', 'Task IDs must be 1-64 safe identifier characters.');
  if (!ALLOWED_TASK_TYPES.includes(task.type)) throw new MissionEngineError('TASK_NOT_ALLOWED', `Task type is not allowlisted: ${String(task.type)}`);
  const dependsOn = task.dependsOn ?? [];
  if (!Array.isArray(dependsOn) || dependsOn.length > MAX_TASKS || dependsOn.some((id) => typeof id !== 'string' || !ID_RE.test(id))) {
    throw new MissionEngineError('INVALID_MISSION', `Task ${task.id} dependencies must be safe task IDs.`);
  }
  const input = task.input ?? {};
  const inputBytes = Buffer.byteLength(assertJson(input, `Task ${task.id} input`));
  if (inputBytes > MAX_INPUT_BYTES) throw new MissionEngineError('INPUT_TOO_LARGE', `Task ${task.id} input exceeds the 1 MiB limit.`);
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new MissionEngineError('INVALID_MISSION', `Task ${task.id} input must be a JSON object.`);
  if (task.type === 'climate.connector_snapshot' && !isAllowedMissionConnectorInput(input)) {
    throw new MissionEngineError('INVALID_TASK_INPUT', 'Connector snapshots allow reviewed AshAlert aggregate reads or AirPulse reads for a configured city preset only.');
  }
  if (task.requiresApproval !== undefined && typeof task.requiresApproval !== 'boolean') {
    throw new MissionEngineError('INVALID_MISSION', `Task ${task.id} requiresApproval must be boolean.`);
  }
  const retry = task.retry ?? {};
  const maxAttempts = retry.maxAttempts ?? 0;
  const delayMs = retry.delayMs ?? 0;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 0 || maxAttempts > 5 || !Number.isInteger(delayMs) || delayMs < 0 || delayMs > 60_000) {
    throw new MissionEngineError('INVALID_MISSION', `Task ${task.id} retry policy is outside the supported bounds.`);
  }
  const timeoutMs = task.timeoutMs ?? 5000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new MissionEngineError('INVALID_MISSION', `Task ${task.id} timeoutMs must be between 100 and 30000.`);
  }
  return {
    id: task.id,
    type: task.type,
    title: requiredString(task.title ?? task.id, `Task ${task.id} title`, 160),
    dependsOn: [...new Set(dependsOn)],
    input: clone(input),
    requiresApproval: task.requiresApproval === true,
    retry: { maxAttempts, delayMs },
    timeoutMs,
  };
}

function validateRefs(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const task of tasks) {
    const refs = scanRefs(task.input);
    for (const ref of refs) {
      if (!ref || typeof ref !== 'object' || typeof ref.taskId !== 'string' || typeof ref.path !== 'string') {
        throw new MissionEngineError('INVALID_REFERENCE', `Task ${task.id} contains an invalid $ref.`);
      }
      if (!task.dependsOn.includes(ref.taskId) || !byId.has(ref.taskId)) {
        throw new MissionEngineError('INVALID_REFERENCE', `Task ${task.id} may only reference a declared dependency.`);
      }
      if (ref.path !== '' && (!ref.path.startsWith('/') || ref.path.split('/').some((part) => part === '..'))) {
        throw new MissionEngineError('INVALID_REFERENCE', `Task ${task.id} contains an invalid JSON pointer.`);
      }
    }
  }
}

function resolveRefs(value, taskResults) {
  if (Array.isArray(value)) return value.map((item) => resolveRefs(item, taskResults));
  if (!value || typeof value !== 'object') return value;
  if (Object.keys(value).length === 1 && value.$ref) {
    const { taskId, path: pointer } = value.$ref;
    const result = taskResults[taskId];
    if (!result || result.status !== 'COMPLETED') throw new MissionEngineError('DEPENDENCY_NOT_READY', `Dependency ${taskId} has no completed output.`);
    let current = result.output;
    if (pointer) {
      for (const rawSegment of pointer.slice(1).split('/')) {
        const segment = rawSegment.replaceAll('~1', '/').replaceAll('~0', '~');
        if (current === null || typeof current !== 'object' || !Object.hasOwn(current, segment)) {
          throw new MissionEngineError('INVALID_REFERENCE', `JSON pointer ${pointer} does not exist in task ${taskId} output.`);
        }
        current = current[segment];
      }
    }
    return clone(current);
  }
  const out = {};
  for (const [key, item] of Object.entries(value)) out[key] = resolveRefs(item, taskResults);
  return out;
}

function collectInputReferences(input, dependencyIds = []) {
  const references = new Set(dependencyIds.map((id) => `task-output:${id}`));
  function visit(value) {
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    if (!value || typeof value !== 'object') return;
    if (typeof value.sourceId === 'string' && value.sourceId.trim()) references.add(`source:${value.sourceId.trim()}`);
    if (typeof value.artifactRef === 'string' && value.artifactRef.trim()) references.add(`artifact:${value.artifactRef.trim()}`);
    if (typeof value.connector === 'string' && value.connector.trim()) references.add(`connector:${value.connector.trim()}`);
    for (const child of Object.values(value)) visit(child);
  }
  visit(input);
  return [...references];
}

function validateObservationInput(input) {
  if (!Array.isArray(input.observations) || input.observations.length === 0 || input.observations.length > MAX_OBSERVATIONS) {
    throw new MissionEngineError('INVALID_TASK_INPUT', `observations must contain 1-${MAX_OBSERVATIONS} records.`);
  }
  return input.observations.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new MissionEngineError('INVALID_TASK_INPUT', `Observation ${index} must be an object.`);
    if (typeof row.metric !== 'string' || !row.metric.trim() || row.metric.length > 100) throw new MissionEngineError('INVALID_TASK_INPUT', `Observation ${index} has an invalid metric.`);
    if (typeof row.unit !== 'string' || !row.unit.trim() || row.unit.length > 40) throw new MissionEngineError('INVALID_TASK_INPUT', `Observation ${index} has an invalid unit.`);
    if (typeof row.value !== 'number' || !Number.isFinite(row.value)) throw new MissionEngineError('INVALID_TASK_INPUT', `Observation ${index} value must be finite.`);
    if (typeof row.sourceId !== 'string' || !row.sourceId.trim() || row.sourceId.length > 200) throw new MissionEngineError('INVALID_TASK_INPUT', `Observation ${index} needs a sourceId.`);
    if (!['live', 'simulated', 'test_fixture'].includes(row.sourceStatus)) throw new MissionEngineError('INVALID_TASK_INPUT', `Observation ${index} must declare sourceStatus as live, simulated, or test_fixture.`);
    return {
      metric: row.metric.trim(), unit: row.unit.trim(), value: row.value,
      observedAt: safeDate(row.observedAt, `Observation ${index} observedAt`),
      sourceId: row.sourceId.trim(), sourceStatus: row.sourceStatus,
      geography: typeof row.geography === 'string' && row.geography.length <= 200 ? row.geography : null,
    };
  });
}

export function executeAllowlistedTask(type, input) {
  if (type === 'climate.connector_snapshot') {
    throw new MissionEngineError('CONNECTOR_EXECUTOR_REQUIRED', 'Connector snapshots must run through the bounded local connector registry worker.');
  }
  if (type === 'climate.observation_summary') {
    const rows = validateObservationInput(input);
    const grouped = new Map();
    for (const row of rows) {
      const key = `${row.metric}\u0000${row.unit}`;
      const group = grouped.get(key) ?? { metric: row.metric, unit: row.unit, values: [], observations: [] };
      group.values.push(row.value);
      group.observations.push(row);
      grouped.set(key, group);
    }
    const summaries = [...grouped.values()].map((group) => {
      const latestAt = group.observations.map((row) => row.observedAt).sort().at(-1);
      return {
        metric: group.metric, unit: group.unit, count: group.values.length,
        mean: group.values.reduce((sum, value) => sum + value, 0) / group.values.length,
        minimum: Math.min(...group.values), maximum: Math.max(...group.values),
        period: { start: group.observations.map((row) => row.observedAt).sort()[0], end: latestAt },
        geography: [...new Set(group.observations.map((row) => row.geography).filter(Boolean))],
        sources: [...new Set(group.observations.map((row) => row.sourceId))],
        sourceStatuses: [...new Set(group.observations.map((row) => row.sourceStatus))],
        dataKind: group.observations.some((row) => row.sourceStatus === 'simulated') ? 'mixed_or_simulated'
          : group.observations.some((row) => row.sourceStatus === 'test_fixture') ? 'test_fixture' : 'declared_observations',
      };
    });
    return {
      output: { summaries, provenance: rows.map(({ sourceId, sourceStatus, observedAt, geography }) => ({ sourceId, sourceStatus, observedAt, geography })) },
      validation: [{ check: 'compatible metric and unit grouped independently', passed: true }, { check: 'every observation has timestamp and source provenance', passed: true }],
      uncertainty: 'Summary statistics only; source-status labels were supplied by mission input and were not independently verified. Sampling coverage and measurement uncertainty were not supplied.',
      tool: 'local.allowlist.climate.observation_summary',
    };
  }

  if (type === 'climate.emissions_scenario') {
    const baselineTco2e = input.baselineTco2e;
    const reductionPercent = input.reductionPercent;
    const years = input.years;
    if (typeof baselineTco2e !== 'number' || !Number.isFinite(baselineTco2e) || baselineTco2e < 0
        || typeof reductionPercent !== 'number' || !Number.isFinite(reductionPercent) || reductionPercent < 0 || reductionPercent > 100
        || !Number.isInteger(years) || years < 1 || years > 100) {
      throw new MissionEngineError('INVALID_TASK_INPUT', 'Scenario requires baselineTco2e >= 0, reductionPercent in [0, 100], and integer years in [1, 100].');
    }
    const baselineTotal = baselineTco2e * years;
    const scenarioTotal = baselineTotal * (1 - reductionPercent / 200);
    return {
      output: {
        classification: 'SIMULATION', metric: 'cumulative_emissions', unit: 'tCO2e', years,
        baselineAnnualTco2e: baselineTco2e, baselineTotalTco2e: baselineTotal,
        targetReductionPercent: reductionPercent, estimatedScenarioTotalTco2e: scenarioTotal,
        estimatedAvoidedTco2e: baselineTotal - scenarioTotal,
      },
      validation: [{ check: 'scenario parameter bounds', passed: true }],
      uncertainty: 'Illustrative linear pathway estimate. It assumes constant baseline emissions and a linear reduction to the target; it is not a forecast or measured result.',
      tool: 'local.allowlist.climate.emissions_scenario',
    };
  }

  if (type === 'report.render') {
    const title = requiredString(input.title, 'Report title', 200);
    if (!Array.isArray(input.sections) || input.sections.length < 1 || input.sections.length > 50) {
      throw new MissionEngineError('INVALID_TASK_INPUT', 'Report sections must contain 1-50 entries.');
    }
    const sections = input.sections.map((section, index) => {
      if (!section || typeof section !== 'object' || Array.isArray(section)) throw new MissionEngineError('INVALID_TASK_INPUT', `Report section ${index} must be an object.`);
      const heading = requiredString(section.heading, `Report section ${index} heading`, 200);
      const body = assertJson(section.body ?? '', `Report section ${index} body`);
      return `## ${heading}\n\n${body === '""' ? '' : '```json\n' + JSON.stringify(JSON.parse(body), null, 2) + '\n```'}`;
    });
    const markdown = `# ${title}\n\n> Locally generated report artifact. Verify source provenance and uncertainty before operational use.\n\n${sections.join('\n\n')}`;
    return {
      output: { artifactName: 'mission-report.md', mediaType: 'text/markdown', markdown },
      validation: [{ check: 'report has bounded title and section count', passed: true }],
      uncertainty: 'Report rendering does not independently verify the inputs.',
      tool: 'local.allowlist.report.render',
    };
  }

  throw new MissionEngineError('TASK_NOT_ALLOWED', `Task type is not allowlisted: ${String(type)}`);
}

function sanitizeFailure(error) {
  const code = typeof error?.code === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.code) ? error.code : 'TASK_EXECUTION_FAILED';
  const message = String(error?.message ?? 'Task execution failed.').replace(/[\r\n\t]+/g, ' ').slice(0, 500);
  return { code, message };
}

function assertStateIntegrity(state) {
  for (const [missionId, mission] of Object.entries(state.missions)) {
    if (mission.id !== missionId || !MISSION_STATES.includes(mission.status) || !Array.isArray(mission.tasks)) {
      throw new MissionEngineError('STORE_CORRUPT', `Mission record ${missionId} failed structural validation; store left untouched.`);
    }
    const ids = new Set(mission.tasks.map((task) => task.id));
    if (ids.size !== mission.tasks.length || mission.tasks.some((task) => !TASK_STATES.includes(task.status) || task.dependsOn.some((id) => !ids.has(id)))) {
      throw new MissionEngineError('STORE_CORRUPT', `Mission ${missionId} task graph failed structural validation; store left untouched.`);
    }
  }
}

export function createMissionEngine({
  storePath = process.env.CLIMATE_CHAIN_MISSIONS_PATH,
  taskExecutor = executeAllowlistedTask,
  leaseMs = 30_000,
  lockTimeoutMs = 8_000,
  now = () => Date.now(),
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
} = {}) {
  const resolvedStorePath = path.resolve(storePath || path.join(
    process.env.LOCALAPPDATA || process.env.XDG_DATA_HOME || path.join(process.env.HOME || process.cwd(), '.local', 'share'),
    'ClimateChain', 'Missions', 'missions-v1.json',
  ));
  if (!Number.isInteger(leaseMs) || leaseMs < 100 || leaseMs > 300_000) throw new TypeError('leaseMs must be between 100 and 300000.');
  if (!Number.isInteger(lockTimeoutMs) || lockTimeoutMs < 100 || lockTimeoutMs > 60_000) throw new TypeError('lockTimeoutMs must be between 100 and 60000.');
  if (!Number.isInteger(maxFileBytes) || maxFileBytes < 1024) throw new TypeError('maxFileBytes must be at least 1024.');
  if (typeof taskExecutor !== 'function') throw new TypeError('taskExecutor must be a function.');

  const lockPath = `${resolvedStorePath}.lock`;
  let initialized = false;

  async function acquireLock() {
    await mkdir(path.dirname(resolvedStorePath), { recursive: true, mode: 0o700 });
    const startedAt = Date.now();
    const token = randomUUID();
    while (true) {
      try {
        const handle = await open(lockPath, 'wx', 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid, token, acquiredAt: new Date().toISOString() }));
        await handle.sync();
        return async () => {
          await handle.close().catch(() => {});
          try {
            const current = JSON.parse(await readFile(lockPath, 'utf8'));
            if (current.token === token) await rm(lockPath, { force: true });
          } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
          }
        };
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        try {
          const lockStat = await stat(lockPath);
          if (Date.now() - lockStat.mtimeMs > 60_000) {
            await rm(lockPath, { force: true });
            continue;
          }
        } catch (statError) {
          if (statError?.code === 'ENOENT') continue;
          throw statError;
        }
        if (Date.now() - startedAt >= lockTimeoutMs) throw new MissionEngineError('STORE_LOCK_TIMEOUT', 'Timed out waiting for the mission store lock.');
        await delay(10 + Math.floor(Math.random() * 35));
      }
    }
  }

  async function readState({ allowMissing = false } = {}) {
    let bytes;
    try { bytes = await readFile(resolvedStorePath); } catch (error) {
      if (error?.code === 'ENOENT' && allowMissing) return null;
      if (error?.code === 'ENOENT') throw new MissionEngineError('STORE_NOT_INITIALIZED', 'Mission store is missing; initialize the engine before reading.');
      throw error;
    }
    if (bytes.byteLength > maxFileBytes) throw new MissionEngineError('STORE_TOO_LARGE', `Mission store exceeds ${maxFileBytes} bytes; it was left untouched.`);
    const state = readEnvelope(bytes.toString('utf8'));
    assertStateIntegrity(state);
    return state;
  }

  async function writeState(state) {
    const text = envelopeFor(state);
    if (Buffer.byteLength(text) > maxFileBytes) throw new MissionEngineError('STORE_TOO_LARGE', `Mission store would exceed ${maxFileBytes} bytes.`);
    const tempPath = `${resolvedStorePath}.${process.pid}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(tempPath, 'wx', 0o600);
      await handle.writeFile(text, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await replaceFile(tempPath, resolvedStorePath);
      // Directory fsync is supported on POSIX. Windows filesystem semantics
      // still get the atomic rename and file fsync above.
      if (process.platform !== 'win32') {
        const dirHandle = await open(path.dirname(resolvedStorePath), 'r');
        try { await dirHandle.sync(); } finally { await dirHandle.close(); }
      }
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  async function transact(mutator) {
    const release = await acquireLock();
    try {
      const existing = await readState({ allowMissing: true });
      const state = existing ?? initialState();
      const result = await mutator(state);
      assertStateIntegrity(state);
      await writeState(state);
      initialized = true;
      return clone(result);
    } finally {
      await release();
    }
  }

  async function snapshot() {
    if (!initialized) await initialize();
    return readState();
  }

  function stamp() { return new Date(now()).toISOString(); }

  function addEvent(state, mission, type, details = {}, taskId = null) {
    const event = {
      id: randomUUID(), at: stamp(), missionId: mission.id, taskId,
      correlationId: mission.correlationId, type, details: clone(details),
    };
    state.events.push(event);
    if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
    mission.updatedAt = event.at;
    return event;
  }

  function transitionMission(state, mission, next, type, details = {}) {
    if (mission.status !== next) {
      assertTransition(mission.status, next, MISSION_TRANSITIONS, 'mission');
      const previous = mission.status;
      mission.status = next;
      mission.transitions.push({ from: previous, to: next, at: stamp() });
      addEvent(state, mission, type, { from: previous, to: next, ...details });
    }
  }

  function transitionTask(state, mission, task, next, type, details = {}) {
    if (task.status !== next) {
      assertTransition(task.status, next, TASK_TRANSITIONS, 'task');
      const previous = task.status;
      task.status = next;
      task.transitions.push({ from: previous, to: next, at: stamp() });
      addEvent(state, mission, type, { from: previous, to: next, ...details }, task.id);
    }
  }

  async function initialize() {
    if (initialized) return { status: 'ready', path: resolvedStorePath };
    await transact((state) => ({ missions: Object.keys(state.missions).length }));
    return { status: 'ready', path: resolvedStorePath };
  }

  function getMissionIn(state, id) {
    const mission = state.missions[id];
    if (!mission) throw new MissionEngineError('MISSION_NOT_FOUND', `Mission not found: ${id}`);
    return mission;
  }

  async function createMission(definition, { idempotencyKey } = {}) {
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) throw new MissionEngineError('INVALID_MISSION', 'Mission definition must be an object.');
    const title = requiredString(definition.title, 'Mission title', 200);
    if (!Array.isArray(definition.tasks) || definition.tasks.length < 1 || definition.tasks.length > MAX_TASKS) {
      throw new MissionEngineError('INVALID_MISSION', `Mission tasks must contain 1-${MAX_TASKS} tasks.`);
    }
    const tasks = definition.tasks.map(validateTaskDefinition);
    const ids = new Set(tasks.map((task) => task.id));
    if (ids.size !== tasks.length) throw new MissionEngineError('INVALID_MISSION', 'Task IDs must be unique within a mission.');
    for (const task of tasks) for (const dependency of task.dependsOn) if (!ids.has(dependency)) {
      throw new MissionEngineError('INVALID_DEPENDENCY', `Task ${task.id} depends on missing task ${dependency}.`);
    }
    const order = topologicalOrder(tasks);
    validateRefs(tasks);
    const description = typeof definition.description === 'string' ? definition.description.slice(0, 2000) : '';
    const memoryReferences = definition.memoryReferences ?? [];
    if (!Array.isArray(memoryReferences) || memoryReferences.length > 100 || memoryReferences.some((ref) => typeof ref !== 'string' || ref.length > 200)) {
      throw new MissionEngineError('INVALID_MISSION', 'memoryReferences must be up to 100 bounded identifiers.');
    }
    const cleanDefinition = { title, description, tasks, order, memoryReferences: [...memoryReferences] };
    const definitionHash = digest(cleanDefinition);
    if (idempotencyKey !== undefined && (typeof idempotencyKey !== 'string' || idempotencyKey.length < 1 || idempotencyKey.length > 200)) {
      throw new MissionEngineError('INVALID_IDEMPOTENCY_KEY', 'Idempotency key must contain 1-200 characters.');
    }
    const idempotencyHash = idempotencyKey === undefined ? null : digest(idempotencyKey);
    return transact((state) => {
      if (idempotencyHash && state.idempotency[idempotencyHash]) {
        const existing = state.idempotency[idempotencyHash];
        if (existing.definitionHash !== definitionHash) throw new MissionEngineError('IDEMPOTENCY_CONFLICT', 'This idempotency key was already used for a different mission.');
        return state.missions[existing.missionId];
      }
      const timestamp = stamp();
      const missionId = UUID_RE.test(definition.id ?? '') ? definition.id : randomUUID();
      if (state.missions[missionId]) throw new MissionEngineError('MISSION_EXISTS', `Mission already exists: ${missionId}`);
      const mission = {
        id: missionId, title, description, status: 'CREATED', schemaVersion: SCHEMA_VERSION,
        createdAt: timestamp, updatedAt: timestamp, correlationId: randomUUID(),
        memoryReferences: [...memoryReferences], memoryRetrieval: null, definitionHash,
        tasks: tasks.map((task) => ({ ...task, status: 'PENDING', attempts: 0, automaticRetries: 0, manualRetries: 0,
          nextAttemptAt: null, lease: null, output: null, evidence: null, failure: null, approval: null, transitions: [] })),
        transitions: [],
      };
      state.missions[mission.id] = mission;
      if (idempotencyHash) state.idempotency[idempotencyHash] = { definitionHash, missionId: mission.id };
      addEvent(state, mission, 'mission.created', { taskCount: tasks.length, taskTypes: [...new Set(tasks.map((task) => task.type))] });
      return mission;
    });
  }

  async function validateMission(missionId) {
    return transact((state) => {
      const mission = getMissionIn(state, missionId);
      if (mission.status !== 'CREATED') throw new MissionEngineError('INVALID_TRANSITION', `Only CREATED missions can be validated; received ${mission.status}.`);
      const order = topologicalOrder(mission.tasks);
      if (order.length !== mission.tasks.length) throw new MissionEngineError('INVALID_DEPENDENCY', 'Mission dependency validation failed.');
      validateRefs(mission.tasks);
      for (const task of mission.tasks) if (task.dependsOn.length === 0) transitionTask(state, mission, task, 'READY', 'task.ready');
      transitionMission(state, mission, 'VALIDATED', 'mission.validated', { taskOrder: order });
      return mission;
    });
  }

  async function queueMission(missionId) {
    return transact((state) => {
      const mission = getMissionIn(state, missionId);
      if (mission.status !== 'VALIDATED') throw new MissionEngineError('INVALID_TRANSITION', `Only VALIDATED missions can be queued; received ${mission.status}.`);
      transitionMission(state, mission, 'QUEUED', 'mission.queued');
      return mission;
    });
  }

  async function attachMemoryContext(missionId, { memoryIds = [], manifestSha256, retrievedAt = stamp() } = {}) {
    if (!Array.isArray(memoryIds) || memoryIds.length > 100 || memoryIds.some((id) => typeof id !== 'string' || id.length > 100)) {
      throw new MissionEngineError('INVALID_MEMORY_CONTEXT', 'Retrieved memory IDs must be a list of up to 100 bounded identifiers.');
    }
    if (typeof manifestSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(manifestSha256)) {
      throw new MissionEngineError('INVALID_MEMORY_CONTEXT', 'A verified memory manifest digest is required.');
    }
    if (typeof retrievedAt !== 'string' || !Number.isFinite(Date.parse(retrievedAt))) {
      throw new MissionEngineError('INVALID_MEMORY_CONTEXT', 'Memory retrieval time must be an ISO timestamp.');
    }
    return transact((state) => {
      const mission = getMissionIn(state, missionId);
      if (!['VALIDATED', 'QUEUED', 'PAUSED', 'RETRYING'].includes(mission.status)) {
        throw new MissionEngineError('INVALID_TRANSITION', `Memory context cannot be attached while mission is ${mission.status}.`);
      }
      const memoryRetrieval = {
        memoryIds: [...new Set(memoryIds)], manifestSha256: manifestSha256.toLowerCase(),
        retrievedAt: new Date(retrievedAt).toISOString(), trust: 'untrusted_reference_data',
        interpretation: 'IDs and manifest were retrieved; deterministic allowlisted handlers do not interpret memory instructions.',
      };
      mission.memoryRetrieval = memoryRetrieval;
      addEvent(state, mission, 'mission.memory_context_retrieved', {
        memoryIds: memoryRetrieval.memoryIds, manifestSha256: memoryRetrieval.manifestSha256,
        retrievedAt: memoryRetrieval.retrievedAt, interpretation: memoryRetrieval.interpretation,
      });
      return mission;
    });
  }

  function dependenciesComplete(mission, task) {
    return task.dependsOn.every((id) => mission.tasks.find((candidate) => candidate.id === id)?.status === 'COMPLETED');
  }

  function taskResults(mission) {
    return Object.fromEntries(mission.tasks.map((task) => [task.id, { status: task.status, output: task.output }]));
  }

  async function recoverExpiredLeases() {
    const nowMs = now();
    return transact((state) => {
      let recovered = 0;
      for (const mission of Object.values(state.missions)) {
        for (const task of mission.tasks) {
          if (task.status !== 'RUNNING' || !task.lease || Date.parse(task.lease.expiresAt) > nowMs) continue;
          const expiredWorker = task.lease.workerId;
          task.lease = null;
          const retryAvailable = task.automaticRetries < task.retry.maxAttempts;
          if (retryAvailable) {
            task.automaticRetries += 1;
            task.nextAttemptAt = new Date(nowMs + task.retry.delayMs).toISOString();
            transitionTask(state, mission, task, 'RETRYING', 'task.lease_expired', { workerId: expiredWorker, retry: task.automaticRetries });
            if (!['PAUSED', 'CANCELLED'].includes(mission.status)) transitionMission(state, mission, 'RETRYING', 'mission.worker_recovery', { taskId: task.id });
          } else {
            task.failure = { code: 'LEASE_EXPIRED', message: 'Worker lease expired and retry limit was reached.' };
            transitionTask(state, mission, task, 'FAILED', 'task.lease_expired', { workerId: expiredWorker, retryLimitReached: true });
            blockDependents(state, mission, task.id);
            if (!['PAUSED', 'CANCELLED'].includes(mission.status)) transitionMission(state, mission, 'FAILED', 'mission.worker_failure', { taskId: task.id });
          }
          recovered += 1;
        }
      }
      return { recovered };
    });
  }

  function blockDependents(state, mission, failedTaskId) {
    const blocked = new Set([failedTaskId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const task of mission.tasks) {
        if (!blocked.has(task.id) && task.dependsOn.some((id) => blocked.has(id))) {
          blocked.add(task.id);
          if (['PENDING', 'READY', 'RETRYING'].includes(task.status)) transitionTask(state, mission, task, 'BLOCKED', 'task.blocked', { dependency: task.dependsOn.find((id) => blocked.has(id)) });
          changed = true;
        }
      }
    }
  }

  async function claimNext({ workerId = `worker-${process.pid}`, missionId, requireMemoryContext = false } = {}) {
    requiredString(workerId, 'workerId', 128);
    await recoverExpiredLeases();
    return transact((state) => {
      const missions = Object.values(state.missions)
        .filter((mission) => (!missionId || mission.id === missionId)
          && (!requireMemoryContext || Boolean(mission.memoryRetrieval))
          && ['QUEUED', 'RUNNING', 'RETRYING'].includes(mission.status))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const mission of missions) {
        const task = mission.tasks.find((candidate) => ['READY', 'RETRYING'].includes(candidate.status)
          && (!candidate.nextAttemptAt || Date.parse(candidate.nextAttemptAt) <= now())
          && dependenciesComplete(mission, candidate));
        if (!task) continue;
        if (task.requiresApproval && !task.approval) {
          transitionTask(state, mission, task, 'WAITING_APPROVAL', 'task.approval_required');
          if (mission.status !== 'WAITING_APPROVAL') transitionMission(state, mission, 'WAITING_APPROVAL', 'mission.approval_required', { taskId: task.id });
          return { status: 'waiting_approval', missionId: mission.id, taskId: task.id };
        }
        const fromRetry = task.status === 'RETRYING';
        transitionTask(state, mission, task, 'RUNNING', fromRetry ? 'task.retry_started' : 'task.started', { workerId, attempt: task.attempts + 1 });
        task.attempts += 1;
        task.nextAttemptAt = null;
        task.lease = { workerId, token: randomUUID(), acquiredAt: stamp(), expiresAt: new Date(now() + leaseMs).toISOString() };
        if (mission.status !== 'RUNNING') transitionMission(state, mission, 'RUNNING', 'mission.started', { workerId });
        return { status: 'claimed', missionId: mission.id, taskId: task.id, workerId, leaseToken: task.lease.token, lease: clone(task.lease), type: task.type,
          input: resolveRefs(task.input, taskResults(mission)), taskResults: taskResults(mission), attempt: task.attempts,
          inputReferences: collectInputReferences(task.input, task.dependsOn),
          memoryReferences: clone(mission.memoryReferences), memoryRetrieval: clone(mission.memoryRetrieval), timeoutMs: task.timeoutMs };
      }
      const pendingApproval = missions.flatMap((mission) => mission.tasks.filter((task) => task.status === 'WAITING_APPROVAL').map((task) => ({ missionId: mission.id, taskId: task.id })))[0];
      if (pendingApproval) return { status: 'waiting_approval', ...pendingApproval };
      const waitingRetry = missions.flatMap((mission) => mission.tasks.filter((task) => task.status === 'RETRYING').map((task) => ({ missionId: mission.id, taskId: task.id, nextAttemptAt: task.nextAttemptAt })))[0];
      if (waitingRetry) return { status: 'retry_scheduled', ...waitingRetry };
      return { status: 'idle' };
    });
  }

  async function executeClaim(claimRef) {
    if (!claimRef || typeof claimRef !== 'object' || typeof claimRef.missionId !== 'string'
        || typeof claimRef.taskId !== 'string' || typeof claimRef.workerId !== 'string' || typeof claimRef.leaseToken !== 'string') {
      throw new MissionEngineError('INVALID_LEASE', 'A claimed mission task reference is required.');
    }
    const claim = await transact((state) => {
      const mission = getMissionIn(state, claimRef.missionId);
      const task = mission.tasks.find((candidate) => candidate.id === claimRef.taskId);
      if (!task || task.status !== 'RUNNING' || task.lease?.token !== claimRef.leaseToken || task.lease?.workerId !== claimRef.workerId) {
        return null;
      }
      if (mission.status === 'CANCELLED') return null;
      return {
        status: 'claimed', missionId: mission.id, taskId: task.id, workerId: claimRef.workerId,
        leaseToken: task.lease.token, type: task.type, input: resolveRefs(task.input, taskResults(mission)),
        taskResults: taskResults(mission), memoryReferences: clone(mission.memoryReferences), memoryRetrieval: clone(mission.memoryRetrieval), timeoutMs: task.timeoutMs,
        inputReferences: collectInputReferences(task.input, task.dependsOn),
      };
    });
    if (!claim) return { status: 'lease_lost', missionId: claimRef.missionId, taskId: claimRef.taskId };

    let result;
    let taskError = null;
    const started = now();
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(new Error('Task execution timed out.')), claim.timeoutMs);
    try {
      result = await taskExecutor(claim.type, claim.input, { signal: timeoutController.signal, timeoutMs: claim.timeoutMs });
      if (timeoutController.signal.aborted || now() - started > claim.timeoutMs) throw new MissionEngineError('TASK_TIMEOUT', 'Allowlisted task exceeded its configured execution time.');
      if (Buffer.byteLength(JSON.stringify(result.output)) > MAX_OUTPUT_BYTES) throw new MissionEngineError('OUTPUT_TOO_LARGE', 'Task output exceeded the 2 MiB limit.');
    } catch (error) {
      taskError = sanitizeFailure(error);
    } finally {
      clearTimeout(timeout);
    }

    return transact((state) => {
      const mission = getMissionIn(state, claim.missionId);
      const task = mission.tasks.find((candidate) => candidate.id === claim.taskId);
      if (task.status !== 'RUNNING' || task.lease?.token !== claim.leaseToken || task.lease?.workerId !== claim.workerId) {
        return { status: 'lease_lost', missionId: mission.id, taskId: task.id };
      }
      if (mission.status === 'CANCELLED' || task.status === 'CANCELLED') return { status: 'cancelled', missionId: mission.id, taskId: task.id };
      task.lease = null;
      if (taskError) {
        task.failure = taskError;
        if (task.automaticRetries < task.retry.maxAttempts) {
          task.automaticRetries += 1;
          task.nextAttemptAt = new Date(now() + task.retry.delayMs).toISOString();
          transitionTask(state, mission, task, 'RETRYING', 'task.retry_scheduled', { failure: taskError, retry: task.automaticRetries });
          if (mission.status !== 'PAUSED') transitionMission(state, mission, 'RETRYING', 'mission.retry_scheduled', { taskId: task.id });
          return { status: 'retry_scheduled', missionId: mission.id, taskId: task.id, nextAttemptAt: task.nextAttemptAt, failure: taskError };
        }
        transitionTask(state, mission, task, 'FAILED', 'task.failed', { failure: taskError });
        blockDependents(state, mission, task.id);
        if (mission.status !== 'PAUSED') transitionMission(state, mission, 'FAILED', 'mission.failed', { taskId: task.id, failure: taskError });
        return { status: 'failed', missionId: mission.id, taskId: task.id, failure: taskError };
      }

      const outputHash = digest(result.output);
      task.output = clone(result.output);
      task.evidence = {
        inputReferences: claim.inputReferences,
        inputReferenceVerification: 'Input identifiers are declared mission data and were not independently resolved by this engine.',
        taskInputDigest: digest(claim.input),
        toolsInvoked: [result.tool],
        outputArtifacts: [{ id: `sha256:${outputHash}`, mediaType: result.output.mediaType || 'application/json', byteLength: Buffer.byteLength(JSON.stringify(result.output)) }],
        sourceProvenance: result.provenance ? clone(result.provenance) : null,
        validationResults: clone(result.validation),
        relevantEngineeringMemories: clone(claim.memoryRetrieval?.memoryIds || []),
        declaredEngineeringMemoryReferences: clone(claim.memoryReferences),
        memoryContextStatus: claim.memoryRetrieval
          ? (claim.memoryRetrieval.memoryIds.length ? 'retrieved_not_interpreted_by_deterministic_task' : 'retrieval_completed_no_matching_memory')
          : claim.memoryReferences.length ? 'declared_not_retrieved' : 'not_attached',
        memoryManifestSha256: claim.memoryRetrieval?.manifestSha256 || null,
        memoryRetrievedAt: claim.memoryRetrieval?.retrievedAt || null,
        uncertainty: result.uncertainty,
        executedAt: stamp(),
        approval: clone(task.approval),
        classification: result.output.classification || 'DETERMINISTIC_LOCAL_TRANSFORMATION',
      };
      transitionTask(state, mission, task, 'COMPLETED', 'task.completed', { outputDigest: outputHash, evidenceDigest: digest(task.evidence) });
      const allComplete = mission.tasks.every((candidate) => candidate.status === 'COMPLETED');
      if (allComplete) transitionMission(state, mission, 'COMPLETED', 'mission.completed', { completedTasks: mission.tasks.length });
      else if (mission.status === 'PAUSED') addEvent(state, mission, 'mission.task_completed_while_paused', { taskId: task.id });
      else {
        for (const next of mission.tasks) {
          if (next.status === 'PENDING' && dependenciesComplete(mission, next)) transitionTask(state, mission, next, 'READY', 'task.ready', { dependencies: next.dependsOn });
        }
      }
      return { status: allComplete ? 'mission_completed' : 'task_completed', missionId: mission.id, taskId: task.id, evidence: task.evidence };
    });
  }

  async function runNext(options = {}) {
    const claim = await claimNext(options);
    if (claim.status !== 'claimed') return claim;
    return executeClaim(claim);
  }

  async function runMission(missionId, { workerId = `worker-${process.pid}`, maxSteps = 100, requireMemoryContext = false } = {}) {
    if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 1000) throw new TypeError('maxSteps must be between 1 and 1000.');
    let last = { status: 'idle' };
    for (let step = 0; step < maxSteps; step += 1) {
      last = await runNext({ workerId, missionId, requireMemoryContext });
      if (!['task_completed'].includes(last.status)) break;
    }
    return { ...last, mission: await getMission(missionId) };
  }

  async function approveTask(missionId, taskId, { approvedBy, decision = 'approve', comment = '' } = {}) {
    const approver = requiredString(approvedBy, 'approvedBy', 128);
    if (!APPROVAL_ID_RE.test(approver)) throw new MissionEngineError('INVALID_APPROVAL', 'approvedBy must be a safe human identifier.');
    if (!['approve', 'reject'].includes(decision)) throw new MissionEngineError('INVALID_APPROVAL', 'decision must be approve or reject.');
    if (typeof comment !== 'string' || comment.length > 1000) throw new MissionEngineError('INVALID_APPROVAL', 'Approval comment must be at most 1000 characters.');
    return transact((state) => {
      const mission = getMissionIn(state, missionId);
      const task = mission.tasks.find((candidate) => candidate.id === taskId);
      if (!task) throw new MissionEngineError('TASK_NOT_FOUND', `Task not found: ${taskId}`);
      if (task.status !== 'WAITING_APPROVAL') throw new MissionEngineError('INVALID_TRANSITION', `Task ${taskId} is not waiting for approval.`);
      task.approval = { decision, approvedBy: approver, comment: comment.trim(), decidedAt: stamp() };
      if (decision === 'approve') {
        transitionTask(state, mission, task, 'READY', 'task.approved', { approvedBy: approver });
        transitionMission(state, mission, 'QUEUED', 'mission.approved', { taskId, approvedBy: approver });
      } else {
        task.failure = { code: 'HUMAN_REJECTED', message: 'Human approval was rejected.' };
        transitionTask(state, mission, task, 'FAILED', 'task.rejected', { approvedBy: approver, comment: comment.trim() });
        blockDependents(state, mission, task.id);
        transitionMission(state, mission, 'BLOCKED', 'mission.approval_rejected', { taskId, approvedBy: approver });
      }
      return mission;
    });
  }

  async function pauseMission(missionId, { actor = 'local-operator' } = {}) {
    return transact((state) => {
      const mission = getMissionIn(state, missionId);
      if (['COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED', 'PAUSED'].includes(mission.status)) throw new MissionEngineError('INVALID_TRANSITION', `Mission ${mission.status} cannot be paused.`);
      transitionMission(state, mission, 'PAUSED', 'mission.paused', { actor: requiredString(actor, 'actor', 128) });
      return mission;
    });
  }

  async function resumeMission(missionId, { actor = 'local-operator' } = {}) {
    return transact((state) => {
      const mission = getMissionIn(state, missionId);
      if (mission.status !== 'PAUSED') throw new MissionEngineError('INVALID_TRANSITION', `Only PAUSED missions can resume; received ${mission.status}.`);
      transitionMission(state, mission, 'QUEUED', 'mission.resumed', { actor: requiredString(actor, 'actor', 128) });
      return mission;
    });
  }

  async function cancelMission(missionId, { actor = 'local-operator', reason = '' } = {}) {
    return transact((state) => {
      const mission = getMissionIn(state, missionId);
      if (['COMPLETED', 'CANCELLED'].includes(mission.status)) throw new MissionEngineError('INVALID_TRANSITION', `Mission ${mission.status} is terminal.`);
      const safeActor = requiredString(actor, 'actor', 128);
      if (typeof reason !== 'string' || reason.length > 500) throw new MissionEngineError('INVALID_MISSION', 'Cancellation reason must be at most 500 characters.');
      for (const task of mission.tasks) {
        if (task.status !== 'COMPLETED' && task.status !== 'CANCELLED') {
          task.lease = null;
          transitionTask(state, mission, task, 'CANCELLED', 'task.cancelled', { actor: safeActor });
        }
      }
      transitionMission(state, mission, 'CANCELLED', 'mission.cancelled', { actor: safeActor, reason: reason.slice(0, 500) });
      return mission;
    });
  }

  async function retryTask(missionId, taskId, { actor = 'local-operator', reason = '' } = {}) {
    return transact((state) => {
      const mission = getMissionIn(state, missionId);
      if (!['FAILED', 'BLOCKED'].includes(mission.status)) throw new MissionEngineError('INVALID_TRANSITION', `Only FAILED or BLOCKED missions can be manually retried.`);
      const task = mission.tasks.find((candidate) => candidate.id === taskId);
      if (!task || !['FAILED', 'BLOCKED'].includes(task.status)) throw new MissionEngineError('INVALID_TRANSITION', `Task ${taskId} is not failed or blocked.`);
      const safeActor = requiredString(actor, 'actor', 128);
      if (typeof reason !== 'string' || reason.length > 500) throw new MissionEngineError('INVALID_MISSION', 'Retry reason must be at most 500 characters.');
      const reset = new Set([task.id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const candidate of mission.tasks) if (!reset.has(candidate.id) && candidate.dependsOn.some((id) => reset.has(id))) { reset.add(candidate.id); changed = true; }
      }
      for (const candidate of mission.tasks) {
        if (!reset.has(candidate.id) || !['FAILED', 'BLOCKED'].includes(candidate.status)) continue;
        candidate.failure = null;
        candidate.output = null;
        candidate.evidence = null;
        candidate.lease = null;
        candidate.nextAttemptAt = null;
        candidate.manualRetries += 1;
        const next = dependenciesComplete(mission, candidate) ? 'READY' : 'PENDING';
        transitionTask(state, mission, candidate, next, 'task.manual_retry', { actor: safeActor, reason: reason.slice(0, 500) });
      }
      transitionMission(state, mission, 'QUEUED', 'mission.manual_retry', { taskId, actor: safeActor, reason: reason.slice(0, 500) });
      return mission;
    });
  }

  async function getMission(missionId) {
    const state = await snapshot();
    return clone(getMissionIn(state, missionId));
  }

  async function listMissions({ limit = 100, statuses } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new TypeError('limit must be between 1 and 1000.');
    if (statuses !== undefined && (!Array.isArray(statuses) || statuses.some((status) => !MISSION_STATES.includes(status)))) throw new TypeError('statuses must be valid mission states.');
    const state = await snapshot();
    return Object.values(state.missions).filter((mission) => !statuses || statuses.includes(mission.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map(clone);
  }

  async function getEvents(missionId) {
    const state = await snapshot();
    getMissionIn(state, missionId);
    return state.events.filter((event) => event.missionId === missionId).map(clone);
  }

  async function getExecutionEvidence(missionId, taskId) {
    const mission = await getMission(missionId);
    const task = mission.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new MissionEngineError('TASK_NOT_FOUND', `Task not found: ${taskId}`);
    return clone(task.evidence);
  }

  async function exportMission(missionId) {
    const mission = await getMission(missionId);
    const definition = {
      title: mission.title, description: mission.description, memoryReferences: mission.memoryReferences,
      tasks: mission.tasks.map(({ id, type, title, dependsOn, input, requiresApproval, retry, timeoutMs }) => ({ id, type, title, dependsOn, input, requiresApproval, retry, timeoutMs })),
    };
    const payload = canonical(definition);
    return { format: 'climate-chain-mission-definition', schemaVersion: 1, checksum: digest(payload), payload };
  }

  async function importMission(document, { idempotencyKey } = {}) {
    if (!document || document.format !== 'climate-chain-mission-definition' || document.schemaVersion !== 1 || typeof document.payload !== 'string') {
      throw new MissionEngineError('INVALID_EXPORT', 'Mission definition export is malformed or unsupported.');
    }
    if (digest(document.payload) !== document.checksum) throw new MissionEngineError('INVALID_EXPORT', 'Mission definition checksum verification failed.');
    let definition;
    try { definition = JSON.parse(document.payload); } catch { throw new MissionEngineError('INVALID_EXPORT', 'Mission definition payload is malformed.'); }
    return createMission(definition, { idempotencyKey });
  }

  async function verifyIntegrity() {
    try {
      const state = await snapshot();
      return { valid: true, schemaVersion: state.schemaVersion, missions: Object.keys(state.missions).length, events: state.events.length };
    } catch (error) {
      return { valid: false, code: error.code || 'STORE_READ_FAILED', message: error.message };
    }
  }

  return Object.freeze({
    path: resolvedStorePath,
    initialize,
    createMission,
    validateMission,
    queueMission,
    attachMemoryContext,
    runNext,
    runMission,
    recoverExpiredLeases,
    claimNext,
    executeClaim,
    approveTask,
    pauseMission,
    resumeMission,
    cancelMission,
    retryTask,
    getMission,
    listMissions,
    getEvents,
    getExecutionEvidence,
    exportMission,
    importMission,
    verifyIntegrity,
  });
}

