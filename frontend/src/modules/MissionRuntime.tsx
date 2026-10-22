import { useCallback, useEffect, useMemo, useState } from 'react';
import { CAPABILITIES, FOCUSES, STAGES, type FocusId, type StageId } from '../data/capabilities';
import { createDurableMission, durableMissionAction, fetchDurableMission, fetchDurableMissions, fetchGatewayHealth, type DurableMission, type DurableMissionDefinition, type DurableMissionEvent, type GatewayHealth } from '../api';
import type { Overview } from '../types';

type MissionStatus = 'planned' | 'running' | 'paused' | 'simulated' | 'failed';
type StageStatus = 'waiting' | 'ready' | 'simulated';
interface MissionRecord {
  id: string;
  title: string;
  place: string;
  focus: FocusId;
  capabilityIds: string[];
  status: MissionStatus;
  stages: Record<StageId, StageStatus>;
  approved: boolean;
  createdAt: string;
  updatedAt: string;
  events: { id: string; at: string; label: string; detail: string }[];
  report?: string;
}

const STORAGE_KEY = 'climate-chain.missions.v1';
const EMPTY_STAGES: Record<StageId, StageStatus> = { sense: 'waiting', verify: 'waiting', act: 'waiting', finance: 'waiting', prove: 'waiting' };
const ids = new Set(CAPABILITIES.map((item) => item.id));
const stageIds = STAGES.map((stage) => stage.id);
const focusIds = new Set(FOCUSES.map((item) => item.id));

function validMission(value: unknown): value is MissionRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<MissionRecord>;
  return typeof item.id === 'string' && item.id.length > 0 && typeof item.title === 'string'
    && typeof item.place === 'string' && typeof item.focus === 'string' && focusIds.has(item.focus as FocusId)
    && Array.isArray(item.capabilityIds) && item.capabilityIds.every((id) => typeof id === 'string' && ids.has(id))
    && ['planned', 'running', 'paused', 'simulated', 'failed'].includes(item.status ?? '')
    && !!item.stages && stageIds.every((stage) => ['waiting', 'ready', 'simulated'].includes(item.stages?.[stage] ?? ''))
    && typeof item.approved === 'boolean' && typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt))
    && typeof item.updatedAt === 'string' && Number.isFinite(Date.parse(item.updatedAt))
    && Array.isArray(item.events) && item.events.every((entry) => entry && typeof entry.id === 'string' && typeof entry.at === 'string' && Number.isFinite(Date.parse(entry.at)) && typeof entry.label === 'string' && typeof entry.detail === 'string')
    && (item.report === undefined || (typeof item.report === 'string' && item.report.length <= 1_000_000));
}

function readMissions(): MissionRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    const records = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && (parsed as { schemaVersion?: unknown }).schemaVersion === 1 && Array.isArray((parsed as { missions?: unknown }).missions) ? (parsed as { missions: unknown[] }).missions : null;
    if (!records || records.some((item) => !validMission(item))) {
      throw new Error('Saved mission history has an unsupported format. Exported browser data was not replaced.');
    }
    return records as MissionRecord[];
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Saved mission history could not be read. It was left untouched; export or clear this browser storage only after review.', { cause: error });
    throw error;
  }
}

function saveMissions(records: MissionRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, missions: records }));
}

function event(label: string, detail: string) {
  return { id: crypto.randomUUID(), at: new Date().toISOString(), label, detail };
}

function validateMission(record: MissionRecord) {
  const missing = record.capabilityIds.filter((id) => !ids.has(id));
  const dependencies = record.capabilityIds.flatMap((id) => {
    const capability = CAPABILITIES.find((item) => item.id === id);
    return capability?.stages.some((stage) => !stageIds.includes(stage)) ? [id] : [];
  });
  return missing.length || dependencies.length
    ? `Mission references unavailable capability or stage data (${[...missing, ...dependencies].join(', ')}).`
    : null;
}

