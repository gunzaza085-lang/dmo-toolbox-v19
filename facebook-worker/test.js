'use strict';

const assert = require('assert');
const { COMMENT_LABELS, classifyFacebookUrl, selectNewVerifiedReference, stableReference } = require('./facebook-page');

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
const temporaryComment = 'https://www.facebook.com/example?comment_id=client%3Atemporary';
assert.equal(selectNewVerifiedReference([oldComment], [oldComment, newComment]), newComment);
assert.equal(selectNewVerifiedReference([oldComment], [oldComment]), '');
assert.equal(selectNewVerifiedReference([], [temporaryComment]), '');
console.log('Facebook worker tests: 12/12 PASS');
