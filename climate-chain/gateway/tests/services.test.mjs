import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFire, normalizeWater } from '../services.mjs';
import { SOURCE_CONNECTORS } from '../connectors/registry.mjs';

test('TapAlert normalization preserves aggregate phone-wall counts without household records', () => {
  const raw = {
    homes: [
      { id: 'resident-secret-1', label: 'private label', lat: 19.1, lon: 72.8, reported: true, warned: true, in_ring: true, checkin: 'private note', messages: ['private message'] },
      { id: 'resident-secret-2', lat: 19.2, lon: 72.9, warned: true, in_ring: true },
      { id: 'resident-secret-3', lat: 19.3, lon: 73.0, in_ring: true },
      { id: 'resident-secret-4', lat: 19.4, lon: 73.1 },
    ],
  };

  const normalized = normalizeWater(raw);
  assert.deepEqual(normalized.statusCounts, { reported: 1, warned: 1, inRing: 1, outside: 1 });
  assert.equal(normalized.reported, 1);
  assert.equal(normalized.warned, 2);
  assert.equal(normalized.inRing, 3);
  assert.equal(normalized.total, 4);
  assert.equal(Object.hasOwn(normalized, 'homes'), false);

  const serialized = JSON.stringify(normalized);
  for (const privateValue of ['resident-secret', 'private label', 'private note', 'private message', '19.1', '72.8']) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test('TapAlert normalization rejects malformed household collections', () => {
  assert.throws(() => normalizeWater({ homes: 'not-a-list' }), /must be an array/);
  assert.throws(() => normalizeWater({ homes: [null] }), /records must be objects/);
});

test('missing AshAlert prevented-field outcome stays unknown instead of becoming zero', () => {
  const stats = {
    farmers: 1, fields: 1, acres_registered: 1, acres_booked: 0, acres_cleared: 0,
    tonnes_booked: 0, tonnes_delivered: 0, payouts_estimated_inr: 0,
    red_fields: 0, yellow_fields: 0, alerts_sent: 0, bookings: 0, bookings_done: 0,
  };
  assert.equal(normalizeFire(stats).fieldsSavedAfterAlert, null);
  assert.equal(normalizeFire({ ...stats, fields_saved_after_alert: 0 }).fieldsSavedAfterAlert, 0);
  assert.equal(normalizeFire({ ...stats, demo_prices: true }).demoPrices, true);
  assert.equal(normalizeFire(stats).demoPrices, null);
});

test('AshAlert validates the optional demo-price marker', () => {
  const contract = SOURCE_CONNECTORS.clearsky.endpoints.stats.validate;
  const valid = {
    farmers: 1, fields: 1, acres_registered: 1, acres_booked: 0, acres_cleared: 0,
    tonnes_booked: 0, tonnes_delivered: 0, payouts_estimated_inr: 0,
    red_fields: 0, yellow_fields: 0, alerts_sent: 0, bookings: 0, bookings_done: 0,
  };
  assert.deepEqual(contract({ ...valid, demo_prices: 'unknown' }).map((item) => item.path), ['$.demo_prices']);
  assert.deepEqual(contract({ ...valid, demo_prices: true }), []);
});
