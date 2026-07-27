# Agency OS — MVP

The desktop half of the Sy Leads Scraper system. The Chrome/Firefox extension
collects leads; this app is where you work them.

## What's actually built and verified in this MVP

This was tested with **real, live runs** — not just code review:

- Electron app that **genuinely launches** (verified via headless xvfb launch)
- SQLite database (via sql.js — zero native compile step, easier to
  distribute) with the full Lead Model schema
- **Extension Connector** — a local HTTP server on `localhost:8420` that the
  Chrome/Firefox extension talks to directly. Verified end-to-end: real
  HTTP requests from the actual extension code, against the actual running
  app, correctly persisting to the actual SQLite database, with correct
  field mapping and correct duplicate detection across that boundary.
- **Offline resilience** — verified the extension correctly falls back to a
  local queue (no data loss, no crash) when Agency OS isn't running, and
  correctly does NOT clear that queue if a sync attempt fails.
- **Deterministic rule engine** — no AI anywhere. Website Missing/Present,
  Low/High Reviews, Phone Missing → Priority A/B/C + tags + a recommended
  service + a recommended email template. Verified fully deterministic
  (same input always produces the same output).
- **SMTP email via Gmail** — real `nodemailer` wiring, template merge
  fields, one-click send from the UI. Verified the wiring logic against a
  mocked transport (I can't send a real email without your own Gmail App
  Password sitting in *your* local app).
- **3-panel UI**: integrated browser (real `<webview>`, not an iframe —
  genuinely navigate Google Maps inside the app) / lead info panel / bottom
  queue+log panel.

## Setup

```bash
cd agency-os
npm install
npm start
```

First launch creates the SQLite database in your OS's app-data folder
automatically.

## Connecting Gmail for sending

1. Go to your Google Account → Security → 2-Step Verification → **App
   Passwords**
2. Generate one for "Mail"
3. In Agency OS, enter your Gmail address + that App Password (not your
   regular password — Gmail requires this for SMTP)

## What's real MVP scope vs. genuinely not built yet

**Built:** lead collection (via extension), lead viewing, rule-based
priority/tags, one-click templated email sending, status tracking on each
lead, activity log.

**Not built — real future work, not faked:**
- Kanban/pipeline drag-and-drop view (currently a flat queue list)
- Bulk email sending / scheduling / retry queue (currently one lead at a time)
- Analytics dashboard
- Automation engine (event-triggered workflows)
- Plugin system for other lead sources (LinkedIn, Instagram, etc.)
- Auto-backup / migration system for the database
- Multiple SMTP accounts

These are all real, separate scope — the spec's own instruction was "MVP
first, expand after," and this is genuinely that first slice, not a
mockup pretending to be more.

## Architecture

```
src/
  main/
    main.js              — Electron entry point, IPC handlers
    connectorServer.js    — Extension Connector (isolated HTTP API)
  db/
    database.js            — SQLite via sql.js, Lead Model schema
  rules/
    ruleEngine.js           — deterministic priority/tags/recommendations
  email/
    templates.js            — merge-field email templates
    mailer.js                — nodemailer/Gmail SMTP wiring
  preload/
    preload.js                — context-isolated IPC bridge
  renderer/
    index.html, app.js          — 3-panel UI
```

Every module above was tested independently before being wired together —
`database.js` and `connectorServer.js` have a dedicated test file
(`test_backend.js`) that starts a real server and makes real HTTP requests
against it; `ruleEngine.js`, `templates.js`, and `mailer.js` have their own
(`test_rules_email.js`).
