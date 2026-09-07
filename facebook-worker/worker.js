'use strict';

const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');
const { FACEBOOK_HOME, FacebookPageAdapter, classifyFacebookUrl } = require('./facebook-page');
const { portableProfileDir } = require('./portable-preflight');
const { RecoveryBackoff, isBrowserClosedError, needsReviewError } = require('./recovery');
const { acquireInstanceLock } = require('./instance-lock');
const { createPairingStore, validApiUrl, validWorkerToken } = require('./pairing-store');

const HOST = '127.0.0.1';
const PORT = Number(process.env.FACEBOOK_WORKER_PORT || 17821);
const BACKEND_TIMEOUT_MS = Number(process.env.FACEBOOK_WORKER_BACKEND_TIMEOUT_MS || 45000);
const POLL_INTERVAL_MS = Math.max(15000, Number(process.env.FACEBOOK_WORKER_POLL_MS || 30000));
const HEARTBEAT_INTERVAL_MS = Math.max(15000, Number(process.env.FACEBOOK_WORKER_HEARTBEAT_MS || 30000));
const PROFILE_DIR = portableProfileDir();
const PAIRING_FILE = path.join(PROFILE_DIR, 'worker-pair.json');
const INSTANCE_LOCK_FILE = path.join(PROFILE_DIR, 'worker-instance.lock');
const ALLOWED_ORIGINS = new Set((process.env.WORKER_ALLOWED_ORIGINS || 'https://gunzaza085-lang.github.io').split(',').map((item) => item.trim()).filter(Boolean));
let instanceLock;
try { instanceLock = acquireInstanceLock(INSTANCE_LOCK_FILE); }
catch (error) { console.error(String(error && error.message || error)); process.exit(1); }
const pairingStore = createPairingStore(PAIRING_FILE);
process.once('exit', () => instanceLock.release());

let context = null;
let page = null;
let paired = pairingStore.load();
let running = false;
let activeJobId = '';
let lastError = '';
let lastClaimReason = '';
let lastClaimAt = '';
let timer = null;
let healthTimer = null;
let heartbeatTimer = null;
let lastStatusReportAt = 0;
let lastConnection = 'DISCONNECTED';
let account = { name: '', identifier: '', checkedAt: '' };
let browserLaunchPromise = null;
let intentionalBrowserClose = false;
let browserAutoRecoveryEnabled = true;
const recoveryBackoff = new RecoveryBackoff({
  baseDelayMs: Number(process.env.FACEBOOK_WORKER_RECOVERY_BASE_MS || 5000),
  maxDelayMs: Number(process.env.FACEBOOK_WORKER_RECOVERY_MAX_MS || 120000),
});

function publicStatus(connection = 'DISCONNECTED') {
  lastConnection = String(connection || lastConnection || 'DISCONNECTED');
  const browserRunning = Boolean(context && page && !page.isClosed());
  return { ok: true, worker: 'ONLINE', browser: browserRunning ? 'RUNNING' : 'STOPPED', connection: browserRunning ? lastConnection : 'DISCONNECTED', paired: Boolean(paired), running: Boolean(activeJobId), lastError, lastClaimReason, lastClaimAt, workerPid: process.pid, browserProfile: path.basename(PROFILE_DIR), recovery: { failures: recoveryBackoff.failures, retryInMs: recoveryBackoff.remainingMs() }, account: { ...account }, lastChecked: new Date().toISOString() };
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
  const browserExecutable = process.env.FACEBOOK_WORKER_CHROME_PATH;
  const launched = await chromium.launchPersistentContext(PROFILE_DIR, { ...(browserExecutable ? { executablePath: browserExecutable } : { channel: 'chrome' }), headless: false, viewport: null, args: ['--start-minimized'] });
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
  const focus = Boolean(options.focus);
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
  if (focus) {
    try {
      const cdp = await context.newCDPSession(page);
      const { windowId } = await cdp.send('Browser.getWindowForTarget');
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal', left: 80, top: 60, width: 1280, height: 820 } });
      await cdp.detach();
    } catch {}
    await page.bringToFront();
  }
  return new FacebookPageAdapter(page);
}

async function openFacebookPage(targetUrl, options = {}) {
  const focus = Boolean(options.focus);
  const adapter = await ensureBrowser({ force: true, focus });
  try {
    await page.goto(targetUrl || FACEBOOK_HOME, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (error) {
    const aborted = /net::ERR_ABORTED/i.test(String(error && error.message || error));
    if (!aborted || classifyFacebookUrl(page.url()) === 'INVALID') throw error;
    await page.waitForTimeout(1000);
  }
  if (focus) await page.bringToFront();
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

async function backendPost(apiUrl, token, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
  try {
    const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...payload, token }), signal: controller.signal });
    const data = await response.json();
    if (!data.ok) throw Error(data.error || 'BACKEND_REQUEST_FAILED');
    return data;
  } catch (error) {
    if (error && error.name === 'AbortError') throw Error('BACKEND_TIMEOUT');
    throw error;
  } finally { clearTimeout(timeout); }
}

