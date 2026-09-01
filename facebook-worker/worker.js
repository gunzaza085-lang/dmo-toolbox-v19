'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { FACEBOOK_HOME, FacebookPageAdapter, classifyFacebookUrl } = require('./facebook-page');
const { RecoveryBackoff, isBrowserClosedError, needsReviewError } = require('./recovery');

const HOST = '127.0.0.1';
const PORT = Number(process.env.FACEBOOK_WORKER_PORT || 17821);
const BACKEND_TIMEOUT_MS = Number(process.env.FACEBOOK_WORKER_BACKEND_TIMEOUT_MS || 45000);
const LEGACY_PROFILE_DIR = path.resolve(__dirname, '..', '.facebook-worker-profile');
const PORTABLE_PROFILE_DIR = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'GUN-SHOP-DMO', 'FacebookWorkerProfile')
  : LEGACY_PROFILE_DIR;
const PROFILE_DIR = path.resolve(process.env.FACEBOOK_WORKER_PROFILE_DIR || (fs.existsSync(LEGACY_PROFILE_DIR) ? LEGACY_PROFILE_DIR : PORTABLE_PROFILE_DIR));
const ALLOWED_ORIGINS = new Set((process.env.WORKER_ALLOWED_ORIGINS || 'https://gunzaza085-lang.github.io,http://127.0.0.1:4173').split(',').map((item) => item.trim()).filter(Boolean));

let context = null;
let page = null;
let paired = null;
let running = false;
let lastError = '';
let timer = null;
let healthTimer = null;
let account = { name: '', identifier: '', checkedAt: '' };
let browserLaunchPromise = null;
let intentionalBrowserClose = false;
let browserAutoRecoveryEnabled = true;
const recoveryBackoff = new RecoveryBackoff({
  baseDelayMs: Number(process.env.FACEBOOK_WORKER_RECOVERY_BASE_MS || 5000),
  maxDelayMs: Number(process.env.FACEBOOK_WORKER_RECOVERY_MAX_MS || 120000),
});

function publicStatus(connection = 'DISCONNECTED') {
  const browserRunning = Boolean(context && page && !page.isClosed());
  return { ok: true, worker: 'ONLINE', browser: browserRunning ? 'RUNNING' : 'STOPPED', connection, paired: Boolean(paired), running, lastError, workerPid: process.pid, browserProfile: path.basename(PROFILE_DIR), recovery: { failures: recoveryBackoff.failures, retryInMs: recoveryBackoff.remainingMs() }, account: { ...account }, lastChecked: new Date().toISOString() };
}

async function refreshAccountIdentity(adapter) {
  const identity = await adapter.accountIdentity(context);
  account = { name: identity.name || '', identifier: identity.identifier || '', checkedAt: new Date().toISOString() };
  return identity.state;
}

async function invalidateBrowser(error) {
  if (error) lastError = String(error && error.message || error).slice(0, 300);
  const staleContext = context;
  context = null;
  page = null;
  if (staleContext) await staleContext.close().catch(() => {});
}

async function launchBrowser() {
  const launched = await chromium.launchPersistentContext(PROFILE_DIR, { channel: 'chrome', headless: false, viewport: null, args: ['--start-maximized'] });
  intentionalBrowserClose = false;
  launched.on('close', () => {
    if (context === launched) { context = null; page = null; }
    if (!intentionalBrowserClose) lastError = 'BROWSER_CONTEXT_CLOSED';
  });
  context = launched;
  page = launched.pages()[0] || await launched.newPage();
  recoveryBackoff.success();
}

async function ensureBrowser(options = {}) {
  const force = Boolean(options.force);
  try {
    if (context) {
      const pages = context.pages();
      page = page && !page.isClosed() ? page : pages.find((candidate) => !candidate.isClosed()) || await context.newPage();
    }
  } catch (error) {
    if (!isBrowserClosedError(error)) throw error;
    await invalidateBrowser(error);
  }
  if (!context) {
    if (!force && !recoveryBackoff.canAttempt()) throw Error(`BROWSER_RECOVERY_COOLDOWN:${recoveryBackoff.remainingMs()}`);
    if (!browserLaunchPromise) browserLaunchPromise = launchBrowser().catch((error) => { recoveryBackoff.failure(); throw error; }).finally(() => { browserLaunchPromise = null; });
    await browserLaunchPromise;
  }
  try {
    page = page && !page.isClosed() ? page : context.pages().find((candidate) => !candidate.isClosed()) || await context.newPage();
  } catch (error) {
    if (isBrowserClosedError(error)) { await invalidateBrowser(error); recoveryBackoff.failure(); }
    throw error;
  }
  try {
    const cdp = await context.newCDPSession(page);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal', left: 80, top: 60, width: 1280, height: 820 } });
    await cdp.detach();
  } catch {}
  await page.bringToFront();
  return new FacebookPageAdapter(page);
}

