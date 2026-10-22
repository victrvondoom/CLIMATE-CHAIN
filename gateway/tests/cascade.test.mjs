import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessCascade,
  hashEvidence,
  parseThreshold,
  validPoint,
} from '../cascade.mjs';

const site = {
  id: 'site_jdh_1', status: 'open', verification: 'unverified', reportCount: 3,
  lat: 26.29, lng: 73.02,
  firstReportedAt: '2026-10-21T08:00:00.000Z',
  lastReportedAt: '2026-10-21T09:00:00.000Z',
};
const air = {
  place: { name: 'Rounded query location', lat: 26.29, lng: 73.02 },
  pm25Now: 62,
  provenance: {
    mode: 'live', source: 'station', stationId: 'monitor-1', stationName: 'North monitor',
    distanceKm: 1.4, observedAt: '2026-10-21T10:00:00.000Z', fetchedAt: '2026-10-21T10:04:00.000Z',
    asOf: '2026-10-21T10:04:00.000Z', ageMinutes: 4, simulated: false,
  },
};

test('creates a human-review proximity lead only when both sources, space and time qualify', () => {
  const result = assessCascade({ site, air, wasteMode: 'live', airUpstreamMode: 'live', capturedAt: '2026-10-21T10:05:00.000Z' });
  assert.equal(result.assessment.status, 'ready_for_human_review');
  assert.equal(result.assessment.candidate, true);
  assert.equal(result.assessment.relationship, 'spatiotemporal_proximity_lead');
  assert.equal(result.assessment.causality, 'not_assessed');
  assert.equal(result.assessment.proximity.temporalGapHours, 1);
});

test('keeps simulated or estimated source data out of review candidates', () => {
  const result = assessCascade({
    site,
    air: { ...air, provenance: { ...air.provenance, mode: 'model', source: 'model' } },
    wasteMode: 'live',
    airUpstreamMode: 'live',
  });
  assert.equal(result.assessment.status, 'source_not_observed');
  assert.equal(result.assessment.candidate, false);
});

test('keeps distance and stale-time threshold failures explicit', () => {
  const distant = assessCascade({ site, air: { ...air, provenance: { ...air.provenance, distanceKm: 9 } }, wasteMode: 'live', airUpstreamMode: 'live' });
  assert.equal(distant.assessment.status, 'outside_radius');
  const stale = assessCascade({ site, air: { ...air, provenance: { ...air.provenance, observedAt: '2026-10-18T09:00:00.000Z' } }, wasteMode: 'live', airUpstreamMode: 'live' });
  assert.equal(stale.assessment.status, 'outside_time_window');
});

test('marks missing source timestamps and closed sites without manufacturing a join', () => {
  const untimed = assessCascade({ site: { ...site, lastReportedAt: null }, air, wasteMode: 'live', airUpstreamMode: 'live' });
  assert.equal(untimed.assessment.status, 'missing_time_provenance');
  const closed = assessCascade({ site: { ...site, status: 'cleared' }, air, wasteMode: 'live', airUpstreamMode: 'live' });
  assert.equal(closed.assessment.status, 'site_not_open');
});

test('hash is deterministic for canonical key order and changes when evidence changes', () => {
  assert.equal(hashEvidence({ b: 2, a: { y: true, x: 1 } }), hashEvidence({ a: { x: 1, y: true }, b: 2 }));
  assert.notEqual(hashEvidence({ reading: 62 }), hashEvidence({ reading: 63 }));
});

test('validates geographic points and bounded analyst thresholds', () => {
  assert.equal(validPoint({ lat: 26.29, lng: 73.02 }), true);
  assert.equal(validPoint({ lat: 91, lng: 73.02 }), false);
  assert.equal(parseThreshold('7.5', 5, 50), 7.5);
  assert.equal(parseThreshold('51', 5, 50), null);
  assert.equal(parseThreshold('0', 5, 50), null);
});
