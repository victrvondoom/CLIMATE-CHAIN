// Client for the Climate Chain gateway. The four API-backed projects are reached
// through the one gateway, never directly, so the frontend has a single
// base URL, a single error model, and honest live/mock provenance.

import type { CascadeResponse, Overview, SourceStatus } from './types';

export type MemoryCategory = 'principle' | 'workflow' | 'boundary';
export type MemorySource = 'voice' | 'typed';
export type MemoryNamespace = { type: 'global' } | { type: 'project'; project: string };
export type MemoryVerificationStatus = 'unknown' | 'unverified' | 'verified';
export interface AgentMemoryEntry {
  id: string;
  title: string;
  rule: string;
  why: string;
  scope: string;
  category: MemoryCategory;
  tags: string[];
  source: MemorySource;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
  digest: string;
  namespace?: MemoryNamespace;
  technicalContext?: string;
  originalTranscript?: string;
  confidence?: number | null;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  verificationStatus?: MemoryVerificationStatus;
  constraints?: string[];
  affectedComponents?: string[];
  relatedFiles?: string[];
  evidence?: string[];
  exceptions?: string[];
  dependencies?: string[];
  conflictsWith?: string[];
  supersedes?: string[];
  revision?: number;
  versions?: { revision: number; updatedAt: string; digest: string }[];
}
export interface AgentMemorySnapshot {
  status: 'ready';
  storage: 'local-user-sandbox';
  location: string;
  complete: boolean;
  schemaVersion?: number;
  scannedAt: string;
  updatedAt: string | null;
  count: number;
  activeCount: number;
  manifestSha256: string;
  vaultSha256: string;
  encryption?: MemoryEncryptionStatus;
  entries: AgentMemoryEntry[];
  activeEntries: AgentMemoryEntry[];
  effectiveActiveCount?: number;
  effectiveActiveEntries?: AgentMemoryEntry[];
  recallFailureCode: 'CLIMATE_CHAIN_MEMORY_UNAVAILABLE';
  recallFailureAction: string;
}
export interface AgentMemoryExports {
  markdown: string;
  claudeMarkdown: string;
  mcpConfig: { mcpServers: Record<string, { command: string; args: string[]; cwd: string; env: Record<string, string> }> };
  mcpConfigJson: string;
  manifestSha256: string;
  count: number;
}
export interface IntegrationEvidence {
  schemaVersion: number;
  checkedAt: string;
  upstreams: {
    name: string;
    label: string;
    domain: string;
    configured: boolean;
    endpoint: string;
    healthPath: string;
    operations: { operation: string; path: string; schema: string }[];
    apiKeyRequired: boolean;
    authentication: string;
    evidence: string;
  }[];
  credentials: {
    provider: string;
    variable: string;
    required: boolean;
    configured: boolean;
    state: string;
    validated: boolean;
    usedByGateway: boolean;
    evidence: string;
    secretValueReturned: false;
  }[];
  mcp: { name: string; transport: string; available: boolean; configuration: string; gateway: string; tools: string[]; sourceApiKeysRequired: boolean; access: string };
  scope: string;
}
export interface AgentMemoryDraft {
  title: string;
  rule: string;
  why: string;
  scope: string;
  category: MemoryCategory;
  tags: string[];
  source: MemorySource;
  technicalContext?: string;
  originalTranscript?: string;
  confidence?: number | null;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  verificationStatus?: MemoryVerificationStatus;
  constraints?: string[];
  affectedComponents?: string[];
  relatedFiles?: string[];
  evidence?: string[];
  exceptions?: string[];
  dependencies?: string[];
  conflictsWith?: string[];
  supersedes?: string[];
}

