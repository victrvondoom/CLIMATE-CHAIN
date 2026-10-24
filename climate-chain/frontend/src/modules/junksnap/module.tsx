import { useMemo, useState } from 'react';
import { useSignals } from '../../core/signals';
import { Card, Stat } from '../../components/Ui';
import { appendLedger, createEvidence } from '../../core/evidence';
import type { ClimateModule } from '../../core/module';
import type { Overview } from '../../types';
import { BACKERS_NEEDED, verifiedAt } from './domain/backers';
import { draftCitedLetter, type CitedLetter, type LetterRule, type PlaceFacts } from './domain/letters';
import lettersFixture from './fixtures/letter-rules.json';
import sitesFixture from './fixtures/sites.json';
import './module.css';

interface SiteRow {
  id: string;
  reportType: string;
  context: string;
  backers: number;
  reportCount: number;
}

const FIXTURE_SITES: SiteRow[] = sitesFixture;
const RULES = lettersFixture.rules as LetterRule[];
const PAGES = lettersFixture.pages as Record<string, string>;
const PLACE = lettersFixture.place as PlaceFacts;

// The overview's waste list when the gateway answers; the fixture otherwise.
function rowsFrom(overview: Overview | null): SiteRow[] {
  if (!overview) return FIXTURE_SITES;
  return overview.waste.sites.map((site) => ({
    id: site.id,
    reportType: site.reportType,
    context: site.context,
    backers: site.backers.count,
    reportCount: site.reportCount,
  }));
}

type Draft = { ok: true; letter: CitedLetter } | { ok: false; error: string };

function draftFor(site: SiteRow): Draft {
  try {
    const letter = draftCitedLetter({
      siteId: site.id,
      reportType: site.reportType,
      context: site.context,
      backers: site.backers,
      reporters: site.reportCount,
      place: PLACE,
      rules: RULES,
      pages: PAGES,
      document: lettersFixture.document,
    });
    return { ok: true, letter };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Draft failed' };
  }
}

