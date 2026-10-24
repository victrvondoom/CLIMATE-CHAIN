import { describe, expect, it } from 'vitest';
import { CONSUMERS } from './scenario';
import { findWindow, ruleParse } from './ruleparse';

// Ported from projects/hourmatch-master/tests/ruleparse.test.mjs. The ledger days are the demo week.
const DAYS = ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12'];
const ctx = { consumers: CONSUMERS, days: DAYS };

describe('keyword parser', () => {
  it('reports an unknown company as an error, never as a default company', () => {
    const r = ruleParse('Acme Steel ran on 100% renewable power this week.', ctx);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/no known company/);
  });

  it('reads time windows: 9 to 18, between, am/pm, colon forms', () => {
    expect(findWindow('ran on solar from 9 to 18 every weekday')).toEqual({ from: 9, to: 18 });
    expect(findWindow('ran on solar 9 to 18')).toEqual({ from: 9, to: 18 });
    expect(findWindow('between 9 and 18')).toEqual({ from: 9, to: 18 });
    expect(findWindow('9am to 6pm')).toEqual({ from: 9, to: 18 });
    expect(findWindow('09:00-18:00 on 2026-10-07')).toEqual({ from: 9, to: 18 });
    expect(findWindow('from 18:00 to midnight')).toEqual({ from: 18, to: 24 });
    expect(findWindow('100% renewable on 2026-10-07')).toBeNull();
  });

  it('says why an unsupported window is refused instead of ignoring it', () => {
    expect(findWindow('from 22:00 to 06:00')).toEqual({ error: expect.stringMatching(/crosses midnight/) });
    expect(findWindow('9:30 to 18:00')).toEqual({ error: expect.stringMatching(/full hour/) });
  });

  it('parses the reviewer case: Harbor Office 9 to 18 on weekdays', () => {
    const r = ruleParse('Harbor Office ran on 95% renewable power from 9 to 18 on weekdays.', ctx);
    expect(r.ok).toBe(true);
    expect(r.claim).toMatchObject({
      consumer_id: 'HARBOR-OFFICE',
      hour_from: 9,
      hour_to: 18,
      weekdays_only: true,
      claimed_pct: 95,
    });
  });

  it('reads volume wording, a single date and RE100', () => {
    const r = ruleParse('Certificates bought by Cloudline Data Center covered 100% of its use on 2026-10-11, RE100-eligible.', ctx);
    expect(r.claim).toMatchObject({ standard: 'volume', start_date: '2026-10-11', end_date: '2026-10-11', re100: true });
    const m = ruleParse('Northbay Fab was 100% renewable on 8 October.', ctx);
    expect(m.claim?.start_date).toBe('2026-10-08');
  });
});
