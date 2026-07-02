'use strict';

/**
 * Zoho Mail provider — OAuth 2.0 + Zoho Mail REST API.
 *
 * Auth: GET /receptions/auth/zoho  → redirect to Zoho consent screen
 *       GET /receptions/auth/zoho/callback
 *
 * Register your app at: https://api-console.zoho.com/
 * Required scopes: ZohoMail.messages.READ, ZohoMail.messages.CREATE,
 *                  ZohoMail.messages.UPDATE, ZohoMail.messages.DELETE,
 *                  ZohoMail.folders.READ
 */

const config = require('../config');

const ZOHO_AUTH_BASE = 'https://accounts.zoho.com/oauth/v2';
const ZOHO_API_BASE = 'https://mail.zoho.com/api';

// Cache the fetch implementation at module load to avoid repeated dynamic
// imports on every API call (same pattern used by outlook.js).
let _fetchFn = typeof globalThis.fetch === 'function' ? globalThis.fetch : null;
async function _resolveFetch() {
  if (_fetchFn) return _fetchFn;
  const mod = await import('node-fetch').catch(() => null);
  _fetchFn = mod?.default ?? null;
  if (!_fetchFn) throw new Error('No fetch implementation available');
  return _fetchFn;
}

// ── OAuth 2.0 ─────────────────────────────────────────────────────────────────

/** Generate the Zoho OAuth consent URL. */
function getAuthUrl(state) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.zoho.clientId,
    scope: config.zoho.scopes.join(' '),
    redirect_uri: config.zoho.redirectUri,
    access_type: 'offline',
    prompt: 'consent',
    state: state || '',
  });
  return `${ZOHO_AUTH_BASE}/auth?${params}`;
}

