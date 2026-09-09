'use strict';

class LeaseKeeper {
  constructor(options) {
    this.renew = options.renew;
    this.intervalMs = Math.max(100, Number(options.intervalMs || 30000));
    this.safetyMs = Math.max(0, Number(options.safetyMs || 15000));
    this.timer = null;
    this.expiresAt = 0;
    this.lastError = null;
    this.inFlight = null;
  }

  update(result) {
    const value = Date.parse(result && result.leaseExpiresAt || '');
    if (!Number.isFinite(value)) throw Error('LEASE_EXPIRY_INVALID');
    this.expiresAt = value;
    this.lastError = null;
    return result;
  }

  async renewNow() {
    if (!this.inFlight) this.inFlight = Promise.resolve().then(() => this.renew()).then((result) => this.update(result)).catch((error) => { this.lastError = error; throw error; }).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  start(initialExpiry) {
    this.update({ leaseExpiresAt: initialExpiry });
    this.stop();
    this.timer = setInterval(() => this.renewNow().catch(() => {}), this.intervalMs);
    return this;
  }

  async beforeIrreversible(now = Date.now()) {
    if (this.lastError || !this.expiresAt || Number(now) + this.safetyMs >= this.expiresAt) await this.renewNow();
    if (!this.expiresAt || Date.now() + this.safetyMs >= this.expiresAt) throw Error('LEASE_NOT_SAFE_BEFORE_SUBMIT');
    return true;
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

module.exports = { LeaseKeeper };
