'use strict';

const crypto = require('crypto');

const FACEBOOK_HOME = 'https://www.facebook.com/';
const LOGIN_PATHS = ['/login', '/checkpoint', '/recover'];
const COMMENT_LABELS = [
  /write a comment/i,
  /comment as/i,
  /เขียนความคิดเห็น/i,
  /แสดงความคิดเห็น/i,
  /ความคิดเห็น/i,
  /เขียนความคิดเห็น/i,
  /แสดงความคิดเห็น/i,
];

function classifyFacebookUrl(value) {
  const url = new URL(value || FACEBOOK_HOME, FACEBOOK_HOME);
  if (url.hostname !== 'www.facebook.com' && url.hostname !== 'facebook.com') return 'INVALID';
  if (LOGIN_PATHS.some((part) => url.pathname.startsWith(part))) return url.pathname.startsWith('/checkpoint') ? 'CHECKPOINT' : 'LOGIN_REQUIRED';
  return 'CONNECTED';
}

function stableReference(value) {
  return `UNVERIFIED-${crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 20)}`;
}

function selectNewVerifiedReference(beforeReferences, afterReferences) {
  const before = new Set((beforeReferences || []).filter(Boolean));
  const fresh = (afterReferences || []).filter((reference) => reference && !before.has(reference));
  return fresh.find((reference) => {
    try {
      const url = new URL(reference, FACEBOOK_HOME);
      const commentId = decodeURIComponent(url.searchParams.get('comment_id') || url.searchParams.get('reply_comment_id') || '');
      return commentId && !commentId.startsWith('client:') && /\/(?:groups\/[^/]+\/(?:posts|permalink)|posts)\//i.test(url.pathname);
    } catch { return false; }
  }) || '';
}

class FacebookPageAdapter {
  constructor(page) { this.page = page; }

  async connectionState() {
    const state = classifyFacebookUrl(this.page.url());
    if (state !== 'CONNECTED') return state;
    const loginForm = await this.page.locator('input[name="email"], input[name="pass"]').count();
    return loginForm ? 'LOGIN_REQUIRED' : 'CONNECTED';
  }

  async openPost(postUrl) {
    const url = new URL(String(postUrl || ''));
    if (!/^(?:www\.|m\.|web\.)?facebook\.com$/i.test(url.hostname) || url.protocol !== 'https:') throw Error('INVALID_POST_URL');
    await this.page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const state = await this.connectionState();
    if (state !== 'CONNECTED') throw Error(state);
    await this.page.waitForTimeout(1200);
  }

  async findCommentInput() {
    const candidates = this.page.locator('div[contenteditable="true"][role="textbox"], textarea');
    const count = await candidates.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      const label = `${await candidate.getAttribute('aria-label') || ''} ${await candidate.getAttribute('placeholder') || ''}`;
      if (COMMENT_LABELS.some((pattern) => pattern.test(label)) && await candidate.isVisible()) return candidate;
    }
    throw Error('COMMENT_INPUT_NOT_FOUND');
  }

  async exactCommentCount(message) {
    return this.page.locator('[role="article"]').filter({ hasText: String(message) }).evaluateAll((nodes, expected) => nodes.filter((node) => node.innerText.trim() === expected || node.innerText.split('\n').some((line) => line.trim() === expected)).length, String(message));
  }

  async exactCommentReferences(message) {
    return this.page.locator('[role="article"]').filter({ hasText: String(message) }).evaluateAll((nodes, expected) => nodes
      .filter((node) => node.innerText.trim() === expected || node.innerText.split('\n').some((line) => line.trim() === expected))
      .flatMap((node) => Array.from(node.querySelectorAll('a[href*="comment_id="], a[href*="reply_comment_id="]')).map((link) => link.href))
      .filter(Boolean), String(message));
  }

  async submitComment(message) {
    const text = String(message || '').trim();
    if (!text) throw Error('EMPTY_COMMENT');
    const before = await this.exactCommentCount(text);
    const beforeReferences = await this.exactCommentReferences(text);
    const input = await this.findCommentInput();
    await input.click();
    await input.fill(text);
    await input.press('Enter');
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      await this.page.waitForTimeout(500);
      const after = await this.exactCommentCount(text);
      if (after > before) {
        const referenceDeadline = Date.now() + 5000;
        let href = '';
        while (!href && Date.now() < referenceDeadline) {
          const afterReferences = await this.exactCommentReferences(text);
          href = selectNewVerifiedReference(beforeReferences, afterReferences);
          if (!href) await this.page.waitForTimeout(500);
        }
        return { ok: true, externalCommentId: href || stableReference(`${this.page.url()}|${text}|${Date.now()}`), verifiedReference: Boolean(href) };
      }
    }
    throw Error('COMMENT_SUBMIT_TIMEOUT');
  }

  async deleteOwnedComment(reference) {
    const value = String(reference || '');
    if (!value || value.startsWith('UNVERIFIED-')) return { ok: false, code: 'OWNERSHIP_NOT_VERIFIABLE' };
    const url = new URL(value, FACEBOOK_HOME);
    const commentId = url.searchParams.get('comment_id') || url.searchParams.get('reply_comment_id');
    if (!commentId) return { ok: false, code: 'OWNERSHIP_NOT_VERIFIABLE' };
    await this.page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const state = await this.connectionState();
    if (state !== 'CONNECTED') throw Error(state);
    await this.page.waitForTimeout(1200);
    const links = this.page.locator('a[href*="comment_id="], a[href*="reply_comment_id="]');
    let link = null;
    for (let index = 0; index < await links.count(); index += 1) {
      const candidate = links.nth(index);
      const href = await candidate.getAttribute('href');
      try { const candidateUrl = new URL(href, FACEBOOK_HOME); if ((candidateUrl.searchParams.get('comment_id') || candidateUrl.searchParams.get('reply_comment_id')) === commentId) { link = candidate; break; } } catch {}
    }
    if (!link) return { ok: false, code: 'OWNED_COMMENT_NOT_FOUND' };
    const article = link.locator('xpath=ancestor::*[@role="article"][1]');
    const menu = article.getByRole('button', { name: /actions|menu|การดำเนินการ|ตัวเลือก|แก้ไข\s*หรือ\s*ลบ|ลบนี้/i }).last();
    if (!await menu.count()) return { ok: false, code: 'DELETE_MENU_NOT_FOUND' };
    await menu.click();
    const remove = this.page.getByRole('button', { name: /^(?:delete|ลบ)$/i }).last();
    try { await remove.waitFor({ state: 'visible', timeout: 5000 }); } catch { return { ok: false, code: 'DELETE_ACTION_NOT_FOUND' }; }
    await remove.click();
    const confirm = this.page.getByRole('button', { name: /delete|ลบ/i }).last();
    try { await confirm.waitFor({ state: 'visible', timeout: 5000 }); await confirm.click(); } catch {}
    return { ok: true, code: 'DELETED' };
  }
}

module.exports = { FACEBOOK_HOME, COMMENT_LABELS, FacebookPageAdapter, classifyFacebookUrl, selectNewVerifiedReference, stableReference };