/** Exchange authorization code for tokens. */
async function exchangeCode(code) {
  const fetchFn = await _resolveFetch();
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.zoho.clientId,
    client_secret: config.zoho.clientSecret,
    redirect_uri: config.zoho.redirectUri,
    code,
  });
  const res = await fetchFn(`${ZOHO_AUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw Object.assign(new Error(`Zoho token error ${res.status}: ${text}`), { status: 502 });
  }
  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    tokenType: data.token_type,
    // Zoho returns a per-DC api_domain — use it if present.
    apiBase: data.api_domain ? `${data.api_domain}/api` : ZOHO_API_BASE,
  };
}

// ── Zoho API fetch wrapper ────────────────────────────────────────────────────

async function zohoFetch(credentials, path, options = {}) {
  const fetchFn = await _resolveFetch();
  const base = credentials.apiBase || ZOHO_API_BASE;
  const url = path.startsWith('http') ? path : `${base}${path}`;

  const res = await fetchFn(url, {
    ...options,
    headers: {
      Authorization: 'Zoho-oauthtoken ' + credentials.accessToken,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Zoho API error ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;

  const json = await res.json();
  // Zoho wraps responses in { status: { code, description }, data: ... }
  if (json.status && json.status.code !== 200 && json.status.code !== 201) {
    throw Object.assign(
      new Error(`Zoho API: ${json.status.description}`),
      { status: json.status.code }
    );
  }
  return json.data !== undefined ? json.data : json;
}

// ── Account ID resolution ─────────────────────────────────────────────────────

/**
 * Resolve the Zoho account ID.  Fetched once and cached in the credentials
 * object (which lives in the session), so subsequent calls are free.
 */
async function _getAccountId(credentials) {
  if (credentials.accountId) return credentials.accountId;
  const data = await zohoFetch(credentials, '/accounts');
  const accountId = Array.isArray(data) ? data[0]?.accountId : data?.accountId;
  if (!accountId) {
    throw Object.assign(new Error('Could not resolve Zoho accountId'), { status: 502 });
  }
  credentials.accountId = accountId;
  if (Array.isArray(data) && data[0]?.emailAddress) {
    credentials.userEmail = data[0].emailAddress;
  }
  return accountId;
}

// ── Messages ──────────────────────────────────────────────────────────────────

async function listMessages(credentials, { skip = 0, top = 20, folderId = '' } = {}) {
  const accountId = await _getAccountId(credentials);
  let qs = `?start=${skip}&limit=${top}`;
  if (folderId) qs += `&folderId=${encodeURIComponent(folderId)}`;

  const items = await zohoFetch(credentials, `/accounts/${accountId}/messages/view${qs}`);
  return {
    messages: (Array.isArray(items) ? items : []).map(normalizeMessage),
    nextSkip: skip + top,
  };
}

async function getMessage(credentials, id, folderId) {
  const accountId = await _getAccountId(credentials);
  const qs = folderId ? `?folderId=${encodeURIComponent(folderId)}` : '';
  const item = await zohoFetch(credentials, `/accounts/${accountId}/messages/${id}${qs}`);
  return normalizeMessage(Array.isArray(item) ? item[0] : item);
}

// ── Threads ───────────────────────────────────────────────────────────────────

async function listThreads(credentials, { skip = 0, top = 20, folderId = '' } = {}) {
  const accountId = await _getAccountId(credentials);
  let qs = `?start=${skip}&limit=${top}`;
  if (folderId) qs += `&folderId=${encodeURIComponent(folderId)}`;

  const items = await zohoFetch(credentials, `/accounts/${accountId}/messages/view${qs}`);
  const byConv = {};
  for (const raw of (Array.isArray(items) ? items : [])) {
    const key = raw.conversationId || raw.messageId;
    if (!byConv[key]) {
      byConv[key] = { id: key, subject: raw.subject, messages: [], provider: 'zoho' };
    }
    byConv[key].messages.push(normalizeMessage(raw));
  }
  return { threads: Object.values(byConv), nextSkip: skip + top };
}

async function getThread(credentials, id, opts = {}) {
  const accountId = await _getAccountId(credentials);
  const folderId = opts.folderId || '';
  let qs = `?conversationId=${encodeURIComponent(id)}`;
  if (folderId) qs += `&folderId=${encodeURIComponent(folderId)}`;

  const items = await zohoFetch(
    credentials,
    `/accounts/${accountId}/messages/view${qs}`
  ).catch(() => []);

  return {
    id,
    messages: (Array.isArray(items) ? items : []).map(normalizeMessage),
    provider: 'zoho',
  };
}

// ── Folders ───────────────────────────────────────────────────────────────────

async function listFolders(credentials) {
  const accountId = await _getAccountId(credentials);
  const items = await zohoFetch(credentials, `/accounts/${accountId}/folders`);
  return (Array.isArray(items) ? items : []).map((f) => ({
    id: f.folderId,
    name: f.folderName,
    path: f.folderPath || f.folderName,
    totalCount: f.messageCount,
    unreadCount: f.unreadCount,
    provider: 'zoho',
  }));
}

async function listFolderMessages(credentials, folderId, opts = {}) {
  return listMessages(credentials, { ...opts, folderId });
}

// ── Send ──────────────────────────────────────────────────────────────────────

async function sendMessage(credentials, { to, cc, bcc, subject, body, replyToMessageId } = {}) {
  const accountId = await _getAccountId(credentials);
  const payload = {
    fromAddress: credentials.userEmail || '',
    toAddress: to || '',
    ccAddress: cc || '',
    bccAddress: bcc || '',
    subject: subject || '(no subject)',
    content: body || '',
    mailFormat: 'plaintext',
  };
  if (replyToMessageId) payload.inReplyTo = replyToMessageId;

  await zohoFetch(credentials, `/accounts/${accountId}/messages`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return { status: 'sent' };
}

// ── Delete ────────────────────────────────────────────────────────────────────

async function deleteMessage(credentials, id) {
  const accountId = await _getAccountId(credentials);
  // Move to trash via updatemessage — does not require folderId.
  await zohoFetch(credentials, `/accounts/${accountId}/updatemessage`, {
    method: 'POST',
    body: JSON.stringify({ mode: 'trash', messageId: [id] }),
  });
  return { id, status: 'trashed' };
}

// ── Patch ─────────────────────────────────────────────────────────────────────

async function patchMessage(credentials, id, updates = {}) {
  const accountId = await _getAccountId(credentials);
  let mode;
  if (updates.isRead !== undefined) {
    mode = updates.isRead ? 'markAsRead' : 'markAsUnread';
  } else if (updates.flag !== undefined) {
    mode = updates.flag ? 'flag' : 'unflag';
  }
  if (!mode) return { id, status: 'no-op' };

  const payload = { mode, messageId: [id] };
  if (updates.folderId || updates.mailbox) {
    payload.folderId = updates.folderId || updates.mailbox;
  }

  await zohoFetch(credentials, `/accounts/${accountId}/updatemessage`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return { id, status: 'patched', mode };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeMessage(raw) {
  if (!raw) return null;
  return {
    id: raw.messageId,
    threadId: raw.conversationId || null,
    folderId: raw.folderId || null,
    subject: raw.subject || null,
    from: raw.fromAddress || null,
    to: raw.toAddress || null,
    cc: raw.ccAddress || null,
    bcc: raw.bccAddress || null,
    snippet: raw.summary || '',
    internalDate: raw.receivedTime
      ? new Date(parseInt(raw.receivedTime, 10)).toISOString()
      : null,
    isRead: raw.isRead === 'true' || raw.isRead === true,
    hasAttachment: raw.hasAttachment === 'true' || raw.hasAttachment === true,
    body: {
      text: raw.contentType === 'text' ? (raw.content || null) : null,
      html: raw.contentType === 'html' ? (raw.content || null) : null,
    },
    provider: 'zoho',
  };
}

module.exports = {
  getAuthUrl,
  exchangeCode,
  listMessages,
  getMessage,
  listThreads,
  getThread,
  listFolders,
  listFolderMessages,
  sendMessage,
  deleteMessage,
  patchMessage,
};
