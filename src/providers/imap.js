'use strict';

const Imap = require('node-imap');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');

/**
 * Open an IMAP connection and resolve when ready.
 * credentials: { user, password, host, port, tls }
 */
function openImap(credentials) {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: credentials.user,
      password: credentials.password,
      host: credentials.host,
      port: credentials.port || 993,
      tls: credentials.tls !== false,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 10000,
      authTimeout: 5000,
    });

    imap.once('ready', () => resolve(imap));
    imap.once('error', reject);
    imap.connect();
  });
}

/** Fetch messages from a mailbox. */
async function listMessages(credentials, { mailbox = 'INBOX', limit = 20, offset = 0 } = {}) {
  const imap = await openImap(credentials);
  return new Promise((resolve, reject) => {
    imap.openBox(mailbox, true, (err, box) => {
      if (err) { imap.end(); return reject(err); }

      const total = box.messages.total;
      if (total === 0) { imap.end(); return resolve({ messages: [], total: 0 }); }

      const end = Math.max(1, total - offset);
      const start = Math.max(1, end - limit + 1);
      const range = `${start}:${end}`;

      const messages = [];
      const fetch = imap.seq.fetch(range, {
        bodies: ['HEADER.FIELDS (FROM TO CC BCC SUBJECT DATE MESSAGE-ID)', 'TEXT'],
        struct: true,
      });

      fetch.on('message', (msg, seqno) => {
        const parsed = { seqno, headers: null, text: null };

        msg.on('body', (stream, info) => {
          let buf = '';
          stream.on('data', (chunk) => { buf += chunk.toString('utf8'); });
          stream.once('end', () => {
            if (info.which.startsWith('HEADER')) parsed.headers = Imap.parseHeader(buf);
            else parsed.text = buf;
          });
        });

        msg.once('attributes', (attrs) => { parsed.attrs = attrs; });
        msg.once('end', () => messages.push(parsed));
      });

      fetch.once('error', (fetchErr) => { imap.end(); reject(fetchErr); });
      fetch.once('end', () => {
        imap.end();
        resolve({
          messages: messages.reverse().map((m) => normalizeImapMessage(m, mailbox)),
          total,
        });
      });
    });
  });
}

/** Fetch a single message by UID. */
async function getMessage(credentials, uid, mailbox = 'INBOX') {
  const imap = await openImap(credentials);
  return new Promise((resolve, reject) => {
    imap.openBox(mailbox, true, (err) => {
      if (err) { imap.end(); return reject(err); }

      const fetch = imap.fetch(String(uid), { bodies: '' });
      const parts = [];

      fetch.on('message', (msg) => {
        let buf = '';
        msg.on('body', (stream) => stream.on('data', (c) => { buf += c; }));
        msg.once('attributes', (attrs) => { parts.push({ buf, attrs }); });
      });

      fetch.once('error', (e) => { imap.end(); reject(e); });
      fetch.once('end', async () => {
        imap.end();
        if (!parts.length) return reject(Object.assign(new Error('Message not found'), { status: 404 }));
        try {
          const parsed = await simpleParser(parts[0].buf);
          resolve(normalizeMailparserMessage(parsed, parts[0].attrs, mailbox));
        } catch (e) { reject(e); }
      });
    });
  });
}

/** List mailbox folders. */
async function listFolders(credentials) {
  const imap = await openImap(credentials);
  return new Promise((resolve, reject) => {
    imap.getBoxes((err, boxes) => {
      imap.end();
      if (err) return reject(err);
      resolve(flattenBoxes(boxes, ''));
    });
  });
}

/** List messages in a folder. */
async function listFolderMessages(credentials, folder, opts = {}) {
  return listMessages(credentials, { ...opts, mailbox: folder });
}

/** Get threads — IMAP has no native thread concept; group by subject. */
async function listThreads(credentials, opts = {}) {
  const result = await listMessages(credentials, opts);
  const bySubject = {};
  for (const m of result.messages) {
    const key = (m.subject || '').replace(/^(re|fwd?):\s*/i, '').trim().toLowerCase();
    if (!bySubject[key]) bySubject[key] = { id: key, subject: m.subject, messages: [] };
    bySubject[key].messages.push(m);
  }
  return { threads: Object.values(bySubject), total: result.total };
}

