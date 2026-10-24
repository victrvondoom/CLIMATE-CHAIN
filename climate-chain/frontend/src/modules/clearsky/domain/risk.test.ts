import { describe, expect, it } from 'vitest';
import { levelFor, scoreField, type FieldState } from './risk';

// Vectors from backend/tests/test_risk_alerts.py (clearsky). TODAY is 2026-10-20 in the source test.
const TODAY = '2026-10-20';
const harvested: FieldState = {
  status: 'HARVESTED',
  harvestDate: '2026-10-17',
  sowingDeadline: '2026-10-22',
  harvestConfirmed: true,
};

describe('burn risk: field bands', () => {
  it('a booked or cleared field scores 0 (GREEN), and a reported fire scores 100 (RED)', () => {
    expect(scoreField({ ...harvested, status: 'BOOKED' }, 1, TODAY, false)).toMatchObject({ score: 0, level: 'GREEN', reasons: ['booked'] });
    expect(scoreField({ ...harvested, status: 'CLEARED' }, 1, TODAY, false)).toMatchObject({ reasons: ['cleared'] });
    expect(scoreField({ ...harvested, status: 'FIRE_REPORTED' }, 0, TODAY, true)).toMatchObject({ score: 100, level: 'RED' });
  });

  it('96 RED with high fire history and no baler free, with the source reasons in order', () => {
    expect(scoreField(harvested, 1, TODAY, false)).toEqual({
      score: 96,
      level: 'RED',
      reasons: ['harvested 3 days ago', '2 days to sowing', 'high fire history', 'no baler free', 'not booked'],
    });
  });

  it('40 YELLOW with a free slot and no fire history (a tie at 40.5 rounds to even, as in Python)', () => {
    expect(scoreField(harvested, 0, TODAY, true)).toMatchObject({ score: 40, level: 'YELLOW' });
  });

  it('66 RED when the field is bookable at 4 days to sowing with high fire history', () => {
    expect(scoreField({ ...harvested, sowingDeadline: '2026-10-24' }, 1, TODAY, true)).toMatchObject({ score: 66, level: 'RED' });
  });

  it('damps a field that is not harvested yet by 0.35, so it stays GREEN', () => {
    const notYet: FieldState = { status: 'REGISTERED', harvestDate: '2026-10-22', sowingDeadline: '2026-10-22', harvestConfirmed: false };
    const result = scoreField(notYet, 1, TODAY, false);
    expect(result.score).toBe(33);
    expect(result.level).toBe('GREEN');
    expect(result.reasons[0]).toBe('harvest in 2 days');
  });

  it('says a passed sowing deadline and a declined field in its reasons', () => {
    const late = scoreField({ ...harvested, sowingDeadline: '2026-10-18' }, 0, TODAY, false);
    expect(late.reasons).toContain('sowing deadline passed');
    const refused = scoreField(harvested, 0, TODAY, false, 2);
    expect(refused.reasons).toContain('no baler accepted');
    expect(scoreField(harvested, 0, TODAY, true, 1).reasons).toContain('declined by 1 baler');
  });

  it('bands at 60 RED, 40 YELLOW and below 40 GREEN', () => {
    expect(levelFor(60)).toBe('RED');
    expect(levelFor(59)).toBe('YELLOW');
    expect(levelFor(40)).toBe('YELLOW');
    expect(levelFor(39)).toBe('GREEN');
  });
});
