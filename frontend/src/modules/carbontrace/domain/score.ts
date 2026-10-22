// Port of backend/app/scoring.py assess(). Pure: the same observations and claim always give the same assessment.
// The score decides whether a credit is approved. Approved credits are trimmed to the land's capacity, rounded down.
// Rounding follows Python: round() is half-to-even. The metrics keep the source's snake_case keys.

export const APPROVE_THRESHOLD = 70;
export const MODEL_VERSION = 'carbontrace-score-1.0';

export interface Observation {
  month: number;
  meanNdvi: number;
  p10: number;
  p90: number;
  canopyFraction: number; // share of valid pixels with NDVI >= 0.5
  validFraction: number; // share of the polygon with a usable (cloud-free) observation
}

export interface Satellite {
  provider: string;
  simulated: boolean;
  biome: string;
  sequestrationRate: number; // tCO2e per hectare per year for this biome
  lowConfidence: boolean;
  observations: Observation[];
}

export interface Geometry {
  areaHa: number;
  cells: number[];
}

export interface Check {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  value: string;
  detail: string;
}

export interface Assessment {
  score: number;
  approved: boolean;
  verifiedTonnes: number;
  capacityTonnes: number;
  claimedTonnes: number;
  checks: Check[];
  metrics: Record<string, number | null>;
  components: Record<string, number | Record<string, number>>;
  capsApplied: string[];
  modelVersion: string;
}

function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  if (x - floor === 0.5) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(x);
}

function roundTo(x: number, digits: number): number {
  const p = 10 ** digits;
  return roundHalfEven(x * p) / p;
}

