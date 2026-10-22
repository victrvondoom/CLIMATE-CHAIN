// Explainable investigation-priority score "priority-v1", ported from PLUME
// backend/app/investigation/scoring.py. It ranks where field investigation is most useful.
// It is not an estimate of emissions, climate impact or health risk. A missing factor
// contributes 0 and is reported as unavailable, so less evidence means lower priority.

export const SCORING_VERSION = 'priority-v1';

export const WEIGHTS = {
  magnitude: 30,
  recurrence: 20,
  provider_persistence: 10,
  corroboration: 10,
  recency: 10,
  measurement_confidence: 10,
  localization: 10,
} as const;

export type FactorName = keyof typeof WEIGHTS;

const MAG_LOW_KG_H = 50;
const MAG_HIGH_KG_H = 5000;
const RECENCY_HALF_LIFE_DAYS = 365;
const LOCALIZATION_SCALE_M = 150;
const DAY_MS = 86_400_000;
const RECURRENCE: Record<number, number> = { 1: 0, 2: 0.5, 3: 0.7, 4: 0.85 };

export interface ObservationFacts {
  observedAt: string; // ISO 8601, UTC
  rateKgH: number | null;
  uncertaintyKgH: number | null;
  instrument: string | null;
}

export interface Factor {
  name: FactorName;
  weight: number;
  value: number | null; // normalized to [0, 1]; null when unavailable
  contribution: number;
  evidence: string;
}

export interface ScoreResult {
  score: number; // 0-100
  factors: Factor[];
}

const clip = (x: number) => Math.max(0, Math.min(1, x));
const fmt = (x: number) => Math.round(x).toLocaleString('en-US');
const utcDay = (iso: string) => new Date(iso).toISOString().slice(0, 10);

// Median as in Python's statistics.median: the mean of the two middle values for even counts.
export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function scoreIncident(
  observations: readonly ObservationFacts[],
  referenceTime: string,
  spatialSpreadM: number,
  providerPersistence: number | null,
): ScoreResult {
  if (observations.length === 0) throw new Error('an incident needs at least one observation');
  const factors: Factor[] = [];
  const add = (name: FactorName, value: number | null, evidence: string) => {
    const weight = WEIGHTS[name];
    factors.push({ name, weight, value, contribution: value === null ? 0 : weight * value, evidence });
  };

  // Magnitude: log-scaled median of the quantified rates, so one outlier retrieval does not decide it.
  const rates = observations.flatMap((o) => (o.rateKgH !== null ? [o.rateKgH] : []));
  if (rates.length > 0) {
    const med = median(rates);
    const v = clip(Math.log10(Math.max(med, MAG_LOW_KG_H) / MAG_LOW_KG_H) / Math.log10(MAG_HIGH_KG_H / MAG_LOW_KG_H));
    add('magnitude', v, `median reported rate ${fmt(med)} kg/h over ${rates.length} quantified detection(s)`);
  } else {
    add('magnitude', null, 'no quantified emission rate reported by the provider');
  }

  // Recurrence: distinct UTC dates. Several plumes in one scene count once.
  const dates = new Set(observations.map((o) => utcDay(o.observedAt))).size;
  add(
    'recurrence',
    RECURRENCE[dates] ?? 1,
    `detections on ${dates} distinct date(s)` + (dates === 1 ? ' — single date, persistence not inferred' : ''),
  );

  // Provider persistence: Carbon Mapper detection dates / observed overpass dates.
  if (providerPersistence !== null) {
    add(
      'provider_persistence',
      clip(providerPersistence),
      `provider-reported persistence ${providerPersistence.toFixed(2)} (detections ÷ observed overpasses)`,
    );
  } else {
    add('provider_persistence', null, 'provider persistence not available for this grouping');
  }

  // Corroboration: independent instruments.
  const instruments = [...new Set(observations.flatMap((o) => (o.instrument ? [o.instrument] : [])))].sort();
  add(
    'corroboration',
    clip((instruments.length - 1) / 2),
    `${instruments.length} distinct instrument(s): ${instruments.join(', ') || 'unknown'}`,
  );

  // Recency: half-life of a year, measured from the dataset reference time so scores reproduce.
  const latest = Math.max(...observations.map((o) => Date.parse(o.observedAt)));
  const ageDays = Math.max(0, (Date.parse(referenceTime) - latest) / DAY_MS);
  add('recency', 0.5 ** (ageDays / RECENCY_HALF_LIFE_DAYS), `latest detection ${fmt(ageDays)} days before dataset reference date`);

  // Measurement confidence: 1 minus the median relative uncertainty.
  const rel = observations.flatMap((o) =>
    o.rateKgH && o.uncertaintyKgH !== null ? [o.uncertaintyKgH / o.rateKgH] : [],
  );
  if (rel.length > 0) {
    const mr = median(rel);
    add('measurement_confidence', clip(1 - mr), `median relative uncertainty ±${Math.round(mr * 100)}%`);
  } else {
    add('measurement_confidence', null, 'no reported uncertainty');
  }

  // Localization: tight repeat detections place the source better.
  if (observations.length === 1) {
    add('localization', 0.5, 'single detection: plume origin from one retrieval only');
  } else {
    add(
      'localization',
      clip(1 - spatialSpreadM / LOCALIZATION_SCALE_M),
      `repeat detections within ${fmt(spatialSpreadM)} m RMS of the group centroid`,
    );
  }

  const score = Math.round(factors.reduce((s, f) => s + f.contribution, 0) * 100) / 100;
  return { score, factors };
}
