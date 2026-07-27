// src/main/integration/Connector.js
//
// The one interface every platform implements. Features never talk to Gmail,
// Drive or Maps directly — they resolve a connector from the registry and call
// these methods. Adding a platform means writing one subclass; nothing else in
// the app changes.
//
// Subclasses override the _-prefixed hooks. The public methods around them
// supply the cross-cutting behaviour (rate limiting, retry, circuit breaking,
// logging, status transitions) so no connector has to reimplement it, and none
// can accidentally skip it.

const { EventEmitter } = require('events');
const { RateLimiter } = require('./rateLimiter');
const { withRetry, CircuitBreaker } = require('./retry');

const STATUS = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DEGRADED: 'degraded',
  ERROR: 'error',
};

class Connector extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.id stable identifier, e.g. 'smtp'
   * @param {string} opts.name human label
   * @param {string} opts.category email | storage | calendar | maps | database | ...
   * @param {string[]} [opts.permissions] what this connector can do once authorised
   * @param {object} [opts.rateLimit] RateLimiter options
   * @param {object} [opts.vault] credential vault
   * @param {object} [opts.cache] response cache
   */
  constructor({
    id, name, category,
    permissions = [],
    rateLimit = { tokensPerInterval: 5, intervalMs: 1000 },
    retry = {},
    vault = null,
    cache = null,
    logLimit = 100,
  }) {
    super();
    if (!id) throw new Error('Connector requires an id');
    this.id = id;
    this.name = name || id;
    this.category = category || 'general';
    this._permissions = permissions;

    this.limiter = new RateLimiter(rateLimit);
    this.breaker = new CircuitBreaker(retry.breaker || {});
    this.retryOptions = { retries: 3, baseDelayMs: 500, maxDelayMs: 30000, ...retry };
    this.vault = vault;
    this.cache = cache;

    this.status = STATUS.DISCONNECTED;
    this.lastError = null;
    this.lastHealthCheck = null;
    this.connectedAt = null;
    this._logs = [];
    this._logLimit = logLimit;
    this._offlineQueue = [];
  }

  // ---- lifecycle -------------------------------------------------------

  async connect() {
    if (this.status === STATUS.CONNECTED) return this.getStatus();
    this._setStatus(STATUS.CONNECTING);
    try {
      await this._connect();
      this.connectedAt = new Date().toISOString();
      this._setStatus(STATUS.CONNECTED);
      this.log('info', 'Connected');
      await this.flushQueue();
    } catch (error) {
      this._fail('Connect failed', error);
      throw error;
    }
    return this.getStatus();
  }

  async authenticate(credentials) {
    try {
      const result = await this._authenticate(credentials);
      if (this.vault && credentials) await this.vault.set(this.id, credentials);
      this.log('info', 'Authenticated');
      return result;
    } catch (error) {
      this._fail('Authentication failed', error);
      throw error;
    }
  }

  async disconnect() {
    try {
      await this._disconnect();
    } finally {
      this.connectedAt = null;
      this._setStatus(STATUS.DISCONNECTED);
      this.log('info', 'Disconnected');
    }
  }

  async reconnect() {
    await this.disconnect().catch(() => {});
    return this.connect();
  }

  /** Removes stored credentials as well as closing the connection. */
  async revoke() {
    await this.disconnect().catch(() => {});
    if (this.vault) await this.vault.delete(this.id);
    this.log('warn', 'Credentials revoked');
  }

  // ---- health & status -------------------------------------------------

  async healthCheck() {
    const startedAt = Date.now();
    let result;
    try {
      const detail = await this._healthCheck();
      result = { ok: true, latencyMs: Date.now() - startedAt, detail: detail || 'OK' };
      if (this.status === STATUS.ERROR || this.status === STATUS.DEGRADED) {
        this._setStatus(STATUS.CONNECTED);
      }
    } catch (error) {
      result = { ok: false, latencyMs: Date.now() - startedAt, detail: String(error.message || error) };
      this._setStatus(STATUS.DEGRADED);
    }
    result.at = new Date().toISOString();
    this.lastHealthCheck = result;
    this.emit('health', result);
    return result;
  }

  getStatus() {
    return {
      id: this.id,
      name: this.name,
      category: this.category,
      status: this.status,
      connectedAt: this.connectedAt,
      lastError: this.lastError,
      lastHealthCheck: this.lastHealthCheck,
      permissions: this._permissions,
      queued: this._offlineQueue.length,
      rateLimit: this.limiter.snapshot(),
      circuit: this.breaker.snapshot(),
      configured: this.isConfigured(),
    };
  }

  permissions() {
    return [...this._permissions];
  }

  isConfigured() {
    return true;
  }

  // ---- actions ---------------------------------------------------------

  /**
   * The single entry point for doing anything. Wraps the subclass's action
   * table in rate limiting, circuit breaking and retry, so every connector
   * gets identical backpressure behaviour for free.
   */
  async execute(action, payload = {}, { signal, idempotent = true } = {}) {
    const handler = this.actions()[action];
    if (!handler) throw new Error(`${this.id}: unknown action "${action}"`);

    const run = async () => {
      await this.limiter.acquire(1, { signal });
      return handler.call(this, payload, { signal });
    };

    try {
      const result = idempotent
        ? await this.breaker.run(() => withRetry(run, {
            ...this.retryOptions,
            signal,
            onRetry: ({ attempt, delay, error }) => {
              this.log('warn', `Retry ${attempt + 1} in ${delay}ms: ${error.message || error}`);
              if (error.retryAfterMs) this.limiter.penalize(error.retryAfterMs);
            },
          }))
        : await this.breaker.run(run);
      this.emit('action', { action, ok: true });
      return result;
    } catch (error) {
      this.log('error', `Action "${action}" failed: ${error.message || error}`);
      this.emit('action', { action, ok: false, error: String(error.message || error) });
      throw error;
    }
  }

  /** Subclasses return { actionName: async fn }. */
  actions() {
    return {};
  }

  async sync() {
    return this._sync();
  }

  // ---- offline queue ---------------------------------------------------

  /** Queues an action to run when the connector is next healthy. */
  enqueue(action, payload) {
    const job = { id: `${this.id}-${Date.now()}-${this._offlineQueue.length}`, action, payload, queuedAt: new Date().toISOString() };
    this._offlineQueue.push(job);
    this.log('info', `Queued "${action}" for later (offline)`);
    this.emit('queued', job);
    return job;
  }

  async flushQueue() {
    if (!this._offlineQueue.length) return { flushed: 0, failed: 0 };
    const pending = [...this._offlineQueue];
    this._offlineQueue = [];
    let flushed = 0;
    const failed = [];
    for (const job of pending) {
      try {
        await this.execute(job.action, job.payload);
        flushed++;
      } catch {
        failed.push(job); // keep it queued for the next attempt
      }
    }
    this._offlineQueue.push(...failed);
    if (flushed) this.log('info', `Flushed ${flushed} queued action(s)`);
    return { flushed, failed: failed.length };
  }

  queue() {
    return [...this._offlineQueue];
  }

  // ---- logging ---------------------------------------------------------

  log(level, message) {
    const entry = { level, message, at: new Date().toISOString() };
    this._logs.push(entry);
    if (this._logs.length > this._logLimit) this._logs.shift();
    this.emit('log', entry);
    return entry;
  }

  logs() {
    return [...this._logs];
  }

  // ---- internals -------------------------------------------------------

  _setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.emit('status', this.getStatus());
  }

  _fail(context, error) {
    this.lastError = { message: String(error.message || error), at: new Date().toISOString() };
    this._setStatus(STATUS.ERROR);
    this.log('error', `${context}: ${this.lastError.message}`);
  }

  // Hooks — override as needed. Defaults keep trivial connectors tiny.
  async _connect() {}
  async _disconnect() {}
  async _authenticate() { return { ok: true }; }
  async _healthCheck() { return 'OK'; }
  async _sync() { return { ok: true, changed: 0 }; }
}

module.exports = { Connector, STATUS };