const clip = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => sum(xs) / xs.length;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function assess(geom: Geometry, sat: Satellite, claimedTonnes: number, threshold = APPROVE_THRESHOLD): Assessment {
  const obs = [...sat.observations].sort((a, b) => a.month - b.month);
  const usable = obs.filter((o) => o.validFraction >= 0.3);

  if (usable.length === 0) {
    return {
      score: 0,
      approved: false,
      verifiedTonnes: 0,
      capacityTonnes: 0,
      claimedTonnes,
      checks: [
        {
          id: 'coverage',
          label: 'Usable satellite observations',
          status: 'fail',
          value: '0 of 12 months',
          detail: 'No cloud-free observations were available for this site and year.',
        },
      ],
      metrics: { months_observed: 0 },
      components: {},
      capsApplied: ['no_observations'],
      modelVersion: MODEL_VERSION,
    };
  }

  const weights = usable.map((o) => o.validFraction);
  const weightSum = sum(weights);
  const canopy = sum(usable.map((o, i) => o.canopyFraction * weights[i])) / weightSum;
  const means = usable.map((o) => o.meanNdvi);
  const medianNdvi = median(means);
  const meanValid = weightSum / weights.length;

  let maxDrop = 0;
  let dropMonth: number | null = null;
  for (let i = 1; i < usable.length; i++) {
    const drop = usable[i - 1].meanNdvi - usable[i].meanNdvi;
    if (drop > maxDrop) {
      maxDrop = drop;
      dropMonth = usable[i].month;
    }
  }
  const third = Math.max(1, Math.floor(usable.length / 3));
  const decline = mean(means.slice(0, third)) - mean(means.slice(-third));
  const disturbance = maxDrop >= 0.25 || decline >= 0.25;

  const capacity = geom.areaHa * sat.sequestrationRate * canopy;
  const ratio = capacity > 0 ? claimedTonnes / capacity : Infinity;

  // Component scores, each 0 to 1.
  const canopyS = clip((canopy - 0.2) / 0.6);
  const ndviS = clip((medianNdvi - 0.35) / 0.35);
  const vegetation = 0.6 * canopyS + 0.4 * ndviS;
  const stability = maxDrop < 0.12 ? 1 : clip(1 - (maxDrop - 0.12) / 0.18);
  const plausibility = ratio <= 1 ? 1 : clip(1 - (ratio - 1) / 2);
  let confidence = 0.5 * Math.min(1, usable.length / 8) + 0.5 * meanValid;
  if (sat.lowConfidence) confidence *= 0.5;

  const raw = 0.5 * vegetation + 0.2 * stability + 0.2 * plausibility + 0.1 * confidence;
  let score = roundHalfEven(100 * raw);

  // Hard caps: each one limits the score and is listed in capsApplied.
  const caps: string[] = [];
  const cap = (limit: number, why: string) => {
    score = Math.min(score, limit);
    caps.push(why);
  };
  if (sat.sequestrationRate <= 0) cap(30, 'non_forest_biome');
  if (canopy < 0.4) cap(45, 'insufficient_canopy');
  if (ratio > 3.0) cap(55, 'implausible_claim');
  if (disturbance) cap(40, 'clearing_detected');
  if (sat.lowConfidence) cap(threshold - 1, 'low_confidence_evidence');

  // Trimming: approved credits are capped at the land's capacity and rounded down. A non-positive result is a rejection.
  let approved = score >= threshold;
  let verified = approved ? Math.floor(Math.min(claimedTonnes, capacity)) : 0;
  if (verified <= 0) {
    approved = false;
    verified = 0;
  }

  const checks: Check[] = [
    {
      id: 'canopy',
      label: 'Forest canopy cover',
      status: canopy >= 0.6 ? 'pass' : canopy >= 0.4 ? 'warn' : 'fail',
      value: `${roundHalfEven(canopy * 100)}% of the site`,
      detail: 'Share of observed pixels with NDVI of 0.5 or higher, weighted by cloud-free area.',
    },
    {
      id: 'greenness',
      label: 'Greenness (median NDVI)',
      status: medianNdvi >= 0.55 ? 'pass' : medianNdvi >= 0.4 ? 'warn' : 'fail',
      value: medianNdvi.toFixed(2),
      detail: 'Healthy dense forest is typically above 0.6.',
    },
    {
      id: 'clearing',
      label: 'No clearing detected during the year',
      status: disturbance ? 'fail' : 'pass',
      value: disturbance
        ? `drop of ${maxDrop.toFixed(2)} in month ${dropMonth}`
        : `largest monthly drop ${maxDrop.toFixed(2)}`,
      detail: 'A sudden or sustained fall in NDVI suggests the trees were removed.',
    },
    {
      id: 'biome',
      label: 'Land can store forest carbon',
      status: sat.sequestrationRate > 0 ? 'pass' : 'fail',
      value: sat.biome,
      detail: `Reference rate ${sat.sequestrationRate} tCO2e per hectare per year.`,
    },
    {
      id: 'claim',
      label: 'Claim fits what the land can hold',
      status: ratio <= 1 ? 'pass' : ratio <= 3 ? 'warn' : 'fail',
      value: `claimed ${claimedTonnes.toLocaleString('en-US')} t vs capacity ${Math.round(capacity).toLocaleString('en-US')} t`,
      detail: ratio > 1 ? 'Credits are capped at capacity. Claims far above it fail.' : 'Within capacity.',
    },
    {
      id: 'coverage',
      label: 'Cloud-free observation coverage',
      status: sat.lowConfidence ? 'fail' : usable.length >= 6 ? 'pass' : 'warn',
      value: `${usable.length} of 12 months usable`,
      detail: 'More usable months give more reliable evidence.',
    },
  ];

  return {
    score,
    approved,
    verifiedTonnes: verified,
    capacityTonnes: roundTo(capacity, 2),
    claimedTonnes,
    checks,
    metrics: {
      area_ha: roundTo(geom.areaHa, 2),
      cells: geom.cells.length,
      canopy_fraction: roundTo(canopy, 4),
      median_ndvi: roundTo(medianNdvi, 4),
      max_monthly_drop: roundTo(maxDrop, 4),
      year_decline: roundTo(decline, 4),
      months_observed: usable.length,
      mean_valid_fraction: roundTo(meanValid, 4),
      claim_to_capacity_ratio: Number.isFinite(ratio) ? roundTo(ratio, 4) : null,
      sequestration_rate: sat.sequestrationRate,
    },
    components: {
      vegetation: roundTo(vegetation, 4),
      stability: roundTo(stability, 4),
      claim_plausibility: roundTo(plausibility, 4),
      confidence: roundTo(confidence, 4),
      weights: { vegetation: 0.5, stability: 0.2, claim_plausibility: 0.2, confidence: 0.1 },
    },
    capsApplied: caps,
    modelVersion: MODEL_VERSION,
  };
}
