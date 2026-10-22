// Port of the verdict rule in projects/plotlock-main/oracle/evidence.py (evaluate and the two signals).
// Pure and deterministic. The rule is deliberately small:
//
//   NoBurn    - BOTH signals present and BOTH clean.
//   Burned    - BOTH signals present and BOTH positive (a FIRMS active-fire detection inside the plot
//               AND a Sentinel-2 burn scar).
//   Uncertain - anything else: a signal is missing or unavailable, or the two signals disagree.
//               Uncertain never pays out.
//
// Thresholds (USGS dNBR severity scale, as documented in the source):
//   - a scar is positive when mean dNBR >= 0.10 OR the burned-pixel fraction >= 0.25.
//     The pixel-level dNBR >= 0.15 test that produces that fraction runs upstream, in the
//     satellite pipeline, so this module takes the fraction as given.
//   - a FIRMS detection counts when its confidence is 'n' (nominal) or 'h' (high) and it lies
//     inside the plot polygon.

export type Verdict = 'NoBurn' | 'Burned' | 'Uncertain';

export const DNBR_MEAN_THRESHOLD = 0.1;
export const BURNED_PIXEL_FRACTION_THRESHOLD = 0.25;
const FIRMS_COUNTING_CONFIDENCE = new Set(['n', 'h']);

export interface Detection {
  confidence: string;
  inside_plot: boolean;
}

export interface FirmsBlock {
  status: string;
  detections: Detection[];
}

export interface Sentinel2Block {
  status: string;
  unavailable_reason?: string;
  dnbr_mean?: number | null;
  burned_pixel_fraction?: number | null;
}

// Only the fields the verdict reads. The fixture files carry more (plot geometry, provenance).
export interface EvidenceBundle {
  firms: FirmsBlock;
  sentinel2: Sentinel2Block;
}

export interface FirmsSignal {
  present: boolean;
  positive: boolean;
  detail: string;
  detectionsTotal: number;
  detectionsCounting: number;
}

export interface ScarSignal {
  present: boolean;
  positive: boolean;
  detail: string;
  dnbrMean: number | null;
  burnedPixelFraction: number | null;
}

export interface Evaluation {
  verdict: Verdict;
  signals: { firms: FirmsSignal; sentinel2: ScarSignal };
  reasons: string[];
}

function firmsSignal(bundle: EvidenceBundle): FirmsSignal {
  const firms = bundle.firms;
  if (firms.status !== 'ok') {
    return {
      present: false,
      positive: false,
      detail: `FIRMS evidence unavailable (status=${firms.status || 'missing'})`,
      detectionsTotal: 0,
      detectionsCounting: 0,
    };
  }
  const hits = firms.detections.filter(
    (d) => d.inside_plot && FIRMS_COUNTING_CONFIDENCE.has(String(d.confidence ?? '').toLowerCase()),
  );
  return {
    present: true,
    positive: hits.length > 0,
    detail: hits.length
      ? `${hits.length} counting FIRMS detection(s) inside the plot`
      : 'no counting FIRMS detections inside the plot',
    detectionsTotal: firms.detections.length,
    detectionsCounting: hits.length,
  };
}

function scarSignal(bundle: EvidenceBundle): ScarSignal {
  const s2 = bundle.sentinel2;
  if (s2.status !== 'ok') {
    const reason = s2.unavailable_reason ?? s2.status ?? 'missing';
    return {
      present: false,
      positive: false,
      detail: `Sentinel-2 scar check unavailable (${reason})`,
      dnbrMean: null,
      burnedPixelFraction: null,
    };
  }
  const dnbr = s2.dnbr_mean ?? null;
  const frac = s2.burned_pixel_fraction ?? null;
  if (dnbr === null || frac === null) {
    return {
      present: false,
      positive: false,
      detail: 'Sentinel-2 scar check incomplete (missing dNBR)',
      dnbrMean: dnbr,
      burnedPixelFraction: frac,
    };
  }
  const positive = dnbr >= DNBR_MEAN_THRESHOLD || frac >= BURNED_PIXEL_FRACTION_THRESHOLD;
  return {
    present: true,
    positive,
    detail: `dNBR mean ${dnbr}, burned-pixel fraction ${frac} -> ${positive ? 'scar present' : 'no scar'}`,
    dnbrMean: dnbr,
    burnedPixelFraction: frac,
  };
}

export function evaluate(bundle: EvidenceBundle): Evaluation {
  const firms = firmsSignal(bundle);
  const scar = scarSignal(bundle);
  const reasons = [`FIRMS: ${firms.detail}`, `Sentinel-2: ${scar.detail}`];

  let verdict: Verdict;
  if (!firms.present || !scar.present) {
    verdict = 'Uncertain';
    reasons.push('A required signal is missing -> Uncertain (never pays).');
  } else if (firms.positive && scar.positive) {
    verdict = 'Burned';
    reasons.push('Both signals confirm a burn -> Burned.');
  } else if (!firms.positive && !scar.positive) {
    verdict = 'NoBurn';
    reasons.push('Both signals present and clean -> NoBurn.');
  } else {
    verdict = 'Uncertain';
    reasons.push('Signals disagree -> Uncertain (never pays).');
  }

  return { verdict, signals: { firms, sentinel2: scar }, reasons };
}

// Only NoBurn is payable (contracts/PlotLock.sol records an attestation only for NoBurn).
export function isPayable(verdict: Verdict): boolean {
  return verdict === 'NoBurn';
}
