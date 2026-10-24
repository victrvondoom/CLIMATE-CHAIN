// Per-browser dashboard layout: which views are pinned, and whether the dashboard shows
// one view or a grid of pins. Storage can be blocked, full or absent, and reading
// window.localStorage itself can throw, so every access is guarded and falls back to
// defaults. Nothing here leaves the browser.

export const DASHBOARD_PREFS_KEY = 'climate-chain-dashboard-v1';
export const MAX_PINNED = 4;

export type DashboardLayout = 'focus' | 'grid';

export interface DashboardPrefs {
  layout: DashboardLayout;
  pinned: string[];
}

type PrefsStorage = Pick<Storage, 'getItem' | 'setItem'>;

const MAX_STORED_LENGTH = 10_000;

function defaultPrefs(): DashboardPrefs {
  return { layout: 'focus', pinned: [] };
}

// Drops unknown ids, duplicates and anything past the pin cap. Keeps the stored order.
export function sanitizePrefs(raw: unknown, isPinnable: (id: string) => boolean): DashboardPrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultPrefs();
  const record = raw as { layout?: unknown; pinned?: unknown };
  const pinned: string[] = [];
  if (Array.isArray(record.pinned)) {
    for (const item of record.pinned) {
      if (pinned.length === MAX_PINNED) break;
      if (typeof item === 'string' && isPinnable(item) && !pinned.includes(item)) pinned.push(item);
    }
  }
  return { layout: record.layout === 'grid' ? 'grid' : 'focus', pinned };
}

function browserStorage(): PrefsStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readPrefs(isPinnable: (id: string) => boolean, storage: PrefsStorage | null = browserStorage()): DashboardPrefs {
  try {
    const raw = storage?.getItem(DASHBOARD_PREFS_KEY) ?? null;
    if (!raw || raw.length > MAX_STORED_LENGTH) return defaultPrefs();
    return sanitizePrefs(JSON.parse(raw), isPinnable);
  } catch {
    return defaultPrefs();
  }
}

// Returns false when the write was refused. The caller shows that instead of failing silently.
export function writePrefs(prefs: DashboardPrefs, storage: PrefsStorage | null = browserStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(DASHBOARD_PREFS_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}

export function canPin(pinned: string[], id: string): boolean {
  return pinned.includes(id) || pinned.length < MAX_PINNED;
}

// Toggles one view in the pinned list. A full list refuses new pins; it never drops an existing one.
export function togglePinned(pinned: string[], id: string): string[] {
  if (pinned.includes(id)) return pinned.filter((item) => item !== id);
  return canPin(pinned, id) ? [...pinned, id] : pinned;
}

// Another view (the command center) can ask for a set of views side by side. The dashboard owns
// the saved layout, so the request travels as a window event that the dashboard listens for.
export const PIN_REQUEST_EVENT = 'climate-chain:pin-views';

export function requestPinnedGrid(ids: string[]): void {
  window.dispatchEvent(new CustomEvent<string[]>(PIN_REQUEST_EVENT, { detail: ids }));
}

// The layout a pin request produces: those views, in that order, in the grid. Unknown ids,
// duplicates and anything past the cap are dropped, as for stored preferences.
export function pinnedGridPrefs(ids: unknown, isPinnable: (id: string) => boolean): DashboardPrefs | null {
  if (!Array.isArray(ids)) return null;
  const prefs = sanitizePrefs({ layout: 'grid', pinned: ids }, isPinnable);
  return prefs.pinned.length > 0 ? prefs : null;
}
