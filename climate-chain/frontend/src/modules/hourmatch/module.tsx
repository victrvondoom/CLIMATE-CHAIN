import { useMemo, useState } from 'react';
import type { ClimateModule } from '../../core/module';
import { appendLedger, createEvidence, type EvidenceRecord } from '../../core/evidence';
import { Card, Stat } from '../../components/Ui';
import { checkClaim, pctText, type CheckResult } from './domain/checker';
import { ruleParse, type RuleParseResult } from './domain/ruleparse';
import { CONSUMERS, GENERATORS, ISSUERS, buildScenario } from './domain/scenario';
import week from './fixtures/taipower_week_2026-10-06.json';
import examples from './fixtures/examples.json';
import './module.css';

// What this Page does, in the order it appears. Kept in step with the rendered sections.
const FEATURES = [
  'Hourly certificates from several issuers, one shared retirement state',
  'Transfer-once rule and wallet-bound company retirement',
  'Claim checker and hour-by-hour evaluation against Taipower open data',
];

interface Outcome {
  parse: RuleParseResult;
  check: CheckResult | null;
  evidence: EvidenceRecord | null;
  saved: boolean;
}

function ModeTag({ mode }: { mode: 'DEMO' | 'RESEARCH' }) {
  return <span className={`m-hourmatch-mode m-hourmatch-mode-${mode.toLowerCase()}`}>{mode}</span>;
}

const kwh = (value: number) => value.toLocaleString('en-US');

