'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function processAlive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
  try { process.kill(Number(pid), 0); return true; }
  catch (error) { return Boolean(error && error.code === 'EPERM'); }
}

function acquireInstanceLock(lockFile, options = {}) {
  const pid = Number(options.pid || process.pid);
  const isProcessAlive = options.isProcessAlive || processAlive;
  const token = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });

  function create() {
    const fd = fs.openSync(lockFile, 'wx');
    fs.writeFileSync(fd, JSON.stringify({ pid, token, startedAt: new Date().toISOString() }), 'utf8');
    return fd;
  }

  let fd;
  try { fd = create(); }
  catch (error) {
    if (!error || error.code !== 'EEXIST') throw error;
    let existing = null;
    try { existing = JSON.parse(fs.readFileSync(lockFile, 'utf8')); } catch {}
    if (existing && isProcessAlive(Number(existing.pid))) {
      const alreadyRunning = Error(`WORKER_ALREADY_RUNNING:${existing.pid}`);
      alreadyRunning.code = 'WORKER_ALREADY_RUNNING';
      throw alreadyRunning;
    }
    fs.unlinkSync(lockFile);
    fd = create();
  }

  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      try { fs.closeSync(fd); } catch {}
      try {
        const current = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
        if (current.token === token && Number(current.pid) === pid) fs.unlinkSync(lockFile);
      } catch {}
    },
  };
}

module.exports = { acquireInstanceLock, processAlive };
