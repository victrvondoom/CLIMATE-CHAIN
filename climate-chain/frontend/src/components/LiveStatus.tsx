import { useEffect, useState } from 'react';

// Shown inside a view that needs the shared signal snapshot before the first snapshot arrives,
// so the panel says what it is waiting for instead of staying blank. No value is drawn until a
// real snapshot is received.
export function SignalsPending({ label, error, online, onRetry }: { label: string; error: string | null; online: boolean; onRetry: () => void }) {
  if (error || !online) {
    return (
      <section className="signals-pending signals-pending-error" role="alert">
        <span className="eyebrow">SIGNALS UNAVAILABLE</span>
        <h2>{label} needs the latest source snapshot</h2>
        <p>{!online ? 'This browser is offline.' : error} No values are shown until a snapshot arrives.</p>
        <button type="button" onClick={onRetry} disabled={!online}>Retry connection</button>
      </section>
    );
  }
  return (
    <section className="signals-pending" role="status" aria-live="polite">
      <span className="eyebrow">LOADING SIGNALS</span>
      <p>Requesting the latest snapshot from DumpWatch, AshAlert, TapAlert and AirPulse for {label}…</p>
    </section>
  );
}

export function LiveStatus({ updatedAt, refreshing, error, online, onRefresh }: {
  updatedAt: number | null;
  refreshing: boolean;
  error: string | null;
  online: boolean;
  onRefresh: () => void;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const age = updatedAt === null ? null : Math.max(0, Math.floor((now - updatedAt) / 1000));
  return (
    <div className={`live-status ${!online || error ? 'live-status-warning' : ''}`}>
      <span className={`dot ${online && !error ? 'dot-live' : 'dot-down'}`} aria-hidden="true" />
      <span role="status">{!online ? updatedAt ? 'Offline · showing last received data' : 'Offline · reconnect to load signals' : refreshing ? 'Refreshing signals…' : updatedAt ? `Received ${age}s ago · refreshes every 30s` : 'Connecting to signals…'}</span>
      {error && <span className="live-status-error" role="alert">{error}{updatedAt ? ' Showing the last successful snapshot.' : ''}</span>}
      <button type="button" onClick={onRefresh} disabled={refreshing || !online}>{refreshing ? 'Refreshing…' : error ? 'Retry connection' : 'Refresh now'}</button>
    </div>
  );
}
