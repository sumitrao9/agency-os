// src/main/integration/rateLimiter.js
//
// Token-bucket rate limiter. Every connector owns one, configured under the
// target platform's published limits. This is the primary reason requests
// don't get refused: we simply never exceed what the service allows, rather
// than firing freely and reacting to 429s after the fact.
//
// Deliberately time-injectable so tests can advance the clock instead of
// sleeping through real intervals.

class RateLimiter {
  /**
   * @param {object} opts
   * @param {number} opts.tokensPerInterval how many requests are granted per interval
   * @param {number} opts.intervalMs length of the refill window
   * @param {number} [opts.burst] max tokens that can accumulate (defaults to tokensPerInterval)
   * @param {number} [opts.minSpacingMs] hard floor between two grants, even when tokens remain
   * @param {() => number} [opts.now] clock injection for tests
   */
  constructor({ tokensPerInterval, intervalMs, burst, minSpacingMs = 0, now } = {}) {
    if (!tokensPerInterval || tokensPerInterval <= 0) throw new Error('tokensPerInterval must be > 0');
    if (!intervalMs || intervalMs <= 0) throw new Error('intervalMs must be > 0');

    this.tokensPerInterval = tokensPerInterval;
    this.intervalMs = intervalMs;
    this.burst = burst || tokensPerInterval;
    this.minSpacingMs = minSpacingMs;
    this._now = now || (() => Date.now());

    this.tokens = this.burst;
    this.lastRefill = this._now();
    this.lastGrant = 0;
    this._waiters = [];
    this._timer = null;
  }

  _refill() {
    const now = this._now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    const gained = (elapsed / this.intervalMs) * this.tokensPerInterval;
    if (gained <= 0) return;
    this.tokens = Math.min(this.burst, this.tokens + gained);
    this.lastRefill = now;
  }

  /** Milliseconds until `count` tokens (and the spacing floor) are satisfied. 0 if available now. */
  msUntilAvailable(count = 1) {
    this._refill();
    const now = this._now();

    const spacingWait = this.minSpacingMs > 0
      ? Math.max(0, this.lastGrant + this.minSpacingMs - now)
      : 0;

    const deficit = count - this.tokens;
    const tokenWait = deficit <= 0
      ? 0
      : Math.ceil((deficit / this.tokensPerInterval) * this.intervalMs);

    return Math.max(spacingWait, tokenWait);
  }

  /** Non-blocking attempt. Returns true if the request may proceed right now. */
  tryAcquire(count = 1) {
    if (this.msUntilAvailable(count) > 0) return false;
    this.tokens -= count;
    this.lastGrant = this._now();
    return true;
  }

  /** Waits until the request is allowed. Honors an AbortSignal if provided. */
  async acquire(count = 1, { signal } = {}) {
    if (count > this.burst) {
      throw new Error(`Cannot acquire ${count} tokens; bucket capacity is ${this.burst}`);
    }
    for (;;) {
      if (signal?.aborted) throw new Error('Rate limit wait aborted');
      const wait = this.msUntilAvailable(count);
      if (wait <= 0) {
        this.tokens -= count;
        this.lastGrant = this._now();
        return;
      }
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, wait);
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Rate limit wait aborted'));
          }, { once: true });
        }
      });
    }
  }

  /**
   * Applies a server-sent backpressure hint (a Retry-After value). Drains the
   * bucket and pushes the next grant out, so a 429 slows everything behind it
   * rather than only the request that happened to get rejected.
   */
  penalize(delayMs) {
    if (!delayMs || delayMs <= 0) return;
    this.tokens = 0;
    this.lastRefill = this._now() + delayMs - this.intervalMs;
    this.lastGrant = Math.max(this.lastGrant, this._now() + delayMs - this.minSpacingMs);
  }

  snapshot() {
    this._refill();
    return {
      tokens: Math.floor(this.tokens),
      capacity: this.burst,
      tokensPerInterval: this.tokensPerInterval,
      intervalMs: this.intervalMs,
      msUntilNext: this.msUntilAvailable(1),
    };
  }
}

module.exports = { RateLimiter };
