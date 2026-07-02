'use strict';

const config = require('../config');

/**
 * AI stub service.
 *
 * When AI_STUB_MODE=true (default), all methods return canned responses so the
 * API layer is fully exercisable without an OpenAI key.
 *
 * To wire up a real LLM, set AI_STUB_MODE=false and provide OPENAI_API_KEY.
 * The live path calls the OpenAI Chat Completions endpoint.
 */

// ── Summarize ─────────────────────────────────────────────────────────────────

/**
 * Summarize a single email or thread.
 * @param {{ subject, from, body, messages }} input
 * @returns {Promise<{ summary: string, keyPoints: string[] }>}
 */
async function summarize(input) {
  if (config.ai.stubMode) {
    return {
      summary: `[STUB] This is an AI-generated summary of "${input.subject || 'the email'}".`,
      keyPoints: [
        '[STUB] Key point 1 extracted from the message.',
        '[STUB] Key point 2 extracted from the message.',
        '[STUB] Action item identified in the message.',
      ],
      model: 'stub',
    };
  }

  const text = buildTextForSummarization(input);
  const prompt = `Summarize the following email concisely. Return JSON with keys "summary" (string) and "keyPoints" (array of strings).\n\n---\n${text}`;
  return callOpenAI(prompt, 'summarize');
}

// ── Prioritize ────────────────────────────────────────────────────────────────

/**
 * Prioritize a list of message stubs.
 * @param {Array<{ id, subject, from, snippet, internalDate }>} messages
 * @returns {Promise<Array<{ id, priority: 'high'|'medium'|'low', reason: string }>>}
 */
async function prioritize(messages) {
  if (config.ai.stubMode) {
    return messages.map((m, i) => ({
      id: m.id,
      priority: ['high', 'medium', 'low'][i % 3],
      reason: `[STUB] Stub priority assigned based on position ${i + 1}.`,
      model: 'stub',
    }));
  }

  const list = messages
    .map((m, i) => `${i + 1}. id=${m.id} from=${m.from} subject="${m.subject}" date=${m.internalDate}`)
    .join('\n');

  const prompt = `You are an email assistant. Prioritize the following emails. Return a JSON array where each element has "id", "priority" ("high"|"medium"|"low"), and "reason".\n\n${list}`;
  return callOpenAI(prompt, 'prioritize');
}

// ── Daily Brief ───────────────────────────────────────────────────────────────

/**
 * Generate a daily brief from a set of messages.
 * @param {Array<{ id, subject, from, snippet, internalDate }>} messages
 * @param {{ date?: string }} opts
 * @returns {Promise<{ date: string, totalMessages: number, highlights: string[], actionItems: string[], brief: string }>}
 */
async function dailyBrief(messages, opts = {}) {
  const date = opts.date || new Date().toISOString().slice(0, 10);

  if (config.ai.stubMode) {
    return {
      date,
      totalMessages: messages.length,
      highlights: [
        `[STUB] You received ${messages.length} message(s) today.`,
        '[STUB] There is 1 high-priority item requiring your attention.',
      ],
      actionItems: [
        '[STUB] Reply to the message from your manager.',
        '[STUB] Review the attached report.',
      ],
      brief: `[STUB] Daily brief for ${date}: You have ${messages.length} new messages. No real AI processing performed (stub mode enabled).`,
      model: 'stub',
    };
  }

  const snippets = messages
    .slice(0, 30)
    .map((m) => `- From: ${m.from}  Subject: "${m.subject}"  Preview: ${m.snippet}`)
    .join('\n');

  const prompt = `Generate a concise daily email brief for ${date}. Return JSON with keys: "highlights" (string[]), "actionItems" (string[]), "brief" (string). Emails:\n${snippets}`;
  const result = await callOpenAI(prompt, 'dailyBrief');
  return { date, totalMessages: messages.length, ...result };
}

// ── OpenAI caller ─────────────────────────────────────────────────────────────

async function callOpenAI(prompt, operation) {
  const fetchFn = typeof globalThis.fetch === 'function'
    ? globalThis.fetch
    : (await import('node-fetch').catch(() => null))?.default;

  if (!fetchFn) throw new Error('No fetch implementation available');
  if (!config.ai.openaiApiKey) throw new Error('OPENAI_API_KEY is not configured');

  const res = await fetchFn('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + config.ai.openaiApiKey,
    },
    body: JSON.stringify({
      model: config.ai.model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw Object.assign(new Error(`OpenAI error ${res.status}: ${text}`), { status: 502 });
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  try {
    const parsed = JSON.parse(content);
    return { ...parsed, model: config.ai.model };
  } catch {
    return { raw: content, model: config.ai.model };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildTextForSummarization(input) {
  if (Array.isArray(input.messages)) {
    return input.messages
      .map((m) => `From: ${m.from}\nDate: ${m.internalDate}\nSubject: ${m.subject}\n\n${m.body?.text || m.snippet || ''}`)
      .join('\n\n---\n\n');
  }
  return `From: ${input.from}\nSubject: ${input.subject}\n\n${input.body?.text || input.snippet || ''}`;
}

module.exports = { summarize, prioritize, dailyBrief };
