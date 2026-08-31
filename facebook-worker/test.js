'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { COMMENT_LABELS, classifyFacebookUrl, requireVerifiedCommentReference, selectNewVerifiedReference } = require('./facebook-page');
const { chromeCandidates, findChrome, nodeMajorSupported, portableProfileDir, probeWorkerPort, workerPort } = require('./portable-preflight');
const { RecoveryBackoff, isBrowserClosedError, needsReviewError } = require('./recovery');

let assertions = 0;
function check(value, message) { assertions += 1; assert(value, message); }
function equal(actual, expected, message) { assertions += 1; assert.equal(actual, expected, message); }
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
  equal(selectNewVerifiedReference([oldComment], [oldComment, newComment]), newComment);
  equal(selectNewVerifiedReference([oldComment], [permalinkComment]), permalinkComment);
  equal(selectNewVerifiedReference([oldComment], [oldComment]), '');
  equal(selectNewVerifiedReference([], [temporaryComment]), '');
  equal(requireVerifiedCommentReference(newComment), newComment);
  throws(() => requireVerifiedCommentReference(''), /COMMENT_REFERENCE_UNVERIFIED_NEEDS_REVIEW/);

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
  check(!workerSource.includes('http://127.0.0.1:4173'));
  check(!workerSource.includes('stableReference('));
  check(!/C:\\Users\\Gx/i.test(`${setup}\n${start}\n${workerSource}`));

  console.log(`Facebook worker tests: ${assertions}/${assertions} PASS`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