export interface MemoryBackupEnvelope { format: string; formatVersion: number; exportedAt: string; store: unknown; integritySha256: string }
export interface EncryptedPortableMemoryBackup {
  format: 'climate-chain-encrypted-memory-backup';
  formatVersion: 1;
  exportedAt: string;
  cipher: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA-256';
  iterations: 600_000;
  salt: string;
  iv: string;
  ciphertext: string;
}
export interface MemoryEncryptionStatus { enabled: boolean; algorithm: string | null; keyProtection: string; activePlaintextVault: boolean; auditEncryptedAtRest: boolean; plaintextAuditPresent: boolean; legacyPlaintextCopy: boolean; legacyAuditPlaintextCopy: boolean; warning: string | null }
export interface MemoryIntegrity { valid: boolean; complete: boolean; schemaVersion: number; count: number; activeCount: number; vaultSha256: string; encryption?: MemoryEncryptionStatus; verifiedAt: string }
export interface MemoryBackupStatus { backups: { name: string; createdAt: string; sizeBytes: number; integrityValid: boolean; encryptedAtRest?: boolean }[]; latest: { name: string; createdAt: string; sizeBytes: number; integrityValid: boolean; encryptedAtRest?: boolean } | null; complete: boolean }
export interface MemoryConflict { id: string; records: AgentMemoryEntry[]; declaredBy: string[] }
export interface MemoryConflictResult { conflicts: MemoryConflict[]; complete: boolean; project: string; manifestSha256: string }
export interface MemoryRetrievalTrace { events: { id: string; at: string; operation: string; project: string; querySha256: string | null; returned: { id: string; score?: number; reasons: string[] }[]; durationMs: number; manifestSha256: string }[]; complete: boolean }
export interface MemorySearchResult { entries: AgentMemoryEntry[]; scores: { id: string; score: number; reasons: string[] }[]; totalVisible: number; complete: boolean; project: string; manifestSha256: string; trace: MemoryRetrievalTrace['events'][number] }

export type DurableMissionStatus = 'CREATED' | 'VALIDATED' | 'QUEUED' | 'RUNNING' | 'WAITING_APPROVAL' | 'PAUSED' | 'RETRYING' | 'FAILED' | 'CANCELLED' | 'BLOCKED' | 'COMPLETED';
export interface DurableMissionTask {
  id: string;
  type: string;
  title: string;
  dependsOn: string[];
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  evidence: Record<string, unknown> | null;
  failure: { code: string; message: string } | null;
  requiresApproval: boolean;
  approval: Record<string, unknown> | null;
}
export interface DurableMission {
  id: string;
  title: string;
  description: string;
  status: DurableMissionStatus;
  createdAt: string;
  updatedAt: string;
  correlationId: string;
  tasks: DurableMissionTask[];
  memoryRetrieval: { memoryIds: string[]; manifestSha256: string; retrievedAt: string; interpretation: string } | null;
}
export interface DurableMissionEvent { id: string; at: string; type: string; taskId: string | null; details: Record<string, unknown> }
export interface DurableMissionSnapshot { missions: DurableMission[]; integrity: { valid: boolean; code?: string; message?: string; missions?: number; events?: number }; persistence: string }
export interface DurableMissionDefinition { title: string; description?: string; memoryReferences?: string[]; tasks: { id: string; type: string; title: string; dependsOn?: string[]; input: Record<string, unknown>; requiresApproval?: boolean; timeoutMs?: number; retry?: { maxAttempts?: number; delayMs?: number } }[] }
export interface GatewayHealth {
  status: 'ready' | 'degraded';
  correlationId: string;
  uptimeSeconds: number;
  memory: { status: 'ready' | 'unavailable'; count?: number; schemaVersion?: number; encryption?: MemoryEncryptionStatus; errorCode?: string };
  missions: { status: 'ready' | 'unavailable'; count: number | null; events: number | null; errorCode: string | null };
  worker: { status: 'running' | 'starting' | 'restarting' | 'stopping' | 'stopped' | 'stale' | 'unknown' | 'unavailable'; available: boolean; workerId: string | null; pid: number | null; restartCount: number; backoffMs: number | null; startedAt: string | null; lastHeartbeatAt: string | null; ageMs: number | null; errorCode: string | null };
  connectors: { name: string; status: string; breaker: string; latencyMs: number | null; lastCheckAt: string | null; lastSuccessAt: string | null; errorCode: string | null }[];
  checkedAt: string;
}

export const CITIES = {
  delhi: { name: 'Delhi', lat: 28.61, lng: 77.23 },
  jodhpur: { name: 'Jodhpur', lat: 26.29, lng: 73.02 },
  chandigarh: { name: 'Chandigarh', lat: 30.73, lng: 76.78 },
} as const;

