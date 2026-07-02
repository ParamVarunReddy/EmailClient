'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { getProvider } = require('../providers');

const router = Router();
router.use(requireAuth);

/**
 * GET /receptions/messages
 * Query params: pageToken | skip, maxResults | top | limit, q | filter
 */
router.get('/', async (req, res, next) => {
  try {
    const provider = getProvider(req.session.provider);
    const opts = buildListOpts(req.query, req.session.provider);
    const result = await provider.listMessages(req.session.credentials, opts);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /receptions/messages/:id
 * Query param (IMAP only): mailbox
 */
router.get('/:id', async (req, res, next) => {
  try {
    const provider = getProvider(req.session.provider);
    // IMAP getMessage accepts optional mailbox as second arg
    const result = await provider.getMessage(
      req.session.credentials,
      req.params.id,
      req.query.mailbox
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /receptions/messages
 * Body: { to, cc?, bcc?, subject?, body?, replyToMessageId? }
 */
router.post('/', async (req, res, next) => {
  try {
    const provider = getProvider(req.session.provider);
    const result = await provider.sendMessage(req.session.credentials, req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /receptions/messages/:id
 * Gmail: { addLabelIds?, removeLabelIds? }
 * Outlook: { isRead?, flag?, categories? }
 * IMAP: { addFlags?, removeFlags?, mailbox? }
 */
router.patch('/:id', async (req, res, next) => {
  try {
    const provider = getProvider(req.session.provider);
    const result = await provider.patchMessage(
      req.session.credentials,
      req.params.id,
      req.body,
      req.body.mailbox
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /receptions/messages/:id
 * Query param (IMAP only): mailbox
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const provider = getProvider(req.session.provider);
    const result = await provider.deleteMessage(
      req.session.credentials,
      req.params.id,
      req.query.mailbox
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
      filter: query.filter || '',
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
