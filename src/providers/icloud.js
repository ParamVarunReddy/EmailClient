'use strict';

/**
 * Apple iCloud Mail provider — wraps the generic IMAP provider with
 * iCloud's preset server settings.
 *
 * Auth: POST /receptions/auth/icloud  { user, password }
 *   Apple requires an app-specific password for third-party mail clients.
 *   Generate one at: https://appleid.apple.com → Sign-In and Security → App-Specific Passwords
 *   Use your full iCloud email address (e.g. user@icloud.com) as the username.
 */

const imapProvider = require('./imap');

const ICLOUD_SERVERS = {
  host: 'imap.mail.me.com',
  port: 993,
  tls: true,
  smtpHost: 'smtp.mail.me.com',
  smtpPort: 587,
  smtpTls: true,
};

/** Merge preset server settings into the stored credentials. */
function _build(credentials) {
  return { ...ICLOUD_SERVERS, ...credentials };
}

/** Override provider tag on a single message or result object. */
function _tagMessage(m) {
  return m ? { ...m, provider: 'icloud' } : m;
}

function _tagMessages(result) {
  if (!result) return result;
  if (Array.isArray(result)) return result.map(_tagMessage);
  if (Array.isArray(result.messages)) {
    return { ...result, messages: result.messages.map(_tagMessage) };
  }
  return _tagMessage(result);
}

// ── Provider API ──────────────────────────────────────────────────────────────

async function listMessages(credentials, opts) {
  return _tagMessages(await imapProvider.listMessages(_build(credentials), opts));
}

async function getMessage(credentials, id, mailbox) {
  return _tagMessage(await imapProvider.getMessage(_build(credentials), id, mailbox));
}

async function listThreads(credentials, opts) {
  const result = await imapProvider.listThreads(_build(credentials), opts);
  return {
    ...result,
    threads: (result.threads || []).map((t) => ({
      ...t,
      messages: (t.messages || []).map(_tagMessage),
      provider: 'icloud',
    })),
  };
}

async function getThread(credentials, id, opts) {
  const result = await imapProvider.getThread(_build(credentials), id, opts);
  return {
    ...result,
    messages: (result.messages || []).map(_tagMessage),
    provider: 'icloud',
  };
}

async function listFolders(credentials) {
  const folders = await imapProvider.listFolders(_build(credentials));
  return folders.map((f) => ({ ...f, provider: 'icloud' }));
}

async function listFolderMessages(credentials, folder, opts) {
  return _tagMessages(await imapProvider.listFolderMessages(_build(credentials), folder, opts));
}

async function sendMessage(credentials, params) {
  return imapProvider.sendMessage(_build(credentials), params);
}

async function deleteMessage(credentials, uid, mailbox) {
  return imapProvider.deleteMessage(_build(credentials), uid, mailbox);
}

async function patchMessage(credentials, uid, updates, mailbox) {
  return imapProvider.patchMessage(_build(credentials), uid, updates, mailbox);
}

module.exports = {
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
