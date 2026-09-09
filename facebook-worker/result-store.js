'use strict';

const fs = require('fs');
const path = require('path');

class ResultStore {
  constructor(file) {
    this.file = file;
    this.records = this.load();
  }

  load() {
    for (const candidate of [this.file, `${this.file}.bak`]) {
      try {
        const value = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
      } catch {}
    }
    return {};
  }

  persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    const backup = `${this.file}.bak`;
    fs.writeFileSync(temporary, JSON.stringify(this.records, null, 2), 'utf8');
    try { fs.unlinkSync(backup); } catch {}
    try { if (fs.existsSync(this.file)) fs.renameSync(this.file, backup); } catch {}
    fs.renameSync(temporary, this.file);
    try { fs.unlinkSync(backup); } catch {}
  }

  put(jobId, patch) {
    const id = String(jobId || '');
    if (!id) throw Error('RESULT_STORE_JOB_ID_REQUIRED');
    this.records[id] = { ...(this.records[id] || {}), ...patch, jobId: id, updatedAt: new Date().toISOString() };
    this.persist();
    return this.records[id];
  }

  get(jobId) { return this.records[String(jobId || '')] || null; }
  pending() { return Object.values(this.records).filter((item) => item && item.state !== 'ACKNOWLEDGED'); }

  acknowledge(jobId) {
    const current = this.get(jobId);
    if (!current) return null;
    return this.put(jobId, { state: 'ACKNOWLEDGED', acknowledgedAt: new Date().toISOString() });
  }

  prune(limit = 500) {
    const entries = Object.entries(this.records);
    if (entries.length <= limit) return;
    const keep = entries.sort((a, b) => String(b[1].updatedAt || '').localeCompare(String(a[1].updatedAt || ''))).slice(0, limit);
    this.records = Object.fromEntries(keep);
    this.persist();
  }
}

module.exports = { ResultStore };
