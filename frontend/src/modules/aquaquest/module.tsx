import { useMemo, useState } from 'react';
import { Card } from '../../components/Ui';
import { appendLedger, createEvidence } from '../../core/evidence';
import type { ClimateModule } from '../../core/module';
import {
  hasUserContributed,
  progressFor,
  type ChallengeRecord,
  type ContributionRecord,
} from './domain/challenges';
import {
  CLARITY,
  COLOUR,
  LITTER,
  NOTE_MAX_LENGTH,
  PH_MAX,
  PH_MIN,
  SMELL,
  STEP_COUNT,
  WILDLIFE,
  canSubmit,
  draftProblems,
  emptyDraft,
  parseReading,
  stepIsValid,
  type ObservationDraft,
  type Wildlife,
} from './domain/observations';
import challengesFixture from './fixtures/challenges.json';
import contributionsFixture from './fixtures/contributions.json';
import './module.css';

type ChallengeEntry = ChallengeRecord & {
  readonly activityType: string;
  readonly siteId: string | null;
  readonly points: number;
  readonly status: string;
  readonly joined: number;
  readonly maxParticipants: number;
};

interface ChallengesFixture {
  readonly note: string;
  readonly challenges: ChallengeEntry[];
}

interface ContributionsFixture {
  readonly note: string;
  readonly contributions: ContributionRecord[];
}

const CHALLENGES = challengesFixture as ChallengesFixture;
const CONTRIBUTIONS = contributionsFixture as ContributionsFixture;

const STEP_TITLES = ['Clarity', 'Litter', 'Smell, colour and wildlife', 'Readings and note', 'Review and submit'] as const;

const label = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ');

function ChoiceGroup<T extends string>({
  name,
  options,
  value,
  onChange,
}: {
  name: string;
  options: readonly T[];
  value: T | null;
  onChange: (next: T) => void;
}) {
  return (
    <div className="m-aquaquest-choices" role="radiogroup" aria-label={name}>
      {options.map((option) => (
        <label key={option} className={`m-aquaquest-choice ${value === option ? 'is-on' : ''}`}>
          <input type="radio" name={name} value={option} checked={value === option} onChange={() => onChange(option)} />
          {label(option)}
        </label>
      ))}
    </div>
  );
}

