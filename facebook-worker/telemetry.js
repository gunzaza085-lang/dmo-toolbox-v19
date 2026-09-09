'use strict';

const fs = require('fs');
const path = require('path');

function safeText(value, limit = 600) {
  return String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').slice(0, limit);
}

class PersistentTelemetry {
  constructor(file, options = {}) {
    this.file = file;
    this.maxBytes = Math.max(65536, Number(options.maxBytes || 5 * 1024 * 1024));
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  rotateIfNeeded(extraBytes) {
    let size = 0;
    try { size = fs.statSync(this.file).size; } catch {}
    if (size + extraBytes <= this.maxBytes) return;
    const previous = `${this.file}.1`;
    try { fs.unlinkSync(previous); } catch {}
    try { fs.renameSync(this.file, previous); } catch {}
  }

  append(event, fields = {}) {
    const record = {
      at: new Date().toISOString(),
      event: safeText(event, 100),
      jobId: safeText(fields.jobId, 120),
      targetPostId: safeText(fields.targetPostId, 120),
      phase: safeText(fields.phase, 100),
      outcome: safeText(fields.outcome, 80),
      detail: safeText(fields.detail, 600),
      durationMs: Math.max(0, Number(fields.durationMs || 0)),
      attempt: Math.max(0, Number(fields.attempt || 0)),
      leaseToken: safeText(fields.leaseToken, 160),
      externalCommentId: safeText(fields.externalCommentId, 1000),
    };
    const line = `${JSON.stringify(record)}\n`;
    this.rotateIfNeeded(Buffer.byteLength(line));
    fs.appendFileSync(this.file, line, 'utf8');
    return record;
  }
}

module.exports = { PersistentTelemetry, safeText };