function reportFor(mission: MissionRecord, data: Overview | null) {
  const names = mission.capabilityIds.map((id) => CAPABILITIES.find((item) => item.id === id)?.name ?? id);
  return [
    `# ${mission.title}`,
    '',
    `- Place: ${mission.place || 'Not specified'}`,
    `- Status: ${mission.status === 'simulated' ? 'Local dry run simulated' : mission.status}`,
    `- Created: ${mission.createdAt}`,
    `- Last updated: ${mission.updatedAt}`,
    `- Source snapshot: ${data ? new Date(data.asOf).toISOString() : 'unavailable'}`,
    `- Included capabilities: ${names.join(', ') || 'none'}`,
    '',
    '## Stage history',
    ...STAGES.map((stage) => `- ${stage.title}: ${mission.stages[stage.id]}`),
    '',
    '## Timeline',
    ...mission.events.map((item) => `- ${item.at} — ${item.label}: ${item.detail}`),
    '',
    'This browser-only dry run did not execute specialist APIs, approvals, funding, or field actions.',
  ].join('\n');
}

export function durableReport(mission: DurableMission, events: DurableMissionEvent[]) {
  const lines = [
    `# ${mission.title}`, '',
    `- Mission ID: ${mission.id}`,
    `- Status: ${mission.status}`,
    `- Correlation ID: ${mission.correlationId}`,
    `- Created: ${mission.createdAt}`,
    `- Updated: ${mission.updatedAt}`,
    `- Memory retrieval: ${mission.memoryRetrieval ? `${mission.memoryRetrieval.memoryIds.length} IDs checked against ${mission.memoryRetrieval.manifestSha256}` : 'not yet recorded'}`,
    '', '## Tasks', '',
  ];
  for (const task of mission.tasks) {
    lines.push(`### ${task.title}`, '', `- Type: ${task.type}`, `- Status: ${task.status}`);
    if (task.failure) lines.push(`- Failure: ${task.failure.code} — ${task.failure.message}`);
    if (task.output) lines.push('', '#### Output', '', '```json', JSON.stringify(task.output, null, 2), '```');
    if (task.evidence) lines.push('', '#### Evidence', '', '```json', JSON.stringify(task.evidence, null, 2), '```');
    lines.push('');
  }
  lines.push('## Event history', '', ...events.map((item) => `- ${item.at} — ${item.type}${item.taskId ? ` (${item.taskId})` : ''}: ${JSON.stringify(item.details)}`), '',
    'This execution used bounded deterministic local task adapters. Evidence validates inputs and records output digests; it does not independently verify source claims or execute specialist side effects.');
  return lines.join('\n');
}

function workerHealthLabel(worker: GatewayHealth['worker']): string {
  if (worker.status === 'running' && worker.available) return `online · heartbeat ${Math.max(0, Math.floor((worker.ageMs ?? 0) / 1000))}s ago`;
  if (worker.status === 'restarting') return `restarting · retry in ${worker.backoffMs ?? '—'} ms`;
  if (worker.status === 'stale') return 'heartbeat stale · inspect supervisor logs or restart the launcher';
  if (worker.status === 'starting') return 'starting · awaiting first heartbeat';
  if (worker.status === 'stopping') return 'stopping';
  if (worker.status === 'stopped') return 'stopped · restart the launcher or run npm run worker';
  if (worker.status === 'unknown') return 'not detected · start with start.ps1 or npm run worker';
  return `status unavailable${worker.errorCode ? ` · ${worker.errorCode}` : ''}`;
}

