# EmailClient

An AI-powered email client **API layer** — Express.js app with Gmail, Outlook, and IMAP provider adapters, OAuth 2.0 auth routes, normalized message/thread/folder endpoints, and a stub AI layer for summarize / prioritize / daily-brief.

All calls are **real-time passthrough** to the upstream provider — no email is stored locally.

---

## Quick start

```bash
cp .env.example .env    # fill in your OAuth credentials
npm install
npm start               # http://localhost:3000
```

---

## Namespace

All endpoints live under `/receptions`.

---

## Endpoints

### Auth

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/receptions/auth/gmail` | Redirect to Google OAuth consent |
| `GET`  | `/receptions/auth/gmail/callback` | Google OAuth callback |
| `GET`  | `/receptions/auth/outlook` | Redirect to Microsoft OAuth consent |
| `GET`  | `/receptions/auth/outlook/callback` | Microsoft OAuth callback |
| `POST` | `/receptions/auth/imap` | Authenticate with IMAP/SMTP credentials |
| `GET`  | `/receptions/auth/me` | Current session info |
| `POST` | `/receptions/auth/logout` | Destroy session |

**IMAP login body:**
```json
{ "user": "you@example.com", "password": "secret", "host": "imap.example.com",
  "port": 993, "tls": true, "smtpHost": "smtp.example.com", "smtpPort": 587 }
```

---

### Messages

| Method   | Path | Description |
|----------|------|-------------|
| `GET`    | `/receptions/messages` | List messages (supports pagination & search) |
| `GET`    | `/receptions/messages/:id` | Fetch a single message |
| `POST`   | `/receptions/messages` | Send a message |
| `PATCH`  | `/receptions/messages/:id` | Update flags / labels |
| `DELETE` | `/receptions/messages/:id` | Trash / delete a message |

**Send body:**
```json
{ "to": "alice@example.com", "subject": "Hello", "body": "Hi there",
  "cc": "", "bcc": "", "replyToMessageId": "" }
```

**Gmail PATCH body** (add/remove labels):
```json
{ "addLabelIds": ["STARRED"], "removeLabelIds": ["UNREAD"] }
```

**Outlook PATCH body:**
```json
{ "isRead": true }
```

**IMAP PATCH body:**
```json
{ "addFlags": ["\\Seen"], "removeFlags": [], "mailbox": "INBOX" }
```

---

### Threads

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/receptions/threads` | List threads |
| `GET`  | `/receptions/threads/:id` | Fetch a thread with all messages |

---

### Folders

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/receptions/folders` | List all folders / labels / mailboxes |
| `GET`  | `/receptions/folders/:id/messages` | List messages in a folder |

---

### AI (stub)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/receptions/ai/summarize` | Summarize a message or thread |
| `POST` | `/receptions/ai/prioritize` | Prioritize a list of messages |
| `GET`  | `/receptions/ai/daily-brief` | Generate a daily email brief |

By default `AI_STUB_MODE=true` — all AI endpoints return canned stub responses.  
Set `AI_STUB_MODE=false` and provide `OPENAI_API_KEY` to use a real LLM.

---

### Health

```
GET /receptions/health
```

---

## Provider adapters

| Provider | Auth | Notes |
|----------|------|-------|
| **Gmail** | OAuth 2.0 (Google) | Uses `googleapis` SDK |
| **Outlook** | OAuth 2.0 (MSAL / Microsoft) | Uses `@azure/msal-node` + Graph API |
| **IMAP** | Credentials in session | `node-imap` + `nodemailer` for SMTP |

---

## Project structure

```
src/
  app.js            Express app (routes wired up)
  server.js         HTTP server entry point
  config/index.js   Env-based configuration
  providers/
    gmail.js        Gmail adapter (googleapis)
    outlook.js      Outlook adapter (MSAL + Graph)
    imap.js         Generic IMAP/SMTP adapter
    index.js        Provider factory
  routes/
    auth.js         OAuth 2.0 + IMAP auth routes
    messages.js     Message CRUD routes
    threads.js      Thread routes
    folders.js      Folder / label routes
    ai.js           AI stub routes
  middleware/
    auth.js         Session auth guard
    error.js        Central error handler
  services/
    ai.js           AI stub / OpenAI integration
```
