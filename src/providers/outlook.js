'use strict';

const { ConfidentialClientApplication } = require('@azure/msal-node');
const config = require('../config');

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// ── MSAL helpers ─────────────────────────────────────────────────────────────

function buildMsalApp() {
  return new ConfidentialClientApplication({
    auth: {
      clientId: config.outlook.clientId,
      clientSecret: config.outlook.clientSecret,
      authority: `https://login.microsoftonline.com/${config.outlook.tenantId}`,
    },
  });
}

function getAuthUrl(state) {
  const msalApp = buildMsalApp();
  return msalApp.getAuthCodeUrl({
    scopes: config.outlook.scopes,
    redirectUri: config.outlook.redirectUri,
    state,
  });
}

async function exchangeCode(code) {
  const msalApp = buildMsalApp();
  const result = await msalApp.acquireTokenByCode({
    code,
    scopes: config.outlook.scopes,
    redirectUri: config.outlook.redirectUri,
  });
  return {
    accessToken: result.accessToken,
    expiresOn: result.expiresOn,
    account: result.account,
  };
}

// ── Graph API fetch wrapper ───────────────────────────────────────────────────

async function graphFetch(credentials, path, options = {}) {
  const { default: nodeFetch } = await import('node-fetch').catch(() => {
    // node 18+ has native fetch
    return { default: globalThis.fetch };
  });

  const fetchFn = typeof globalThis.fetch === 'function' ? globalThis.fetch : nodeFetch;

  const url = path.startsWith('http') ? path : `${GRAPH_BASE}${path}`;
  const res = await fetchFn(url, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + credentials.accessToken,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Graph API error ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }

  if (res.status === 204) return null;
  return res.json();
}

// ── Messages ──────────────────────────────────────────────────────────────────

async function listMessages(credentials, { skip = 0, top = 20, filter = '', select } = {}) {
  const defaultSelect = 'id,conversationId,subject,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,bodyPreview,body,isRead,isDraft,parentFolderId';
  let qs = `?$top=${top}&$skip=${skip}&$select=${select || defaultSelect}`;
  if (filter) qs += `&$filter=${encodeURIComponent(filter)}`;

  const data = await graphFetch(credentials, `/me/messages${qs}`);
  return {
    messages: (data.value || []).map(normalizeMessage),
    nextLink: data['@odata.nextLink'] || null,
  };
}

async function getMessage(credentials, id) {
  const data = await graphFetch(credentials, `/me/messages/${id}`);
  return normalizeMessage(data);
}

async function listThreads(credentials, { skip = 0, top = 20 } = {}) {
  const data = await graphFetch(
    credentials,
    `/me/mailFolders/inbox/threads?$top=${top}&$skip=${skip}`
  ).catch(() =>
    // /threads endpoint may not exist on all tenants; fall back to conversations
    graphFetch(credentials, `/me/mailFolders/inbox/messages?$top=${top}&$skip=${skip}&$select=conversationId,subject`)
  );

  const items = data.value || [];
  return {
    threads: items.map((item) => ({
      id: item.id || item.conversationId,
      subject: item.subject,
      provider: 'outlook',
    })),
    nextLink: data['@odata.nextLink'] || null,
  };
}

async function getThread(credentials, id) {
  // Fetch all messages in a conversation
  const data = await graphFetch(
    credentials,
    `/me/messages?$filter=conversationId eq '${id}'&$select=id,conversationId,subject,from,toRecipients,receivedDateTime,bodyPreview,body,isRead`
  );
  return {
    id,
    messages: (data.value || []).map(normalizeMessage),
    provider: 'outlook',
  };
}

async function listFolders(credentials) {
  const data = await graphFetch(credentials, '/me/mailFolders?$top=50');
  return (data.value || []).map((f) => ({
    id: f.id,
    name: f.displayName,
    totalItemCount: f.totalItemCount,
    unreadItemCount: f.unreadItemCount,
    provider: 'outlook',
  }));
}

async function listFolderMessages(credentials, folderId, opts = {}) {
  const { skip = 0, top = 20 } = opts;
  const data = await graphFetch(credentials, `/me/mailFolders/${folderId}/messages?$top=${top}&$skip=${skip}`);
  return {
    messages: (data.value || []).map(normalizeMessage),
    nextLink: data['@odata.nextLink'] || null,
  };
}

async function sendMessage(credentials, { to, cc, bcc, subject, body, replyToMessageId } = {}) {
  const message = {
    subject: subject || '(no subject)',
    body: { contentType: 'Text', content: body || '' },
    toRecipients: parseAddresses(to),
    ccRecipients: parseAddresses(cc),
    bccRecipients: parseAddresses(bcc),
  };

  if (replyToMessageId) {
    await graphFetch(credentials, `/me/messages/${replyToMessageId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
    return { status: 'replied' };
  }

  await graphFetch(credentials, '/me/sendMail', {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
  return { status: 'sent' };
}

async function deleteMessage(credentials, id) {
  await graphFetch(credentials, `/me/messages/${id}`, { method: 'DELETE' });
  return { id, status: 'deleted' };
}

async function patchMessage(credentials, id, updates = {}) {
  const body = {};
  if (updates.isRead !== undefined) body.isRead = updates.isRead;
  if (updates.flag !== undefined) body.flag = updates.flag;
  if (updates.categories !== undefined) body.categories = updates.categories;

  const data = await graphFetch(credentials, `/me/messages/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  return normalizeMessage(data);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeMessage(raw) {
  return {
    id: raw.id,
    threadId: raw.conversationId,
    subject: raw.subject,
    from: raw.from ? raw.from.emailAddress.address : null,
    to: (raw.toRecipients || []).map((r) => r.emailAddress.address).join(', '),
    cc: (raw.ccRecipients || []).map((r) => r.emailAddress.address).join(', '),
    bcc: (raw.bccRecipients || []).map((r) => r.emailAddress.address).join(', '),
    snippet: raw.bodyPreview || '',
    internalDate: raw.receivedDateTime || null,
    isRead: raw.isRead,
    isDraft: raw.isDraft,
    body: {
      text: raw.body && raw.body.contentType === 'Text' ? raw.body.content : null,
      html: raw.body && raw.body.contentType === 'HTML' ? raw.body.content : null,
    },
    provider: 'outlook',
  };
}

function parseAddresses(str) {
  if (!str) return [];
  return str.split(',').map((addr) => ({
    emailAddress: { address: addr.trim() },
  }));
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