export type CityKey = keyof typeof CITIES;

async function getJson<T>(path: string, signal?: AbortSignal, allowDegradedHealth = false): Promise<T> {
  const res = await fetch(path, { headers: { accept: 'application/json' }, cache: 'no-store', signal });
  if (allowDegradedHealth && res.status === 503) return res.json() as Promise<T>;
  if (!res.ok) {
    let message = `${res.status} ${res.statusText} from ${path}`;
    try {
      const body = await res.json();
      if (body?.error?.code) message = `${body.error.code}: ${body.error.message || message}`;
    } catch {
      // Preserve the HTTP status when an error response is not JSON.
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

async function sendMemoryJson<T>(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText} from ${path}`;
    try {
      const payload = await response.json();
      if (payload?.error?.code) message = `${payload.error.code}: ${payload.error.message || message}`;
    } catch {
      // Preserve the HTTP status when an error response is not JSON.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

async function sendMissionJson<T>(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText} from ${path}`;
    try {
      const payload = await response.json();
      if (payload?.error?.code) message = `${payload.error.code}: ${payload.error.message || message}${payload.error.action ? ` (${payload.error.action})` : ''}`;
    } catch {
      // Keep the HTTP failure visible even if the gateway response is not JSON.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export function fetchDurableMissions(signal?: AbortSignal): Promise<DurableMissionSnapshot> {
  return getJson('/api/missions', signal);
}

// Polls the status view, which reports a degraded gateway with HTTP 200. /api/health is the
// readiness probe and answers 503 while degraded; a 503 is still accepted here.
export function fetchGatewayHealth(signal?: AbortSignal): Promise<GatewayHealth> {
  return getJson('/api/status', signal, true);
}

export function fetchIntegrationEvidence(signal?: AbortSignal): Promise<IntegrationEvidence> {
  return getJson('/api/v1/evidence/integrations', signal);
}

export function createDurableMission(definition: DurableMissionDefinition, idempotencyKey: string): Promise<{ mission: DurableMission }> {
  return sendMissionJson('/api/missions', 'POST', definition, { 'idempotency-key': idempotencyKey });
}

export function durableMissionAction(missionId: string, action: 'validate' | 'queue' | 'run' | 'pause' | 'resume' | 'cancel'): Promise<{ mission?: DurableMission; status?: string }> {
  return sendMissionJson(`/api/missions/${encodeURIComponent(missionId)}/${action}`, 'POST');
}

export function durableMissionTaskAction(missionId: string, taskId: string, action: 'approve' | 'retry', decision?: { approvedBy: string; decision: 'approve' | 'reject'; comment?: string } | { actor: string; reason?: string }): Promise<{ mission: DurableMission }> {
  return sendMissionJson(`/api/missions/${encodeURIComponent(missionId)}/${action}/${encodeURIComponent(taskId)}`, 'POST', decision);
}

export function fetchDurableMission(missionId: string, signal?: AbortSignal): Promise<{ mission: DurableMission; events: DurableMissionEvent[] }> {
  return getJson(`/api/missions/${encodeURIComponent(missionId)}`, signal);
}

export function fetchDurableMissionEvidence(missionId: string, taskId: string, signal?: AbortSignal): Promise<{ evidence: Record<string, unknown> | null }> {
  return getJson(`/api/missions/${encodeURIComponent(missionId)}/evidence/${encodeURIComponent(taskId)}`, signal);
}

export function fetchAgentMemory(signal?: AbortSignal): Promise<AgentMemorySnapshot> {
  return getJson('/api/agent-memory', signal);
}

export function fetchAgentMemoryExports(project = 'climate-chain', signal?: AbortSignal): Promise<AgentMemoryExports> {
  return getJson(`/api/agent-memory/exports?project=${encodeURIComponent(project)}`, signal);
}

export function fetchAgentMemoryIntegrity(signal?: AbortSignal): Promise<MemoryIntegrity> {
  return getJson('/api/agent-memory/integrity', signal);
}

export function fetchAgentMemoryConflicts(signal?: AbortSignal): Promise<MemoryConflictResult> {
  return getJson('/api/agent-memory/conflicts', signal);
}

export function fetchAgentMemoryRetrievals(signal?: AbortSignal): Promise<MemoryRetrievalTrace> {
  return getJson('/api/agent-memory/retrievals?limit=50', signal);
}

export function searchAgentMemory(query: string, project?: string, signal?: AbortSignal): Promise<MemorySearchResult> {
  const params = new URLSearchParams({ query });
  if (project) params.set('project', project);
  return getJson(`/api/agent-memory/search?${params}`, signal);
}

export function fetchAgentMemoryBackups(signal?: AbortSignal): Promise<MemoryBackupStatus> {
  return getJson('/api/agent-memory/backups', signal);
}

export function fetchAgentMemoryBackup(signal?: AbortSignal): Promise<MemoryBackupEnvelope> {
  return getJson('/api/agent-memory/backup', signal);
}

export function restoreAgentMemoryBackup(backup: MemoryBackupEnvelope, confirmation: string): Promise<{ imported: boolean; schemaVersion: number; count: number; integrity: string }> {
  return sendMemoryJson('/api/agent-memory/import', 'POST', { backup, reviewed: true, confirmation });
}

export function rotateAgentMemoryKey(confirmation: string): Promise<{ rotated: boolean; keyId: string; previousKeyId: string; retainedKeyVersions: number; schemaVersion: number; count: number }> {
  return sendMemoryJson('/api/agent-memory/rotate-key', 'POST', { reviewed: true, confirmation });
}

const BACKUP_ITERATIONS = 600_000;
const backupTextEncoder = new TextEncoder();
const backupTextDecoder = new TextDecoder('utf-8', { fatal: true });

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length > 45_000_000) throw new Error('Encrypted memory backup encoding is invalid.');
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function derivePortableBackupKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', toArrayBuffer(backupTextEncoder.encode(passphrase)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations: BACKUP_ITERATIONS }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptPortableMemoryBackup(backup: MemoryBackupEnvelope, passphrase: string): Promise<EncryptedPortableMemoryBackup> {
  if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 1024) throw new Error('Use a separate backup passphrase with at least 12 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derivePortableBackupKey(passphrase, salt);
  const plaintext = backupTextEncoder.encode(JSON.stringify(backup));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, toArrayBuffer(plaintext)));
  return {
    format: 'climate-chain-encrypted-memory-backup', formatVersion: 1,
    exportedAt: new Date().toISOString(), cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA-256',
    iterations: BACKUP_ITERATIONS, salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(ciphertext),
  };
}

