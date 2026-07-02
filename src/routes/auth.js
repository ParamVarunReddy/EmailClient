'use strict';

const { Router } = require('express');
const gmailProvider = require('../providers/gmail');
const outlookProvider = require('../providers/outlook');
const zohoProvider = require('../providers/zoho');

const router = Router();

// ── Gmail ─────────────────────────────────────────────────────────────────────

/**
 * GET /receptions/auth/gmail
 * Redirect user to Google's OAuth consent screen.
 */
router.get('/gmail', (req, res) => {
  const state = req.query.state || '';
  const url = gmailProvider.getAuthUrl(state);
  res.redirect(url);
});

/**
 * GET /receptions/auth/gmail/callback
 * Google redirects here after user grants consent.
 */
router.get('/gmail/callback', async (req, res, next) => {
  const { code, error } = req.query;
  if (error) {
    return res.status(400).json({ error: 'OAuth denied', details: error });
  }
  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  try {
    const credentials = await gmailProvider.exchangeCode(code);
    req.session.provider = 'gmail';
    req.session.credentials = credentials;
    res.json({ status: 'authenticated', provider: 'gmail' });
  } catch (err) {
    next(err);
  }
});

// ── Outlook ───────────────────────────────────────────────────────────────────

/**
 * GET /receptions/auth/outlook
 * Redirect user to Microsoft's OAuth consent screen.
 */
router.get('/outlook', async (req, res, next) => {
  try {
    const state = req.query.state || '';
    const url = await outlookProvider.getAuthUrl(state);
    res.redirect(url);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /receptions/auth/outlook/callback
 * Microsoft redirects here after consent.
 */
router.get('/outlook/callback', async (req, res, next) => {
  const { code, error } = req.query;
  if (error) {
    return res.status(400).json({ error: 'OAuth denied', details: req.query.error_description || error });
  }
  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  try {
    const credentials = await outlookProvider.exchangeCode(code);
    req.session.provider = 'outlook';
    req.session.credentials = credentials;
    res.json({ status: 'authenticated', provider: 'outlook' });
  } catch (err) {
    next(err);
  }
});

// ── IMAP ──────────────────────────────────────────────────────────────────────

/**
 * POST /receptions/auth/imap
 * Body: { user, password, host, port?, tls?, smtpHost?, smtpPort?, smtpTls? }
 * Credentials are stored in the session (never persisted to disk).
 */
router.post('/imap', (req, res) => {
  const { user, password, host, port, tls, smtpHost, smtpPort, smtpTls } = req.body;
  if (!user || !password || !host) {
    return res.status(400).json({ error: 'user, password, and host are required for IMAP login' });
  }

  req.session.provider = 'imap';
  req.session.credentials = {
    user,
    password,
    host,
    port: port || 993,
    tls: tls !== false,
    smtpHost: smtpHost || host,
    smtpPort: smtpPort || 587,
    smtpTls: smtpTls !== false,
  };

  res.json({ status: 'authenticated', provider: 'imap', user });
});

// ── Yahoo Mail ────────────────────────────────────────────────────────────────

/**
 * POST /receptions/auth/yahoo
 * Body: { user, password }
 * Uses Yahoo's IMAP/SMTP servers (imap.mail.yahoo.com / smtp.mail.yahoo.com).
 * If 2-step verification is on, generate an app password at:
 * https://myaccount.yahoo.com/security
 */
router.post('/yahoo', (req, res) => {
  const { user, password } = req.body;
  if (!user || !password) {
    return res.status(400).json({ error: 'user and password are required for Yahoo login' });
  }
  req.session.provider = 'yahoo';
  req.session.credentials = { user, password };
  res.json({ status: 'authenticated', provider: 'yahoo', user });
});

// ── Apple iCloud ──────────────────────────────────────────────────────────────

/**
 * POST /receptions/auth/icloud
 * Body: { user, password }
 * Uses Apple iCloud IMAP/SMTP servers (imap.mail.me.com / smtp.mail.me.com).
 * Requires an app-specific password from:
 * https://appleid.apple.com → Sign-In and Security → App-Specific Passwords
 */
router.post('/icloud', (req, res) => {
  const { user, password } = req.body;
  if (!user || !password) {
    return res.status(400).json({ error: 'user and password are required for iCloud login' });
  }
  req.session.provider = 'icloud';
  req.session.credentials = { user, password };
  res.json({ status: 'authenticated', provider: 'icloud', user });
});

// ── Zoho Mail ─────────────────────────────────────────────────────────────────

/**
 * GET /receptions/auth/zoho
 * Redirect user to Zoho's OAuth consent screen.
 */
router.get('/zoho', (req, res) => {
  const state = req.query.state || '';
  const url = zohoProvider.getAuthUrl(state);
  res.redirect(url);
});

/**
 * GET /receptions/auth/zoho/callback
 * Zoho redirects here after the user grants consent.
 */
router.get('/zoho/callback', async (req, res, next) => {
  const { code, error } = req.query;
  if (error) {
    return res.status(400).json({ error: 'OAuth denied', details: error });
  }
  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }
  try {
    const credentials = await zohoProvider.exchangeCode(code);
    req.session.provider = 'zoho';
    req.session.credentials = credentials;
    res.json({ status: 'authenticated', provider: 'zoho' });
  } catch (err) {
    next(err);
  }
});

// ── Session info & logout ─────────────────────────────────────────────────────

/**
 * GET /receptions/auth/me
 * Return current session provider (no credentials).
 */
router.get('/me', (req, res) => {
  if (!req.session.provider) {
    return res.status(401).json({ authenticated: false });
  }
  const info = { authenticated: true, provider: req.session.provider };
  if (req.session.provider === 'imap') info.user = req.session.credentials.user;
  res.json(info);
});

/**
 * POST /receptions/auth/logout
 * Destroy the session.
 */
router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.json({ status: 'logged_out' });
  });
});

module.exports = router;
