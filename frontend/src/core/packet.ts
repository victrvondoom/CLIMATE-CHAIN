import { hashValue, canonicalJson } from './evidence';
import type { StageId } from './module';

// The one shape an agent submits. Strict on purpose: exact fields, a known module and stage,
// and a payload whose digest must match. Agents never submit LIVE data.

export const PACKET_SCHEMA = 'climate-chain.packet/1';
export const PACKET_MODES = ['SIMULATED', 'RESEARCH', 'DEMO'] as const;
export const PACKET_FIELDS = ['schema', 'module', 'stage', 'claim', 'mode', 'evidence'] as const;
export const EVIDENCE_FIELDS = ['kind', 'payload', 'sha256'] as const;
export const MAX_CLAIM = 280;
export const MAX_PAYLOAD_BYTES = 64 * 1024;

const STAGES: readonly StageId[] = ['sense', 'verify', 'act', 'finance', 'prove'];

export type PacketMode = (typeof PACKET_MODES)[number];

export interface WorkPacket {
  schema: typeof PACKET_SCHEMA;
  module: string;
  stage: StageId;
  claim: string;
  mode: PacketMode;
  evidence: { kind: string; payload: unknown; sha256: string };
}

export interface ModuleStages {
  id: string;
  stages: readonly StageId[];
}

export type PacketCheck = { ok: true; packet: WorkPacket } | { ok: false; errors: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Synchronous checks on shape and vocabulary. Returns every problem, so an agent fixes them in one pass.
export function shapeErrors(input: unknown, modules: readonly ModuleStages[]): string[] {
  const errors: string[] = [];
  if (!isRecord(input)) return ['packet must be a JSON object'];
  for (const key of Object.keys(input)) {
    if (!(PACKET_FIELDS as readonly string[]).includes(key)) errors.push(`unexpected field "${key}"`);
  }
  for (const key of PACKET_FIELDS) {
    if (!(key in input)) errors.push(`missing field "${key}"`);
  }
  if (input.schema !== PACKET_SCHEMA) errors.push(`schema must be "${PACKET_SCHEMA}"`);

  const module = modules.find((item) => item.id === input.module);
  if (typeof input.module !== 'string' || !module) {
    errors.push(`module "${String(input.module)}" is not a Climate Chain module`);
  }
  if (!STAGES.includes(input.stage as StageId)) {
    errors.push(`stage must be one of ${STAGES.join(', ')}`);
  } else if (module && !module.stages.includes(input.stage as StageId)) {
    errors.push(`stage "${String(input.stage)}" is not a stage of ${module.id}`);
  }

  if (typeof input.claim !== 'string') {
    errors.push('claim must be a string');
  } else {
    const claim = input.claim.trim();
    if (claim.length === 0) errors.push('claim is empty');
    if (claim.length > MAX_CLAIM) errors.push(`claim is longer than ${MAX_CLAIM} characters`);
    if ([...input.claim].some((ch) => ch.codePointAt(0)! < 32 || ch.codePointAt(0) === 127)) {
      errors.push('claim contains control characters');
    }
  }

  if (input.mode === 'LIVE') errors.push('agents cannot submit LIVE data; use SIMULATED, RESEARCH or DEMO');
  else if (!(PACKET_MODES as readonly string[]).includes(String(input.mode))) {
    errors.push(`mode must be one of ${PACKET_MODES.join(', ')}`);
  }

  if (!isRecord(input.evidence)) {
    errors.push('evidence must be an object with kind, payload and sha256');
  } else {
    for (const key of Object.keys(input.evidence)) {
      if (!(EVIDENCE_FIELDS as readonly string[]).includes(key)) errors.push(`unexpected evidence field "${key}"`);
    }
    const { kind, payload, sha256 } = input.evidence;
    if (typeof kind !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(kind)) {
      errors.push('evidence.kind must be lowercase letters, digits and hyphens (max 40)');
    }
    if (payload === undefined) {
      errors.push('evidence.payload is missing');
    } else {
      const size = canonicalJson(payload).length;
      if (size > MAX_PAYLOAD_BYTES) errors.push(`evidence.payload is larger than ${MAX_PAYLOAD_BYTES} bytes`);
    }
    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) {
      errors.push('evidence.sha256 must be 64 lowercase hex characters');
    }
  }
  return errors;
}

// Full check: shape first, then the digest. The digest is the canonical payload hash used by the ledger.
export async function checkPacket(input: unknown, modules: readonly ModuleStages[]): Promise<PacketCheck> {
  const errors = shapeErrors(input, modules);
  if (errors.length > 0) return { ok: false, errors };
  const packet = input as WorkPacket;
  const digest = await hashValue(packet.evidence.payload);
  if (digest !== packet.evidence.sha256) {
    return { ok: false, errors: [`evidence.sha256 does not match the canonical payload (expected ${digest})`] };
  }
  return { ok: true, packet: { ...packet, claim: packet.claim.trim() } };
}

// A small, valid example an agent can copy. The digest is computed at runtime, never typed by hand.
export const EXAMPLE_PAYLOAD = { day: '2026-10-15', detections: 3, sites: 2 };
export function examplePacket(sha256: string): WorkPacket {
  return {
    schema: PACKET_SCHEMA,
    module: 'flarewatch',
    stage: 'verify',
    claim: 'Two sites in the 15 Oct night file meet the three-of-seven-nights rule.',
    mode: 'RESEARCH',
    evidence: { kind: 'night-summary', payload: EXAMPLE_PAYLOAD, sha256 },
  };
}
