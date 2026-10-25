// Plausibility check for a meter reading, ported from WattCert oracle/gridproof/integrity.py.
// Only the physics part is ported: how far a reading exceeds what the weather allowed, a solar
// reading at night, and a replayed peak. The source also blends in an IsolationForest score
// (scikit-learn, learned on the device's own history), which is not ported here. The score below
// therefore equals the source's "physics" column, and it is the value that is compared with THRESHOLD.

import type { Kind } from './physics';

// Matches GranularCertificate.anomalyThresholdBps = 7000.
export const THRESHOLD = 0.7;

export interface Hour {
  expectedWh: number;
  maxPlausibleWh: number;
  reportedWh: number;
}

export interface Scored {
  physics: number; // 0 to 1
  flagged: boolean; // physics >= THRESHOLD: the reading is quarantined
  reasons: string[];
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const clip01 = (x: number) => Math.min(1, Math.max(0, x));

export function scoreSeries(kind: Kind, capacityW: number, hours: readonly Hour[]): Scored[] {
  return hours.map((h, i): Scored => {
    const rep = h.reportedWh;
    const exp = h.expectedWh;
    const overPlausible = (rep - h.maxPlausibleWh) / capacityW;
    const ratioLog = Math.log((rep + 0.02 * capacityW) / (exp + 0.02 * capacityW));
    const expectedFrac = exp / capacityW;
    const reportedFrac = rep / capacityW;
    const night = exp < 0.01 * capacityW && kind === 'solar';

    // Gap to the largest reading of the previous 24 hours (replays). Undefined early on, as in the source.
    const sameAsYesterdayMax =
      i >= 24 ? Math.abs(rep - Math.max(...hours.slice(i - 24, i).map((x) => x.reportedWh))) / capacityW : 1;

    const sigmoidTerm = sigmoid((overPlausible - 0.03) / 0.01);
    const nightTerm = night && reportedFrac > 0.05 ? 1 : 0;
    const replay = sameAsYesterdayMax < 0.002 && ratioLog > 0.3 && reportedFrac < 0.97;
    const physics = clip01(Math.max(sigmoidTerm, nightTerm, replay ? 0.9 : 0));

    const reasons: string[] = [];
    if (night && reportedFrac > 0.05) reasons.push('Solar output reported at night');
    if (overPlausible > 0.02) {
      reasons.push(
        `Reported ${Math.exp(ratioLog).toFixed(1)}x the expected output, above the most this hour's weather allowed`,
      );
    }
    if (reportedFrac > 0.94 && expectedFrac < 0.6) reasons.push('Reading pinned at capacity in weak conditions');
    if (sameAsYesterdayMax < 0.002 && ratioLog > 0.3 && reportedFrac < 0.97) {
      reasons.push("Identical to yesterday's peak reading (possible replay)");
    }

    return { physics, flagged: physics >= THRESHOLD, reasons };
  });
}
