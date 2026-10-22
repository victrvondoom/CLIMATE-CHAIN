import { describe, expect, it } from 'vitest';
import candidates from '../fixtures/candidates.json';
import verdicts from '../fixtures/verdicts.json';
import { joinVerdicts } from './candidates';

describe('candidate and recorded verdict slices', () => {
  const rows = joinVerdicts(candidates.candidates, verdicts.verdicts);

  it('joins every candidate in the slice to a recorded verdict', () => {
    expect(rows).toHaveLength(200);
    expect(rows.every((r) => r.verdict !== null && r.reason !== null)).toBe(true);
  });

  it('counts 136 yes and 64 no verdicts, matching the slice definition', () => {
    expect(rows.filter((r) => r.verdict === 'yes')).toHaveLength(136);
    expect(rows.filter((r) => r.verdict === 'no')).toHaveLength(64);
  });

  it('leaves the verdict empty for a candidate with no recorded verdict', () => {
    const [first] = joinVerdicts(candidates.candidates.slice(0, 1), []);
    expect(first.verdict).toBeNull();
    expect(first.reason).toBeNull();
  });
});
