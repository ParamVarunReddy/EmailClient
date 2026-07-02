'use strict';

const express = require('express');
const session = require('express-session');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const { errorHandler } = require('./middleware/error');
const { csrfGuard, csrfTokenHandler } = require('./middleware/csrf');

const authRoutes = require('./routes/auth');
const messagesRoutes = require('./routes/messages');
const threadsRoutes = require('./routes/threads');
const foldersRoutes = require('./routes/folders');
const aiRoutes = require('./routes/ai');

const app = express();

// ── Global middleware ─────────────────────────────────────────────────────────

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    },
  })
);

// ── Rate limiting ─────────────────────────────────────────────────────────────

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again later.' },
});

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP, please try again later.' },
});

// ── CSRF protection ───────────────────────────────────────────────────────────

app.get('/receptions/csrf-token', csrfTokenHandler);
app.use('/receptions', globalLimiter);
app.use(csrfGuard);

// ── Namespace: /receptions ────────────────────────────────────────────────────

app.use('/receptions/auth', authLimiter, authRoutes);
app.use('/receptions/messages', messagesRoutes);
app.use('/receptions/threads', threadsRoutes);
app.use('/receptions/folders', foldersRoutes);
app.use('/receptions/ai', aiRoutes);

// ── Health check ──────────────────────────────────────────────────────────────

app.get('/receptions/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    providers: ['gmail', 'outlook', 'imap'],
    aiStubMode: require('./config').ai.stubMode,
  });
});

// ── Root ──────────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({
    name: 'EmailClient API',
    namespace: '/receptions',
    version: '1.0.0',
    endpoints: {
      health: 'GET /receptions/health',
      auth: {
        gmail: 'GET /receptions/auth/gmail',
        gmailCallback: 'GET /receptions/auth/gmail/callback',
        outlook: 'GET /receptions/auth/outlook',
        outlookCallback: 'GET /receptions/auth/outlook/callback',
        imap: 'POST /receptions/auth/imap',
        me: 'GET /receptions/auth/me',
        logout: 'POST /receptions/auth/logout',
      },
      messages: {
        list: 'GET /receptions/messages',
        get: 'GET /receptions/messages/:id',
        send: 'POST /receptions/messages',
        patch: 'PATCH /receptions/messages/:id',
        delete: 'DELETE /receptions/messages/:id',
      },
      threads: {
        list: 'GET /receptions/threads',
        get: 'GET /receptions/threads/:id',
      },
      folders: {
        list: 'GET /receptions/folders',
        messages: 'GET /receptions/folders/:id/messages',
      },
      ai: {
        summarize: 'POST /receptions/ai/summarize',
        prioritize: 'POST /receptions/ai/prioritize',
        dailyBrief: 'GET /receptions/ai/daily-brief',
      },
    },
  });
});

// ── 404 ───────────────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ── Error handler ─────────────────────────────────────────────────────────────

app.use(errorHandler);

module.exports = app;
