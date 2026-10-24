// localStorage sends events to other tabs only. Notify this tab after successful
// writes too, so the desk, ledger and module outputs stay in step.
const listeners = new Map<string, Set<() => void>>();
let eventTarget: Window | null = null;
const refreshAll = () => listeners.forEach((subscribers) => subscribers.forEach((listener) => listener()));
const onStorage = (event: StorageEvent) => {
  if (event.key === null) refreshAll();
  else notifyLocalStore(event.key);
};

export function subscribeLocalStore(key: string, listener: () => void): () => void {
  const subscribers = listeners.get(key) ?? new Set<() => void>();
  subscribers.add(listener);
  listeners.set(key, subscribers);
  if (!eventTarget && typeof window !== 'undefined') {
    eventTarget = window;
    eventTarget.addEventListener('storage', onStorage);
    eventTarget.addEventListener('focus', refreshAll);
  }
  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) listeners.delete(key);
    if (listeners.size === 0 && eventTarget) {
      eventTarget.removeEventListener('storage', onStorage);
      eventTarget.removeEventListener('focus', refreshAll);
      eventTarget = null;
    }
  };
}

export function notifyLocalStore(key: string): void {
  listeners.get(key)?.forEach((listener) => listener());
}