export async function decryptPortableMemoryBackup(envelope: EncryptedPortableMemoryBackup, passphrase: string): Promise<MemoryBackupEnvelope> {
  if (!envelope || envelope.format !== 'climate-chain-encrypted-memory-backup' || envelope.formatVersion !== 1
      || envelope.cipher !== 'AES-256-GCM' || envelope.kdf !== 'PBKDF2-SHA-256' || envelope.iterations !== BACKUP_ITERATIONS
      || typeof envelope.salt !== 'string' || typeof envelope.iv !== 'string' || typeof envelope.ciphertext !== 'string') {
    throw new Error('Encrypted memory backup format is unsupported or malformed.');
  }
  if (typeof passphrase !== 'string' || passphrase.length < 1 || passphrase.length > 1024) throw new Error('Enter the passphrase used to encrypt this backup.');
  const salt = fromBase64(envelope.salt);
  const iv = fromBase64(envelope.iv);
  const ciphertext = fromBase64(envelope.ciphertext);
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 17 || ciphertext.length > 32 * 1024 * 1024 + 16) throw new Error('Encrypted memory backup payload has invalid bounds.');
  try {
    const key = await derivePortableBackupKey(passphrase, salt);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, toArrayBuffer(ciphertext));
    const backup: unknown = JSON.parse(backupTextDecoder.decode(plaintext));
    if (!backup || typeof backup !== 'object' || !('format' in backup) || !('integritySha256' in backup)) throw new Error('Backup content does not match the Climate Chain vault format.');
    return backup as MemoryBackupEnvelope;
  } catch {
    throw new Error('Could not authenticate this encrypted backup. Check the passphrase and file integrity.');
  }
}

