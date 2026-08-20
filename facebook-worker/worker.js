'use strict';

const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');
const { FACEBOOK_HOME, FacebookPageAdapter, classifyFacebookUrl } = require('./facebook-page');

const HOST = '127.0.0.1';
const PORT = Number(process.env.FACEBOOK_WORKER_PORT || 17821);
const PROFILE_DIR = path.resolve(__dirname, '..', '.facebook-worker-profile');
const ALLOWED_ORIGINS = new Set((process.env.WORKER_ALLOWED_ORIGINS || 'https://gunzaza085-lang.github.io,http://127.0.0.1:4173,http://127.0.0.1:4175').split(',').map((item) => item.trim()).filter(Boolean));

let context = null;
let page = null;
let paired = null;
let running = false;
let lastError = '';
let timer = null;

function publicStatus(connection = 'DISCONNECTED') {
  return { ok: true, connection, paired: Boolean(paired), running, lastError };
}

async function ensureBrowser() {
  if (!context) context = await chromium.launchPersistentContext(PROFILE_DIR, { channel: 'chrome', headless: false, viewport: null, args: ['--start-maximized'] });
  page = page && !page.isClosed() ? page : context.pages()[0] || await context.newPage();
  await page.bringToFront();
  return new FacebookPageAdapter(page);
}

async function openFacebookPage(targetUrl) {
  const adapter = await ensureBrowser();
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
  const response = await fetch(paired.apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...payload, token: paired.token }) });
  const data = await response.json();
  if (!data.ok) throw Error(data.error || 'BACKEND_REQUEST_FAILED');
  return data;
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
  const adapter = await ensureBrowser();
  const connection = await adapter.connectionState();
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
      const code = String(error && error.message || error).slice(0, 300);
      lastError = code;
      await finishJob('failFacebookBumpJob', { jobId: job.jobId, error: code });
    }
  } finally { running = false; }
}

function schedule() {
  clearInterval(timer);
  timer = setInterval(() => processOnce().catch((error) => { lastError = String(error && error.message || error).slice(0, 300); }), 15000);
}

function cors(req, res) {
  const origin = req.headers.origin || '';
  if (origin && !ALLOWED_ORIGINS.has(origin)) return false;
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => { let body = ''; req.on('data', (chunk) => { body += chunk; if (body.length > 200000) reject(Error('REQUEST_TOO_LARGE')); }); req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(Error('INVALID_JSON')); } }); req.on('error', reject); });
}

const server = http.createServer(async (req, res) => {
  if (!cors(req, res)) { res.writeHead(403); return res.end(JSON.stringify({ ok: false, error: 'ORIGIN_NOT_ALLOWED' })); }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  res.setHeader('Content-Type', 'application/json;charset=utf-8');
  try {
    if (req.method === 'GET' && req.url === '/status') return res.end(JSON.stringify(await connectionStatus()));
    const body = await readBody(req);
    if (req.method === 'POST' && req.url === '/connect') return res.end(JSON.stringify(await openFacebookPage(FACEBOOK_HOME)));
    if (req.method === 'POST' && req.url === '/test') return res.end(JSON.stringify(await connectionStatus()));
    if (req.method === 'POST' && req.url === '/open') return res.end(JSON.stringify(await openFacebookPage(body.url || FACEBOOK_HOME)));
    if (req.method === 'POST' && req.url === '/pair') { if (!/^https:\/\/script\.google\.com\/macros\/s\//.test(String(body.apiUrl || '')) || !body.token) throw Error('INVALID_PAIRING'); paired = { apiUrl: String(body.apiUrl), token: String(body.token) }; schedule(); return res.end(JSON.stringify(await connectionStatus())); }
    if (req.method === 'POST' && req.url === '/disconnect') { paired = null; running = false; clearInterval(timer); timer = null; if (context) await context.close(); context = null; page = null; return res.end(JSON.stringify(publicStatus('DISCONNECTED'))); }
    res.writeHead(404); return res.end(JSON.stringify({ ok: false, error: 'NOT_FOUND' }));
  } catch (error) { lastError = String(error && error.message || error).slice(0, 300); res.writeHead(400); return res.end(JSON.stringify({ ok: false, error: lastError })); }
});

server.listen(PORT, HOST, () => { console.log(`Facebook worker ready at http://${HOST}:${PORT}`); });
process.on('SIGINT', async () => { if (context) await context.close(); process.exit(0); });
