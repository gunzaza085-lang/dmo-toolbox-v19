'use strict';

const fs = require('fs');
const path = require('path');

function validApiUrl(value) { return /^https:\/\/script\.google\.com\/macros\/s\//.test(String(value || '')); }
function validWorkerToken(value) { return /^fbw_[a-f0-9]{64}$/i.test(String(value || '')); }

function createPairingStore(pairingFile) {
  return {
    load() {
      try {
        const value = JSON.parse(fs.readFileSync(pairingFile, 'utf8'));
        return validApiUrl(value.apiUrl) && validWorkerToken(value.token) ? { apiUrl: String(value.apiUrl), token: String(value.token) } : null;
      } catch { return null; }
    },
    persist(value) {
      if (!validApiUrl(value && value.apiUrl) || !validWorkerToken(value && value.token)) throw Error('INVALID_WORKER_PAIRING');
      fs.mkdirSync(path.dirname(pairingFile), { recursive: true });
      const temporary = `${pairingFile}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ apiUrl: String(value.apiUrl), token: String(value.token) }), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporary, pairingFile);
    },
    forget() {
      try { fs.unlinkSync(pairingFile); } catch (error) { if (error && error.code !== 'ENOENT') throw error; }
    },
  };
}

module.exports = { createPairingStore, validApiUrl, validWorkerToken };
