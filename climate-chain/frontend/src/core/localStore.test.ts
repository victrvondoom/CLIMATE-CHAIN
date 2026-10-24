import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendLedger, createEvidence, subscribeLedger } from './evidence';
import { notifyLocalStore, subscribeLocalStore } from './localStore';

describe('observable browser storage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('notifies subscribers only after an evidence record is saved in this tab', async () => {
    let blocked = false;
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (blocked) throw new Error('blocked');
        values.set(key, value);
      },
    });
    const changed = vi.fn();
    const stop = subscribeLedger(changed);
    try {
      const record = await createEvidence({ moduleId: 'flarewatch', kind: 'test', mode: 'DEMO', summary: 'Test', payload: {} });
      expect(appendLedger(record)).toBe(true);
      expect(changed).toHaveBeenCalledTimes(1);
      blocked = true;
      expect(appendLedger(record)).toBe(false);
      expect(changed).toHaveBeenCalledTimes(1);
    } finally { stop(); }
  });

  it('syncs changes from other tabs, storage clearing and focus, then unsubscribes', () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    const changed = vi.fn();
    const stop = subscribeLocalStore('review-test', changed);
    target.dispatchEvent(Object.assign(new Event('storage'), { key: 'other-key' }));
    expect(changed).not.toHaveBeenCalled();
    target.dispatchEvent(Object.assign(new Event('storage'), { key: 'review-test' }));
    target.dispatchEvent(Object.assign(new Event('storage'), { key: null }));
    target.dispatchEvent(new Event('focus'));
    expect(changed).toHaveBeenCalledTimes(3);
    stop();
    notifyLocalStore('review-test');
    target.dispatchEvent(new Event('focus'));
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it('reports absent storage as a failed write', async () => {
    vi.stubGlobal('localStorage', undefined);
    const record = await createEvidence({ moduleId: 'flarewatch', kind: 'test', mode: 'DEMO', summary: 'Test', payload: {} });
    expect(appendLedger(record)).toBe(false);
  });
});
