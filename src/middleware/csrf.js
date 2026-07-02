'use strict';

const crypto = require('crypto');

/**
 * CSRF protection for session-cookie-based endpoints.
 *
 * Strategy: stateless Double-Submit-Cookie (HMAC signed).
 *  1. GET /receptions/csrf-token  — issues a signed token stored in session + returned in JSON.
 *  2. csrfGuard middleware        — validates the token on every state-mutating request
 *     (POST / PUT / PATCH / DELETE) unless the request is to an OAuth callback path.
 *
 * Clients must:
 *   a) Call GET /receptions/csrf-token once after login.
 *   b) Include the returned token in the `X-CSRF-Token` request header on every
 *      mutating request.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Paths that perform state mutation but carry their own CSRF protection
// (OAuth callbacks use the `state` param; IMAP login is the initial credential exchange).
const CSRF_EXEMPT = new Set([
  '/receptions/auth/imap',
  '/receptions/auth/logout',
]);

function generateToken(secret) {
  const rand = crypto.randomBytes(16).toString('hex');
  const hmac = crypto.createHmac('sha256', secret).update(rand).digest('hex');
  return `${rand}.${hmac}`;
}

function verifyToken(token, secret) {
  if (!token || typeof token !== 'string') return false;
  const [rand, hmac] = token.split('.');
  if (!rand || !hmac) return false;
  const expected = crypto.createHmac('sha256', secret).update(rand).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(hmac, 'hex').slice(0, 32), Buffer.from(expected, 'hex').slice(0, 32));
}

/**
 * Middleware: reject state-mutating requests that lack a valid CSRF token.
 */
function csrfGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (CSRF_EXEMPT.has(req.path)) return next();

  const secret = req.session && req.session.csrfSecret;
  if (!secret) {
    return res.status(403).json({ error: 'CSRF secret not initialised. Call GET /receptions/csrf-token first.' });
  }

  const token = req.headers['x-csrf-token'];
  if (!verifyToken(token, secret)) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token' });
  }

  next();
}

/**
 * Route handler: issue a fresh CSRF token.
 * GET /receptions/csrf-token
 */
function csrfTokenHandler(req, res) {
  if (!req.session.csrfSecret) {
    req.session.csrfSecret = crypto.randomBytes(32).toString('hex');
  }
  const token = generateToken(req.session.csrfSecret);
  res.json({ csrfToken: token });
}

module.exports = { csrfGuard, csrfTokenHandler };