function JunkSnapPage() {
  const { data: overview, error: feedError } = useSignals();
  const [selectedId, setSelectedId] = useState<string>(FIXTURE_SITES[0].id);
  const [recorded, setRecorded] = useState<{ sha256: string; saved: boolean } | null>(null);

  const rows = useMemo(() => rowsFrom(overview), [overview]);
  const live = overview?.sources.junksnap.mode === 'live';
  const site = rows.find((row) => row.id === selectedId) ?? rows[0];
  const draft = useMemo(() => (site ? draftFor(site) : null), [site]);

  async function recordDraft(letter: CitedLetter, siteId: string) {
    const evidence = await createEvidence({
      moduleId: 'junksnap',
      kind: 'cited-letter',
      mode: 'SIMULATED',
      summary: `Cited letter for ${siteId}: ${letter.verifier.verified} of ${letter.verifier.total} quotes verified`,
      payload: { siteId, subject: letter.subject, citations: letter.citations, verifier: letter.verifier },
    });
    setRecorded({ sha256: evidence.sha256, saved: appendLedger(evidence) });
  }

  return (
    <section className="m-junksnap-page">
      <header className="m-junksnap-head">
        <div>
          <p className="m-junksnap-kicker">Waste · Jodhpur</p>
          <h2>JunkSnap</h2>
          <p>Waste evidence to municipal action: 10 backers verify a site, and the letter cites only quotes it can prove.</p>
        </div>
        <span className="m-junksnap-mode" title="The module's data is a fixture unless the overview feed is live">
          Mode: SIMULATED
        </span>
      </header>

      <div className="m-junksnap-grid">
        <Card className="m-junksnap-card">
          <h3>10-person site verification</h3>
          <p className="m-junksnap-note">
            A site verifies at {BACKERS_NEEDED} distinct backers. Each person counts once, from a photo or a yes vote.
          </p>
          <Stat
            label="Site list feed"
            value={live ? 'LIVE' : 'SIMULATED'}
            hint={feedError ? `Overview not reachable: ${feedError}` : overview ? 'From fetchOverview().waste' : 'Loading the overview'}
          />
          <table className="m-junksnap-table">
            <thead>
              <tr>
                <th scope="col">Site</th>
                <th scope="col">Backers</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>
                    {row.backers} of {BACKERS_NEEDED}
                  </td>
                  <td>{verifiedAt(row.backers) ? 'verified' : 'unverified'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="m-junksnap-card">
          <h3>Cited letter</h3>
          <div className="m-junksnap-picker" role="group" aria-label="Choose a site">
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                className={row.id === site?.id ? 'm-junksnap-chip m-junksnap-chip-on' : 'm-junksnap-chip'}
                aria-pressed={row.id === site?.id}
                onClick={() => {
                  setSelectedId(row.id);
                  setRecorded(null);
                }}
              >
                {row.id}
              </button>
            ))}
          </div>
          {draft?.ok ? (
            <div className="m-junksnap-letter">
              <p className="m-junksnap-subject">{draft.letter.subject}</p>
              <pre className="m-junksnap-body">{draft.letter.body}</pre>
              <p className="m-junksnap-note">
                Quotes verified: {draft.letter.verifier.verified} of {draft.letter.verifier.total}. Copies:{' '}
                {draft.letter.cc.length === 0 ? 'none on file' : draft.letter.cc.map((line) => `${line.office} ${line.seat.name}`).join('; ')}
              </p>
              <ul className="m-junksnap-citations">
                {draft.letter.citations.map((citation) => (
                  <li key={citation.ruleId}>
                    <strong>Clause {citation.clause}</strong> ({citation.document}): &ldquo;{citation.quote}&rdquo;
                  </li>
                ))}
              </ul>
              <button type="button" className="m-junksnap-action" onClick={() => void recordDraft(draft.letter, selectedId)}>
                Record this draft in the evidence ledger
              </button>
              {recorded ? (
                <p className="m-junksnap-note" role="status">
                  Recorded, sha256 {recorded.sha256.slice(0, 16)}… {recorded.saved ? '(saved to the ledger)' : '(ledger unavailable in this browser)'}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="m-junksnap-error" role="alert">
              {draft && !draft.ok ? draft.error : 'No site selected.'} The letter is not sent: an unverified quote is never shipped.
            </p>
          )}
        </Card>
      </div>

      <Card className="m-junksnap-card">
        <h3>Not ported</h3>
        <ul className="m-junksnap-note">
          <li>Privacy blur and stacked photo checks: blur is produced by the photo pipeline (ONNX models and the server), with no simple blur algorithm in the frontend source, so it is out of scope.</li>
          <li>Letter delivery, prose drafting by a model, clause scoring, channel routing and letter IDs: the source runs these on its server.</li>
          <li>Ward and seat data is a placeholder fixture. Real seats come from the source's location data, which is not ported.</li>
        </ul>
      </Card>
    </section>
  );
}

const climateModule: ClimateModule = {
  id: 'junksnap',
  name: 'JunkSnap',
  tagline: 'Waste photos become verified sites and cited letters to the municipal body.',
  stages: ['sense', 'verify', 'act', 'prove'],
  tone: 'waste',
  mode: 'SIMULATED',
  features: [
    '10-person site verification (a site verifies at 10 distinct backers)',
    'Ward and elected-seat mapping with cited letters (quotes verified word for word)',
    'Site list read from the overview waste feed',
  ],
  source: {
    folder: 'JunkSnap-main',
    files: [
      'backend/server/src/domain/sites/Backers.ts',
      'backend/server/tests/sites/backers.test.ts',
      'backend/server/src/domain/letters/BackingStatement.ts',
      'backend/server/src/domain/letters/SitePlace.ts',
      'backend/server/src/services/letters/QuoteVerifier.ts',
      'backend/server/src/services/letters/LetterService.ts',
      'backend/server/tests/letters/countWording.test.ts',
      'backend/server/tests/letters/fixtures/rules/rules.json',
      'backend/server/tests/letters/fixtures/rules/texts/sample_rules_en.txt',
    ],
  },
  Page: JunkSnapPage,
};

export default climateModule;
