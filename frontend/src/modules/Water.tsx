// Water module: Teesri Shikayat's features — the 250 m ring, the warned
// phone wall, resident-only case closure — surfaced in the unified shell.

import { Card, ModeBadge, ExternalLink } from '../components/Ui';
import { num } from '../api';
import type { Overview } from '../types';

export function Water({ data }: { data: Overview }) {
  const { water } = data;
  const wall = [
    { id: 'reported', label: 'Reported', count: water.statusCounts.reported },
    { id: 'warned', label: 'Warned', count: water.statusCounts.warned },
    { id: 'ring', label: 'In ring, silent', count: water.statusCounts.inRing },
    { id: 'outside', label: 'Outside ring', count: water.statusCounts.outside },
  ];
  return (
    <div className="stack">
      <div className="module-head">
        <div>
          <h1>Water <span className="by">· Teesri Shikayat</span></h1>
          <ModeBadge mode={data.sources.teesri.mode} />
          <p>A tripwire for dirty tap water. When three homes close together report dirty water, every enrolled
             home within 250 m is warned, and only the residents can close the case. Join in one tap over Telegram —
             no app, no forms.</p>
        </div>
      </div>

      <div className="grid-2">
        <Card>
          <h2>The ring · {water.ward}</h2>
          <div className="ring-stats">
            <div><span className="stat-value c-water">{num(water.reported)}</span> reports joined</div>
            <div><span className="stat-value c-water">{num(water.warned)} / {num(water.inRing)}</span> homes in ring warned</div>
            <div><span className="stat-value c-water">{water.caseOpen ? 'OPEN' : 'CLOSED'}</span> case status</div>
          </div>
          <p className="muted">
            {water.caseOpen
              ? 'The tripwire is armed: three neighbours reported, everyone around them is now warned, and the ward office holds one joined-up case.'
              : 'Residents confirmed clean taps, so the case is closed. Only they could close it.'}
          </p>
          <p className="muted">
            {water.reported > 0 && `${num(water.reported)} households reported in this source snapshot. Individual identifiers and locations are not included in the shared view.`}
          </p>
          <ExternalLink href="https://t.me/TeesriShikayatBot?start=B">Join over Telegram</ExternalLink>
        </Card>

        <Card>
          <h2>Phone wall</h2>
          <p className="muted">Aggregate status wall for the current source snapshot. Household identifiers and coordinates stay out of the shared view:</p>
          <div className="wall wall-summary" aria-label="Aggregate household status counts">
            {wall.map((row) => (
              <div className={`home ${row.id}`} key={row.id}>
                <span className="home-id">{num(row.count)}</span>
                <span className="home-state">{row.label}</span>
              </div>
            ))}
          </div>
          <div className="wall-legend">
            <span className="dot dot-reported" /> reported &nbsp;
            <span className="dot dot-warned" /> warned &nbsp;
            <span className="dot dot-ring" /> in ring, silent &nbsp;
            <span className="dot dot-outside" /> outside ring
          </div>
          <p className="muted">This summary shows the number of households in each source-reported status. The resident-level warning and case workflow remains in Teesri Shikayat.</p>
          <ExternalLink href="https://eirioqqhvtvve3aw5xhpje2wju0jztrl.lambda-url.ap-south-1.on.aws/console">Open the Teesri console</ExternalLink>
        </Card>
      </div>
    </div>
  );
}
