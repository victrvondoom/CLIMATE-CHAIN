import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashValue, readLedger } from './evidence';
import { PACKET_SCHEMA, type WorkPacket } from './packet';
import { MAX_NOTE, decide, queuePacket, readSession, waitingAt } from './session';

async function packet(claim = 'The 16 Oct night file holds five detections.'): Promise<WorkPacket> {
  const payload = { day: '2026-10-16', detections: 5 };
  return {
    schema: PACKET_SCHEMA,
    module: 'flarewatch',
    stage: 'verify',
    claim,
    mode: 'RESEARCH',
    evidence: { kind: 'night-summary', payload, sha256: await hashValue(payload) },
  };
}

function stubStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  return values;
}

describe('review queue', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('queues a packet once, under the hash of its contents', async () => {
    stubStorage();
    const first = await queuePacket(await packet());
    const again = await queuePacket(await packet());
    expect(first.duplicate).toBe(false);
    expect(first.saved).toBe(true);
    expect(again.duplicate).toBe(true);
    expect(readSession()).toHaveLength(1);
    expect(readSession()[0].status).toBe('waiting');
  });

  it('counts waiting packets by stage and module', async () => {
    stubStorage();
    await queuePacket(await packet('First claim.'));
    await queuePacket(await packet('Second claim.'));
    const items = readSession();
    expect(waitingAt(items)).toBe(2);
    expect(waitingAt(items, 'verify', 'flarewatch')).toBe(2);
    expect(waitingAt(items, 'prove')).toBe(0);
  });

  it('records a verdict in the shared ledger and updates the item', async () => {
    stubStorage();
    const { item } = await queuePacket(await packet());
    const result = await decide(item!.id, 'accepted', 'Checked against the day file.');
    expect(result.item?.status).toBe('accepted');
    expect(result.ledgerSaved).toBe(true);
    const ledger = readLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0].kind).toBe('verdict');
    expect(ledger[0].mode).toBe('RESEARCH');
    expect(ledger[0].payload).toMatchObject({ verdict: 'accepted', packetId: item!.id });
    expect(waitingAt(readSession())).toBe(0);
  });

  it('clips a long reviewer note', async () => {
    stubStorage();
    const { item } = await queuePacket(await packet());
    const result = await decide(item!.id, 'held', 'n'.repeat(MAX_NOTE + 50));
    expect(result.item?.note).toHaveLength(MAX_NOTE);
  });

  it('keeps the first human decision when two actions overlap', async () => {
    stubStorage();
    const { item } = await queuePacket(await packet());
    const results = await Promise.all([
      decide(item.id, 'accepted', 'First review'),
      decide(item.id, 'rejected', 'Second review'),
    ]);
    expect(results.filter((result) => result.alreadyDecided)).toHaveLength(1);
    expect(readLedger()).toHaveLength(1);
    const [saved] = readSession();
    expect(readLedger()[0].payload).toMatchObject({ verdict: saved.status, note: saved.note });
  });

  it('does nothing for an unknown packet', async () => {
    stubStorage();
    const result = await decide('no-such-id', 'rejected', '');
    expect(result).toEqual({ item: null, ledgerSaved: false, sessionSaved: false });
  });

  it('treats blocked storage as an empty queue and reports the failed save', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(readSession()).toEqual([]);
    const queued = await queuePacket(await packet());
    expect(queued.saved).toBe(false);
  });
});
