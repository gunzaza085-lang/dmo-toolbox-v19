'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { backendPost, retryBackendAction } = require('../facebook-worker/backend-client');
const { LeaseKeeper } = require('../facebook-worker/lease-keeper');
const { ResultStore } = require('../facebook-worker/result-store');

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

function close(server) { return new Promise((resolve) => server.close(resolve)); }

async function main() {
  await test('Apps Script slow response becomes a bounded timeout', async () => {
    const target = await listen((_req, res) => setTimeout(() => { if (!res.destroyed) res.end(JSON.stringify({ ok: true })); }, 150));
    try {
      await assert.rejects(() => backendPost(target.url, 'token', { action: 'slow' }, { timeoutMs: 30 }), /BACKEND_TIMEOUT/);
    } finally { await close(target.server); }
  });

  await test('HTML Apps Script failure is classified with evidence', async () => {
    const target = await listen((_req, res) => { res.writeHead(503, { 'Content-Type': 'text/html' }); res.end('<!DOCTYPE html><title>Service unavailable</title>'); });
    try {
      await assert.rejects(() => backendPost(target.url, 'token', { action: 'html' }, { timeoutMs: 500 }), /BACKEND_NON_JSON:503:text\/html:<!DOCTYPE html>/);
    } finally { await close(target.server); }
  });

  await test('Network disconnect is retryable and idempotent', async () => {
    const committed = new Set();
    let requests = 0;
    const target = await listen((req, res) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        requests += 1;
        const body = JSON.parse(raw);
        committed.add(body.jobId);
        if (requests === 1) return req.socket.destroy();
        res.end(JSON.stringify({ ok: true, idempotent: true, jobId: body.jobId }));
      });
    });
    try {
      const result = await retryBackendAction(() => backendPost(target.url, 'token', { action: 'completeFacebookBumpJob', jobId: 'JOB-IDEMPOTENT' }, { timeoutMs: 500 }), { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 });
      assert.equal(result.jobId, 'JOB-IDEMPOTENT');
      assert.equal(requests, 2);
      assert.equal(committed.size, 1);
    } finally { await close(target.server); }
  });

  await test('Renewable lease survives a slow operation', async () => {
    let renewals = 0;
    const keeper = new LeaseKeeper({ intervalMs: 100, safetyMs: 5, renew: async () => ({ leaseExpiresAt: new Date(Date.now() + 150).toISOString(), count: ++renewals }) });
    keeper.start(new Date(Date.now() + 125).toISOString());
    await new Promise((resolve) => setTimeout(resolve, 250));
    await keeper.beforeIrreversible();
    keeper.stop();
    assert(renewals >= 2);
  });

  await test('Worker restart journal never resubmits an ambiguous comment', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dmo-restart-sim-'));
    const file = path.join(directory, 'results.json');
    try {
      new ResultStore(file).put('JOB-RESTART', { state: 'SUBMITTING', leaseToken: 'lease-restart', submitStartedAt: new Date().toISOString() });
      const restored = new ResultStore(file).pending();
      assert.equal(restored.length, 1);
      assert.equal(restored[0].state, 'SUBMITTING');
      assert.equal(Boolean(restored[0].externalCommentId), false);
    } finally {
      for (const name of ['results.json', 'results.json.bak']) { try { fs.unlinkSync(path.join(directory, name)); } catch {} }
      try { fs.rmdirSync(directory); } catch {}
    }
  });

  await test('Chrome watchdog and cleanup fail-closed paths are installed', async () => {
    const root = path.resolve(__dirname, '..');
    const worker = fs.readFileSync(path.join(root, 'facebook-worker', 'worker.js'), 'utf8');
    const page = fs.readFileSync(path.join(root, 'facebook-worker', 'facebook-page.js'), 'utf8');
    const gas = fs.readFileSync(path.join(root, 'FacebookBumpModule.gs'), 'utf8');
    assert(worker.includes("invalidateBrowser(Error('JOB_WATCHDOG_ABORTED'))"));
    assert(worker.includes("stored.state === 'SUBMITTING'") && worker.includes('WORKER_RESTART_DURING_SUBMIT_NEEDS_REVIEW'));
    assert(page.includes('knownCommentIds') && page.includes('COMMENT_REFERENCE_AMBIGUOUS_NEEDS_REVIEW'));
    assert(gas.includes('COMMENT_ID_ALREADY_OWNED_NEEDS_REVIEW'));
    assert(gas.includes("cleanupResult.indexOf('CLEANUP_FAILED:')===0"));
  });

  console.log(`Facebook reliability failure simulations: ${passed}/${passed} PASS`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