async function openFacebookPage(targetUrl) {
  const adapter = await ensureBrowser({ force: true });
  try {
    await page.goto(targetUrl || FACEBOOK_HOME, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (error) {
    const aborted = /net::ERR_ABORTED/i.test(String(error && error.message || error));
    if (!aborted || classifyFacebookUrl(page.url()) === 'INVALID') throw error;
    await page.waitForTimeout(1000);
  }
  await page.bringToFront();
  const connection = await adapter.connectionState();
  if (connection === 'CONNECTED') lastError = '';
  return publicStatus(connection);
}

async function connectionStatus() {
  if (!context || !page || page.isClosed()) return publicStatus('DISCONNECTED');
  const adapter = new FacebookPageAdapter(page);
  const connection = await adapter.connectionState();
  if (connection === 'CONNECTED') lastError = '';
  return publicStatus(connection);
}

async function apiPost(payload) {
  if (!paired) throw Error('WORKER_NOT_PAIRED');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
  try {
    const response = await fetch(paired.apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...payload, token: paired.token }), signal: controller.signal });
    const data = await response.json();
    if (!data.ok) throw Error(data.error || 'BACKEND_REQUEST_FAILED');
    return data;
  } catch (error) {
    if (error && error.name === 'AbortError') throw Error('BACKEND_TIMEOUT');
    throw error;
  } finally { clearTimeout(timeout); }
}

async function finishJob(action, payload) {
  let error;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await apiPost({ action, ...payload }); } catch (caught) { error = caught; await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1))); }
  }
  throw error;
}

async function processOnce() {
  if (!paired || running) return;
  let adapter;
  try { adapter = await ensureBrowser(); }
  catch (error) { lastError = String(error && error.message || error).slice(0, 300); return; }
  let connection = await adapter.connectionState();
  if (connection === 'INVALID') {
    const opened = await openFacebookPage(FACEBOOK_HOME);
    connection = opened.connection;
    adapter = new FacebookPageAdapter(page);
  }
  if (connection !== 'CONNECTED') { lastError = connection; return; }
  running = true;
  try {
    const claim = await apiPost({ action: 'claimFacebookBumpJob' });
    if (!claim.job) return;
    const { job, previousOwnedComment, cleanupOld } = claim;
    try {
      await adapter.openPost(job.postUrl);
      const created = await adapter.submitComment(job.message);
      let cleanupResult = 'SKIPPED';
      let previousCommentId = '';
      if (cleanupOld && previousOwnedComment) {
        previousCommentId = previousOwnedComment.externalCommentId || '';
        const cleanup = await adapter.deleteOwnedComment(previousCommentId);
        cleanupResult = cleanup.ok ? 'DELETED' : `CLEANUP_FAILED:${cleanup.code}`;
      }
      await finishJob('completeFacebookBumpJob', { jobId: job.jobId, externalCommentId: created.externalCommentId, message: job.message, cleanupResult, previousCommentId });
      lastError = '';
    } catch (error) {
      const code = needsReviewError(error);
      lastError = code;
      if (isBrowserClosedError(error)) { await invalidateBrowser(error); recoveryBackoff.failure(); }
      await finishJob('failFacebookBumpJob', { jobId: job.jobId, error: code });
    }
  } finally { running = false; }
}

async function maintainBrowser() {
  if (!browserAutoRecoveryEnabled || paired || running) return;
  try {
    let adapter = await ensureBrowser();
    let connection = await adapter.connectionState();
    if (connection === 'INVALID') {
      const opened = await openFacebookPage(FACEBOOK_HOME);
      connection = opened.connection;
      adapter = new FacebookPageAdapter(page);
    }
    lastError = connection === 'CONNECTED' ? '' : connection;
  } catch (error) {
    lastError = String(error && error.message || error).slice(0, 300);
  }
}

function schedule() {
  clearInterval(timer);
  timer = setInterval(() => processOnce().catch((error) => { lastError = String(error && error.message || error).slice(0, 300); }), 15000);
}

