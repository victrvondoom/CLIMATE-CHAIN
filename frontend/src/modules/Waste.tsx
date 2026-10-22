// Waste module: JunkSnap's features — site map list, 10-backer verification,
// ward/MLA/MP accountability and the cited letter — surfaced in the unified shell.

import { Card, ModeBadge, Progress, ExternalLink } from '../components/Ui';
import { num } from '../api';
import type { Overview } from '../types';

const TYPE_LABEL: Record<string, string> = {
  waste_dump: 'Waste dump',
  overflowing_bin: 'Overflowing or broken bin',
  construction_debris: 'Construction debris',
};

export function Waste({ data, onReview }: { data: Overview; onReview: (siteId: string) => void }) {
  const { sites } = data.waste;
  const open = sites.filter((s) => s.status === 'open');
  const cleared = sites.filter((s) => s.status !== 'open');
  return (
    <div className="stack">
      <div className="module-head">
        <div>
          <h1>Waste <span className="by">· JunkSnap</span></h1>
          <ModeBadge mode={data.sources.junksnap.mode} />
          <p>Snap the junk, prove it, get it cleared. Residents photograph waste; the photo is blurred,
             checked by stacked models, mapped to the ward, MLA and MP seat, and becomes a cited letter
             once 10 different people back it.</p>
        </div>
      </div>

      <div className="grid-2">
        <Card>
          <h2>Open sites awaiting proof</h2>
          <ul className="site-list">
            {open.map((s) => (
              <li key={s.id} className="site">
                <div className="site-main">
                  <div className="site-title">
                    {TYPE_LABEL[s.reportType] ?? s.reportType}
                    <span className="site-context">· {s.context.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="site-coords muted">
                    {s.lat?.toFixed(4)}°N, {s.lng?.toFixed(4)}°E · {s.reportCount} report{s.reportCount === 1 ? '' : 's'}
                  </div>
                  {s.lastReportedAt && <div className="site-coords muted">Last reported {new Date(s.lastReportedAt).toLocaleString()}</div>}
                  <Progress count={s.backers.count} needed={s.backers.needed} color="waste" />
                  <button className="text-action site-review" onClick={() => onReview(s.id)}>
                    Review nearby air context <span aria-hidden="true">→</span>
                  </button>
                </div>
                <span className={`chip ${s.verification === 'verified' ? 'chip-ok' : ''}`}>
                  {s.verification === 'verified' ? 'Verified' : 'Unverified'}
                </span>
              </li>
            ))}
            {open.length === 0 && <li className="muted">No open sites in the pilot bbox right now.</li>}
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
            <ExternalLink href="https://junksnap.coehemang.dev">Report a site in the JunkSnap app</ExternalLink>
          </Card>

          <Card>
            <h2>City scorecard</h2>
            <div className="ledger">
              <div><span className="stat-value c-waste">{num(cleared.length)}</span> sites cleared</div>
              <div><span className="stat-value c-waste">{num(data.waste.verified)}</span> verified with 10+ backers</div>
              <div><span className="stat-value c-waste">{num(sites.length)}</span> total in view</div>
            </div>
            <p className="muted">JunkSnap scores how fast the city clears dumps, how much residents dump, and whether anywhere legal exists to put waste. Cleared sites feed the Water module's sanitation cross-check.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
