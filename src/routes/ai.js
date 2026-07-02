'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const aiService = require('../services/ai');

const router = Router();
router.use(requireAuth);

/**
 * POST /receptions/ai/summarize
 * Body (one of):
 *   { subject, from, body: { text|html }, snippet }   — single message
 *   { subject, messages: [{ from, internalDate, subject, body, snippet }] }  — thread
 * Returns: { summary, keyPoints, model }
 */
router.post('/summarize', async (req, res, next) => {
  try {
    const input = req.body;
    if (!input || (!input.body && !input.snippet && !input.messages)) {
      return res.status(400).json({
        error: 'Provide either a message object { subject, from, body, snippet } or a thread { subject, messages[] }',
      });
    }
    const result = await aiService.summarize(input);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /receptions/ai/prioritize
 * Body: { messages: [{ id, subject, from, snippet, internalDate }] }
 * Returns: [{ id, priority: 'high'|'medium'|'low', reason, model }]
 */
router.post('/prioritize', async (req, res, next) => {
  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Provide a non-empty "messages" array' });
    }
    const result = await aiService.prioritize(messages);
    res.json({ priorities: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /receptions/ai/daily-brief
 * Query params: date (YYYY-MM-DD, default today), limit (default 50)
 *
 * Fetches messages from the active provider for the given date range,
 * then asks the AI to produce a daily brief.
 */
router.get('/daily-brief', async (req, res, next) => {
  try {
    const { getProvider } = require('../providers');
    const provider = getProvider(req.session.provider);
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const limit = parseInt(req.query.limit, 10) || 50;

    // Build a provider-specific query for today's messages
    let messages = [];
    if (req.session.provider === 'gmail') {
      const q = `after:${date.replace(/-/g, '/')} before:${nextDay(date).replace(/-/g, '/')}`;
      const data = await provider.listMessages(req.session.credentials, { maxResults: limit, q });
      messages = data.messages;
    } else if (req.session.provider === 'outlook') {
      const filter = `receivedDateTime ge ${date}T00:00:00Z and receivedDateTime lt ${nextDay(date)}T00:00:00Z`;
      const data = await provider.listMessages(req.session.credentials, { top: limit, filter });
      messages = data.messages;
    } else {
      // IMAP — just grab the latest N messages
      const data = await provider.listMessages(req.session.credentials, { limit });
      messages = data.messages;
    }

    const result = await aiService.dailyBrief(messages, { date });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

function nextDay(dateStr) {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

module.exports = router;
