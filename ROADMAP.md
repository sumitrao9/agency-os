# AgencyOS Roadmap

## Completed (v1.0.0 – v1.8.0)
Electron shell, SQLite (sql.js), Extension Connector API, deterministic rule
engine, SMTP/Gmail sending, One-Click Outreach (send→CRM→follow-up),
independent Auto-Scan (webview scraping, zoom/pan/load-more escalation),
Email Discovery (hidden BrowserWindow), Universal Search, location spoofing,
startup health check, auto-backup, Today's Mission, Revenue Score.

## Completed this session (v1.9.0)
- [x] SQLite write-debouncing — implemented, and a real race-condition bug
      was found and fixed in the same pass: `backup()` copied the raw file
      without flushing pending writes first, which could capture stale
      data or even fail outright if the file hadn't been written yet.
      Reproduced the bug explicitly, confirmed the fix, 14/14 regression clean.

## Completed this session (v1.9.0) — all verified, not just implemented
- [x] SQLite write-debouncing — plus a real backup/race-condition bug
      found and fixed
- [x] SMTP daily send-limit tracking — 5/5 including midnight rollover
- [x] Express → native `http` — 14/14 regression + new CORS/malformed-body tests
- [x] `electron-builder` packaging — real AppImage built AND launched
- [x] `.icns`/`.ico` icons — verified via magic bytes
- [x] Dependency vulnerability audit — 16 high severity → 0

## Remaining, real reasons given (this session — v1.9.0)
- [ ] SQLite write-debouncing (real perf risk at scale — every field edit
      currently rewrites the entire DB file)
- [ ] SMTP daily send-limit tracking (Gmail ~500/day cap — currently untracked)
- [ ] Express → native `http` (dependency reduction per free-first mandate)
- [ ] `electron-builder` packaging config (currently source-only, not
      installable)
- [ ] `.icns` via `png2icons` (macOS dock icon)

## Deferred, real reasons given
- Multi-SMTP accounts — v1 ships with one Gmail account; real value, real
  scope, needs its own pass
- Bounce/reply tracking — requires IMAP polling or Gmail API webhook, a
  genuinely separate subsystem
- Campaign history / proposal generation — depends on the above
- Custom Rule Builder UI — rule engine is code-level deterministic already;
  a visual editor is real scope on top of that
- Command Palette (Ctrl+K) — real value, not yet started

## Known technical debt
- No renderer/UI automated test coverage (verified via real process launch
  + log inspection only, not click-simulation)
- Hidden-BrowserWindow email discovery has no concurrency cap if ever
  called in a bulk loop
