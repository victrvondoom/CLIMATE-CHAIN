import { describe, expect, it } from 'vitest';
import { DAY_FILES, INDEX } from '../data';
import { buildSites, cluster, dayStats, haversineKm, parseDay, persistent } from './derive';

// Rules from flarewatch METHOD.md sections 4 and 5 (also pipeline/derive.mjs and pipeline/common.mjs).
describe('site clustering: detections within 1.0 km link into one site', () => {
  it('measures 0.01 degrees of latitude as about 1.112 km', () => {
    expect(haversineKm({ lat: 5, lon: 7 }, { lat: 5.01, lon: 7 })).toBeCloseTo(1.11195, 3);
  });

  it('links a chain of points that are each within 1 km, even when the ends are 1.8 km apart', () => {
    // 0.0081 degrees is about 0.90 km; the two ends are about 1.80 km apart and linked through the middle.
    const pts = [
      { lat: 5.0, lon: 7.0 },
      { lat: 5.0081, lon: 7.0 },
      { lat: 5.0162, lon: 7.0 },
    ];
    expect(cluster(pts)).toHaveLength(1);
  });

  it('keeps detections more than 1 km apart in separate sites', () => {
    expect(cluster([{ lat: 5, lon: 7 }, { lat: 5.02, lon: 7 }])).toHaveLength(2);
  });
});

describe('persistent flare: at least 3 distinct nights within 7 days', () => {
  it('counts three nights with a 6-day span as persistent, and a 7-day span as not', () => {
    expect(persistent(['2026-10-15', '2026-10-17', '2026-10-21'])).toBe(true);
    expect(persistent(['2026-10-15', '2026-10-17', '2026-10-22'])).toBe(false);
  });

  it('does not depend on the order the nights are given in', () => {
    expect(persistent(['2026-10-21', '2026-10-15', '2026-10-17'])).toBe(true);
  });

  it('needs three nights, not two', () => {
    expect(persistent(['2026-10-15', '2026-10-16'])).toBe(false);
  });
});

// Vectors from the project's own published outputs: web/data/index.json, written by pipeline/derive.mjs.
describe('against the project outputs for the first week (web/data/index.json)', () => {
  it('reproduces each night: flare sites, detections and total FRP in kW', () => {
    for (const d of DAY_FILES) {
      const expected = INDEX.days.find((x) => x.day === d.day);
      expect(expected).toBeDefined();
      expect(dayStats(parseDay(d.raw))).toEqual({
        flareSites: expected?.flareSites,
        detections: expected?.detections,
        totalFrpKw: expected?.totalFrpKw,
      });
    }
  });

  it('reproduces the week: 675 detections, 91 sites and 48 persistent flares', () => {
    const sites = buildSites(DAY_FILES.map((d) => parseDay(d.raw)));
    expect(sites).toHaveLength(INDEX.totals.sites);
    expect(sites.filter((s) => s.flare)).toHaveLength(INDEX.totals.flares);
    expect(sites.reduce((sum, s) => sum + s.detections, 0)).toBe(INDEX.totals.detections);
  });
});
