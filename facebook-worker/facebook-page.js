'use strict';

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

function verifiedCommentKey(reference) {
  try {
    const url = new URL(reference, FACEBOOK_HOME);
    const commentId = url.searchParams.get('comment_id') || url.searchParams.get('reply_comment_id') || '';
    const facebookHost = /^(?:www\.|m\.|web\.)?facebook\.com$/i.test(url.hostname);
    const postPath = /\/(?:groups\/[^/]+\/(?:posts|permalink)|posts)\//i.test(url.pathname);
    return facebookHost && postPath && commentId && !commentId.startsWith('client:') ? commentId : '';
  } catch { return ''; }
}

function commentKey(value) {
  const text = String(value || '');
  if (/^\d+$/.test(text)) return text;
  return verifiedCommentKey(text);
}

function selectNewVerifiedReference(beforeReferences, afterReferences) {
  const before = new Set((beforeReferences || []).map(verifiedCommentKey).filter(Boolean));
  return (afterReferences || []).find((reference) => {
    const key = verifiedCommentKey(reference);
    return key && !before.has(key);
  }) || '';
}

function buildCommentReference(postUrl, id) {
  const key = commentKey(id);
  if (!key) return '';
  const url = new URL(String(postUrl || ''), FACEBOOK_HOME);
  url.search = '';
  url.hash = '';
  url.searchParams.set('comment_id', key);
  return url.href;
}

function graphqlCommentIds(value, expectedText) {
  const found = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return false;
    let containsText = false;
    Object.entries(node).forEach(([key, child]) => {
      if ((key === 'text' || key === 'message') && typeof child === 'string' && child.trim() === expectedText) containsText = true;
      if (walk(child)) containsText = true;
    });
    if (containsText) {
      Object.entries(node).forEach(([key, child]) => {
        if (typeof child !== 'string' && typeof child !== 'number') return;
        if ((/comment.*id/i.test(key) || key === 'legacy_fbid') && /^\d{5,}$/.test(String(child))) found.add(String(child));
      });
    }
    return containsText;
  };
  walk(value);
  return [...found];
}

function requireVerifiedCommentReference(reference) {
  if (!verifiedCommentKey(reference)) throw Error('COMMENT_REFERENCE_UNVERIFIED_NEEDS_REVIEW');
  return reference;
}

class FacebookPageAdapter {
  constructor(page) { this.page = page; }

  async connectionState() {
    const state = classifyFacebookUrl(this.page.url());
    if (state !== 'CONNECTED') return state;
    const loginForm = await this.page.locator('input[name="email"], input[name="pass"]').count();
    return loginForm ? 'LOGIN_REQUIRED' : 'CONNECTED';
  }

