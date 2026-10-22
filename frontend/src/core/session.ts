import { appendLedger, createEvidence, hashValue } from './evidence';
import type { WorkPacket } from './packet';

// The review queue. Every packet is queued once, under the canonical hash of its contents.
// Every verdict is written to the shared evidence ledger, so a decision can be checked later.

export type Verdict = 'accepted' | 'held' | 'rejected';
export type ItemStatus = 'waiting' | Verdict;

export interface SessionItem {
  id: string;
  packet: WorkPacket;
  status: ItemStatus;
  note: string;
  queuedAt: string;
  decidedAt: string | null;
  ledgerSaved: boolean | null;
}

const KEY = 'climate-chain.session.v1';
const MAX_ITEMS = 300;
export const MAX_NOTE = 280;

// Storage can be missing or blocked. A failed read is an empty queue, never an exception.
export function readSession(): SessionItem[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SessionItem[]) : [];
  } catch {
    return [];
  }
}

function writeSession(items: SessionItem[]): boolean {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
    return true;
  } catch {
    return false;
  }
}

export async function queuePacket(packet: WorkPacket, now: Date = new Date()): Promise<{ item: SessionItem; duplicate: boolean; saved: boolean }> {
  const id = await hashValue(packet);
  const items = readSession();
  const existing = items.find((item) => item.id === id);
  if (existing) return { item: existing, duplicate: true, saved: true };
  const item: SessionItem = {
    id,
    packet,
    status: 'waiting',
    note: '',
    queuedAt: now.toISOString(),
    decidedAt: null,
    ledgerSaved: null,
  };
  return { item, duplicate: false, saved: writeSession([item, ...items]) };
}

export async function decide(id: string, verdict: Verdict, note: string, now: Date = new Date()): Promise<{ item: SessionItem | null; ledgerSaved: boolean; sessionSaved: boolean }> {
  const items = readSession();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return { item: null, ledgerSaved: false, sessionSaved: false };
  const current = items[index];
  const clipped = note.slice(0, MAX_NOTE);
  const evidence = await createEvidence({
    moduleId: current.packet.module,
    kind: 'verdict',
    mode: current.packet.mode,
    summary: `${verdict}: ${current.packet.claim}`,
    payload: {
      packetId: id,
      module: current.packet.module,
      stage: current.packet.stage,
      claim: current.packet.claim,
      evidenceKind: current.packet.evidence.kind,
      evidenceSha256: current.packet.evidence.sha256,
      verdict,
      note: clipped,
    },
  });
  const ledgerSaved = appendLedger(evidence);
  const updated: SessionItem = { ...current, status: verdict, note: clipped, decidedAt: now.toISOString(), ledgerSaved };
  items[index] = updated;
  return { item: updated, ledgerSaved, sessionSaved: writeSession(items) };
}

// The narrow path's counts: how many packets wait at a stage, and for a module within that stage.
export function waitingAt(items: readonly SessionItem[], stage?: string, moduleId?: string): number {
  return items.filter((item) => item.status === 'waiting'
    && (stage === undefined || item.packet.stage === stage)
    && (moduleId === undefined || item.packet.module === moduleId)).length;
}
