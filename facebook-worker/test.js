'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { COMMENT_LABELS, buildCommentReference, classifyFacebookUrl, commentKey, graphqlCommentIds, requireVerifiedCommentReference, selectNewVerifiedReference } = require('./facebook-page');
const { chromeCandidates, findChrome, nodeMajorSupported, portableProfileDir, probeWorkerPort, workerPort } = require('./portable-preflight');
const { RecoveryBackoff, isBrowserClosedError, needsReviewError } = require('./recovery');
const { acquireInstanceLock } = require('./instance-lock');
const { createPairingStore } = require('./pairing-store');
const { LeaseKeeper } = require('./lease-keeper');
const { ResultStore } = require('./result-store');
const { PersistentTelemetry } = require('./telemetry');

let assertions = 0;
function check(value, message) { assertions += 1; assert(value, message); }
function equal(actual, expected, message) { assertions += 1; assert.equal(actual, expected, message); }
function deepEqual(actual, expected, message) { assertions += 1; assert.deepEqual(actual, expected, message); }
function throws(fn, pattern, message) { assertions += 1; assert.throws(fn, pattern, message); }

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) { return new Promise((resolve) => server.close(resolve)); }

async function main() {
  equal(classifyFacebookUrl('https://www.facebook.com/'), 'CONNECTED');
  equal(classifyFacebookUrl('https://www.facebook.com/login/'), 'LOGIN_REQUIRED');
  equal(classifyFacebookUrl('https://www.facebook.com/checkpoint/123'), 'CHECKPOINT');
  equal(classifyFacebookUrl('https://example.com/'), 'INVALID');
  check(COMMENT_LABELS.some((pattern) => pattern.test('Write a comment')));
  check(COMMENT_LABELS.some((pattern) => pattern.test('เขียนความคิดเห็น')));
  const oldComment = 'https://www.facebook.com/groups/1/posts/2/?comment_id=100';
  const newComment = 'https://www.facebook.com/groups/1/posts/2/?comment_id=101';
  const permalinkComment = 'https://www.facebook.com/groups/1/permalink/2/?comment_id=102';
  const temporaryComment = 'https://www.facebook.com/example?comment_id=client%3Atemporary';
  const sameCommentDifferentTracking = 'https://www.facebook.com/groups/1/posts/2/?comment_id=100&ref=changed';
  const nonFacebookComment = 'https://example.com/groups/1/posts/2/?comment_id=103';
  equal(selectNewVerifiedReference([oldComment], [oldComment, newComment]), newComment);
  equal(selectNewVerifiedReference([oldComment], [permalinkComment]), permalinkComment);
  equal(selectNewVerifiedReference([oldComment], [oldComment]), '');
  equal(selectNewVerifiedReference([], [temporaryComment]), '');
  equal(selectNewVerifiedReference([oldComment], [sameCommentDifferentTracking]), '');
  equal(selectNewVerifiedReference([], [nonFacebookComment]), '');
  equal(requireVerifiedCommentReference(newComment), newComment);
  throws(() => requireVerifiedCommentReference(''), /COMMENT_REFERENCE_UNVERIFIED_NEEDS_REVIEW/);
  throws(() => requireVerifiedCommentReference(nonFacebookComment), /COMMENT_REFERENCE_UNVERIFIED_NEEDS_REVIEW/);
  equal(commentKey(sameCommentDifferentTracking), '100');
  equal(buildCommentReference('https://www.facebook.com/groups/1/posts/2/?tracking=old', '10003'), 'https://www.facebook.com/groups/1/posts/2/?comment_id=10003');
  deepEqual(graphqlCommentIds({ data: { comment_create: { comment: { legacy_fbid: '10004', message: { text: '+' } } } } }, '+'), ['10004']);
  deepEqual(graphqlCommentIds({ data: { post: { legacy_fbid: '2', message: { text: 'not plus' } } } }, '+'), []);

  const backoff = new RecoveryBackoff({ baseDelayMs: 100, maxDelayMs: 400 });
  equal(backoff.canAttempt(0), true);
  equal(backoff.failure(1000), 100);
  equal(backoff.canAttempt(1099), false);
  equal(backoff.canAttempt(1100), true);
  equal(backoff.failure(1100), 200);
  equal(backoff.failure(1300), 400);
  equal(backoff.failure(1700), 400);
  backoff.success();
  equal(backoff.failures, 0);
  equal(backoff.canAttempt(0), true);
  equal(isBrowserClosedError(Error('browserContext.newPage: Target page, context or browser has been closed')), true);
  equal(needsReviewError(Error('Target closed')), 'BROWSER_CLOSED_NEEDS_REVIEW');
  equal(needsReviewError(Error('BACKEND_TIMEOUT'), true), 'BACKEND_TIMEOUT_AFTER_COMMENT_NEEDS_REVIEW');

  let renewals = 0;
  const lease = new LeaseKeeper({ intervalMs: 100000, safetyMs: 10, renew: async () => ({ leaseExpiresAt: new Date(Date.now() + 60000).toISOString(), count: ++renewals }) });
  lease.start(new Date(Date.now() + 5).toISOString());
  equal(await lease.beforeIrreversible(), true);
  equal(renewals, 1);
  lease.stop();
  const failedLease = new LeaseKeeper({ intervalMs: 100000, safetyMs: 1000, renew: async () => { throw Error('NETWORK_DOWN'); } });
  failedLease.start(new Date(Date.now() + 10).toISOString());
  let leaseBlocked = false; try { await failedLease.beforeIrreversible(); } catch (error) { leaseBlocked = /NETWORK_DOWN/.test(String(error)); }
  equal(leaseBlocked, true);
  failedLease.stop();

  equal(nodeMajorSupported('20.0.0'), true);
  equal(nodeMajorSupported('22.9.1'), true);
  equal(nodeMajorSupported('19.9.0'), false);
  equal(workerPort({}), 17821);
  equal(workerPort({ FACEBOOK_WORKER_PORT: '18000' }), 18000);
  throws(() => workerPort({ FACEBOOK_WORKER_PORT: '0' }), /INVALID_WORKER_PORT/);
  const fakeLocal = path.join('C:', 'Users', 'Second PC', 'AppData', 'Local');
  equal(portableProfileDir({ LOCALAPPDATA: fakeLocal }, path.join('C:', 'Users', 'Ignored')), path.resolve(fakeLocal, 'GUN-SHOP-DMO', 'FacebookWorkerProfile'));
  const explicitProfile = path.join('D:', 'DMO Worker Data');
  equal(portableProfileDir({ FACEBOOK_WORKER_PROFILE_DIR: explicitProfile }, 'ignored'), path.resolve(explicitProfile));
  check(!portableProfileDir({ LOCALAPPDATA: fakeLocal }, 'ignored').includes('.facebook-worker-profile'));
  const candidates = chromeCandidates({ ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: fakeLocal });
  equal(candidates.length, 3);
  equal(findChrome({ FACEBOOK_WORKER_CHROME_PATH: 'X:\\Chrome\\chrome.exe' }, (candidate) => candidate.startsWith('X:')), 'X:\\Chrome\\chrome.exe');
  equal(findChrome({}, () => false), '');

  const workerServer = http.createServer((req, res) => res.end(JSON.stringify({ worker: 'ONLINE' })));
  const workerPortNumber = await listen(workerServer);
  equal(await probeWorkerPort(workerPortNumber), 'WORKER');
  await close(workerServer);
  await new Promise((resolve) => setTimeout(resolve, 150));
  equal(await probeWorkerPort(workerPortNumber), 'FREE');
  const occupiedServer = http.createServer((req, res) => res.end('another program'));
  const occupiedPort = await listen(occupiedServer);
  equal(await probeWorkerPort(occupiedPort), 'OCCUPIED');
  await close(occupiedServer);

  const lockTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmo-worker-lock-'));
  const lockTestFile = path.join(lockTestDir, 'worker.lock');
  try {
    const firstLock = acquireInstanceLock(lockTestFile);
    equal(fs.existsSync(lockTestFile), true);
    throws(() => acquireInstanceLock(lockTestFile), /WORKER_ALREADY_RUNNING/);
    firstLock.release();
    equal(fs.existsSync(lockTestFile), false);
    fs.writeFileSync(lockTestFile, JSON.stringify({ pid: 999999, token: 'stale' }), 'utf8');
    const recoveredLock = acquireInstanceLock(lockTestFile, { isProcessAlive: () => false });
    equal(fs.existsSync(lockTestFile), true);
    recoveredLock.release();
    equal(fs.existsSync(lockTestFile), false);
  } finally {
    try { fs.unlinkSync(lockTestFile); } catch {}
    try { fs.rmdirSync(lockTestDir); } catch {}
  }

  const pairingTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmo-worker-pair-'));
  const pairingTestFile = path.join(pairingTestDir, 'worker-pair.json');
  const pairingApiUrl = 'https://script.google.com/macros/s/test-deployment/exec';
  const firstPair = { apiUrl: pairingApiUrl, token: `fbw_${'a'.repeat(64)}` };
  const secondPair = { apiUrl: pairingApiUrl, token: `fbw_${'b'.repeat(64)}` };
  try {
    const pairingStore = createPairingStore(pairingTestFile);
    equal(pairingStore.load(), null);
    pairingStore.persist(firstPair);
    deepEqual(createPairingStore(pairingTestFile).load(), firstPair);
    pairingStore.persist(secondPair);
    deepEqual(createPairingStore(pairingTestFile).load(), secondPair);
    pairingStore.forget();
    equal(pairingStore.load(), null);
  } finally {
    try { fs.unlinkSync(pairingTestFile); } catch {}
    try { fs.rmdirSync(pairingTestDir); } catch {}
  }

  const reliabilityDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmo-worker-reliability-'));
  try {
    const resultFile = path.join(reliabilityDir, 'results.json');
    const results = new ResultStore(resultFile);
    results.put('JOB-1', { state: 'SUBMITTING', leaseToken: 'lease-1' });
    equal(new ResultStore(resultFile).pending().length, 1);
    results.put('JOB-1', { state: 'COMMENT_CREATED', externalCommentId: newComment });
    equal(new ResultStore(resultFile).get('JOB-1').externalCommentId, newComment);
    results.acknowledge('JOB-1');
    equal(new ResultStore(resultFile).pending().length, 0);
    const telemetryFile = path.join(reliabilityDir, 'telemetry.jsonl');
    const persistent = new PersistentTelemetry(telemetryFile, { maxBytes: 65536 });
    persistent.append('NETWORK_TIMEOUT', { jobId: 'JOB-1', detail: 'Apps Script timeout' });
    equal(JSON.parse(fs.readFileSync(telemetryFile, 'utf8').trim()).event, 'NETWORK_TIMEOUT');
  } finally {
    for (const name of ['results.json', 'results.json.bak', 'telemetry.jsonl', 'telemetry.jsonl.1']) { try { fs.unlinkSync(path.join(reliabilityDir, name)); } catch {} }
    try { fs.rmdirSync(reliabilityDir); } catch {}
  }

  const root = path.resolve(__dirname, '..');
  const setup = fs.readFileSync(path.join(root, 'SETUP-FACEBOOK-WORKER.cmd'), 'utf8');
  const start = fs.readFileSync(path.join(root, 'START-FACEBOOK-WORKER.cmd'), 'utf8');
  const workerSource = fs.readFileSync(path.join(__dirname, 'worker.js'), 'utf8');
  check(setup.includes('cd /d "%~dp0"'));
  check(start.includes('cd /d "%~dp0"'));
  check(setup.includes('where node'));
  check(setup.includes('where npm'));
  check(setup.includes('portable-preflight.js" setup'));
  check(start.includes('portable-preflight.js" start'));
  check(start.includes('PREFLIGHT_EXIT'));
  check(!workerSource.includes("'.facebook-worker-profile'"));
  check(workerSource.includes("const path = require('path');"));
  check(workerSource.includes('acquireInstanceLock(INSTANCE_LOCK_FILE)'));
  check(workerSource.includes('pairingStore.load()'));
  check(workerSource.includes('pairingStore.persist('));
  check(workerSource.includes('reportRemoteHeartbeat()'));
  check(workerSource.includes("'https://gunzaza085-lang.github.io'") && workerSource.includes("'https://shop-dmo.github.io'"));
  check(!workerSource.includes('http://127.0.0.1:4173'));
  check(!workerSource.includes('stableReference('));
  check(!/C:\\Users\\Gx/i.test(`${setup}\n${start}\n${workerSource}`));

  console.log(`Facebook worker tests: ${assertions}/${assertions} PASS`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
