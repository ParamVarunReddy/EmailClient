'use strict';

const gmail = require('./gmail');
const outlook = require('./outlook');
const imap = require('./imap');

const PROVIDERS = { gmail, outlook, imap };

/**
 * Resolve the correct provider adapter from the session.
 * @param {string} providerName  One of 'gmail' | 'outlook' | 'imap'
 * @returns {object} provider adapter module
 */
function getProvider(providerName) {
  const provider = PROVIDERS[providerName];
  if (!provider) {
    const err = new Error(`Unknown provider "${providerName}". Must be one of: ${Object.keys(PROVIDERS).join(', ')}.`);
    err.status = 400;
    throw err;
  }
  return provider;
}

module.exports = { getProvider, PROVIDERS };