async function apiPost(payload) {
  if (!paired) throw Error('WORKER_NOT_PAIRED');
  try { return await backendPost(paired.apiUrl, paired.token, payload); }
  catch (error) {
    if (/WORKER_PAIR_REQUIRED/.test(String(error && error.message || error))) {
      paired = null;
      pairingStore.forget();
    }
    throw error;
  }
}

async function reportRemoteHeartbeat(force = false) {
  if (!paired || (!force && Date.now() - lastStatusReportAt < HEARTBEAT_INTERVAL_MS)) return;
  await apiPost({ action: 'reportFacebookWorkerStatus', workerStatus: publicStatus(lastConnection) });
  lastStatusReportAt = Date.now();
}

async function establishPairing(apiUrl, adminToken) {
  if (!validApiUrl(apiUrl) || !adminToken) throw Error('INVALID_PAIRING');
  const result = await backendPost(String(apiUrl), String(adminToken), { action: 'pairFacebookWorker', workerId: process.env.COMPUTERNAME || 'PC2' });
  if (!validWorkerToken(result.workerToken)) throw Error('INVALID_WORKER_TOKEN');
  const next = { apiUrl: String(apiUrl), token: String(result.workerToken) };
  pairingStore.persist(next);
  paired = next;
  schedule();
  return next;
}

async function finishJob(action, payload) {
  let error;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await apiPost({ action, ...payload }); } catch (caught) { error = caught; await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1))); }
  }
  throw error;
}

async function executeRemoteCommand(command, adapter) {
  if (!command || !command.id) return null;
  if (command.command === 'OPEN_FACEBOOK') return openFacebookPage(FACEBOOK_HOME, { focus: false });
  if (command.command === 'TEST') {
    const connection = await refreshAccountIdentity(adapter);
    if (connection === 'CONNECTED') lastError = '';
    return publicStatus(connection);
  }
  throw Error('REMOTE_COMMAND_NOT_ALLOWED');
}

async function processOnce() {
  if (!paired || running) return;
  let adapter;
  try { adapter = await ensureBrowser(); }
  catch (error) { lastError = String(error && error.message || error).slice(0, 300); await reportRemoteHeartbeat(true).catch(() => {}); return; }
  let connection = await adapter.connectionState();
  if (connection === 'INVALID') {
    const opened = await openFacebookPage(FACEBOOK_HOME);
    connection = opened.connection;
    adapter = new FacebookPageAdapter(page);
  }
  running = true;
  try {
    let claim;
    try {
      claim = await apiPost({ action: 'claimFacebookBumpJob', workerStatus: publicStatus(connection) });
      lastStatusReportAt = Date.now();
      lastClaimReason = claim.job ? 'CLAIMED' : String(claim.reason || 'NO_JOB');
    } catch (error) {
      lastClaimReason = `ERROR:${String(error && error.message || error).slice(0, 200)}`;
      throw error;
    } finally {
      lastClaimAt = new Date().toISOString();
    }
    if (claim.command) {
      try {
        const status = await executeRemoteCommand(claim.command, adapter);
        await finishJob('completeFacebookWorkerCommand', { commandId: claim.command.id, ok: true, workerStatus: status || await connectionStatus() });
        lastError = '';
      } catch (error) {
        lastError = String(error && error.message || error).slice(0, 300);
        await finishJob('completeFacebookWorkerCommand', { commandId: claim.command.id, ok: false, error: lastError, workerStatus: await connectionStatus() });
      }
      return;
    }
    if (connection !== 'CONNECTED') { lastError = connection; return; }
    if (!claim.job) return;
    const { job, previousOwnedComment, cleanupOld } = claim;
    activeJobId = String(job.jobId || '');
    let created = null;
    let jobCompleted = false;
    try {
      await adapter.openPost(job.postUrl);
      created = await adapter.submitComment(job.message);
      const previousCommentId = cleanupOld && previousOwnedComment ? previousOwnedComment.externalCommentId || '' : '';
      let cleanupResult = previousCommentId ? 'PENDING' : 'SKIPPED';
      await finishJob('completeFacebookBumpJob', { jobId: job.jobId, externalCommentId: created.externalCommentId, message: job.message, cleanupResult });
      jobCompleted = true;
      if (cleanupOld && previousOwnedComment) {
        try {
          const cleanup = await adapter.deleteOwnedComment(previousCommentId, previousOwnedComment.message || '');
          cleanupResult = cleanup.ok ? 'DELETED' : `CLEANUP_FAILED:${cleanup.code}`;
        } catch (error) {
          cleanupResult = `CLEANUP_FAILED:${needsReviewError(error)}`;
          if (isBrowserClosedError(error)) { await invalidateBrowser(error); recoveryBackoff.failure(); }
        }
        try { await finishJob('completeFacebookBumpJob', { jobId: job.jobId, externalCommentId: created.externalCommentId, cleanupResult, previousCommentId }); }
        catch (error) { lastError = `CLEANUP_REPORT_FAILED:${String(error && error.message || error).slice(0, 260)}`; return; }
      }
      lastError = cleanupResult.indexOf('CLEANUP_FAILED:')===0 ? cleanupResult : '';
    } catch (error) {
      if (jobCompleted) { lastError = `POST_COMPLETE_CLEANUP_ERROR:${String(error && error.message || error).slice(0, 260)}`; return; }
      const code = needsReviewError(error, Boolean(created));
      lastError = code;
      if (isBrowserClosedError(error)) { await invalidateBrowser(error); recoveryBackoff.failure(); }
      await finishJob('failFacebookBumpJob', { jobId: job.jobId, error: code, externalCommentId: created && created.externalCommentId || '' });
    }
  } finally { activeJobId = ''; running = false; }
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
  clearInterval(heartbeatTimer);
  timer = setInterval(() => processOnce().catch((error) => { lastError = String(error && error.message || error).slice(0, 300); }), POLL_INTERVAL_MS);
  heartbeatTimer = setInterval(() => reportRemoteHeartbeat().catch(() => {}), HEARTBEAT_INTERVAL_MS);
  setTimeout(() => processOnce().catch((error) => { lastError = String(error && error.message || error).slice(0, 300); }), 250);
  setTimeout(() => reportRemoteHeartbeat().catch(() => {}), 500);
}

