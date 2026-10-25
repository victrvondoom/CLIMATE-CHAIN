import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from '../rate-limit.mjs';

test('a caller may burst up to the limit and is then refused with a retry time', () => {
  let t = 0;
  const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => t });
  assert.deepEqual([1, 2, 3].map(() => limiter.take('a').ok), [true, true, true]);
  const refused = limiter.take('a');
  assert.equal(refused.ok, false);
  assert.equal(refused.retryAfterSeconds, 20); // one token every 20 s
});

test('tokens refill continuously, never beyond the limit', () => {
  let t = 0;
  const limiter = createRateLimiter({ limit: 2, windowMs: 10_000, now: () => t });
  limiter.take('a'); limiter.take('a');
  assert.equal(limiter.take('a').ok, false);
  t += 5_000;
  assert.equal(limiter.take('a').ok, true);
  assert.equal(limiter.take('a').ok, false);
  t += 10 * 60_000;
  assert.deepEqual([1, 2, 3].map(() => limiter.take('a').ok), [true, true, false], 'a long idle period grants only the burst size');
});

test('callers are independent of each other', () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 0 });
  assert.equal(limiter.take('a').ok, true);
  assert.equal(limiter.take('a').ok, false);
  assert.equal(limiter.take('b').ok, true);
});

test('memory stays bounded and the least recently seen caller is the one forgotten', () => {
  let t = 0;
  const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => t, maxKeys: 3 });
  for (const key of ['a', 'b', 'c']) limiter.take(key);
  t += 1; limiter.take('a'); // refresh a: it is now the most recent
  limiter.take('d');         // evicts b, the oldest
  assert.equal(limiter.size(), 3);
  assert.equal(limiter.take('b').ok, true, 'b was forgotten, so it starts with a full bucket');
  assert.equal(limiter.take('a').ok, false, 'a was remembered and is still empty');
});

test('invalid configuration is rejected up front', () => {
  assert.throws(() => createRateLimiter({ limit: 0, windowMs: 1000 }), RangeError);
  assert.throws(() => createRateLimiter({ limit: 5, windowMs: 0 }), RangeError);
});