  async accountIdentity(context) {
    const state = await this.connectionState();
    if (state !== 'CONNECTED') return { state, name: '', identifier: '' };
    const identityPage = await context.newPage();
    try {
      await identityPage.goto(`${FACEBOOK_HOME}me`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      const identityState = classifyFacebookUrl(identityPage.url());
      if (identityState !== 'CONNECTED') return { state: identityState, name: '', identifier: '' };
      await identityPage.waitForTimeout(1500);
      const heading = String(await identityPage.locator('main h1, [role="main"] h1, h1').first().textContent({ timeout: 8000 }).catch(() => '') || '').trim();
      const metaTitle = String(await identityPage.locator('meta[property="og:title"]').getAttribute('content').catch(() => '') || '').trim();
      const documentTitle = String(await identityPage.title().catch(() => '') || '').replace(/\s*[|·-]\s*Facebook\s*$/i, '').trim();
      const name = heading || metaTitle || (/^facebook$/i.test(documentTitle) ? '' : documentTitle);
      const currentUrl = new URL(identityPage.url());
      const identifier = currentUrl.searchParams.get('id') || currentUrl.pathname.split('/').filter(Boolean)[0] || '';
      return { state: 'CONNECTED', name: name.slice(0, 160), identifier: String(identifier).slice(0, 160) };
    } finally { await identityPage.close().catch(() => {}); }
  }

  async openPost(postUrl) {
    const url = new URL(String(postUrl || ''));
    if (!/^(?:www\.|m\.|web\.)?facebook\.com$/i.test(url.hostname) || url.protocol !== 'https:') throw Error('INVALID_POST_URL');
    await this.page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const state = await this.connectionState();
    if (state !== 'CONNECTED') throw Error(state);
    await this.page.waitForTimeout(1200);
  }

  async findCommentInput(timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    do {
      const candidates = this.page.locator('div[contenteditable="true"][role="textbox"], div[contenteditable="true"][data-lexical-editor="true"], textarea');
      const count = await candidates.count();
      const visible = [];
      for (let index = 0; index < count; index += 1) {
        const candidate = candidates.nth(index);
        if (!await candidate.isVisible()) continue;
        visible.push(candidate);
        const label = `${await candidate.getAttribute('aria-label') || ''} ${await candidate.getAttribute('placeholder') || ''}`;
        if (COMMENT_LABELS.some((pattern) => pattern.test(label))) return candidate;
      }
      if (visible.length === 1 && /\/(?:groups\/[^/]+\/(?:posts|permalink)|posts)\//i.test(new URL(this.page.url()).pathname)) return visible[0];
      if (Date.now() < deadline) await this.page.waitForTimeout(500);
    } while (Date.now() < deadline);
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

  async submitComment(message, options = {}) {
    const text = String(message || '').trim();
    if (!text) throw Error('EMPTY_COMMENT');
    const knownKeys = new Set((options.knownCommentIds || []).map(commentKey).filter(Boolean));
    const before = await this.exactCommentCount(text);
    const beforeReferences = await this.exactCommentReferences(text);
    beforeReferences.map(commentKey).filter(Boolean).forEach((key) => knownKeys.add(key));
    const input = await this.findCommentInput();
    await input.click();
    await input.fill(text);
    if (typeof options.beforeSubmit === 'function') await options.beforeSubmit();
    const graphqlIds = new Set();
    const onResponse = async (response) => {
      try {
        if (!/facebook\.com\/api\/graphql/i.test(response.url()) || response.request().method() !== 'POST' || response.status() >= 400) return;
        const raw = await response.text();
        const payload = JSON.parse(raw.replace(/^for\s*\(;;\);\s*/, ''));
        graphqlCommentIds(payload, text).forEach((id) => { if (!knownKeys.has(id)) graphqlIds.add(id); });
      } catch {}
    };
    this.page.on('response', onResponse);
    await input.press('Enter');
    const deadline = Date.now() + 20000;
    try {
      while (Date.now() < deadline) {
        await this.page.waitForTimeout(500);
        if (graphqlIds.size === 1) {
          const href = buildCommentReference(this.page.url(), [...graphqlIds][0]);
          return { ok: true, externalCommentId: requireVerifiedCommentReference(href), verifiedReference: true, verificationMethod: 'GRAPHQL_RESPONSE' };
        }
        const after = await this.exactCommentCount(text);
        if (after > before) {
          const candidates = [this.page.url(), ...(await this.exactCommentReferences(text))]
            .filter((reference) => { const key = commentKey(reference); return key && !knownKeys.has(key); });
          const unique = [...new Map(candidates.map((reference) => [commentKey(reference), reference])).values()];
          if (unique.length === 1) return { ok: true, externalCommentId: requireVerifiedCommentReference(unique[0]), verifiedReference: true, verificationMethod: 'DOM_NEW_UNIQUE' };
          if (unique.length > 1) throw Error('COMMENT_REFERENCE_AMBIGUOUS_NEEDS_REVIEW');
        }
      }
    } finally {
      this.page.off('response', onResponse);
    }
    throw Error('COMMENT_SUBMIT_TIMEOUT_NEEDS_REVIEW');
  }

  async visibleAction(scopes, roles, name, timeoutMs = 7000) {
    const deadline = Date.now() + timeoutMs;
    do {
      for (const scope of scopes) {
        for (const role of roles) {
          const candidates = scope.getByRole(role, { name });
          const count = await candidates.count().catch(() => 0);
          for (let index = count - 1; index >= 0; index -= 1) {
            const candidate = candidates.nth(index);
            if (await candidate.isVisible().catch(() => false)) return candidate;
          }
        }
      }
      if (Date.now() < deadline) await this.page.waitForTimeout(250);
    } while (Date.now() < deadline);
    return null;
  }

  async commentLink(commentId) {
    const links = this.page.locator('a[href*="comment_id="], a[href*="reply_comment_id="]');
    for (let index = 0; index < await links.count(); index += 1) {
      const candidate = links.nth(index);
      const href = await candidate.getAttribute('href');
      try {
        const candidateUrl = new URL(href, FACEBOOK_HOME);
        if ((candidateUrl.searchParams.get('comment_id') || candidateUrl.searchParams.get('reply_comment_id')) === commentId) return candidate;
      } catch {}
    }
    return null;
  }

  async deleteOwnedComment(reference, expectedMessage = '') {
    const value = String(reference || '');
    if (!value || value.startsWith('UNVERIFIED-')) return { ok: false, code: 'OWNERSHIP_NOT_VERIFIABLE' };
    const url = new URL(value, FACEBOOK_HOME);
    const commentId = url.searchParams.get('comment_id') || url.searchParams.get('reply_comment_id');
    if (!commentId) return { ok: false, code: 'OWNERSHIP_NOT_VERIFIABLE' };
    await this.page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const state = await this.connectionState();
    if (state !== 'CONNECTED') throw Error(state);
    await this.page.waitForTimeout(1800);
    const link = await this.commentLink(commentId);
    let article = link ? link.locator('xpath=ancestor::*[@role="article"][1]') : null;
    if ((!article || !await article.count()) && commentKey(this.page.url()) === commentId && expectedMessage) {
      const exact = this.page.locator('[role="article"]').filter({ hasText: String(expectedMessage) });
      const matches = [];
      for (let index = 0; index < await exact.count(); index += 1) {
        const candidate = exact.nth(index);
        const text = String(await candidate.innerText().catch(() => '') || '');
        if (text.split('\n').some((line) => line.trim() === String(expectedMessage).trim())) matches.push(candidate);
      }
      if (matches.length === 1) article = matches[0];
    }
    if (!article) return { ok: true, code: 'ALREADY_ABSENT' };
    if (!await article.count()) return { ok: false, code: 'OWNED_COMMENT_ARTICLE_NOT_FOUND' };
    if (expectedMessage) {
      const text = String(await article.innerText().catch(() => '') || '');
      if (!text.split('\n').some((line) => line.trim() === String(expectedMessage).trim())) return { ok: false, code: 'OWNED_COMMENT_MESSAGE_MISMATCH' };
    }
    const buttons = article.locator('button,[role="button"]');
    let menu = null;
    for (let index = await buttons.count() - 1; index >= 0; index -= 1) {
      const candidate = buttons.nth(index);
      if (!await candidate.isVisible().catch(() => false)) continue;
      const label = `${await candidate.getAttribute('aria-label') || ''} ${await candidate.getAttribute('title') || ''}`;
      const popup = String(await candidate.getAttribute('aria-haspopup') || '').toLowerCase();
      if (popup === 'menu' || /actions|menu|การดำเนินการ|ตัวเลือก|แก้ไข\s*หรือ\s*ลบ|ลบนี้|เพิ่มเติม/i.test(label)) { menu = candidate; break; }
    }
    if (!menu) return { ok: false, code: 'DELETE_MENU_NOT_FOUND' };
    await menu.click();
    const actionName = /^(?:delete|ลบ)(?:\s+(?:comment|ความคิดเห็น|รายการนี้))?$/i;
    const remove = await this.visibleAction([this.page], ['menuitem', 'button'], actionName);
    if (!remove) return { ok: false, code: 'DELETE_ACTION_NOT_FOUND' };
    await remove.click();
    const dialog = this.page.getByRole('dialog').last();
    const confirm = await this.visibleAction([dialog, this.page], ['button'], actionName);
    if (!confirm) {
      try { await article.waitFor({ state: 'detached', timeout: 3000 }); return { ok: true, code: 'DELETED' }; } catch { return { ok: false, code: 'DELETE_CONFIRM_NOT_FOUND' }; }
    }
    await confirm.click();
    try { await article.waitFor({ state: 'detached', timeout: 10000 }); return { ok: true, code: 'DELETED' }; } catch {}
    await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
    await this.page.waitForTimeout(1200);
    const found = Boolean(await this.commentLink(commentId));
    return found ? { ok: false, code: 'DELETE_NOT_CONFIRMED' } : { ok: true, code: 'DELETED' };
  }
}

module.exports = { FACEBOOK_HOME, COMMENT_LABELS, FacebookPageAdapter, buildCommentReference, classifyFacebookUrl, commentKey, graphqlCommentIds, requireVerifiedCommentReference, selectNewVerifiedReference };