export function createAgentMemory(draft: AgentMemoryDraft): Promise<{ entry: AgentMemoryEntry }> {
  return sendMemoryJson('/api/agent-memory', 'POST', draft);
}

export function updateAgentMemory(entry: AgentMemoryEntry, changes: Partial<AgentMemoryDraft> & { status?: 'active' | 'archived' }): Promise<{ entry: AgentMemoryEntry }> {
  return sendMemoryJson(`/api/agent-memory/${encodeURIComponent(entry.id)}`, 'PUT', { ...entry, ...changes });
}

export function deleteAgentMemory(id: string): Promise<{ deleted: true }> {
  return sendMemoryJson(`/api/agent-memory/${encodeURIComponent(id)}`, 'DELETE');
}

export function getCachedOverview(city: CityKey = 'delhi'): Overview | null {
  try {
    const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(`cc_overview_${city}`) : null;
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function fetchOverview(city: CityKey = 'delhi', signal?: AbortSignal): Promise<Overview> {
  const qs = city === 'delhi' ? '' : `?city=${city}`;
  const data = await getJson<Overview>(`/api/unified/overview${qs}`, signal);
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(`cc_overview_${city}`, JSON.stringify(data));
    }
  } catch {
    // Ignore storage quota
  }
  return data;
}

export function fetchServices(signal?: AbortSignal): Promise<{ services: SourceStatus[] }> {
  return getJson('/api/services', signal);
}

export interface ProjectAppStatus {
  id: string;
  path: string;
  available: boolean;
  build: string | null;
}

// Standalone project apps served under /apps/<id>/, with whether each is present on disk.
export function fetchProjectApps(signal?: AbortSignal): Promise<{ apps: ProjectAppStatus[] }> {
  return getJson('/api/v1/projects', signal);
}

export function fetchCascade(
  siteId: string,
  radiusKm: number,
  timeWindowHours: number,
  signal?: AbortSignal,
  demo = false,
): Promise<CascadeResponse> {
  const qs = new URLSearchParams({ site: siteId, radiusKm: String(radiusKm), timeWindowHours: String(timeWindowHours) });
  if (demo) qs.set('demo', '1');
  return getJson<CascadeResponse>(`/api/v1/cascade?${qs}`, signal);
}

export interface EvidenceAnchorStatus {
  network: string;
  localOnly: boolean;
  chainMode?: 'in-process' | 'external-rpc';
  chainId: number;
  rpcUrl: string;
  contractAddress: string | null;
  deployBlock: number | null;
  anchorCount: number | null;
  latestBlock: number | null;
  available: boolean;
  state: string;
  message?: string;
}

export interface EvidenceAnchorProof {
  digest: string;
  anchored: boolean;
  proofVerified: boolean;
  evidenceType?: string;
  manifestIdHash?: string;
  evidenceTypeHash?: string;
  anchorer?: string;
  blockNumber?: number;
  anchoredAt?: string;
  blockHash?: string | null;
  transactionHash?: string | null;
  transactionStatus?: 'success' | 'failed' | 'missing';
  alreadyAnchored?: boolean;
  network?: string;
  chainId?: number;
  contractAddress?: string;
}

export function fetchEvidenceAnchorStatus(signal?: AbortSignal): Promise<EvidenceAnchorStatus> {
  return getJson<EvidenceAnchorStatus>('/api/v1/evidence-anchors/status', signal);
}

export function fetchEvidenceAnchors(signal?: AbortSignal): Promise<{ network: string; chainId: number; contractAddress: string; anchors: EvidenceAnchorProof[] }> {
  return getJson<{ network: string; chainId: number; contractAddress: string; anchors: EvidenceAnchorProof[] }>('/api/v1/evidence-anchors?limit=50', signal);
}

export function verifyEvidenceAnchor(digest: string, signal?: AbortSignal): Promise<EvidenceAnchorProof> {
  return getJson<EvidenceAnchorProof>(`/api/v1/evidence-anchors/${encodeURIComponent(digest)}`, signal);
}

