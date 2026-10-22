// Fire module: clearsky's features — Burn Risk Radar, baler logistics,
// buyer supply and impact — surfaced in the unified shell.

import { Card, ModeBadge, Stat, ExternalLink } from '../components/Ui';
import { inr, num } from '../api';
import type { Overview } from '../types';

export function Fire({ data }: { data: Overview }) {
  const { fire } = data;
  const redPct = fire.fields ? Math.round((fire.redFields / fire.fields) * 100) : 0;
  return (
    <div className="stack">
      <div className="module-head">
        <div>
          <h1>Fire <span className="by">· clearsky</span></h1>
          <ModeBadge mode={data.sources.clearsky.mode} />
          <p>Stop stubble fires before they start. A farmer sends one WhatsApp message or voice note in Hindi,
             Punjabi, Hinglish or English; an AI agent registers the field, books the nearest baler that can clear
             it before wheat sowing, and routes the straw to the buyer who pays the most after transport.</p>
        </div>
      </div>

      <div className="kpis">
        <Card accent="fire"><Stat label="Fields at burn risk (RED)" value={num(fire.redFields)} hint={`${redPct}% of ${num(fire.fields)} registered fields`} color="fire" /></Card>
        <Card accent="fire"><Stat label="Acres cleared without burning" value={num(fire.acresCleared)} unit={`of ${num(fire.acresRegistered)} ac`} color="fire" /></Card>
        <Card accent="fire"><Stat label="Straw delivered to buyers" value={num(fire.tonnesDelivered)} unit="t" hint={`${num(fire.tonnesBooked)} t booked`} color="fire" /></Card>
        <Card accent="fire"><Stat label="Estimated farmer payouts" value={inr(fire.payoutsEstimatedInr)} color="fire" /></Card>
      </div>

      <div className="grid-2">
        <Card>
          <h2>Burn Risk Radar</h2>
          <p className="muted">District officers see fields likely to burn <em>before</em> a fire is lit, ranked by harvest
             date, rain, machine distance and the wheat-sowing deadline. Village alerts go out with one tap.</p>
          <div className="radar">
            <div className="radar-row"><span className="radar-dot red" /><strong>{num(fire.redFields)} RED</strong> fields — book a baler now</div>
            <div className="radar-row"><span className="radar-dot yellow" /><strong>{num(fire.yellowFields)} YELLOW</strong> fields — watch list</div>
            <div className="radar-row"><span className="radar-dot green" /><strong>{num(fire.fields - fire.redFields - fire.yellowFields)} GREEN</strong> fields — straw cleared or booked</div>
          </div>
          <p className="muted">The radar is the Fire module's half of the Fire↔Air link: every RED field that clears is smoke
             that never reaches the Air module's dial.</p>
          <ExternalLink href="https://clearsky.akkki.tech/admin">Officer radar (clearsky dashboard)</ExternalLink>
        </Card>

        <div className="stack tight">
          <Card>
            <h2>Season ledger</h2>
            <div className="ledger">
              <div><span className="stat-value c-fire">{num(fire.farmers)}</span> farmers on WhatsApp</div>
              <div><span className="stat-value c-fire">{num(fire.bookings)}</span> baler bookings ({num(fire.bookingsDone)} done)</div>
              <div><span className="stat-value c-fire">{num(fire.alertsSent)}</span> village alerts sent</div>
              <div><span className="stat-value c-fire">{fire.fieldsSavedAfterAlert == null ? 'Not reported' : num(fire.fieldsSavedAfterAlert)}</span> fields saved after alerts</div>
            </div>
          </Card>
          <Card>
            <h2>Why it matters here</h2>
            <p className="muted">Clearsky reports field and alert activity in its own season context. Climate Chain does not join those field outcomes to Vayu readings or estimate avoided air pollution.</p>
            <ExternalLink href="https://clearsky.akkki.tech/impact">Public impact page</ExternalLink>
          </Card>
        </div>
      </div>
    </div>
  );
}