function AquaQuestPage() {
  const [draft, setDraft] = useState<ObservationDraft>(emptyDraft);
  const [step, setStep] = useState(1);
  const [viewer, setViewer] = useState('none');
  const [recorded, setRecorded] = useState('');

  const problems = draftProblems(draft);
  const contributions = CONTRIBUTIONS.contributions;
  const contributorSlots = useMemo(
    () => Array.from(new Set(contributions.map((contribution) => contribution.contributorId))),
    [contributions],
  );

  const patch = (changes: Partial<ObservationDraft>) => setDraft((current) => ({ ...current, ...changes }));

  function toggleWildlife(item: Wildlife) {
    patch({
      wildlife: draft.wildlife.includes(item)
        ? draft.wildlife.filter((entry) => entry !== item)
        : [...draft.wildlife, item],
    });
  }

  async function recordObservation() {
    const payload = {
      clarity: draft.clarity,
      litter: draft.litter,
      smell: draft.smell,
      colour: draft.colour,
      wildlife: [...draft.wildlife].sort(),
      ph: draft.ph,
      turbidity: draft.turbidity,
      temperature: draft.temperature,
      note: draft.note,
    };
    try {
      const record = await createEvidence({
        moduleId: 'aquaquest',
        kind: 'water-observation',
        mode: 'DEMO',
        summary: `Water observation: clarity ${draft.clarity ?? 'none'}, litter ${draft.litter ?? 'none'}`,
        payload,
      });
      const kept = appendLedger(record);
      setRecorded(
        kept
          ? `Recorded. sha256 ${record.sha256.slice(0, 16)}..., kept in this browser's ledger.`
          : `Hashed (sha256 ${record.sha256.slice(0, 16)}...), but browser storage is blocked, so it is not kept.`,
      );
    } catch {
      setRecorded('This browser could not hash the observation.');
    }
  }

  return (
    <div className="m-aquaquest-root">
      <header className="m-aquaquest-head">
        <div className="m-aquaquest-kicker">AquaQuest · Water · Bangladesh</div>
        <h2 className="m-aquaquest-title">Guided water observation and challenge progress</h2>
        <p className="m-aquaquest-lede">
          The observation steps, their required fields and the reading limits are ported from the app. Mode:{' '}
          <span className="m-aquaquest-mode">DEMO</span>, the project's own walkthrough data.
        </p>
      </header>

      <div className="m-aquaquest-grid">
        <Card className="m-aquaquest-card">
          <h3>
            Observation, step {step} of {STEP_COUNT}: {STEP_TITLES[step - 1]}
          </h3>
          <ol className="m-aquaquest-steps" aria-label="Steps">
            {STEP_TITLES.map((title, index) => (
              <li key={title} className={index + 1 === step ? 'is-current' : index + 1 < step ? 'is-done' : ''}>
                {index + 1}
              </li>
            ))}
          </ol>

          {step === 1 ? (
            <>
              <p className="m-aquaquest-note">How clear is the water? Required.</p>
              <ChoiceGroup name="clarity" options={CLARITY} value={draft.clarity} onChange={(clarity) => patch({ clarity })} />
            </>
          ) : null}

          {step === 2 ? (
            <>
              <p className="m-aquaquest-note">How much litter is on the bank or in the water? Required.</p>
              <ChoiceGroup name="litter" options={LITTER} value={draft.litter} onChange={(litter) => patch({ litter })} />
            </>
          ) : null}

          {step === 3 ? (
            <div className="m-aquaquest-fields">
              <label className="m-aquaquest-field">
                Smell
                <select value={draft.smell ?? ''} onChange={(event) => patch({ smell: (event.target.value || null) as ObservationDraft['smell'] })}>
                  <option value="">Not recorded</option>
                  {SMELL.map((option) => (
                    <option key={option} value={option}>
                      {label(option)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="m-aquaquest-field">
                Colour
                <select value={draft.colour ?? ''} onChange={(event) => patch({ colour: (event.target.value || null) as ObservationDraft['colour'] })}>
                  <option value="">Not recorded</option>
                  {COLOUR.map((option) => (
                    <option key={option} value={option}>
                      {label(option)}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className="m-aquaquest-fieldset">
                <legend>Wildlife seen (optional)</legend>
                <div className="m-aquaquest-choices">
                  {WILDLIFE.map((item) => (
                    <label key={item} className={`m-aquaquest-choice ${draft.wildlife.includes(item) ? 'is-on' : ''}`}>
                      <input type="checkbox" checked={draft.wildlife.includes(item)} onChange={() => toggleWildlife(item)} />
                      {label(item)}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="m-aquaquest-fields">
              <label className="m-aquaquest-field">
                pH ({PH_MIN} to {PH_MAX})
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 7.2"
                  defaultValue={draft.ph === null ? '' : String(draft.ph)}
                  onChange={(event) => patch({ ph: parseReading(event.target.value) })}
                />
              </label>
              <label className="m-aquaquest-field">
                Turbidity (NTU, 0 or more)
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 12"
                  defaultValue={draft.turbidity === null ? '' : String(draft.turbidity)}
                  onChange={(event) => patch({ turbidity: parseReading(event.target.value) })}
                />
              </label>
              <label className="m-aquaquest-field">
                Temperature (°C)
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 25"
                  defaultValue={draft.temperature === null ? '' : String(draft.temperature)}
                  onChange={(event) => patch({ temperature: parseReading(event.target.value) })}
                />
              </label>
              <label className="m-aquaquest-field">
                Note ({draft.note.length}/{NOTE_MAX_LENGTH})
                <textarea
                  rows={3}
                  maxLength={NOTE_MAX_LENGTH}
                  placeholder="Anything else you noticed"
                  value={draft.note}
                  onChange={(event) => patch({ note: event.target.value })}
                />
              </label>
            </div>
          ) : null}

          {step === 5 ? (
            <div className="m-aquaquest-review">
              <dl>
                <dt>Clarity</dt>
                <dd>{draft.clarity ? label(draft.clarity) : 'Missing'}</dd>
                <dt>Litter</dt>
                <dd>{draft.litter ? label(draft.litter) : 'Missing'}</dd>
                <dt>Smell and colour</dt>
                <dd>
                  {draft.smell ? label(draft.smell) : 'Not recorded'} · {draft.colour ? label(draft.colour) : 'Not recorded'}
                </dd>
                <dt>Wildlife</dt>
                <dd>{draft.wildlife.length ? draft.wildlife.map(label).join(', ') : 'None recorded'}</dd>
                <dt>pH · turbidity · temperature</dt>
                <dd>
                  {draft.ph ?? 'none'} · {draft.turbidity ?? 'none'} · {draft.temperature ?? 'none'}
                </dd>
              </dl>
              {problems.length ? (
                <ul className="m-aquaquest-problems">
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              ) : null}
              <button
                type="button"
                className="m-aquaquest-btn"
                disabled={!canSubmit(draft)}
                onClick={() => void recordObservation()}
              >
                Submit and record evidence
              </button>
              {recorded ? <p className="m-aquaquest-status">{recorded}</p> : null}
            </div>
          ) : null}

          {step === 4 && problems.length ? (
            <ul className="m-aquaquest-problems">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}

          <div className="m-aquaquest-nav">
            <button type="button" className="m-aquaquest-btn is-ghost" disabled={step === 1} onClick={() => setStep(step - 1)}>
              Back
            </button>
            {step < STEP_COUNT ? (
              <button
                type="button"
                className="m-aquaquest-btn"
                disabled={!stepIsValid(step, draft) || (step === 4 && problems.length > 0)}
                onClick={() => setStep(step + 1)}
              >
                Next
              </button>
            ) : null}
          </div>
        </Card>

        <Card className="m-aquaquest-card">
          <h3>Challenge progress</h3>
          <label className="m-aquaquest-field">
            Viewing as
            <select value={viewer} onChange={(event) => setViewer(event.target.value)}>
              <option value="none">No contributor</option>
              {contributorSlots.map((slot) => (
                <option key={slot} value={slot}>
                  {slot}
                </option>
              ))}
            </select>
          </label>
          <ul className="m-aquaquest-challenges">
            {CHALLENGES.challenges.map((challenge) => {
              const progress = progressFor(challenge, contributions);
              const joined = viewer !== 'none' && hasUserContributed(contributions, challenge.id, viewer);
              return (
                <li key={challenge.id}>
                  <div className="m-aquaquest-challenge-head">
                    <strong>{challenge.title}</strong>
                    {joined ? <span className="m-aquaquest-joined">Contributed</span> : null}
                  </div>
                  <div className="m-aquaquest-bar" role="img" aria-label={`${progress.percent}% of goal`}>
                    <div className="m-aquaquest-bar-fill" style={{ width: `${progress.percent}%` }} />
                  </div>
                  <p className="m-aquaquest-note">
                    {progress.current} of {progress.target} contributions ({progress.percent}%) · {challenge.points} points ·{' '}
                    {challenge.joined} of {challenge.maxParticipants} joined
                  </p>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <footer className="m-aquaquest-foot">
        <p>
          <strong>Not ported:</strong> photo upload and photo compression, the One Health insight card and its risk rules,
          points and badges, the cleanup and restoration before-and-after steps, challenge suggestions, the learning library,
          the community feed, the offline PWA and service worker, and the map. The pH and turbidity limits are declared on the
          app's inputs; the browser enforces them there, and this port checks them in code.
        </p>
      </footer>
    </div>
  );
}

const climateModule: ClimateModule = {
  id: 'aquaquest',
  name: 'AquaQuest',
  tagline: 'Guided water observations checked the way the app checks them, with challenge progress from logged contributions.',
  stages: ['sense', 'act', 'prove'],
  tone: 'water',
  mode: 'DEMO',
  features: [
    'Guided water observation in five steps, with clarity and litter required',
    'pH (0 to 14), turbidity (0 or more) and 300-character note checks',
    'Challenge progress from logged contributions, with goal and percent',
    'Evidence record for each submitted observation',
  ],
  source: {
    folder: 'AquaQuest-main',
    files: [
      'js/pages/observe.js',
      'js/features/observations.js',
      'js/features/contributions.js',
      'js/data/challenges.js',
      'js/demo-data.js',
    ],
  },
  Page: AquaQuestPage,
};

export default climateModule;
