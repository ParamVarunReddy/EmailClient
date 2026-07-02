'use strict';

require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  sessionSecret: process.env.SESSION_SECRET || 'change-me-in-production',

  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID || '',
    clientSecret: process.env.GMAIL_CLIENT_SECRET || '',
    redirectUri: process.env.GMAIL_REDIRECT_URI || 'http://localhost:3000/receptions/auth/gmail/callback',
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
      'profile',
      'email',
    ],
  },

  outlook: {
    clientId: process.env.OUTLOOK_CLIENT_ID || '',
    clientSecret: process.env.OUTLOOK_CLIENT_SECRET || '',
    tenantId: process.env.OUTLOOK_TENANT_ID || 'common',
    redirectUri: process.env.OUTLOOK_REDIRECT_URI || 'http://localhost:3000/receptions/auth/outlook/callback',
    scopes: ['openid', 'profile', 'email', 'Mail.Read', 'Mail.Send', 'Mail.ReadWrite'],
  },

  imap: {
    defaultPort: parseInt(process.env.IMAP_DEFAULT_PORT, 10) || 993,
    defaultTls: process.env.IMAP_DEFAULT_TLS !== 'false',
  },

  ai: {
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.AI_MODEL || 'gpt-4o',
    stubMode: process.env.AI_STUB_MODE !== 'false',
  },
};

module.exports = config;
