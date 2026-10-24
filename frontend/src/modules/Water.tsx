// Water module: Teesri Shikayat's features — the 250 m ring, the warned
// phone wall, resident-only case closure — surfaced in the unified shell.

import { useState } from 'react';
import { Card, ModeBadge, ExternalLink } from '../components/Ui';
import { num } from '../api';
import type { Overview } from '../types';
import { downloadSnapshot, SignalSnapshot } from './SignalSnapshot';

export function Water({ data }: { data: Overview }) {
  const { water } = data;
  const [selectedStatus, setSelectedStatus] = useState('all');
  const wall = [
    { id: 'reported', label: 'Reported', count: water.statusCounts.reported, detail: 'Households with a dirty-water report in the source snapshot.' },
    { id: 'warned', label: 'Warned', count: water.statusCounts.warned, detail: 'Households the source marks as warned. Delivery receipts are not returned here.' },
    { id: 'ring', label: 'In ring, silent', count: water.statusCounts.inRing, detail: 'Households in the ring without a reported or warned status in this aggregate.' },
    { id: 'outside', label: 'Outside ring', count: water.statusCounts.outside, detail: 'Enrolled households outside the current ring.' },
  ];
  const selected = wall.find((row) => row.id === selectedStatus);
  const coverage = water.inRing > 0 ? Math.round(water.warned / water.inRing * 100) : null;
  const statusTotal = wall.reduce((sum, row) => sum + row.count, 0);
  return (
    <div className="stack signal-page">
      <div className="module-head">
        <div>
          <h1>Water <span className="by">· Teesri Shikayat</span></h1>
          <ModeBadge mode={data.sources.teesri.mode} />
          <p>A tripwire for dirty tap water. When three homes close together report dirty water, every enrolled
             home within 250 m is warned, and only the residents can close the case. Join in one tap over Telegram —
             no app, no forms.</p>
        </div>
      </div>

      <SignalSnapshot data={data} source="teesri" />
      <div className="library-resultline"><span>{num(water.total)} enrolled households · {coverage == null ? 'Ring coverage unavailable' : `${coverage}% source-reported warning coverage`}</span><button className="text-action" onClick={() => downloadSnapshot('water-aggregate', { asOf: data.asOf, source: data.sources.teesri, water })}>Export aggregate snapshot</button></div>

      <div className="grid-2">
        <Card>
          <h2>The ring · {water.ward}</h2>
          <div className="ring-stats">
            <div><span className="stat-value c-water">{num(water.reported)}</span> reports joined</div>
            <div><span className="stat-value c-water">{num(water.warned)} / {num(water.inRing)}</span> homes in ring warned</div>
            <div><span className="stat-value c-water">{water.caseOpen ? 'MET' : 'NOT MET'}</span> three-report threshold</div>
          </div>
          <p className="muted">
            {water.caseOpen
              ? `The gateway's three-report threshold is met: ${num(water.reported)} reports and ${num(water.warned)} warned households. ${num(Math.max(0, water.inRing - water.warned))} in-ring households are not counted as warned.`
              : 'The current snapshot is below the three-report threshold. A source-confirmed case state, closure confirmations and their history are not included here.'}
          </p>
          <p className="muted">
            {water.reported > 0 && `${num(water.reported)} households reported in this source snapshot. Individual identifiers and locations are not included in the shared view.`}
          </p>
          <ExternalLink href="https://t.me/TeesriShikayatBot?start=B">Join over Telegram</ExternalLink>
        </Card>

        <Card>
          <h2>Phone wall</h2>
          <p className="muted">Select a status to inspect its share of the current snapshot. Household identifiers and coordinates stay out of the shared view.</p>
          <div className="filter-row" aria-label="Household status"><button className={selectedStatus === 'all' ? 'filter-pill active' : 'filter-pill'} aria-pressed={selectedStatus === 'all'} onClick={() => setSelectedStatus('all')}>All statuses</button>{wall.map((row) => <button key={row.id} className={selectedStatus === row.id ? 'filter-pill active' : 'filter-pill'} aria-pressed={selectedStatus === row.id} onClick={() => setSelectedStatus(row.id)}>{row.label}</button>)}</div>
          <div className="wall wall-summary" aria-label="Aggregate household status counts">
            {wall.filter((row) => selectedStatus === 'all' || selectedStatus === row.id).map((row) => (
              <div className={`home ${row.id}`} key={row.id}>
                <span className="home-id">{num(row.count)}</span>
                <span className="home-state">{row.label}</span>
              </div>
            ))}
          </div>
          {selected && <div role="status"><p>{selected.detail}</p><p className="muted">{num(selected.count)} of {num(statusTotal)} households across the reported status categories{statusTotal > 0 ? ` (${Math.round(selected.count / statusTotal * 100)}%)` : ''}.</p></div>}
          {statusTotal !== water.total && <p className="muted small">The status categories total {num(statusTotal)}; enrollment total is {num(water.total)}. These source totals are shown without assigning missing household statuses.</p>}
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
