// Seeded random stream and profile helpers, copied from packages/sim/src/index.ts.
// The draw order inside simulateDispatch must stay the same as the source, or seeds stop matching.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const seedFor = (i: number): number => ((i + 1) * 0x9e3779b1) >>> 0;

export const gaussian = (x: number, peak: number, width: number): number =>
  Math.exp(-((x - peak) ** 2) / (2 * width * width));

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
