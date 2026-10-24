// Shared UI atoms for the unified frontend.

import type { ReactNode } from 'react';
import type { SourceMode } from '../types';

export function ModeBadge({ mode }: { mode: SourceMode }) {
  return (
    <span className={`mode-badge ${mode}`} title={mode === 'live' ? 'Live data from the project\'s own API' : 'Upstream unreachable; labelled simulated data'}>
      {mode === 'live' ? 'LIVE' : 'SIMULATED'}
    </span>
  );
}

export function Card({ children, className, accent }: { children: ReactNode; className?: string; accent?: string }) {
  return (
    <section className={`card ${className ?? ''} ${accent ? `accent-${accent}` : ''}`}>
      {children}
    </section>
  );
}

export function Stat({ label, value, unit, hint, color }: { label: string; value: ReactNode; unit?: string; hint?: string; color?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${color ? `c-${color}` : ''}`}>
        {value}
        {unit ? <span className="stat-unit"> {unit}</span> : null}
      </div>
      {hint ? <div className="stat-hint">{hint}</div> : null}
    </div>
  );
}

export function Sparkline({ hours, max = 250 }: { hours: { t: string; pm25: number; kind: string }[]; max?: number }) {
  if (!hours.length) return <div className="sparkline-empty">no hours</div>;
  const w = 560;
  const h = 90;
  const points = hours.map((hh, i) => {
    const x = (i / Math.max(1, hours.length - 1)) * w;
    const y = h - Math.min(1, hh.pm25 / max) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`PM2.5 trend across ${hours.length} readings`}>
      <polyline className="spark-line" points={points.join(' ')} />
      <polyline className="spark-fill" points={`0,${h} ${points.join(' ')} ${w},${h}`} />
      <line x1="0" y1={h - (115 / max) * h} x2={w} y2={h - (115 / max) * h} className="who-line" />
    </svg>
  );
}

export function Progress({ count, needed, color }: { count: number; needed: number; color: string }) {
  const pct = Math.min(100, (count / needed) * 100);
  return (
    <div className="progress" title={`${count} of ${needed} resident backers`}>
      <div className="progress-fill" style={{ width: `${pct}%`, background: `var(--${color})` }} />
      <span className="progress-text">
        {count}/{needed} backers
      </span>
    </div>
  );
}

export function ModuleTag({ modules }: { modules: string[] }) {
  return (
    <span className="module-tags">
      {modules.map((m) => (
        <span key={m} className={`tag tag-${m}`}>
          {m}
        </span>
      ))}
    </span>
  );
}

export function ExternalLink({ href: _href, children, onClick }: { href?: string; children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      className="ext-inapp"
      onClick={onClick}
      title="Integrated natively into Climate Chain centralized workflow"
    >
      <span className="ext-label">{children}</span>
      <span className="ext-tag">Centralized In-App</span>
    </button>
  );
}