/** Get a "thread" by subject key using IMAP SEARCH to avoid fetching all messages. */
async function getThread(credentials, id, opts = {}) {
  const mailbox = opts.mailbox || 'INBOX';
  const imap = await openImap(credentials);
  return new Promise((resolve, reject) => {
    imap.openBox(mailbox, true, (err) => {
      if (err) { imap.end(); return reject(err); }

      // Use server-side SUBJECT search to avoid downloading the full mailbox.
      imap.search([['SUBJECT', id]], (searchErr, uids) => {
        if (searchErr) { imap.end(); return reject(searchErr); }
        if (!uids || uids.length === 0) {
          imap.end();
          return resolve({ id, messages: [], provider: 'imap' });
        }

        const messages = [];
        const fetch = imap.fetch(uids, {
          bodies: ['HEADER.FIELDS (FROM TO CC BCC SUBJECT DATE MESSAGE-ID)', 'TEXT'],
          struct: true,
        });

        fetch.on('message', (msg, seqno) => {
          const parsed = { seqno, headers: null, text: null };
          msg.on('body', (stream, info) => {
            let buf = '';
            stream.on('data', (chunk) => { buf += chunk.toString('utf8'); });
            stream.once('end', () => {
              if (info.which.startsWith('HEADER')) parsed.headers = Imap.parseHeader(buf);
              else parsed.text = buf;
            });
          });
          msg.once('attributes', (attrs) => { parsed.attrs = attrs; });
          msg.once('end', () => messages.push(parsed));
        });

        fetch.once('error', (fetchErr) => { imap.end(); reject(fetchErr); });
        fetch.once('end', () => {
          imap.end();
          // Filter to exact subject-key matches after fetch for precision.
          const matched = messages
            .map((m) => normalizeImapMessage(m, mailbox))
            .filter((m) => (m.subject || '').replace(/^(re|fwd?):\s*/i, '').trim().toLowerCase() === id);
          resolve({ id, messages: matched, provider: 'imap' });
        });
      });
    });
  });
}

/** Send via SMTP using the same IMAP credentials host. */
async function sendMessage(credentials, { to, cc, bcc, subject, body } = {}) {
  const transporter = nodemailer.createTransport({
    host: credentials.smtpHost || credentials.host,
    port: credentials.smtpPort || 587,
    secure: credentials.smtpTls !== false,
    auth: { user: credentials.user, pass: credentials.password },
    tls: { rejectUnauthorized: false },
  });

  const info = await transporter.sendMail({
    from: credentials.user,
    to,
    cc,
    bcc,
    subject: subject || '(no subject)',
    text: body || '',
  });

  return { messageId: info.messageId, status: 'sent' };
}

/** Mark a message as deleted (adds \\Deleted flag + expunge). */
async function deleteMessage(credentials, uid, mailbox = 'INBOX') {
  const imap = await openImap(credentials);
  return new Promise((resolve, reject) => {
    imap.openBox(mailbox, false, (err) => {
      if (err) { imap.end(); return reject(err); }
      imap.addFlags(String(uid), '\\Deleted', (flagErr) => {
        if (flagErr) { imap.end(); return reject(flagErr); }
        imap.expunge((expErr) => {
          imap.end();
          if (expErr) return reject(expErr);
          resolve({ uid, status: 'deleted' });
        });
      });
    });
  });
}

/** Patch a message — set/unset flags (e.g., \\Seen, \\Flagged). */
async function patchMessage(credentials, uid, { addFlags = [], removeFlags = [] } = {}, mailbox = 'INBOX') {
  const imap = await openImap(credentials);
  return new Promise((resolve, reject) => {
    imap.openBox(mailbox, false, (err) => {
      if (err) { imap.end(); return reject(err); }

      const doAdd = () =>
        addFlags.length
          ? new Promise((res, rej) => imap.addFlags(String(uid), addFlags, (e) => (e ? rej(e) : res())))
          : Promise.resolve();

      const doRemove = () =>
        removeFlags.length
          ? new Promise((res, rej) => imap.delFlags(String(uid), removeFlags, (e) => (e ? rej(e) : res())))
          : Promise.resolve();

      doAdd()
        .then(doRemove)
        .then(() => { imap.end(); resolve({ uid, addFlags, removeFlags, status: 'patched' }); })
        .catch((e) => { imap.end(); reject(e); });
    });
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeImapMessage(raw, mailbox) {
  const h = raw.headers || {};
  const pick = (field) => (h[field] ? h[field][0] : null);
  return {
    id: raw.attrs ? String(raw.attrs.uid) : String(raw.seqno),
    seqno: raw.seqno,
    threadId: null,
    subject: pick('subject'),
    from: pick('from'),
    to: pick('to'),
    cc: pick('cc'),
    bcc: pick('bcc'),
    internalDate: pick('date'),
    snippet: (raw.text || '').substring(0, 200),
    body: { text: raw.text || null, html: null },
    flags: raw.attrs ? raw.attrs.flags : [],
    mailbox,
    provider: 'imap',
  };
}

function normalizeMailparserMessage(parsed, attrs, mailbox) {
  return {
    id: attrs ? String(attrs.uid) : null,
    threadId: null,
    subject: parsed.subject || null,
    from: parsed.from ? parsed.from.text : null,
    to: parsed.to ? parsed.to.text : null,
    cc: parsed.cc ? parsed.cc.text : null,
    bcc: parsed.bcc ? parsed.bcc.text : null,
    internalDate: parsed.date ? parsed.date.toISOString() : null,
    snippet: (parsed.text || '').substring(0, 200),
    body: { text: parsed.text || null, html: parsed.html || null },
    flags: attrs ? attrs.flags : [],
    mailbox,
    provider: 'imap',
  };
}

function flattenBoxes(boxes, prefix) {
  const result = [];
  for (const [name, box] of Object.entries(boxes)) {
    const fullName = prefix ? `${prefix}${box.delimiter || '/'}${name}` : name;
    result.push({
      id: fullName,
      name: fullName,
      attribs: box.attribs || [],
      provider: 'imap',
    });
    if (box.children) {
      result.push(...flattenBoxes(box.children, fullName));
    }
  }
  return result;
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
