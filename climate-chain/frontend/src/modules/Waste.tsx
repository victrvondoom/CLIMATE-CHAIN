// Waste module: DumpWatch's features — site map list, 10-backer verification,
// ward/MLA/MP accountability and the cited letter — surfaced in the unified shell.

import { useMemo, useState } from 'react';
import { Card, ModeBadge, Progress, ExternalLink } from '../components/Ui';
import { num } from '../api';
import type { Overview } from '../types';
import { downloadSnapshot, SignalSnapshot } from './SignalSnapshot';

const TYPE_LABEL: Record<string, string> = {
  waste_dump: 'Waste dump',
  overflowing_bin: 'Overflowing or broken bin',
  construction_debris: 'Construction debris',
};

export function Waste({ data, onReview }: { data: Overview; onReview: (siteId: string) => void }) {
  const { sites } = data.waste;
  const open = sites.filter((s) => s.status === 'open');
  const cleared = sites.filter((s) => s.status === 'cleared' || s.status === 'resolved');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('open');
  const [verification, setVerification] = useState('all');
  const [sort, setSort] = useState('recent');
  const visible = useMemo(() => sites.filter((site) => (
    (status === 'all' || (status === 'open' ? site.status === 'open' : site.status === status))
    && (verification === 'all' || site.verification === verification)
    && [site.id, site.reportType, TYPE_LABEL[site.reportType], site.context].join(' ').toLowerCase().includes(query.trim().toLowerCase())
  )).sort((a, b) => sort === 'reports' ? b.reportCount - a.reportCount
    : sort === 'backers' ? b.backers.count - a.backers.count
      : (Date.parse(b.lastReportedAt ?? '') || 0) - (Date.parse(a.lastReportedAt ?? '') || 0)), [sites, query, status, verification, sort]);
  const statuses = [...new Set(sites.map((site) => site.status))];
  return (
    <div className="stack signal-page">
      <div className="module-head">
        <div>
          <h1>Waste <span className="by">· DumpWatch</span></h1>
          <ModeBadge mode={data.sources.junksnap.mode} />
          <p>Snap the junk, prove it, get it cleared. Residents photograph waste; the photo is blurred,
             checked by stacked models, mapped to the ward, MLA and MP seat, and becomes a cited letter
             once 10 different people back it.</p>
        </div>
      </div>

      <SignalSnapshot data={data} source="junksnap" />
      <div className="library-controls">
        <label className="search-field">Find site<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Site ID, waste type or context" /></label>
        <label>Status <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="open">Open ({open.length})</option>{statuses.filter((value) => value !== 'open').map((value) => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}</select></label>
        <label>Proof <select value={verification} onChange={(event) => setVerification(event.target.value)}><option value="all">All verification states</option><option value="verified">Verified</option><option value="unverified">Unverified</option></select></label>
        <label>Sort <select value={sort} onChange={(event) => setSort(event.target.value)}><option value="recent">Most recent report</option><option value="reports">Most reports</option><option value="backers">Most backers</option></select></label>
        <button className="text-action" onClick={() => downloadSnapshot('waste-sites', { asOf: data.asOf, source: data.sources.junksnap, filters: { query, status, verification, sort }, sites: visible })}>Export {visible.length} visible sites</button>
      </div>

      <div className="grid-2">
        <Card>
          <h2>{visible.length} of {sites.length} waste sites</h2>
          <ul className="site-list">
            {visible.map((s) => (
              <li key={s.id} className="site">
                <div className="site-main">
                  <div className="site-title">
                    {TYPE_LABEL[s.reportType] ?? s.reportType}
                    <span className="site-context">· {s.context.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="site-coords muted">
                    {s.lat == null || s.lng == null ? 'Location unavailable' : `${s.lat.toFixed(4)}°, ${s.lng.toFixed(4)}°`} · {s.reportCount} report{s.reportCount === 1 ? '' : 's'}
                  </div>
                  <div className="site-coords muted">{s.id} · {s.status.replace(/_/g, ' ')}</div>
                  {s.lastReportedAt && <div className="site-coords muted">Last reported {new Date(s.lastReportedAt).toLocaleString()}</div>}
                  <Progress count={s.backers.count} needed={s.backers.needed} color="waste" />
                  <button className="text-action site-review" disabled={s.status !== 'open' || s.lat == null || s.lng == null} onClick={() => onReview(s.id)}>
                    Review nearby air context <span aria-hidden="true">→</span>
                  </button>
                </div>
                <span className={`chip ${s.verification === 'verified' ? 'chip-ok' : ''}`}>
                  {s.verification === 'verified' ? 'Verified' : 'Unverified'}
                </span>
              </li>
            ))}
            {visible.length === 0 && <li className="muted">No sites match these filters. <button className="text-action" onClick={() => { setQuery(''); setStatus('all'); setVerification('all'); }}>Show all sites</button></li>}
          </ul>
        </Card>

        <div className="stack tight">
          <Card>
            <h2>How the chain closes</h2>
            <ol className="steps">
              <li><strong>Snap</strong> — the in-app camera takes the photo with GPS.</li>
              <li><strong>Blind</strong> — faces and number plates are blurred before storage.</li>
              <li><strong>Verify</strong> — 10 different people must back the site.</li>
              <li><strong>Map</strong> — ward, assembly seat (MLA) and Lok Sabha seat (MP) attached.</li>
              <li><strong>File</strong> — a drafted letter quotes only rules checked word for word against official text.</li>
            </ol>
            <ExternalLink href="https://junksnap.coehemang.dev">Report a site in the DumpWatch app</ExternalLink>
          </Card>

          <Card>
            <h2>City scorecard</h2>
            <div className="ledger">
              <div><span className="stat-value c-waste">{num(cleared.length)}</span> sites cleared</div>
              <div><span className="stat-value c-waste">{num(data.waste.verified)}</span> verified with 10+ backers</div>
              <div><span className="stat-value c-waste">{num(sites.length)}</span> total in view</div>
            </div>
            <p className="muted">Counts cover the sites returned in this snapshot. Only explicit cleared or resolved statuses count as cleared. Water household locations are not supplied, so no sanitation cross-check is inferred.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
