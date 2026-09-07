'use strict';

class RecoveryBackoff {
  constructor(options = {}) {
    this.baseDelayMs = Number(options.baseDelayMs || 5000);
    this.maxDelayMs = Number(options.maxDelayMs || 120000);
    this.failures = 0;
    this.nextAttemptAt = 0;
  }

  canAttempt(now = Date.now()) { return Number(now) >= this.nextAttemptAt; }
  remainingMs(now = Date.now()) { return Math.max(0, this.nextAttemptAt - Number(now)); }
  success() { this.failures = 0; this.nextAttemptAt = 0; }
  failure(now = Date.now()) {
    this.failures += 1;
    const delay = Math.min(this.maxDelayMs, this.baseDelayMs * (2 ** Math.max(0, this.failures - 1)));
    this.nextAttemptAt = Number(now) + delay;
    return delay;
  }
}

function isBrowserClosedError(error) {
  return /target page, context or browser has been closed|browser has been closed|context\.newPage|target closed/i.test(String(error && error.message || error || ''));
}

function needsReviewError(error, commentCreated = false) {
  const code = isBrowserClosedError(error) ? 'BROWSER_CLOSED_NEEDS_REVIEW' : String(error && error.message || error || 'REAL_EXECUTOR_FAILED').slice(0, 280);
  return commentCreated && !/NEEDS_REVIEW/.test(code) ? `${code}_AFTER_COMMENT_NEEDS_REVIEW` : code;
}

module.exports = { RecoveryBackoff, isBrowserClosedError, needsReviewError };