function cors(req, res) {
  const origin = req.headers.origin || '';
  const localPairNavigation = req.method === 'POST' && req.url === '/pair-browser' && origin === 'null';
  if (!origin && req.method !== 'GET') return false;
  if (origin && !ALLOWED_ORIGINS.has(origin) && !localPairNavigation) return false;
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
    if (req.method === 'POST' && req.url === '/connect') { browserAutoRecoveryEnabled = true; return res.end(JSON.stringify(await openFacebookPage(FACEBOOK_HOME,{focus:true}))); }
    if (req.method === 'POST' && req.url === '/test') { browserAutoRecoveryEnabled = true; const adapter = await ensureBrowser({ force: true, focus: true }); const connection = await refreshAccountIdentity(adapter); if (connection === 'CONNECTED') lastError = ''; return res.end(JSON.stringify(publicStatus(connection))); }
    if (req.method === 'POST' && req.url === '/open') { browserAutoRecoveryEnabled = true; return res.end(JSON.stringify(await openFacebookPage(FACEBOOK_HOME,{focus:true}))); }
    if (req.method === 'POST' && req.url === '/pair-browser') { if (!validApiUrl(body.apiUrl) || !body.token) throw Error('INVALID_PAIRING'); browserAutoRecoveryEnabled = true; let current=await connectionStatus();if(current.connection!=='CONNECTED')current=await openFacebookPage(FACEBOOK_HOME,{focus:true});if(current.connection==='CONNECTED')await establishPairing(body.apiUrl,body.token); return pairBridgeResponse(res,await connectionStatus()); }
    if (req.method === 'POST' && req.url === '/pair') { await establishPairing(body.apiUrl,body.token); return res.end(JSON.stringify(await connectionStatus())); }
    if (req.method === 'POST' && req.url === '/disconnect') { if(paired)await apiPost({action:'disconnectFacebookWorker'}).catch(()=>{}); paired = null; pairingStore.forget(); running = false; activeJobId = ''; clearInterval(timer); clearInterval(heartbeatTimer); timer = null; heartbeatTimer = null; browserAutoRecoveryEnabled = false; intentionalBrowserClose = true; if (context) await context.close(); context = null; page = null; recoveryBackoff.success(); return res.end(JSON.stringify(publicStatus('DISCONNECTED'))); }
    res.writeHead(404); return res.end(JSON.stringify({ ok: false, error: 'NOT_FOUND' }));
  } catch (error) { lastError = String(error && error.message || error).slice(0, 300); res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: lastError })); }
});

server.listen(PORT, HOST, () => {
  console.log(`Facebook worker ready at http://${HOST}:${PORT}`);
  if (paired) schedule();
  healthTimer = setInterval(() => maintainBrowser(), 15000);
  maintainBrowser();
});
server.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE') console.error(`[ERROR] Port ${PORT} is already in use. Close the other Worker or program, then try again.`);
  else console.error(`[ERROR] Facebook Worker could not start: ${String(error && error.message || error)}`);
  process.exitCode = 1;
});
async function shutdown() { clearInterval(timer); clearInterval(healthTimer); clearInterval(heartbeatTimer); intentionalBrowserClose = true; if (context) await context.close().catch(() => {}); process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