export function buildDurableMissionDefinition(title: string, place: string, data: Overview): DurableMissionDefinition {
  const observedAt = new Date(data.asOf).toISOString();
  const sourceStatus = (source: keyof Overview['sources']) => {
    const status = data.sources[source];
    if (status.mode !== 'live') return 'simulated';
    if (source === 'vayu' && status.provenance?.mode && !['live', 'measured', 'source_snapshot'].includes(status.provenance.mode)) return 'simulated';
    return 'live';
  };
  const observations = [
    { metric: 'open_waste_sites', value: data.waste.open, unit: 'sites', observedAt, sourceId: 'overview:junksnap', sourceStatus: sourceStatus('junksnap'), geography: place.trim() || data.city.name },
    { metric: 'cleared_land', value: data.fire.acresCleared, unit: 'acres', observedAt, sourceId: 'overview:clearsky', sourceStatus: sourceStatus('clearsky'), geography: 'ClearSky service scope' },
    { metric: 'households_warned', value: data.water.warned, unit: 'households', observedAt, sourceId: 'overview:teesri', sourceStatus: sourceStatus('teesri'), geography: 'Teesri service scope' },
    ...(data.air.pm25Now === null ? [] : [{ metric: 'pm25', value: data.air.pm25Now, unit: 'ug/m3', observedAt: data.air.provenance?.asOf ?? observedAt, sourceId: 'overview:vayu', sourceStatus: sourceStatus('vayu'), geography: data.city.name }]),
  ];
  const hasLiveAggregateConnector = data.sources.clearsky.mode === 'live' && data.sources.clearsky.connection === 'connected';
  const cityKey = data.city.name.toLocaleLowerCase('en-US');
  const hasLiveVayuConnector = ['delhi', 'jodhpur', 'chandigarh'].includes(cityKey)
    && data.sources.vayu.mode === 'live' && data.sources.vayu.connection === 'connected';
  const tasks: DurableMissionDefinition['tasks'] = [
    ...(hasLiveAggregateConnector ? [{ id: 'clearsky', type: 'climate.connector_snapshot', title: 'Refresh ClearSky aggregate statistics', input: { connector: 'clearsky' }, timeoutMs: 8_000, retry: { maxAttempts: 1, delayMs: 500 } }] : []),
    ...(hasLiveVayuConnector ? [{ id: 'vayu', type: 'climate.connector_snapshot', title: 'Refresh Vayu city air-quality sample', input: { connector: 'vayu', city: cityKey }, timeoutMs: 8_000, retry: { maxAttempts: 1, delayMs: 500 } }] : []),
    { id: 'observations', type: 'climate.observation_summary', title: 'Summarize scoped source observations', input: { observations } },
    {
      id: 'report', type: 'report.render', title: 'Render evidence-bound report',
      dependsOn: ['observations', ...(hasLiveAggregateConnector ? ['clearsky'] : []), ...(hasLiveVayuConnector ? ['vayu'] : [])],
      input: {
        title: 'Climate source review',
        sections: [
          { heading: 'Typed summaries', body: { $ref: { taskId: 'observations', path: '/summaries' } } },
          { heading: 'Source provenance', body: { $ref: { taskId: 'observations', path: '/provenance' } } },
          ...(hasLiveAggregateConnector ? [{ heading: 'Fresh ClearSky aggregate snapshot and provenance', body: { $ref: { taskId: 'clearsky', path: '' } } }] : []),
          ...(hasLiveVayuConnector ? [{ heading: 'Fresh Vayu city PM2.5 samples with reported data kind', body: { $ref: { taskId: 'vayu', path: '' } } }] : []),
        ],
      },
    },
  ];
  return {
    title: `${title.trim() || 'Climate intelligence'} — source review`,
    description: `Durable local execution over the latest normalized source snapshot for ${place.trim() || data.city.name}.${hasLiveAggregateConnector ? ' The worker also refreshes public ClearSky aggregate statistics.' : ''}${hasLiveVayuConnector ? ' The worker also refreshes Vayu at the configured city center and stores a privacy-limited sample.' : ''} Source modes remain attached to each row.`,
    tasks,
  };
}

