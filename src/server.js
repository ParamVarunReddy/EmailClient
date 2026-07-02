'use strict';

require('dotenv').config();

const app = require('./app');
const config = require('./config');

const server = app.listen(config.port, () => {
  console.log(`[EmailClient] Server running on http://localhost:${config.port}`);
  console.log(`[EmailClient] Namespace: http://localhost:${config.port}/receptions`);
  console.log(`[EmailClient] AI stub mode: ${config.ai.stubMode}`);
});

server.on('error', (err) => {
  console.error('[EmailClient] Server error:', err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  server.close(() => {
    console.log('[EmailClient] Server stopped.');
    process.exit(0);
  });
});

module.exports = server;
