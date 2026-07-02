'use strict';

/**
 * Auth middleware — requires a valid provider session on the request.
 * The OAuth / IMAP login routes attach `req.session.provider` and
 * `req.session.credentials` after a successful login.
 */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.provider || !req.session.credentials) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'No active session. Authenticate via /receptions/auth/<provider> first.',
    });
  }
  next();
}

module.exports = { requireAuth };
