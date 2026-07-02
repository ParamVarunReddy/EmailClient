'use strict';

/**
 * Central error-handling middleware.
 * Must have 4 parameters so Express treats it as an error handler.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  if (process.env.NODE_ENV !== 'production') {
    console.error('[error]', err.stack || err);
  }

  res.status(status).json({ error: message, ...(err.details ? { details: err.details } : {}) });
}

module.exports = { errorHandler };
