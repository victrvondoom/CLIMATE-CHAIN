// Joins each screened candidate to its recorded local-LLM verdict (verdicts.jsonl), keyed by the
// pair (a, b). The model is not run here; this only reads what it recorded.

export interface VerdictRecord {
  a: string;
  b: string;
  same_asset: string;
  reason: string;
}

export interface JoinedCandidate<C> {
  candidate: C;
  verdict: string | null;
  reason: string | null;
}

export function joinVerdicts<C extends { a: string; b: string }>(
  candidates: readonly C[],
  verdicts: readonly VerdictRecord[],
): JoinedCandidate<C>[] {
  const byPair = new Map(verdicts.map((v) => [`${v.a}|${v.b}`, v] as const));
  return candidates.map((candidate) => {
    const record = byPair.get(`${candidate.a}|${candidate.b}`);
    return { candidate, verdict: record ? record.same_asset : null, reason: record ? record.reason : null };
  });
}