function DurableMissionPanel({ title, place, data, loading }: { title: string; place: string; data: Overview | null; loading: boolean }) {
  const [missions, setMissions] = useState<DurableMission[]>([]);
  const [events, setEvents] = useState<DurableMissionEvent[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [integrity, setIntegrity] = useState<{ valid: boolean; code?: string; message?: string } | null>(null);
  const [gatewayHealth, setGatewayHealth] = useState<GatewayHealth | null>(null);
  const [gatewayHealthError, setGatewayHealthError] = useState('');
  const selected = missions.find((mission) => mission.id === selectedId) ?? null;
  const workerPending = missions.some((mission) => ['QUEUED', 'RETRYING'].includes(mission.status) && mission.memoryRetrieval !== null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const snapshot = await fetchDurableMissions(signal);
      setMissions(snapshot.missions);
      setIntegrity(snapshot.integrity);
      setError(snapshot.integrity.valid ? '' : `Mission store integrity check failed: ${snapshot.integrity.code ?? snapshot.integrity.message ?? 'unknown error'}`);
      const targetId = selectedId || snapshot.missions[0]?.id || '';
      if (targetId && snapshot.missions.some((mission) => mission.id === targetId)) {
        const detail = await fetchDurableMission(targetId, signal);
        setSelectedId(targetId);
        setEvents(detail.events);
      } else {
        setEvents([]);
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : 'Could not reach the local mission service.');
      setIntegrity(null);
    } finally {
      setLoadingList(false);
    }
  }, [selectedId]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = window.setInterval(() => { void refresh(controller.signal); }, workerPending ? 1_000 : 15_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [refresh, workerPending]);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    let request: AbortController | undefined;
    const poll = async () => {
      request = new AbortController();
      try {
        const health = await fetchGatewayHealth(request.signal);
        if (!active) return;
        setGatewayHealth(health);
        setGatewayHealthError('');
      } catch (cause) {
        if (!active || (cause instanceof DOMException && cause.name === 'AbortError')) return;
        setGatewayHealth(null);
        setGatewayHealthError(cause instanceof Error ? cause.message : 'System health is unavailable.');
      } finally {
        if (active) timer = window.setTimeout(() => { void poll(); }, 4_000);
      }
    };
    void poll();
    return () => { active = false; request?.abort(); if (timer !== undefined) window.clearTimeout(timer); };
  }, []);

  async function selectMission(id: string) {
    setSelectedId(id);
    setError('');
    try { const detail = await fetchDurableMission(id); setEvents(detail.events); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load mission events.'); }
  }

  async function createFromSnapshot() {
    if (!data) { setError('A unified source snapshot is required before creating a mission. Refresh the Command Center and retry.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const definition = buildDurableMissionDefinition(title, place, data);
      const result = await createDurableMission(definition, crypto.randomUUID());
      setSelectedId(result.mission.id);
      setNotice('Mission persisted by the local gateway. Validate and queue it to review the execution plan.');
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Mission creation failed.'); }
    finally { setBusy(false); }
  }

  async function action(name: 'validate' | 'queue' | 'run' | 'pause' | 'resume' | 'cancel') {
    if (!selected) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (name === 'validate') {
        await durableMissionAction(selected.id, 'validate');
        await durableMissionAction(selected.id, 'queue');
        setNotice('Dependency graph validated and mission queued in the durable local store.');
      } else {
        const result = await durableMissionAction(selected.id, name);
        setNotice(name === 'run' && result.status === 'queued_for_worker'
          ? 'Memory readiness passed. The mission is queued for the local worker.'
          : name === 'run' ? `Local worker returned ${result.status ?? result.mission?.status ?? 'a visible state'}.` : `Mission ${name} request recorded.`);
      }
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : `Mission ${name} failed.`); }
    finally { setBusy(false); }
  }

  function exportReport() {
    if (!selected) return;
    const content = durableReport(selected, events);
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${selected.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'climate-mission'}-execution-report.md`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('Execution report exported with task outputs, memory retrieval trace, and evidence records.');
  }

  return <section className="card durable-mission-panel" aria-label="Durable backend mission execution">
    <div className="section-heading"><div><span className="eyebrow">DURABLE LOCAL EXECUTION</span><h2>Gateway mission engine</h2><p>Server-persisted workflow with a checksummed store, bounded deterministic task allowlist, memory-readiness gate, and evidence trace.</p></div><div className="durable-mission-toolbar"><span className={integrity?.valid ? 'durable-store-state ready' : 'durable-store-state'}>{integrity?.valid ? 'STORE VERIFIED' : loadingList ? 'CHECKING STORE' : 'STORE UNAVAILABLE'}</span><button type="button" className="mini-action" onClick={() => { setLoadingList(true); void refresh(); }}>Refresh</button></div></div>
    <div className={`gateway-health-summary ${gatewayHealth?.status === 'ready' ? 'ready' : ''}`} role="status"><strong>{gatewayHealth ? gatewayHealth.status === 'ready' ? 'System ready' : 'System degraded' : gatewayHealthError ? 'Gateway health unavailable' : 'Checking gateway health'}</strong><span>{gatewayHealth ? `Worker ${workerHealthLabel(gatewayHealth.worker)} · memory ${gatewayHealth.memory.status} (${gatewayHealth.memory.count ?? '—'} records) · mission store ${gatewayHealth.missions.status} (${gatewayHealth.missions.count ?? '—'} missions) · ${gatewayHealth.connectors.filter((connector) => connector.status === 'connected').length}/${gatewayHealth.connectors.length} connector reads successful · correlation ${gatewayHealth.correlationId}` : gatewayHealthError || 'Health checks worker heartbeat, local vault integrity, mission storage, and connector state.'}</span></div>
    {error && <p role="alert" className="mission-runtime-error">{error}</p>}{notice && <p role="status" className="studio-notice">{notice}</p>}
    {!loading && data && <div className="durable-source-grid" aria-label="Connector read status and provenance">{(['junksnap', 'clearsky', 'teesri', 'vayu'] as const).map((source) => {
      const item = data.sources[source];
      const statusText = item.mode === 'mock' ? 'SIMULATED FALLBACK' : item.connection === 'contract_invalid' ? 'CONTRACT INVALID' : item.connection === 'connected' ? (item.provenance?.mode === 'model' || item.provenance?.mode === 'replay' ? `CONNECTED · ${item.provenance.mode.toUpperCase()}` : 'CONNECTED · SOURCE SNAPSHOT') : 'DISCONNECTED';
      return <details className="durable-source-item" key={source}><summary><span className={item.connection === 'connected' && item.mode === 'live' ? 'source-led connected' : 'source-led'} /><strong>{item.label}</strong><small>{statusText}</small>{item.provenance?.cacheHit && <em>cached</em>}</summary><div><span>Schema: {item.provenance?.schema ?? 'not validated'}</span><span>Fetched: {item.provenance?.fetchedAt ? new Date(item.provenance.fetchedAt).toLocaleString() : 'no source response'}</span>{item.provenance && <span>Latency: {item.provenance.elapsedMs} ms · {item.provenance.attempts} attempt(s)</span>}{item.error && <p role="alert">{item.error.code}: {item.error.message}</p>}</div></details>;
    })}</div>}
    {!loading && <div className="durable-mission-toolbar"><span className="durable-mission-disclosure">Snapshot source modes are carried into each observation. Disconnected feeds remain visibly simulated. No specialist write actions run here.</span><button type="button" className="mini-action" onClick={() => void createFromSnapshot()} disabled={busy || !data}>Create from current snapshot</button></div>}
    {!loadingList && missions.length > 0 && <label className="durable-mission-picker"><span>Persistent mission history</span><select value={selectedId} onChange={(event) => void selectMission(event.target.value)}>{missions.map((mission) => <option key={mission.id} value={mission.id}>{mission.title} · {mission.status}</option>)}</select></label>}
    {selected && <div className="durable-mission-detail">
      <div className="mission-runtime-top"><div><span className="eyebrow">{selected.status} · {selected.id.slice(0, 8)}</span><h3>{selected.title}</h3><small>Correlation {selected.correlationId}</small></div><div className="mission-runtime-actions">
        {selected.status === 'CREATED' && <button className="mini-action" disabled={busy} onClick={() => void action('validate')}>Validate + queue</button>}
        {selected.status === 'QUEUED' && <button className="mini-action" disabled={busy} onClick={() => void action('run')}>{selected.memoryRetrieval ? 'Refresh gate & queue' : 'Queue local worker'}</button>}
        {selected.status === 'RUNNING' && <button className="mini-action" disabled={busy} onClick={() => void action('pause')}>Pause</button>}
        {selected.status === 'PAUSED' && <button className="mini-action" disabled={busy} onClick={() => void action('resume')}>Resume</button>}
        {!['COMPLETED', 'CANCELLED'].includes(selected.status) && <button className="mini-action" disabled={busy} onClick={() => void action('cancel')}>Cancel</button>}
        <button className="mini-action" disabled={busy} onClick={exportReport}>Export evidence report</button>
      </div></div>
      <div className="durable-task-list">{selected.tasks.map((task) => <details className="durable-task" key={task.id} open={task.status === 'FAILED'}><summary><span>{task.status}</span><strong>{task.title}</strong><small>{task.type}{task.dependsOn.length ? ` · after ${task.dependsOn.join(', ')}` : ''}</small></summary><div className="durable-task-content">{task.failure && <p role="alert">{task.failure.code}: {task.failure.message}</p>}{task.output && <><h4>Output artifact</h4><pre>{JSON.stringify(task.output, null, 2)}</pre></>}{task.evidence && <><h4>Execution evidence</h4><pre>{JSON.stringify(task.evidence, null, 2)}</pre></>}</div></details>)}</div>
      <div className="mission-timeline"><div className="mission-timeline-head"><h4>Durable event timeline</h4><span>{events.length} events · reload-safe</span></div>{events.map((item) => <div className="mission-timeline-event" key={item.id}><time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time><div><strong>{item.type}</strong><p>{item.taskId ? `Task ${item.taskId} · ` : ''}{JSON.stringify(item.details)}</p></div></div>)}</div>
    </div>}
    {!loadingList && missions.length === 0 && <div className="mission-empty-state"><strong>No gateway missions yet</strong><span>Create a source review mission after the unified snapshot is loaded. The browser-only plans below remain separate and preserved.</span></div>}
    <p className="durable-mission-disclosure">A separate local worker process claims queued tasks only after memory readiness passes; retrieval traces older than five minutes are not claimable. Three task types perform bounded local transformations; the connector task reads only reviewed ClearSky aggregates or Vayu samples at configured city centers. Vayu output is capped at 24 timestamped PM2.5 samples and omits place/station identifiers, coordinates, and free-text rationale. Tasks cannot run shell commands or access general filesystems, databases, arbitrary network destinations, or specialist write actions. Memory IDs are recorded for traceability; handlers do not interpret memory instructions. The launcher supervises the worker; manual development can run `npm run worker` separately.</p>
  </section>;
}

export function MissionRuntime({ title, place, focus, capabilityIds, data, onLoadMission, focusMissionId }: {
  title: string;
  place: string;
  focus: FocusId;
  capabilityIds: string[];
  data: Overview | null;
  onLoadMission: (mission: Pick<MissionRecord, 'title' | 'place' | 'focus' | 'capabilityIds'>) => void;
  focusMissionId?: string | null;
}) {
  const [initialState] = useState(() => {
    try { return { missions: readMissions(), error: '' }; }
    catch (cause) { return { missions: [] as MissionRecord[], error: cause instanceof Error ? cause.message : 'Mission history could not be loaded.' }; }
  });
  const [missions, setMissions] = useState<MissionRecord[]>(initialState.missions);
  const [activeId, setActiveId] = useState<string | null>(() => {
    try { return localStorage.getItem(`${STORAGE_KEY}.active`) || null; } catch { return null; }
  });
  const [error, setError] = useState(initialState.error);
  const [notice, setNotice] = useState('');
  const [persistenceReady, setPersistenceReady] = useState(!initialState.error);
  const active = missions.find((item) => item.id === activeId) ?? null;
  const nextStage = active ? STAGES.find((stage) => active.stages[stage.id] === 'ready') : undefined;
  const eventCount = useMemo(() => active?.events.length ?? 0, [active]);

  function commit(next: MissionRecord[]) {
    setMissions(next);
    if (!persistenceReady) return;
    try { saveMissions(next); }
    catch {
      setPersistenceReady(false);
      setError('Mission changes are visible for this session but browser storage failed. Export the report before closing this tab.');
    }
  }

  function update(id: string, change: (mission: MissionRecord) => MissionRecord) {
    commit(missions.map((mission) => mission.id === id ? change(mission) : mission));
  }

  function create() {
    setError(''); setNotice('');
    const record: MissionRecord = {
      id: crypto.randomUUID(), title: title.trim() || 'Climate action mission', place: place.trim(), focus,
      capabilityIds: [...new Set(capabilityIds)].filter((id) => ids.has(id)), status: 'planned', stages: { ...EMPTY_STAGES }, approved: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      events: [event('Mission created', 'Saved as a local plan. No source project was contacted.')],
    };
    commit([record, ...missions]); setActiveId(record.id);
    try { localStorage.setItem(`${STORAGE_KEY}.active`, record.id); setNotice('Mission saved to this browser.'); }
    catch { setError('The browser could not persist the active mission pointer. Export the report to keep a portable copy.'); }
  }

  const selectMission = useCallback((mission: MissionRecord) => {
    setActiveId(mission.id); onLoadMission(mission);
    try { localStorage.setItem(`${STORAGE_KEY}.active`, mission.id); } catch { setError('Could not persist selected mission in browser storage.'); }
  }, [onLoadMission]);

  useEffect(() => {
    if (!focusMissionId) return;
    const mission = missions.find((item) => item.id === focusMissionId);
    if (!mission || mission.id === activeId) return;
    selectMission(mission);
    const timer = window.setTimeout(() => document.getElementById(`mission-history-${mission.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    return () => window.clearTimeout(timer);
  }, [activeId, focusMissionId, missions, selectMission]);

  function startOrResume() {
    if (!active) return;
    const problem = validateMission(active);
    if (problem) { setError(problem); update(active.id, (item) => ({ ...item, status: 'failed', updatedAt: new Date().toISOString(), events: [event('Validation failed', problem), ...item.events] })); return; }
    update(active.id, (item) => {
      const stages = { ...item.stages };
      const first = STAGES.find((stage) => stages[stage.id] === 'waiting');
      if (first) stages[first.id] = 'ready';
      const resumed = item.status === 'paused';
      return { ...item, status: 'running', stages, updatedAt: new Date().toISOString(), events: [event(resumed ? 'Dry run resumed' : 'Dry run started', 'Local dependency and handoff checklist only; no remote action is executed.'), ...item.events] };
    });
    setError(''); setNotice('Local simulation started. Specialist services have not been called.');
  }

  function advance() {
    if (!active || !nextStage) return;
    update(active.id, (item) => {
      const stages = { ...item.stages, [nextStage.id]: 'simulated' as const };
      const following = STAGES.find((stage) => stages[stage.id] === 'waiting');
      if (following) stages[following.id] = 'ready';
      const done = !following;
      const label = done ? 'Dry run completed' : `${nextStage.title} simulated`;
      const detail = done ? 'All five planning stages passed local checks. Human review is still required before specialist handoff.' : 'Local plan stage advanced; no external action was taken.';
      const updated = { ...item, stages, status: done ? 'simulated' as const : 'running' as const, updatedAt: new Date().toISOString(), events: [event(label, detail), ...item.events] };
      return { ...updated, report: reportFor(updated, data) };
    });
  }

  function pause() {
    if (!active) return;
    update(active.id, (item) => ({ ...item, status: 'paused', updatedAt: new Date().toISOString(), events: [event('Dry run paused', 'Progress is saved locally and can be resumed.'), ...item.events] }));
  }

  function approveHandoff() {
    if (!active || active.status !== 'simulated') return;
    update(active.id, (item) => ({ ...item, approved: true, updatedAt: new Date().toISOString(), events: [event('Human review checkpoint approved', 'This local acknowledgment does not send or authorize actions in specialist systems.'), ...item.events] }));
    setNotice('Review checkpoint recorded locally. Open the source project to perform any real action.');
  }

  function exportReport(mission = active) {
    if (!mission) return;
    const content = mission.report ?? reportFor(mission, data);
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${(mission.title || 'mission').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-report.md`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('Mission report exported.');
  }

  function exportMissionJson(mission: MissionRecord) {
    const content = JSON.stringify({ schemaVersion: 1, mission }, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${mission.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'mission'}.climate-mission.json`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('Portable mission JSON exported. Importing it will not execute any source-project actions.');
  }

  async function importMission(file?: File) {
    if (!file) return;
    setError(''); setNotice('');
    try {
      if (file.size > 1_000_000) throw new Error('Mission import is limited to 1 MB.');
      const parsed: unknown = JSON.parse(await file.text());
      const candidate = parsed && typeof parsed === 'object' && 'mission' in parsed ? (parsed as { mission: unknown }).mission : parsed;
      if (!validMission(candidate)) throw new Error('This JSON is not a supported Climate Chain mission record.');
      const imported = { ...candidate, id: crypto.randomUUID(), approved: false, status: 'planned' as const, stages: { ...EMPTY_STAGES }, updatedAt: new Date().toISOString(), events: [event('Mission imported', 'Imported as a fresh plan; previous stage status and approval were not carried forward.'), ...candidate.events] };
      commit([imported, ...missions]); setActiveId(imported.id); setNotice('Mission imported as a new, unapproved local plan.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not import mission JSON.');
    }
  }

  function remove(mission: MissionRecord) {
    if (!window.confirm(`Delete local mission “${mission.title}” and its timeline?`)) return;
    commit(missions.filter((item) => item.id !== mission.id));
    if (activeId === mission.id) setActiveId(null);
    setNotice('Local mission removed.');
  }

  return <><DurableMissionPanel title={title} place={place} data={data} loading={!data} /><section className="card mission-runtime" aria-label="Browser-local planning workflow">
    <div className="section-heading"><div><span className="eyebrow">MISSION HISTORY · LOCAL WORKFLOW</span><h2>Save, simulate, and review</h2><p>Mission records and event timelines persist in this browser. Dry-run steps are simulated and do not call the 13 source projects.</p></div>
      <div className="mission-runtime-actions"><button type="button" className="mini-action" onClick={() => document.getElementById('mission-import-file')?.click()}>Import JSON</button><input id="mission-import-file" type="file" accept="application/json,.json" hidden onChange={(event) => { void importMission(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} /><button type="button" className="mini-action" onClick={create} disabled={!capabilityIds.length}>Save current plan</button></div>
    </div>
    {error && <p role="alert" className="mission-runtime-error">{error}</p>}{notice && <p role="status" className="studio-notice">{notice}</p>}
    {missions.length > 0 && <div className="mission-history" aria-label="Saved mission history">{missions.map((mission) => <article id={`mission-history-${mission.id}`} className={'mission-history-item' + (mission.id === activeId ? ' active' : '')} key={mission.id}>
      <button type="button" className="mission-history-select" onClick={() => selectMission(mission)}><strong>{mission.title}</strong><span>{mission.place || 'No place'} · {mission.capabilityIds.length} capability sets · {mission.status}</span><time dateTime={mission.updatedAt}>{new Date(mission.updatedAt).toLocaleString()}</time></button>
      <div><button type="button" className="text-action" onClick={() => exportReport(mission)}>Report</button><button type="button" className="text-action" onClick={() => exportMissionJson(mission)}>JSON</button><button type="button" className="text-action" onClick={() => remove(mission)} aria-label={`Delete ${mission.title}`}>Delete</button></div>
    </article>)}</div>}
    {active && <div className="mission-runtime-detail">
      <div className="mission-runtime-top"><div><span className="eyebrow">{active.status === 'running' ? 'LOCAL DRY RUN · IN PROGRESS' : active.status.toUpperCase()}</span><h3>{active.title}</h3></div><div className="mission-runtime-actions">
        {active.status === 'planned' || active.status === 'paused' ? <button type="button" className="mini-action" onClick={startOrResume}>{active.status === 'paused' ? 'Resume dry run' : 'Start local dry run'}</button> : null}
        {active.status === 'running' && <><button type="button" className="mini-action" onClick={pause}>Pause</button><button type="button" className="mini-action" onClick={advance} disabled={!nextStage}>Simulate {nextStage?.title ?? 'stage'}</button></>}
        {active.status === 'simulated' && !active.approved && <button type="button" className="mini-action" onClick={approveHandoff}>Record human review</button>}
        <button type="button" className="mini-action" onClick={() => exportReport()}>Export report</button>
      </div></div>
      <div className="mission-runtime-stages">{STAGES.map((stage) => <div className={`mission-runtime-stage ${active.stages[stage.id]}`} key={stage.id}><span>{stage.number}</span><strong>{stage.title}</strong><small>{active.stages[stage.id] === 'simulated' ? 'SIMULATED' : active.stages[stage.id] === 'ready' ? 'READY' : 'WAITING'}</small></div>)}</div>
      <div className="mission-runtime-notice"><strong>Human approval boundary</strong><span>{active.approved ? 'Review checkpoint recorded in this browser; this does not authorize an external project action.' : 'After the local dry run, review the plan and open the owning specialist tool for any real action.'}</span></div>
      <div className="mission-timeline"><div className="mission-timeline-head"><h4>Event timeline</h4><span>{eventCount} events</span></div>{active.events.map((item) => <div className="mission-timeline-event" key={item.id}><time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time><div><strong>{item.label}</strong><p>{item.detail}</p></div></div>)}</div>
      {active.report && <details className="memory-config-preview"><summary>Inspect saved execution report</summary><pre>{active.report}</pre></details>}
    </div>}
    {!missions.length && <div className="mission-empty-state"><strong>No saved missions yet</strong><span>Save this plan to create a durable local record with stages, approval checkpoint, and exportable report.</span></div>}
  </section></>;
}
