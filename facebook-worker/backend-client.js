'use strict';

function retryableBackendError(error) {
  return /BACKEND_TIMEOUT|BACKEND_NON_JSON|BACKEND_HTTP_5|FACEBOOK_BUSY_RETRY|fetch failed|ECONNRESET|ETIMEDOUT|UND_ERR_SOCKET/i.test(String(error && error.message || error || ''));
}

async function backendPost(apiUrl, token, payload, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = Math.max(1, Number(options.timeoutMs || 45000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...payload, token }), signal: controller.signal });
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); }
    catch { throw Error(`BACKEND_NON_JSON:${response.status}:${String(response.headers.get('content-type') || '')}:${raw.replace(/[\r\n]+/g, ' ').slice(0, 160)}`); }
    if (!response.ok) throw Error(data.error || `BACKEND_HTTP_${response.status}`);
    if (!data.ok) throw Error(data.error || 'BACKEND_REQUEST_FAILED');
    return data;
  } catch (error) {
    if (error && (error.name === 'AbortError' || error.name === 'TimeoutError')) throw Error('BACKEND_TIMEOUT');
    throw error;
  } finally { clearTimeout(timeout); }
}

async function retryBackendAction(call, options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 4));
  let error;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try { return await call(attempt + 1); }
    catch (caught) {
      error = caught;
      if (!retryableBackendError(caught) || attempt === maxAttempts - 1) break;
      const delay = Math.min(Number(options.maxDelayMs || 8000), Number(options.baseDelayMs || 1000) * (2 ** attempt));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw error;
}

module.exports = { backendPost, retryBackendAction, retryableBackendError };
