import { useCallback, useEffect, useRef, useState } from 'react';

interface QueryState<T> {
  key: string;
  data: T | null;
  error: string | null;
  refreshing: boolean;
  updatedAt: number | null;
  settled: boolean;
}

/** Refresh reads without overlapping requests or committing results from an old selection. */
export function useLiveQuery<T>(
  query: (signal: AbortSignal) => Promise<T>,
  { intervalMs = 30_000, key = 'default', allowOffline = false }: { intervalMs?: number; key?: string; allowOffline?: boolean } = {},
) {
  const [state, setState] = useState<QueryState<T>>({ key, data: null, error: null, refreshing: true, updatedAt: null, settled: false });
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);

  useEffect(() => {
    let disposed = false;
    let pending: Promise<void> | null = null;
    let controller: AbortController | null = null;

    function run(): Promise<void> {
      if (disposed) return Promise.resolve();
      if (pending) return pending;
      if (!navigator.onLine && !allowOffline) {
        setState((old) => ({ ...(old.key === key ? old : { key, data: null, updatedAt: null, settled: false }), error: 'You are offline. Reconnect to refresh.', refreshing: false }));
        return Promise.resolve();
      }
      const current = new AbortController();
      controller = current;
      let timedOut = false;
      const timeout = window.setTimeout(() => { timedOut = true; current.abort(); }, 30_000);
      setState((old) => ({ ...(old.key === key ? old : { key, data: null, updatedAt: null, settled: false }), error: old.key === key ? old.error : null, refreshing: true }));
      pending = Promise.resolve().then(() => query(current.signal)).then((data) => {
        if (!disposed && !current.signal.aborted) setState({ key, data, error: null, refreshing: false, updatedAt: Date.now(), settled: true });
      }).catch((error: unknown) => {
        if (disposed) return;
        const message = timedOut ? 'The request timed out. Try refreshing again.' : error instanceof Error ? error.message : 'Could not refresh this data.';
        setState((old) => ({ ...old, error: message, refreshing: false }));
      }).finally(() => {
        window.clearTimeout(timeout);
        pending = null;
        controller = null;
      });
      return pending;
    }

    const resume = () => {
      setOnline(navigator.onLine);
      if ((navigator.onLine || allowOffline) && document.visibilityState !== 'hidden') void run();
    };
    const connectivity = () => { setOnline(navigator.onLine); if (navigator.onLine) resume(); };
    refreshRef.current = async () => {
      // A refresh requested after a write must observe that write, even if an older read is still running.
      if (pending) await pending;
      await run();
    };
    void run();
    const timer = intervalMs > 0 ? window.setInterval(() => {
      if (document.visibilityState !== 'hidden' && (navigator.onLine || allowOffline)) void run();
    }, intervalMs) : null;
    window.addEventListener('focus', resume);
    window.addEventListener('online', connectivity);
    window.addEventListener('offline', connectivity);
    document.addEventListener('visibilitychange', resume);
    return () => {
      disposed = true;
      controller?.abort();
      if (timer !== null) window.clearInterval(timer);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', connectivity);
      window.removeEventListener('offline', connectivity);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [query, key, intervalMs, allowOffline]);

  const refresh = useCallback(() => refreshRef.current(), []);
  const current = state.key === key ? state : { key, data: null, error: null, refreshing: true, updatedAt: null, settled: false };
  return { ...current, loading: !current.settled && current.error === null, refresh, online: allowOffline || online };
}