export async function anchorCascadeManifest(manifest: CascadeResponse['manifest']): Promise<EvidenceAnchorProof> {
  const path = '/api/v1/evidence-anchors';
  const response = await fetch(path, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ manifest }),
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText} from ${path}`;
    try {
      const payload = await response.json();
      if (payload?.error?.code) message = `${payload.error.code}: ${payload.error.message || message}`;
    } catch {
      // Keep the HTTP status when the gateway returns a non-JSON error.
    }
    throw new Error(message);
  }
  return response.json() as Promise<EvidenceAnchorProof>;
}

export interface KnowledgeHit {
  id: string;
  source: string;
  title: string;
  heading: string;
  startLine: number | null;
  score: number;
  snippet: string;
}

export interface KnowledgeSearchResponse {
  query: string;
  mode: 'lexical-bm25';
  answered: false;
  note: string;
  results: KnowledgeHit[];
  index: { documents: number; chunks: number; builtAt: string };
  asOf: string;
}

// Ranked, redacted excerpts from the workspace files. The gateway generates no answer.
export function searchKnowledge(query: string, limit = 8, signal?: AbortSignal): Promise<KnowledgeSearchResponse> {
  const qs = new URLSearchParams({ q: query, limit: String(limit) });
  return getJson<KnowledgeSearchResponse>(`/api/v1/knowledge/search?${qs}`, signal);
}

export function inr(n: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

export function num(n: number): string {
  return new Intl.NumberFormat('en-IN').format(n);
}

// ---------------------------------------------------------------------------
// Historical Climate Intelligence (200-Year Evidence Ledger)
// ---------------------------------------------------------------------------

export interface HistoricalDatasetMeta {
  dataset_id: string;
  official_title: string;
  source_agency: string;
  source_country: string;
  source_url: string;
  original_dataset_identifier: string;
  data_license: string;
  variable: string;
  measurement_unit: string;
  geographic_coverage: string;
  temporal_resolution: string;
  first_observation_date: string;
  last_observation_date: string;
  number_of_records: number;
  checksum_sha256: string;
  quality_flags: string;
  uncertainty_method: string;
  data_classification: string;
  citation: string;
}

export interface HistoricalCatalogResponse {
  title: string;
  total_cataloged_datasets: number;
  temporal_span: string;
  datasets: HistoricalDatasetMeta[];
}

export interface HistoricalObservation {
  year: number;
  value: number | null;
  uncertainty: number | null;
  unit: string;
  source: string;
  dataset_id: string;
  classification: string;
  is_gap: boolean;
  gap_reason?: string;
}

export interface HistoricalTimelineResponse {
  indicator: string;
  temporal_span: string;
  observation_count: number;
  gap_count: number;
  observations: HistoricalObservation[];
}

export interface PolicyEvent {
  event_id: string;
  year: number;
  date: string;
  title: string;
  geography: string;
  type: string;
  description: string;
  citation: string;
  evidence_status: string;
}

export interface ObservationEvidenceManifest {
  evidence_id: string;
  sha256_digest: string;
  payload: {
    schema_version: string;
    evidence_type: string;
    indicator: string;
    observation_year: number;
    observed_value: number;
    measurement_unit: string;
    uncertainty: number | null;
    data_classification: string;
    source_attribution: {
      dataset_id: string;
      official_title: string;
      source_agency: string;
      source_url: string;
      data_license: string;
      citation: string;
    };
    verification: {
      is_modeled_estimate: boolean;
      is_direct_measurement: boolean;
      is_interpolated: boolean;
      firewall_claim_tier: string;
    };
    generated_at: string;
  };
}

export function fetchHistoricalDatasets(signal?: AbortSignal): Promise<HistoricalCatalogResponse> {
  return getJson<HistoricalCatalogResponse>('/api/v1/history/datasets', signal);
}

export function fetchHistoricalTimeline(indicator = 'temperature_anomaly', startYear = 1826, endYear = 2026, signal?: AbortSignal): Promise<HistoricalTimelineResponse> {
  const qs = new URLSearchParams({ indicator, startYear: String(startYear), endYear: String(endYear) });
  return getJson<HistoricalTimelineResponse>(`/api/v1/history/timeline?${qs}`, signal);
}

export type WorldSignalStatus = 'live' | 'stale';
interface WorldEnvelope { status: WorldSignalStatus; source: string; sourceUrl: string; fetchedAt: string; staleReason?: string }
export interface EnsoSignal extends WorldEnvelope { series: { year: number; month: number; season: string; oni: number; phase: 'El Nino' | 'La Nina' | 'Neutral' }[] }
export interface NewsSignal extends WorldEnvelope { topic: string; outlets: string[]; failedOutlets: string[]; articles: { title: string; url: string; domain: string; outlet: string; seenAt: string | null }[] }
export interface InflationSignal extends WorldEnvelope { country: string; series: { year: number; inflationPct: number }[] }

export const fetchEnso = (signal?: AbortSignal) => getJson<EnsoSignal>('/api/v1/world/enso', signal);
export const fetchClimateNews = (topic: 'climate' | 'india' | 'enso', signal?: AbortSignal) => getJson<NewsSignal>(`/api/v1/world/news?topic=${topic}`, signal);
export const fetchIndiaInflation = (signal?: AbortSignal) => getJson<InflationSignal>('/api/v1/world/india-inflation', signal);

export type AirCategoryId = 'good' | 'moderate' | 'sensitive' | 'unhealthy' | 'very-unhealthy' | 'hazardous' | 'unknown';
export interface AirCategory { id: AirCategoryId; label: string }
export interface AirReading { time: string | null; usAqi: number | null; pm25: number | null; pm10: number | null; no2: number | null; o3: number | null; so2: number | null; co: number | null }
export interface AirCountry { iso2: string; name: string; capital: string; region: string; lat: number; lng: number; reading: AirReading; category: AirCategory }
export interface AirCountriesSignal extends WorldEnvelope { count: number; withData: number; failed: number; countries: AirCountry[] }
export interface AirAreaCell { row: number; col: number; usAqi: number | null; category: AirCategoryId }
export interface AirArea {
  gridCells: number; cellsWithData: number; cellKm: { height: number; width: number }; windowKm: { height: number; width: number };
  threshold: string; pollutedCells: number; pollutedSharePct: number | null; pollutedAreaKm2: number | null; sampledAreaKm2: number;
  byCategory: Partial<Record<AirCategoryId, number>>; cells: AirAreaCell[];
}
export interface AirPointSignal extends WorldEnvelope {
  place: { lat: number; lng: number; nearest: { iso2: string; name: string; capital: string; distanceKm: number } | null };
  reading: AirReading; category: AirCategory; whoPm25Guideline: number; pm25VsWho: number | null; area: AirArea; resolutionNote: string;
}

export const fetchAirCountries = (signal?: AbortSignal) => getJson<AirCountriesSignal>('/api/v1/world/air/countries', signal);
export const fetchAirPoint = (lat: number, lng: number, signal?: AbortSignal) => getJson<AirPointSignal>(`/api/v1/world/air/point?${new URLSearchParams({ lat: String(lat), lng: String(lng) })}`, signal);

export function fetchHistoricalEvents(signal?: AbortSignal): Promise<{ events: PolicyEvent[] }> {
  return getJson<{ events: PolicyEvent[] }>('/api/v1/history/events', signal);
}

export function fetchObservationEvidence(indicator: string, year: number, signal?: AbortSignal): Promise<ObservationEvidenceManifest> {
  const qs = new URLSearchParams({ indicator, year: String(year) });
  return getJson<ObservationEvidenceManifest>(`/api/v1/history/observation-evidence?${qs}`, signal);
}

export interface LiveTelemetryTick {
  indicator: string;
  timestamp: string;
  epoch_ms: number;
  value: number;
  unit: string;
  uncertainty: number;
  delta: number;
  delta_percent: number;
  direction: 'up' | 'down' | 'flat';
  session_high: number;
  session_low: number;
  tick_count: number;
  proof_hash: string;
  station: string;
  block_number: number;
}

export function fetchLiveTelemetryTick(indicator = 'temperature_anomaly', signal?: AbortSignal): Promise<LiveTelemetryTick> {
  const qs = new URLSearchParams({ indicator });
  return getJson<LiveTelemetryTick>(`/api/v1/history/live-tick?${qs}`, signal);
}


