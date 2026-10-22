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
  const res = await fetch(path, { headers: { accept: 'application/json' }, signal });
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

export function fetchGatewayHealth(signal?: AbortSignal): Promise<GatewayHealth> {
  return getJson('/api/health', signal, true);
}

export function createDurableMission(definition: DurableMissionDefinition, idempotencyKey: string): Promise<{ mission: DurableMission }> {
  return sendMissionJson('/api/missions', 'POST', definition, { 'idempotency-key': idempotencyKey });
}

export function durableMissionAction(missionId: string, action: 'validate' | 'queue' | 'run' | 'pause' | 'resume' | 'cancel'): Promise<{ mission?: DurableMission; status?: string }> {
  return sendMissionJson(`/api/missions/${encodeURIComponent(missionId)}/${action}`, 'POST');
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

export function fetchOverview(city: CityKey = 'delhi', signal?: AbortSignal): Promise<Overview> {
  const qs = city === 'delhi' ? '' : `?city=${city}`;
  return getJson<Overview>(`/api/unified/overview${qs}`, signal);
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

export function inr(n: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

export function num(n: number): string {
  return new Intl.NumberFormat('en-IN').format(n);
}
