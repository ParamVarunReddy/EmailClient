'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { getProvider } = require('../providers');

const router = Router();
router.use(requireAuth);

/**
 * GET /receptions/folders
 * List all available folders / labels / mailboxes for the authenticated account.
 */
router.get('/', async (req, res, next) => {
  try {
    const provider = getProvider(req.session.provider);
    const result = await provider.listFolders(req.session.credentials);
    res.json({ folders: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /receptions/folders/:id/messages
 * List messages inside a specific folder.
 * :id is URL-encoded folder id (label for Gmail, folderId for Outlook, mailbox path for IMAP).
 * Query params: pageToken | skip, maxResults | top | limit, q | filter
 */
router.get('/:id/messages', async (req, res, next) => {
  try {
    const provider = getProvider(req.session.provider);
    const folderId = decodeURIComponent(req.params.id);
    const opts = buildListOpts(req.query, req.session.provider);
    const result = await provider.listFolderMessages(req.session.credentials, folderId, opts);
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
    };
  }
  if (provider === 'outlook') {
    return {
      skip: parseInt(query.skip || query.offset, 10) || 0,
      top: parseInt(query.top || query.limit, 10) || 20,
    };
  }
  return {
    limit: parseInt(query.limit, 10) || 20,
    offset: parseInt(query.offset, 10) || 0,
  };
}

module.exports = router;
