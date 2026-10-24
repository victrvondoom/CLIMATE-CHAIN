import { describe, expect, it } from 'vitest';
import { addHours, decide, findCluster, haversineM, isDirty, offsetPoint, stats, type Incident, type Report } from './ring';

// Scenarios from tests/test_tripwire.py (teesri). Homes are placed in metres north and east of the
// Dongri point, as the source's report() helper does, and "h" is hours after 10:00 on 2026-10-08.
const LAT = 18.9622;
const LON = 72.8368;
const T0 = '2026-10-08T10:00:00Z';
const dirty = { colour: 'brown', smell: true, illness: [] as string[] };
const clear = { colour: 'clear', smell: false, illness: [] as string[] };

function report(home: string, north: number, east: number, h: number, fields = dirty): Report {
  const [lat, lon] = offsetPoint(LAT, LON, north, east);
  return { id: `rpt-${home}-${h}`, homeId: `sim-${home}`, lat, lon, ts: addHours(T0, h), fields, incidentId: null };
}

describe('dirty water (the tripwire counts only dirty reports)', () => {
  it('counts yellow, brown or black water, a bad smell, or any illness', () => {
    expect(isDirty({ colour: 'brown', smell: null, illness: [] })).toBe(true);
    expect(isDirty({ colour: 'yellow', smell: null, illness: [] })).toBe(true);
    expect(isDirty({ colour: 'clear', smell: true, illness: [] })).toBe(true);
    expect(isDirty({ colour: 'clear', smell: null, illness: ['fever'] })).toBe(true);
    expect(isDirty({ colour: 'clear', smell: false, illness: [] })).toBe(false);
  });
});

describe('ring distance (haversine, metres)', () => {
  it('is 0 for the same point and about 212 m for the 212 m scenario', () => {
    expect(haversineM(LAT, LON, LAT, LON)).toBe(0);
    const [lat, lon] = offsetPoint(LAT, LON, 0, 212);
    expect(haversineM(LAT, LON, lat, lon)).toBeCloseTo(212, 0);
  });
});

describe('the tripwire decision (test_tripwire.py)', () => {
  it('fires on 3 homes 212 m apart within 71 h: one incident, spread 212, span 71', () => {
    const a = report('A', 0, 0, 0);
    const b = report('B', 0, 212, 30);
    const c = report('C', 100, 106, 71);
    expect(decide(a, []).decision).toBe('none');
    expect(decide(b, [a]).decision).toBe('none');
    const verdict = decide(c, [a, b]);
    expect(verdict.decision).toBe('incident');
    expect(verdict.stats).toMatchObject({ homes: 3, spreadM: 212, spanH: 71 });
  });

  it('does not fire when the only other home is 300 m away', () => {
    const others = [report('A', 0, 0, 0), report('B', 0, 50, 0)];
    expect(decide(report('C', 300, 25, 1), others).decision).toBe('none');
  });

  it('does not fire when the reports span 73 h, because the window is 72 h', () => {
    const others = [report('A', 0, 0, 0), report('B', 50, 0, 60)];
    expect(decide(report('C', 0, 50, 73), others).decision).toBe('none');
  });

  it('keeps the 72 h edge inclusive, as the store query does (GSI1SK >= since)', () => {
    const others = [report('A', 0, 0, 0), report('B', 0, 100, 36)];
    expect(decide(report('C', 0, 50, 72), others).decision).toBe('incident');
  });

  it('does not count the same home three times', () => {
    const others = [report('A', 0, 0, 0), report('A', 0, 0, 5)];
    expect(decide(report('A', 0, 0, 9), others).decision).toBe('none');
  });

  it('never counts clear water', () => {
    const others = [report('A', 0, 0, 0), report('B', 0, 40, 0, clear)];
    expect(decide(report('C', 40, 0, 1), others).decision).toBe('none');
  });

  it('gives one building (spread within 30 m) tank advice rather than an alarm', () => {
    const others = [report('A', 0, 0, 0), report('B', 10, 5, 0)];
    expect(decide(report('C', 5, 15, 2), others).decision).toBe('tank');
    const more = [...others, report('C', 5, 15, 2)];
    expect(decide(report('D', 12, 12, 3), more).decision).toBe('tank');
  });

  it('joins a report to an open incident within 250 m of its centre', () => {
    const a = report('A', 0, 0, 0);
    const b = report('B', 0, 150, 0);
    const c = report('C', 120, 60, 2);
    const first = decide(c, [a, b]);
    expect(first.decision).toBe('incident');
    const centre = { lat: (a.lat + b.lat + c.lat) / 3, lon: (a.lon + b.lon + c.lon) / 3 };
    const open: Incident[] = [{ id: 'inc-1', lat: centre.lat, lon: centre.lon, status: 'OPEN' }];
    const joined = decide(report('D', -80, 90, 5), [a, b, c], open);
    expect(joined).toMatchObject({ decision: 'join', incidentId: 'inc-1' });
  });

  it('returns already for a report that belongs to an incident, and clean for clear water', () => {
    expect(decide({ ...report('A', 0, 0, 0), incidentId: 'inc-9' }, []).decision).toBe('already');
    expect(decide(report('A', 0, 0, 0, clear), []).decision).toBe('clean');
  });
});

describe('finding the cluster', () => {
  it('drops the home that is farthest from the trigger when a pair is more than 250 m apart', () => {
    const trigger = report('T', 0, 0, 0);
    const near = report('X', 0, 180, 0);
    const far = report('Y', 0, -220, 0);
    const members = findCluster(trigger, [near, far]);
    expect(members.map((member) => member.homeId)).toEqual(['sim-T', 'sim-X']);
  });

  it('computes spread and span for the members', () => {
    const members = [report('A', 0, 0, 0), report('B', 0, 212, 30), report('C', 100, 106, 71)];
    expect(stats(members)).toMatchObject({ homes: 3, spreadM: 212, spanH: 71 });
  });
});
