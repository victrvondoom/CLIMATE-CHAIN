import type { EvidenceMode } from './module';

// One evidence ledger for every module. A record's sha256 covers its canonical
// payload, so anyone holding the record can re-check it with verifyEvidence.

export interface EvidenceRecord {
  id: string;
  moduleId: string;
  kind: string;
  mode: EvidenceMode;
  summary: string;
  createdAt: string;
  sha256: string;
  payload: unknown;
}

export type EvidenceInput = Omit<EvidenceRecord, 'id' | 'createdAt' | 'sha256'>;

const LEDGER_KEY = 'climate-chain.evidence.v1';
const MAX_RECORDS = 500;

// Payloads must be JSON-safe. Keys are sorted at every level, so the same data
// always produces the same text and the same digest.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(source).sort().map((key) => [key, sortKeys(source[key])]));
  }
  return value;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function hashValue(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(value));
}

export async function createEvidence(input: EvidenceInput): Promise<EvidenceRecord> {
  return {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    sha256: await hashValue(input.payload),
  };
}

export async function verifyEvidence(record: EvidenceRecord): Promise<boolean> {
  return (await hashValue(record.payload)) === record.sha256;
}

// Storage can be missing or blocked (private windows, disabled site data).
// Every access is guarded, and a failed read returns an empty ledger.
export function readLedger(): EvidenceRecord[] {
  try {
    const raw = globalThis.localStorage?.getItem(LEDGER_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as EvidenceRecord[]) : [];
  } catch {
    return [];
  }
}

export function appendLedger(record: EvidenceRecord): boolean {
  try {
    const next = [record, ...readLedger()].slice(0, MAX_RECORDS);
    globalThis.localStorage?.setItem(LEDGER_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}
