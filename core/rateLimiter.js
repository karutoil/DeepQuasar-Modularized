/**
 * Simple token-bucket rate limiter with per-key buckets.
 * Keys can be composed like `${module}:${command}:${userId}`
 */
export function createRateLimiter(logger) {
  const buckets = new Map();

  function getBucket(key, { capacity = 3, refillPerSec = 1 } = {}) {
    let b = buckets.get(key);
    const now = Date.now();
    if (!b) {
      b = { tokens: capacity, capacity, refillPerSec, last: now };
      buckets.set(key, b);
    }
    // Refill
    const elapsed = (now - b.last) / 1000;
    const refill = elapsed * b.refillPerSec;
    if (refill > 0) {
      b.tokens = Math.min(b.capacity, b.tokens + refill);
      b.last = now;
    }
    return b;
  }

  function take(key, opts) {
    const b = getBucket(key, opts);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { allowed: true, remaining: Math.floor(b.tokens) };
    }
    return { allowed: false, remaining: Math.floor(b.tokens) };
  }

  function setConfig(key, { capacity, refillPerSec }) {
    const b = getBucket(key);
    if (typeof capacity === "number") b.capacity = capacity;
    if (typeof refillPerSec === "number") b.refillPerSec = refillPerSec;
  }

  function clear(key) {
    buckets.delete(key);
  }

  function resetAll() {
    buckets.clear();
  }

  return {
    take,
    setConfig,
    clear,
    resetAll,
    _debug: { buckets },
  };
}