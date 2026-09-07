'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { COMMENT_LABELS, classifyFacebookUrl, selectNewVerifiedReference, stableReference } = require('./facebook-page');
const { RecoveryBackoff, isBrowserClosedError, needsReviewError } = require('./recovery');
const { acquireInstanceLock } = require('./instance-lock');
const { createPairingStore } = require('./pairing-store');

assert.equal(classifyFacebookUrl('https://www.facebook.com/'), 'CONNECTED');
assert.equal(classifyFacebookUrl('https://www.facebook.com/login/'), 'LOGIN_REQUIRED');
assert.equal(classifyFacebookUrl('https://www.facebook.com/checkpoint/123'), 'CHECKPOINT');
assert.equal(classifyFacebookUrl('https://example.com/'), 'INVALID');
assert(COMMENT_LABELS.some((pattern) => pattern.test('Write a comment')));
assert(COMMENT_LABELS.some((pattern) => pattern.test('เขียนความคิดเห็น')));
assert(stableReference('same') === stableReference('same'));
assert(stableReference('a') !== stableReference('b'));
assert(stableReference('a').startsWith('UNVERIFIED-'));
const oldComment = 'https://www.facebook.com/groups/1/posts/2/?comment_id=100';
const newComment = 'https://www.facebook.com/groups/1/posts/2/?comment_id=101';
const permalinkComment = 'https://www.facebook.com/groups/1/permalink/2/?comment_id=102';
const temporaryComment = 'https://www.facebook.com/example?comment_id=client%3Atemporary';
assert.equal(selectNewVerifiedReference([oldComment], [oldComment, newComment]), newComment);
assert.equal(selectNewVerifiedReference([oldComment], [permalinkComment]), permalinkComment);
assert.equal(selectNewVerifiedReference([oldComment], [oldComment]), '');
assert.equal(selectNewVerifiedReference([], [temporaryComment]), '');
const backoff = new RecoveryBackoff({ baseDelayMs: 100, maxDelayMs: 400 });
assert.equal(backoff.canAttempt(0), true);
assert.equal(backoff.failure(1000), 100);
assert.equal(backoff.canAttempt(1099), false);
assert.equal(backoff.canAttempt(1100), true);
assert.equal(backoff.failure(1100), 200);
assert.equal(backoff.failure(1300), 400);
assert.equal(backoff.failure(1700), 400);
backoff.success();
assert.equal(backoff.failures, 0);
assert.equal(backoff.canAttempt(0), true);
assert.equal(isBrowserClosedError(Error('browserContext.newPage: Target page, context or browser has been closed')), true);
assert.equal(needsReviewError(Error('Target closed')), 'BROWSER_CLOSED_NEEDS_REVIEW');
assert.equal(needsReviewError(Error('BACKEND_TIMEOUT'), true), 'BACKEND_TIMEOUT_AFTER_COMMENT_NEEDS_REVIEW');
const lockTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmo-worker-lock-'));
const lockTestFile = path.join(lockTestDir, 'worker.lock');
try {
  const firstLock = acquireInstanceLock(lockTestFile);
  assert.equal(fs.existsSync(lockTestFile), true);
  assert.throws(() => acquireInstanceLock(lockTestFile), /WORKER_ALREADY_RUNNING/);
  firstLock.release();
  assert.equal(fs.existsSync(lockTestFile), false);
  fs.writeFileSync(lockTestFile, JSON.stringify({ pid: 999999, token: 'stale' }), 'utf8');
  const recoveredLock = acquireInstanceLock(lockTestFile, { isProcessAlive: () => false });
  assert.equal(fs.existsSync(lockTestFile), true);
  recoveredLock.release();
  assert.equal(fs.existsSync(lockTestFile), false);
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
  assert.equal(pairingStore.load(), null);
  pairingStore.persist(firstPair);
  assert.deepEqual(createPairingStore(pairingTestFile).load(), firstPair);
  pairingStore.persist(secondPair);
  assert.deepEqual(createPairingStore(pairingTestFile).load(), secondPair);
  pairingStore.forget();
  assert.equal(pairingStore.load(), null);
} finally {
  try { fs.unlinkSync(pairingTestFile); } catch {}
  try { fs.rmdirSync(pairingTestDir); } catch {}
}
console.log('Facebook worker tests: 36/36 PASS');
