// Fire module: AshAlert's features — Burn Risk Radar, baler logistics,
// buyer supply and impact — surfaced in the unified shell.

import { useState } from 'react';
import { Card, ModeBadge, Stat, ExternalLink } from '../components/Ui';
import { inr, num } from '../api';
import type { Overview } from '../types';
import { downloadSnapshot, SignalSnapshot } from './SignalSnapshot';

export function Fire({ data }: { data: Overview }) {
  const { fire } = data;
  const redPct = fire.fields ? Math.round((fire.redFields / fire.fields) * 100) : 0;
  const [risk, setRisk] = useState('all');
  const [ledgerView, setLedgerView] = useState('operations');
  const risks = [
    { id: 'red', label: 'RED', count: fire.redFields, action: 'Prioritize a baler review in AshAlert' },
    { id: 'yellow', label: 'YELLOW', count: fire.yellowFields, action: 'Review the watch list in AshAlert' },
    { id: 'green', label: 'Other fields', count: Math.max(0, fire.fields - fire.redFields - fire.yellowFields), action: 'Classification detail is not returned in this summary' },
  ];
  const metrics = ledgerView === 'operations' ? [
    { label: 'Baler bookings completed', value: fire.bookingsDone, total: fire.bookings, unit: 'bookings' },
    { label: 'Registered acreage cleared', value: fire.acresCleared, total: fire.acresRegistered, unit: 'acres' },
    { label: 'Booked straw delivered', value: fire.tonnesDelivered, total: fire.tonnesBooked, unit: 'tonnes' },
  ] : [
    { label: 'Registered acreage booked', value: fire.acresBooked, total: fire.acresRegistered, unit: 'acres' },
    { label: 'Fields classified RED', value: fire.redFields, total: fire.fields, unit: 'fields' },
    { label: 'Fields classified YELLOW', value: fire.yellowFields, total: fire.fields, unit: 'fields' },
  ];
  return (
    <div className="stack signal-page">
      <div className="module-head">
        <div>
          <h1>Fire <span className="by">· AshAlert</span></h1>
          <ModeBadge mode={data.sources.clearsky.mode} />
          <p>Stop stubble fires before they start. A farmer sends one WhatsApp message or voice note in Hindi,
             Punjabi, Hinglish or English; an AI agent registers the field, books the nearest baler that can clear
             it before wheat sowing, and routes the straw to the buyer who pays the most after transport.</p>
        </div>
      </div>

      <SignalSnapshot data={data} source="clearsky" />
      <div className="library-resultline"><span>Season date reported by source: {fire.today || 'Not supplied'}</span><button className="text-action" onClick={() => downloadSnapshot('fire-season', { asOf: data.asOf, source: data.sources.clearsky, fire })}>Export season snapshot</button></div>

      <div className="kpis">
        <Card accent="fire"><Stat label="Fields at burn risk (RED)" value={num(fire.redFields)} hint={`${redPct}% of ${num(fire.fields)} registered fields`} color="fire" /></Card>
        <Card accent="fire"><Stat label="Acres cleared without burning" value={num(fire.acresCleared)} unit={`of ${num(fire.acresRegistered)} ac`} color="fire" /></Card>
        <Card accent="fire"><Stat label="Straw delivered to buyers" value={num(fire.tonnesDelivered)} unit="t" hint={`${num(fire.tonnesBooked)} t booked`} color="fire" /></Card>
        <Card accent="fire"><Stat label="Estimated farmer payouts" value={inr(fire.payoutsEstimatedInr)} color="fire" /><p className="finance-demo-note">{fire.demoPrices === true ? 'Demo buyer prices; estimate only. This total is not a payment receipt.' : 'Source-reported estimate only; this total is not a payment receipt.'}</p></Card>
      </div>

      <div className="grid-2">
        <Card>
          <h2>Burn Risk Radar</h2>
          <p className="muted">District officers see fields likely to burn <em>before</em> a fire is lit, ranked by harvest
             date, rain, machine distance and the wheat-sowing deadline. Village alerts go out with one tap.</p>
          <div className="filter-row" aria-label="Risk categories"><button className={risk === 'all' ? 'filter-pill active' : 'filter-pill'} aria-pressed={risk === 'all'} onClick={() => setRisk('all')}>All fields</button>{risks.map((row) => <button key={row.id} className={risk === row.id ? 'filter-pill active' : 'filter-pill'} aria-pressed={risk === row.id} onClick={() => setRisk(row.id)}>{row.label} ({num(row.count)})</button>)}</div>
          <div className="radar">
            {risks.filter((row) => risk === 'all' || risk === row.id).map((row) => <div key={row.id} className="radar-row"><span className={`radar-dot ${row.id}`} /><strong>{num(row.count)} {row.label}</strong> fields · {row.action}</div>)}
          </div>
          <p className="muted">These are source-level totals. Field identities, village locations and individual booking actions remain in AshAlert; this summary cannot establish a relationship with a AirPulse reading.</p>
          <ExternalLink href="https://clearsky.akkki.tech/admin">Officer radar (AshAlert dashboard)</ExternalLink>
        </Card>

        <div className="stack tight">
          <Card>
            <h2>Season ledger</h2>
            <div className="filter-row"><button className={ledgerView === 'operations' ? 'filter-pill active' : 'filter-pill'} aria-pressed={ledgerView === 'operations'} onClick={() => setLedgerView('operations')}>Delivery progress</button><button className={ledgerView === 'coverage' ? 'filter-pill active' : 'filter-pill'} aria-pressed={ledgerView === 'coverage'} onClick={() => setLedgerView('coverage')}>Field coverage</button></div>
            {metrics.map((metric) => <div key={metric.label} className="stack tight"><span>{metric.label}: {num(metric.value)} / {num(metric.total)} {metric.unit}</span>{metric.total > 0 ? <progress max={metric.total} value={Math.min(metric.value, metric.total)} aria-label={metric.label} /> : <span className="muted small">No denominator reported</span>}</div>)}
            <div className="ledger">
              <div><span className="stat-value c-fire">{num(fire.farmers)}</span> farmers on WhatsApp</div>
              <div><span className="stat-value c-fire">{num(fire.bookings)}</span> baler bookings ({num(fire.bookingsDone)} done)</div>
              <div><span className="stat-value c-fire">{num(fire.alertsSent)}</span> village alerts sent</div>
              <div><span className="stat-value c-fire">{fire.fieldsSavedAfterAlert == null ? 'Not reported' : num(fire.fieldsSavedAfterAlert)}</span> fields saved after alerts</div>
            </div>
          </Card>
          <Card>
            <h2>Why it matters here</h2>
            <p className="muted">AshAlert reports field and alert activity in its own season context. Climate Chain does not join those field outcomes to AirPulse readings or estimate avoided air pollution.</p>
            <ExternalLink href="https://clearsky.akkki.tech/impact">Public impact page</ExternalLink>
          </Card>
        </div>
      </div>
    </div>
  );
}