function cors(req, res) {
  const origin = req.headers.origin || '';
  const loopbackOrigin = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(origin);
  if (origin && !ALLOWED_ORIGINS.has(origin) && !loopbackOrigin) return false;
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  if (req.headers['access-control-request-private-network'] === 'true') res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => { let body = ''; req.on('data', (chunk) => { body += chunk; if (body.length > 200000) reject(Error('REQUEST_TOO_LARGE')); }); req.on('end', () => { try { const contentType=String(req.headers['content-type']||'').toLowerCase();resolve(!body?{}:contentType.startsWith('application/x-www-form-urlencoded')?Object.fromEntries(new URLSearchParams(body)):JSON.parse(body)); } catch { reject(Error('INVALID_BODY')); } }); req.on('error', reject); });
}

function pairBridgeResponse(res, status) {
  const payload=JSON.stringify({ type: 'DMO_FACEBOOK_PAIR_RESULT', status }).replace(/</g,'\\u003c');
  res.setHeader('Content-Type','text/html;charset=utf-8');
  return res.end(`<!doctype html><meta charset="utf-8"><title>DMO Facebook Pair</title><p>Pairing complete. This window will close automatically.</p><script>if(window.opener)window.opener.postMessage(${payload},'https://gunzaza085-lang.github.io');setTimeout(()=>window.close(),400);<\/script>`);
}

const server = http.createServer(async (req, res) => {
  if (!cors(req, res)) { res.writeHead(403); return res.end(JSON.stringify({ ok: false, error: 'ORIGIN_NOT_ALLOWED' })); }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  res.setHeader('Content-Type', 'application/json;charset=utf-8');
  try {
    if (req.method === 'GET' && req.url === '/status') return res.end(JSON.stringify(await connectionStatus()));
    const body = await readBody(req);
    if (req.method === 'POST' && req.url === '/connect') { browserAutoRecoveryEnabled = true; return res.end(JSON.stringify(await openFacebookPage(FACEBOOK_HOME))); }
    if (req.method === 'POST' && req.url === '/test') { browserAutoRecoveryEnabled = true; const adapter = await ensureBrowser({ force: true }); const connection = await refreshAccountIdentity(adapter); if (connection === 'CONNECTED') lastError = ''; return res.end(JSON.stringify(publicStatus(connection))); }
    if (req.method === 'POST' && req.url === '/open') { browserAutoRecoveryEnabled = true; return res.end(JSON.stringify(await openFacebookPage(body.url || FACEBOOK_HOME))); }
    if (req.method === 'POST' && req.url === '/pair-browser') { if (!/^https:\/\/script\.google\.com\/macros\/s\//.test(String(body.apiUrl || '')) || !body.token) throw Error('INVALID_PAIRING'); browserAutoRecoveryEnabled = true; const opened=await openFacebookPage(FACEBOOK_HOME); if(opened.connection==='CONNECTED'){paired={apiUrl:String(body.apiUrl),token:String(body.token)};schedule();} return pairBridgeResponse(res,await connectionStatus()); }
    if (req.method === 'POST' && req.url === '/pair') { if (!/^https:\/\/script\.google\.com\/macros\/s\//.test(String(body.apiUrl || '')) || !body.token) throw Error('INVALID_PAIRING'); paired = { apiUrl: String(body.apiUrl), token: String(body.token) }; schedule(); return res.end(JSON.stringify(await connectionStatus())); }
    if (req.method === 'POST' && req.url === '/disconnect') { paired = null; running = false; clearInterval(timer); timer = null; browserAutoRecoveryEnabled = false; intentionalBrowserClose = true; if (context) await context.close(); context = null; page = null; recoveryBackoff.success(); return res.end(JSON.stringify(publicStatus('DISCONNECTED'))); }
    res.writeHead(404); return res.end(JSON.stringify({ ok: false, error: 'NOT_FOUND' }));
  } catch (error) { lastError = String(error && error.message || error).slice(0, 300); res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: lastError })); }
});

server.listen(PORT, HOST, () => {
  console.log(`Facebook worker ready at http://${HOST}:${PORT}`);
  healthTimer = setInterval(() => maintainBrowser(), 15000);
  maintainBrowser();
});
process.on('SIGINT', async () => { clearInterval(healthTimer); if (context) await context.close(); process.exit(0); });
