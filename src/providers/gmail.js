'use strict';

const { google } = require('googleapis');
const config = require('../config');

/**
 * Build an OAuth2 client from stored credentials.
 * @param {object} credentials  { access_token, refresh_token, expiry_date }
 */
function buildClient(credentials) {
  const oauth2 = new google.auth.OAuth2(
    config.gmail.clientId,
    config.gmail.clientSecret,
    config.gmail.redirectUri
  );
  oauth2.setCredentials(credentials);
  return oauth2;
}

/** Generate the Google OAuth consent URL. */
function getAuthUrl(state) {
  const oauth2 = new google.auth.OAuth2(
    config.gmail.clientId,
    config.gmail.clientSecret,
    config.gmail.redirectUri
  );
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: config.gmail.scopes,
    state,
  });
}

/** Exchange authorization code for tokens. */
async function exchangeCode(code) {
  const oauth2 = new google.auth.OAuth2(
    config.gmail.clientId,
    config.gmail.clientSecret,
    config.gmail.redirectUri
  );
  const { tokens } = await oauth2.getToken(code);
  return tokens;
}

/** List messages — returns normalized message stubs. */
async function listMessages(credentials, { pageToken, maxResults = 20, q = '' } = {}) {
  const auth = buildClient(credentials);
  const gmail = google.gmail({ version: 'v1', auth });

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    pageToken,
    maxResults,
    q,
  });

  const items = listRes.data.messages || [];
  const messages = await Promise.all(
    items.map((m) => getMessage(credentials, m.id))
  );

  return {
    messages,
    nextPageToken: listRes.data.nextPageToken || null,
    resultSizeEstimate: listRes.data.resultSizeEstimate || 0,
  };
}

/** Fetch a single message by id. */
async function getMessage(credentials, id) {
  const auth = buildClient(credentials);
  const gmail = google.gmail({ version: 'v1', auth });

  const res = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
  return normalizeMessage(res.data);
}

/** List threads. */
async function listThreads(credentials, { pageToken, maxResults = 20, q = '' } = {}) {
  const auth = buildClient(credentials);
  const gmail = google.gmail({ version: 'v1', auth });

  const res = await gmail.users.threads.list({ userId: 'me', pageToken, maxResults, q });
  const items = res.data.threads || [];
  const threads = await Promise.all(items.map((t) => getThread(credentials, t.id)));

  return {
    threads,
    nextPageToken: res.data.nextPageToken || null,
  };
}

/** Fetch a single thread. */
async function getThread(credentials, id) {
  const auth = buildClient(credentials);
  const gmail = google.gmail({ version: 'v1', auth });

  const res = await gmail.users.threads.get({ userId: 'me', id });
  return {
    id: res.data.id,
    historyId: res.data.historyId,
    messages: (res.data.messages || []).map(normalizeMessage),
  };
}

/** List labels (folders). */
async function listFolders(credentials) {
  const auth = buildClient(credentials);
  const gmail = google.gmail({ version: 'v1', auth });

  const res = await gmail.users.labels.list({ userId: 'me' });
  return (res.data.labels || []).map((l) => ({
    id: l.id,
    name: l.name,
    type: l.type,
    messagesTotal: l.messagesTotal,
    messagesUnread: l.messagesUnread,
  }));
}

/** List messages in a folder (label). */
async function listFolderMessages(credentials, folderId, opts = {}) {
  return listMessages(credentials, { ...opts, q: `label:${folderId}` });
}

/** Send a message. */
async function sendMessage(credentials, { to, cc, bcc, subject, body, replyToMessageId } = {}) {
  const auth = buildClient(credentials);
  const gmail = google.gmail({ version: 'v1', auth });

  const raw = buildRawMessage({ to, cc, bcc, subject, body });
  const params = { userId: 'me', requestBody: { raw } };
  if (replyToMessageId) params.requestBody.threadId = replyToMessageId;

  const res = await gmail.users.messages.send(params);
  return { id: res.data.id, threadId: res.data.threadId };
}

/** Trash a message. */
async function deleteMessage(credentials, id) {
  const auth = buildClient(credentials);
  const gmail = google.gmail({ version: 'v1', auth });
  await gmail.users.messages.trash({ userId: 'me', id });
  return { id, status: 'trashed' };
}

/** Modify message labels (mark read/unread, star, etc.). */
async function patchMessage(credentials, id, { addLabelIds = [], removeLabelIds = [] } = {}) {
  const auth = buildClient(credentials);
  const gmail = google.gmail({ version: 'v1', auth });
  const res = await gmail.users.messages.modify({
    userId: 'me',
    id,
    requestBody: { addLabelIds, removeLabelIds },
  });
  return normalizeMessage(res.data);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function headerValue(headers, name) {
  const h = (headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : null;
}

function extractBody(payload) {
  if (!payload) return { text: null, html: null };

  // Single-part plain text
  if (payload.mimeType === 'text/plain' && payload.body && payload.body.data) {
    return { text: Buffer.from(payload.body.data, 'base64').toString('utf8'), html: null };
  }
  if (payload.mimeType === 'text/html' && payload.body && payload.body.data) {
    return { text: null, html: Buffer.from(payload.body.data, 'base64').toString('utf8') };
  }

  // Multipart — recurse parts
  if (payload.parts) {
    let text = null;
    let html = null;
    for (const part of payload.parts) {
      const sub = extractBody(part);
      if (!text && sub.text) text = sub.text;
      if (!html && sub.html) html = sub.html;
    }
    return { text, html };
  }

  return { text: null, html: null };
}

function normalizeMessage(raw) {
  const headers = raw.payload ? raw.payload.headers : [];
  const { text, html } = extractBody(raw.payload);
  return {
    id: raw.id,
    threadId: raw.threadId,
    labelIds: raw.labelIds || [],
    snippet: raw.snippet || '',
    internalDate: raw.internalDate ? new Date(parseInt(raw.internalDate, 10)).toISOString() : null,
    from: headerValue(headers, 'from'),
    to: headerValue(headers, 'to'),
    cc: headerValue(headers, 'cc'),
    bcc: headerValue(headers, 'bcc'),
    subject: headerValue(headers, 'subject'),
    messageId: headerValue(headers, 'message-id'),
    body: { text, html },
    provider: 'gmail',
  };
}

function buildRawMessage({ to, cc, bcc, subject, body }) {
  const lines = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    bcc ? `Bcc: ${bcc}` : null,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    `Subject: ${subject || '(no subject)'}`,
    '',
    body || '',
  ].filter((l) => l !== null);

  return Buffer.from(lines.join('\r\n')).toString('base64url');
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
