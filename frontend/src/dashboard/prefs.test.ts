import { describe, expect, it } from 'vitest';
import { DASHBOARD_PREFS_KEY, MAX_PINNED, PIN_REQUEST_EVENT, canPin, pinnedGridPrefs, readPrefs, requestPinnedGrid, sanitizePrefs, togglePinned, writePrefs } from './prefs';

const KNOWN = ['waste', 'fire', 'water', 'air', 'mission'];
const isKnown = (id: string) => KNOWN.includes(id);

// Minimal stand-in for localStorage. Pass a throwing variant to simulate blocked storage.
function memoryStorage(initial?: string) {
  const store = new Map<string, string>();
  if (initial !== undefined) store.set(DASHBOARD_PREFS_KEY, initial);
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  };
}

const throwingStorage = {
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); },
};

describe('sanitizePrefs', () => {
  it('falls back to focus with nothing pinned when the stored value is not an object', () => {
    for (const raw of [null, undefined, 'grid', 42, [], ['waste']]) {
      expect(sanitizePrefs(raw, isKnown)).toEqual({ layout: 'focus', pinned: [] });
    }
  });

  it('keeps only known, unique string ids', () => {
    const prefs = sanitizePrefs({ layout: 'grid', pinned: ['waste', 'nope', 'waste', 3, null, 'fire'] }, isKnown);
    expect(prefs).toEqual({ layout: 'grid', pinned: ['waste', 'fire'] });
  });

  it('caps the pinned list and keeps the stored order', () => {
    const prefs = sanitizePrefs({ layout: 'grid', pinned: KNOWN }, isKnown);
    expect(prefs.pinned).toEqual(KNOWN.slice(0, MAX_PINNED));
  });

  it('accepts only the two known layouts', () => {
    expect(sanitizePrefs({ layout: 'grid', pinned: [] }, isKnown).layout).toBe('grid');
    expect(sanitizePrefs({ layout: 'columns', pinned: [] }, isKnown).layout).toBe('focus');
  });
});

describe('readPrefs', () => {
  it('returns defaults when no storage is available', () => {
    expect(readPrefs(isKnown, null)).toEqual({ layout: 'focus', pinned: [] });
  });

  it('returns defaults when storage throws', () => {
    expect(readPrefs(isKnown, throwingStorage)).toEqual({ layout: 'focus', pinned: [] });
  });

  it('returns defaults for corrupt or oversized stored text', () => {
    expect(readPrefs(isKnown, memoryStorage('{not json'))).toEqual({ layout: 'focus', pinned: [] });
    expect(readPrefs(isKnown, memoryStorage('x'.repeat(20_000)))).toEqual({ layout: 'focus', pinned: [] });
  });

  it('reads back what was stored, after sanitising', () => {
    const storage = memoryStorage(JSON.stringify({ layout: 'grid', pinned: ['air', 'gone'] }));
    expect(readPrefs(isKnown, storage)).toEqual({ layout: 'grid', pinned: ['air'] });
  });
});

describe('writePrefs', () => {
  it('writes JSON under the dashboard key and reports success', () => {
    const storage = memoryStorage();
    expect(writePrefs({ layout: 'grid', pinned: ['waste'] }, storage)).toBe(true);
    expect(JSON.parse(storage.store.get(DASHBOARD_PREFS_KEY) ?? 'null')).toEqual({ layout: 'grid', pinned: ['waste'] });
  });

  it('reports failure instead of throwing when storage is missing or refuses the write', () => {
    expect(writePrefs({ layout: 'focus', pinned: [] }, null)).toBe(false);
    expect(writePrefs({ layout: 'focus', pinned: [] }, throwingStorage)).toBe(false);
  });

  it('round-trips through read', () => {
    const storage = memoryStorage();
    const prefs = { layout: 'grid' as const, pinned: ['mission', 'water'] };
    writePrefs(prefs, storage);
    expect(readPrefs(isKnown, storage)).toEqual(prefs);
  });
});

describe('pinning', () => {
  it('adds an unpinned view and removes a pinned one', () => {
    const added = togglePinned(['waste'], 'fire');
    expect(added).toEqual(['waste', 'fire']);
    expect(togglePinned(added, 'waste')).toEqual(['fire']);
  });

  it('refuses a fifth pin without dropping an existing one', () => {
    const full = ['waste', 'fire', 'water', 'air'];
    expect(canPin(full, 'mission')).toBe(false);
    expect(togglePinned(full, 'mission')).toBe(full);
  });

  it('still lets a pinned view be unpinned when the grid is full', () => {
    const full = ['waste', 'fire', 'water', 'air'];
    expect(canPin(full, 'air')).toBe(true);
    expect(togglePinned(full, 'air')).toEqual(['waste', 'fire', 'water']);
  });

  it('never mutates the list it was given', () => {
    const pinned = ['waste'];
    togglePinned(pinned, 'fire');
    expect(pinned).toEqual(['waste']);
  });
});

describe('pinned grid requests', () => {
  it('turns a request into a grid of the requested views, in order', () => {
    expect(pinnedGridPrefs(['air', 'water', 'fire', 'waste'], isKnown)).toEqual({ layout: 'grid', pinned: ['air', 'water', 'fire', 'waste'] });
  });

  it('drops unknown and duplicate ids and keeps the cap, as stored preferences do', () => {
    expect(pinnedGridPrefs(['nope', 'air', 'air', 'fire', 'waste', 'water', 'mission'], isKnown)?.pinned).toEqual(['air', 'fire', 'waste', 'water']);
  });

  it('ignores a request with no usable ids', () => {
    expect(pinnedGridPrefs('air', isKnown)).toBeNull();
    expect(pinnedGridPrefs(['nope'], isKnown)).toBeNull();
  });

  it('delivers the request to a listener on the window', () => {
    const received: unknown[] = [];
    const listener = (event: Event) => { received.push((event as CustomEvent<unknown>).detail); };
    const target = new EventTarget();
    Object.defineProperty(globalThis, 'window', { value: target, configurable: true });
    try {
      target.addEventListener(PIN_REQUEST_EVENT, listener);
      requestPinnedGrid(['air', 'water']);
      expect(received).toEqual([['air', 'water']]);
    } finally {
      target.removeEventListener(PIN_REQUEST_EVENT, listener);
      delete (globalThis as { window?: unknown }).window;
    }
  });
});
