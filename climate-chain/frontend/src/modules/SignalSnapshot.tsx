import type { Overview } from '../types';
import { displayText } from '../core/displayNames';
import './signals.css';

export function downloadSnapshot(name: string, snapshot: unknown) {
  const href = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = href;
  link.download = `climate-chain-${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export function SignalSnapshot({ data, source }: { data: Overview; source: keyof Overview['sources'] }) {
  const status = data.sources[source];
  const provenance = status.provenance;
  return (
    <details className="boundary-note">
      <summary>{status.label} · {status.connection?.replace(/_/g, ' ') ?? (status.mode === 'live' ? 'source response received' : 'simulated snapshot')} · snapshot {new Date(data.asOf).toLocaleString()}</summary>
      <p className="muted small">{status.mode === 'mock' ? 'These values are simulated. They are not evidence of current conditions.' : 'Figures belong to this source and its reporting scope. A successful fetch does not make the observations current.'}</p>
      {status.error && <p role="status">{status.error.code}: {status.error.message}</p>}
      {provenance && <dl className="cascade-facts">
        <div><dt>Fetched</dt><dd>{new Date(provenance.fetchedAt).toLocaleString()}</dd></div>
        <div><dt>Source operation</dt><dd>{displayText(`${provenance.source} / ${provenance.operation}`)}</dd></div>
        <div><dt>Request</dt><dd>{provenance.elapsedMs} ms · {provenance.attempts} attempt(s){provenance.cacheHit ? ' · cached response' : ''}</dd></div>
      </dl>}
    </details>
  );
}
