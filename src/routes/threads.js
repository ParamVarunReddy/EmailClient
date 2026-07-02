'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { getProvider } = require('../providers');

const router = Router();
router.use(requireAuth);

/**
 * GET /receptions/threads
 * Query params: pageToken | skip, maxResults | top | limit, q | filter
 */
router.get('/', async (req, res, next) => {
  try {
    const provider = getProvider(req.session.provider);
    const opts = buildListOpts(req.query, req.session.provider);
    const result = await provider.listThreads(req.session.credentials, opts);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /receptions/threads/:id
 * Fetch a thread (and all its messages) by id.
 * Query param (IMAP only): mailbox
 */
router.get('/:id', async (req, res, next) => {
  try {
    const provider = getProvider(req.session.provider);
    const result = await provider.getThread(
      req.session.credentials,
      req.params.id,
      req.query.mailbox ? { mailbox: req.query.mailbox } : undefined
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildListOpts(query, provider) {
  if (provider === 'gmail') {
    return {
      pageToken: query.pageToken,
      maxResults: parseInt(query.maxResults || query.limit, 10) || 20,
      q: query.q || '',
    };
  }
  if (provider === 'outlook') {
    return {
      skip: parseInt(query.skip || query.offset, 10) || 0,
      top: parseInt(query.top || query.limit, 10) || 20,
    };
  }
  // imap
  return {
    mailbox: query.mailbox || 'INBOX',
    limit: parseInt(query.limit, 10) || 20,
    offset: parseInt(query.offset, 10) || 0,
  };
}

module.exports = router;
