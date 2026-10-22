import { describe, expect, it } from 'vitest';
import { hashValue } from './evidence';
import { EXAMPLE_PAYLOAD, MAX_CLAIM, PACKET_SCHEMA, checkPacket, examplePacket, shapeErrors, type ModuleStages } from './packet';

const modules: ModuleStages[] = [{ id: 'flarewatch', stages: ['sense', 'verify', 'prove'] }];

async function packetFor(overrides: Record<string, unknown> = {}) {
  const payload = { day: '2026-10-16', detections: 5 };
  return {
    schema: PACKET_SCHEMA,
    module: 'flarewatch',
    stage: 'verify',
    claim: 'The 16 Oct night file holds five detections.',
    mode: 'RESEARCH',
    evidence: { kind: 'night-summary', payload, sha256: await hashValue(payload) },
    ...overrides,
  };
}

describe('packet intake', () => {
  it('accepts a packet whose digest matches its payload', async () => {
    const result = await checkPacket(await packetFor(), modules);
    expect(result.ok).toBe(true);
  });

  it('refuses a packet whose digest does not match its payload', async () => {
    const packet = await packetFor();
    packet.evidence.payload = { day: '2026-10-16', detections: 6 };
    const result = await checkPacket(packet, modules);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/does not match the canonical payload/);
  });

  it('refuses LIVE data from an agent', async () => {
    expect(shapeErrors(await packetFor({ mode: 'LIVE' }), modules)).toContain('agents cannot submit LIVE data; use SIMULATED, RESEARCH or DEMO');
  });

  it('refuses a module that does not exist', async () => {
    expect(shapeErrors(await packetFor({ module: 'not-a-module' }), modules)[0]).toMatch(/is not a Climate Chain module/);
  });

  it('refuses a stage the module does not have', async () => {
    expect(shapeErrors(await packetFor({ stage: 'finance' }), modules)).toContain('stage "finance" is not a stage of flarewatch');
  });

  it('refuses extra and missing fields', async () => {
    const base = await packetFor();
    expect(shapeErrors({ ...base, owner: 'x' }, modules)).toContain('unexpected field "owner"');
    const { mode: _mode, ...withoutMode } = base;
    expect(shapeErrors(withoutMode, modules)).toContain('missing field "mode"');
  });

  it('bounds the claim and rejects control characters', async () => {
    expect(shapeErrors(await packetFor({ claim: 'x'.repeat(MAX_CLAIM + 1) }), modules)).toContain(`claim is longer than ${MAX_CLAIM} characters`);
    expect(shapeErrors(await packetFor({ claim: 'line\u0007bell' }), modules)).toContain('claim contains control characters');
    expect(shapeErrors(await packetFor({ claim: '   ' }), modules)).toContain('claim is empty');
  });

  it('bounds the payload size', async () => {
    const big = { blob: 'x'.repeat(70 * 1024) };
    const packet = { ...(await packetFor()), evidence: { kind: 'night-summary', payload: big, sha256: '0'.repeat(64) } };
    expect(shapeErrors(packet, modules)).toContain('evidence.payload is larger than 65536 bytes');
  });

  it('rejects things that are not objects', () => {
    expect(shapeErrors('a sentence', modules)).toEqual(['packet must be a JSON object']);
    expect(shapeErrors([], modules)).toEqual(['packet must be a JSON object']);
  });

  it('accepts the example an agent is shown', async () => {
    const example = examplePacket(await hashValue(EXAMPLE_PAYLOAD));
    expect((await checkPacket(example, modules)).ok).toBe(true);
  });
});
