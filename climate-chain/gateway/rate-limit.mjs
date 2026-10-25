// A small in-memory token bucket, one bucket per caller key. It limits abuse of the public chain-write routes on a
// deployment that lets visitors anchor evidence. Serverless instances do not share memory, so the limit is
// per instance; that is enough to stop a single client hammering one instance and keeps this dependency-free.

export function createRateLimiter({ limit, windowMs, now = () => Date.now(), maxKeys = 5000 }) {
  if (!(limit >= 1) || !(windowMs > 0)) throw new RangeError('A rate limiter needs a limit of at least 1 and a positive window.');
  const perMs = limit / windowMs;
  const buckets = new Map();

  return {
    take(key = 'unknown') {
      const t = now();
      let bucket = buckets.get(key);
      if (!bucket) {
        // Bounded memory: when full, drop the least recently seen caller rather than grow without limit.
        if (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value);
        bucket = { tokens: limit, at: t };
      } else {
        bucket.tokens = Math.min(limit, bucket.tokens + (t - bucket.at) * perMs);
        bucket.at = t;
        buckets.delete(key); // re-insert so Map order tracks recency
      }
      buckets.set(key, bucket);
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return { ok: true, remaining: Math.floor(bucket.tokens), retryAfterSeconds: 0 };
      }
      return { ok: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) / perMs / 1000)) };
    },
    size: () => buckets.size,
  };
}