function HourmatchPage() {
  const scenario = useMemo(() => buildScenario(week), []);
  const days = useMemo(
    () => scenario.hours.filter((_, i) => i % 24 === 0).map((h) => h.hour.slice(0, 10)),
    [scenario],
  );

  const plantRows = useMemo(
    () =>
      GENERATORS.map((g) => {
        const issued = scenario.generation[g.id];
        const sold = Object.values(scenario.bought).reduce((sum, byPlant) => sum + (byPlant[g.id] ?? []).reduce((a, b) => a + b, 0), 0);
        return {
          id: g.id,
          name: g.name,
          issuer: ISSUERS.find((i) => i.id === g.issuer)?.name ?? g.issuer,
          year: g.commissionYear,
          issuedKwh: issued.reduce((a, b) => a + b, 0),
          soldKwh: sold,
          hoursWithOutput: issued.filter((v) => v > 0).length,
        };
      }),
    [scenario],
  );

  const retirementRows = useMemo(
    () =>
      CONSUMERS.map((c) => {
        const rows = scenario.ledger.hourly(c.id, scenario.firstHour, scenario.firstHour + BigInt(scenario.n));
        const consumed = rows.reduce((a, r) => a + r.consumed, 0n);
        const matched = rows.reduce((a, r) => a + r.matched, 0n);
        return {
          id: c.id,
          name: c.name,
          consumedKwh: Number(consumed),
          matchedKwh: Number(matched),
          hourlyBps: consumed === 0n ? 0 : Number((matched * 10000n) / consumed),
        };
      }),
    [scenario],
  );

  const rejected = useMemo(() => scenario.log.filter((e) => e.type === 'double-sale-rejected'), [scenario]);

  const [sentence, setSentence] = useState<string>(examples.sentences[0]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function runCheck() {
    const parse = ruleParse(sentence, { consumers: CONSUMERS, days });
    if (!parse.ok) {
      setOutcome({ parse, check: null, evidence: null, saved: false });
      return;
    }
    const check = checkClaim(scenario, parse.claim);
    if (!check.ok) {
      setOutcome({ parse, check, evidence: null, saved: false });
      return;
    }
    let evidence: EvidenceRecord | null = null;
    let saved = false;
    try {
      evidence = await createEvidence({
        moduleId: 'hourmatch',
        kind: 'claim-check',
        mode: 'DEMO',
        summary: `${check.verdict}: ${parse.claim.consumer_id} claimed ${parse.claim.claimed_pct}% (${check.basis})`,
        payload: {
          claim: parse.claim,
          verdict: check.verdict,
          basis: check.basis,
          claimedBps: check.claimedBps,
          hourlyBps: check.hourlyBps,
          volumeBps: check.volumeBps,
          consumedKwh: check.consumedKwh,
          matchedKwh: check.matchedKwh,
          reasons: check.reasons,
        },
      });
      saved = appendLedger(evidence);
    } catch {
      // crypto.subtle is missing outside secure contexts; the verdict still shows without a hash
    }
    setOutcome({ parse, check, evidence, saved });
  }

  return (
    <div className="m-hourmatch">
      <header className="m-hourmatch-head">
        <div>
          <h2 className="m-hourmatch-title">HourSync</h2>
          <p className="m-hourmatch-tagline">Renewable certificates per plant per hour, and a checker for green-power claims.</p>
        </div>
        <ModeTag mode="DEMO" />
      </header>

      <div className="m-hourmatch-grid">
        <Card className="m-hourmatch-wide">
          <h3 className="m-hourmatch-card-title">
            Taipower curves <ModeTag mode="RESEARCH" />
          </h3>
          <p className="m-hourmatch-card-sub">
            {scenario.n} hourly solar, wind and hydro outputs, {days[0]} to {days[days.length - 1]} (Taiwan time). Taipower Company open
            data, trimmed to the three fuels the checker reads. The companies and plants on top are fictional.
          </p>
          <div className="m-hourmatch-stats">
            <Stat label="Hours" value={scenario.n} />
            <Stat label="Plants" value={GENERATORS.length} hint="fictional" />
            <Stat label="Companies" value={CONSUMERS.length} hint="fictional" />
          </div>
        </Card>

        <Card>
          <h3 className="m-hourmatch-card-title">
            Hourly certificates per plant <ModeTag mode="DEMO" />
          </h3>
          <p className="m-hourmatch-card-sub">Each plant issues one certificate per hour, through its own issuer.</p>
          <div className="m-hourmatch-table-wrap">
            <table className="m-hourmatch-table">
              <thead>
                <tr>
                  <th>Plant</th>
                  <th>Issuer</th>
                  <th>Commissioned</th>
                  <th className="m-hourmatch-num">Issued kWh</th>
                  <th className="m-hourmatch-num">Sold kWh</th>
                </tr>
              </thead>
              <tbody>
                {plantRows.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.issuer}</td>
                    <td>{p.year}</td>
                    <td className="m-hourmatch-num">{kwh(p.issuedKwh)}</td>
                    <td className="m-hourmatch-num">{kwh(p.soldKwh)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <h3 className="m-hourmatch-card-title">
            One shared retirement state <ModeTag mode="DEMO" />
          </h3>
          <p className="m-hourmatch-card-sub">Each company retires certificates against its own use in the same hour.</p>
          <div className="m-hourmatch-table-wrap">
            <table className="m-hourmatch-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th className="m-hourmatch-num">Use kWh</th>
                  <th className="m-hourmatch-num">Matched kWh</th>
                  <th className="m-hourmatch-num">Hour by hour</th>
                </tr>
              </thead>
              <tbody>
                {retirementRows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td className="m-hourmatch-num">{kwh(r.consumedKwh)}</td>
                    <td className="m-hourmatch-num">{kwh(r.matchedKwh)}</td>
                    <td className="m-hourmatch-num">{pctText(r.hourlyBps)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="m-hourmatch-wide">
          <h3 className="m-hourmatch-card-title">
            Transfer-once rule <ModeTag mode="DEMO" />
          </h3>
          <p className="m-hourmatch-card-sub">
            Only the plant account can move a certificate, so a buyer cannot pass it on. Strait Wind tried to sell day-3 midday
            certificates that were already sold; the ledger refused each hour.
          </p>
          <div className="m-hourmatch-table-wrap">
            <table className="m-hourmatch-table">
              <thead>
                <tr>
                  <th>Hour (Taiwan time)</th>
                  <th className="m-hourmatch-num">Attempted kWh</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {rejected.map((e) => (
                  <tr key={e.hour}>
                    <td>{e.hour}</td>
                    <td className="m-hourmatch-num">{kwh(e.kwh)}</td>
                    <td className="m-hourmatch-error">rejected: {e.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="m-hourmatch-wide">
          <h3 className="m-hourmatch-card-title">
            Claim checker <ModeTag mode="DEMO" />
          </h3>
          <p className="m-hourmatch-card-sub">
            Keyword rules read the sentence, and the checker decides from the ledger. Every number comes from the code, not from the
            sentence.
          </p>
          <textarea
            className="m-hourmatch-input"
            aria-label="Claim sentence"
            value={sentence}
            onChange={(event) => setSentence(event.target.value)}
          />
          <div className="m-hourmatch-chips">
            {examples.sentences.map((s, i) => (
              <button key={s} type="button" className="m-hourmatch-chip" title={s} onClick={() => setSentence(s)}>
                Example {i + 1}
              </button>
            ))}
          </div>
          <button type="button" className="m-hourmatch-button" onClick={() => void runCheck()}>
            Check claim
          </button>

          {outcome ? <ClaimOutcome outcome={outcome} /> : null}
        </Card>
      </div>

      <p className="m-hourmatch-note">
        Not ported: the Sepolia registry and wallet calls, the language-model sentence parser (these examples use keyword rules only),
        CSV upload of your own data, and the holdout evaluation runs.
      </p>
    </div>
  );
}

function ClaimOutcome({ outcome }: { outcome: Outcome }) {
  const { parse, check, evidence, saved } = outcome;
  if (!parse.ok) {
    return (
      <div>
        <p className="m-hourmatch-error">This sentence cannot be checked yet:</p>
        <ul className="m-hourmatch-list m-hourmatch-error">
          {parse.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </div>
    );
  }
  if (!check || !check.ok) {
    return (
      <ul className="m-hourmatch-list m-hourmatch-error">
        {(check && !check.ok ? check.errors : ['the claim could not be checked']).map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
    );
  }
  const supported = check.verdict === 'SUPPORTED';
  return (
    <div>
      <p>
        <span className={`m-hourmatch-verdict ${supported ? 'm-hourmatch-verdict-supported' : 'm-hourmatch-verdict-not'}`}>
          {check.verdict}
        </span>{' '}
        <span className="m-hourmatch-note">judged on the {check.basis} basis</span>
      </p>
      <div className="m-hourmatch-stats">
        <Stat label="Claimed" value={`${parse.claim.claimed_pct}%`} />
        <Stat label="Hour by hour" value={pctText(check.hourlyBps)} />
        <Stat label="Certificates on paper" value={pctText(check.volumeBps)} />
      </div>
      {check.reasons.length ? (
        <ul className="m-hourmatch-list">
          {check.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      <p className="m-hourmatch-note">{check.rewrite}</p>
      {parse.notes.length ? <p className="m-hourmatch-note">Read as: {parse.notes.join('; ')}.</p> : null}
      {evidence ? (
        <p className="m-hourmatch-note">
          Evidence <span className="m-hourmatch-code">{evidence.sha256}</span>
          {saved ? ' saved to this browser ledger.' : ' not saved (browser storage unavailable).'}
        </p>
      ) : (
        <p className="m-hourmatch-note">Evidence hash unavailable in this context.</p>
      )}
    </div>
  );
}

const climateModule: ClimateModule = {
  id: 'hourmatch',
  name: 'HourSync',
  tagline: 'Renewable certificates per plant per hour, and a checker for green-power claims.',
  stages: ['verify', 'finance', 'prove'],
  tone: 'energy',
  mode: 'DEMO',
  features: FEATURES,
  source: {
    folder: 'hourmatch-master',
    files: [
      'src/ledger.mjs',
      'src/scenario.mjs',
      'src/checker.mjs',
      'src/ruleparse.mjs',
      'src/examples.mjs',
      'tests/checker.test.mjs',
      'tests/ruleparse.test.mjs',
      'data/taipower_hourly_2026-10-06_7d.json',
      'public/samples/sample_use_kwh.csv',
      'public/samples/sample_certificates.csv',
    ],
  },
  Page: HourmatchPage,
};

export default climateModule;
