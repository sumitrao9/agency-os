// src/main/integration/retry.js
//
// Exponential backoff with full jitter, plus a circuit breaker.
//
// Two rules matter here and both exist to be a good citizen rather than to
// squeeze out throughput:
//   1. A server that says Retry-After is obeyed exactly. Guessing shorter is
//      how a temporary throttle turns into a hard block.
//   2. Jitter is full-range, not fixed. Fixed backoff makes every queued
//      request retry in lockstep and re-spike the service you just overloaded.

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN',
  'EPIPE', 'ENOTFOUND', 'ENETUNREACH', 'ERR_NETWORK_CHANGED',
]);

function isRetryableError(error) {
  if (!error) return false;
  if (error.status && RETRYABLE_STATUS.has(error.status)) return true;
  if (error.code && RETRYABLE_CODES.has(error.code)) return true;
  return false;
}

/** Parses Retry-After, which may be delta-seconds or an HTTP date. */
function parseRetryAfter(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const when = Date.parse(value);
  if (Number.isNaN(when)) return 0;
  return Math.max(0, when - Date.now());
}

function backoffDelay(attempt, { baseDelayMs, maxDelayMs, random = Math.random }) {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  // Full jitter: uniformly random in [0, exponential].
  return Math.floor(random() * exponential);
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('Retry aborted'));
      }, { once: true });
    }
  });
}

/**
 * Runs `fn`, retrying transient failures.
 * `fn` receives { attempt } and may throw an error carrying .status/.retryAfterMs.
 */
async function withRetry(fn, {
  retries = 3,
  baseDelayMs = 500,
  maxDelayMs = 30000,
  signal,
  onRetry,
  shouldRetry = isRetryableError,
  random = Math.random,
  sleepFn = sleep,
} = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new Error('Retry aborted');
    try {
      return await fn({ attempt });
    } catch (error) {
      lastError = error;
      if (attempt === retries || !shouldRetry(error)) throw error;

      // A server-supplied delay always wins over our computed backoff.
      const serverDelay = error.retryAfterMs || 0;
      const delay = serverDelay > 0
        ? serverDelay
        : backoffDelay(attempt, { baseDelayMs, maxDelayMs, random });

      if (onRetry) onRetry({ attempt, delay, error });
      await sleepFn(delay, signal);
    }
  }
  throw lastError;
}

/**
 * Circuit breaker: after `failureThreshold` consecutive failures the circuit
 * opens and calls fail fast for `resetTimeoutMs`. This is what stops a dead or
 * angry service from being hammered by every queued job in turn.
 */
class CircuitBreaker {
  constructor({ failureThreshold = 5, resetTimeoutMs = 60000, now } = {}) {
    this.failureThreshold = failureThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
    this._now = now || (() => Date.now());
    this.failures = 0;
    this.state = 'closed'; // closed | open | half-open
    this.openedAt = 0;
  }

  get isOpen() {
    if (this.state !== 'open') return false;
    if (this._now() - this.openedAt >= this.resetTimeoutMs) {
      this.state = 'half-open';
      return false;
    }
    return true;
  }

  recordSuccess() {
    this.failures = 0;
    this.state = 'closed';
  }

  recordFailure() {
    this.failures++;
    if (this.failures >= this.failureThreshold) {
      this.state = 'open';
      this.openedAt = this._now();
    }
  }

  async run(fn) {
    if (this.isOpen) {
      const error = new Error('Circuit is open — service is failing, not sending request');
      error.code = 'ECIRCUITOPEN';
      throw error;
    }
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  snapshot() {
    return { state: this.isOpen ? 'open' : this.state, failures: this.failures };
  }
}

module.exports = {
  withRetry,
  isRetryableError,
  parseRetryAfter,
  backoffDelay,
  CircuitBreaker,
  RETRYABLE_STATUS,
};
