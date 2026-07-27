# Changelog

## [1.12.0] — Performance, reliability, and a real regression fixed — 2026-07-26

### What changed
A targeted audit for genuine engineering debt, not cosmetic rewrites —
every change below is backed by a measured or logically-verified cost,
not "this looked different." Nothing was rewritten just to look cleaner.

### 1. Startup-latency regression fixed (introduced in 1.10.0)
SMTP credential verification is a network round-trip to Gmail. It was
running before DB init and before the window was created — a slow or
unreachable network delayed the entire app from opening, on every single
launch. Now runs concurrently with DB init (`Promise.all`) instead of
serially before it, since the two are independent (network-bound vs
CPU/WASM-bound). Verified via real Electron launch — clean boot, no
change in behavior, just parallelized.

### 2. N sequential IPC round-trips collapsed to 1
`refreshLeadQueue()` (every 4-second poll) and `buildTodaysMission()`
(every launch) each awaited `applyRules()` once per lead in a loop — pure
serialization overhead, since `applyRules` is itself synchronous, no I/O.
At even a few hundred leads that's a few hundred IPC round-trips per poll
tick. Added `leads:applyRulesBatch`, one call for the whole list. Verified
identical output to the per-lead calls (same pure function).

### 3. Real memory leak fixed: unbounded priority cache
`leadPriorityCache` was keyed by `id:updatedDate` — every edit to a lead
left its previous cache entry behind forever, since the old compound key
never gets cleaned up. The cache only ever grew for the life of a
session. Now keyed by `id` alone (one entry per lead, naturally bounded
by lead count); a stale entry is detected by comparing the stored
`updatedDate`, not by leaving old keys around. Also now actively drops
entries for leads that no longer exist.

### 4. BrowserWindow churn reduced 5x in email discovery
`discoverEmail()` created a brand-new hidden `BrowserWindow` (a full
separate Electron renderer process — real, measurable overhead) for the
SSL/mobile check, then another for each of up to 4 contact-page visits —
up to 5 window creations for one "Find Email" click. Refactored to create
one window and reuse it across every visit. Verified with a real
instrumented Electron run: exactly 1 window created per call, down from 5,
identical result (`ok: true, pagesChecked: 4`).

### Reviewed and deliberately left unchanged
- `app.js` at ~800 lines doing UI + business logic in one file — real
  modularity debt, but splitting it now is a rewrite risk with no
  measured cost behind it (it's not slow, not buggy, just long); revisit
  if it starts causing actual merge/maintenance pain, not preemptively
- `getAllLeads()`'s SELECT * + JSON.parse per row on every poll — real
  cost is trivial at hundreds of leads (sql.js in-memory, no disk I/O per
  call); not worth adding a query-result cache until lead count is high
  enough to measure a difference
- Debounced-write persistence, backup-on-startup-only, health-check-once
  — already correct per prior passes, no change

### Verified
- Full regression: 78/78 across all six suites, zero changes to test
  expectations needed
- Real Electron launch: clean boot after the startup-parallelization fix
- Real instrumented run confirming the BrowserWindow count: 1 per
  `discoverEmail()` call (was 5), file reverted cleanly after
  measurement, re-ran full suite to confirm zero drift
- Batch vs per-lead `applyRules` output confirmed byte-identical

### Migration steps
None. No schema, IPC contract stays backward-compatible (old
`leads:applyRules` single-lead handler untouched, batch is additive).

## [1.11.0] — Client-acquisition optimization pass: real research, real gaps closed, free-only — 2026-07-26

### What changed
Researched current (2026) professional practice across deliverability,
lead dedup, contact discovery, and follow-up cadence — checked multiple
engineering approaches, mature open-source/OSINT tooling patterns, and
official guidance, not just one source. Implemented the highest-leverage
free fixes; explicitly skipped anything that required a paid API or broke
the zero-cost mandate.

### 1. Follow-up send engine (biggest gap closed)
Previously: a follow-up date got scheduled and shown as a due badge, but
there was no way to actually send that follow-up — the loop was half
built. Now: a real "Send Follow-up" action, capped at 3 total touches
(initial + 2 follow-ups) per the strongest available research —
consensus across every source checked was 2-3 follow-ups max, not the
5-12 many outdated guides suggest; reply rate keeps dropping and spam
complaints rise past touch 3. Follow-ups send as same-thread replies
(inReplyTo/references headers, "Re: <original subject>"), which
consistently outperforms a fresh subject line. Final touch is an explicit
breakup message offering an easy exit rather than another "just checking
in" — sequence stops itself automatically once a lead replies, moves to
Interested/Call Scheduled/Won/Lost, or hits the 3-touch cap.

### 2. Lead deduplication upgraded
Previously: exact phone match or exact-lowercased-name match only — real
duplicates like "Acme Plumbing" vs "Acme Plumbing LLC." were missed
entirely. Now: business names are normalized (strip Inc/LLC/Ltd/Pvt
Ltd/Corp/Co, punctuation, case) before comparing, and website domain is
checked as a secondary signal — catches the same business found under
different names on different platforms (Google Maps vs Yelp, etc.),
matching standard B2B dedup practice from every source checked.

### 3. Contact discovery: common-pattern fallback
Previously: if no real email was found on the homepage/contact/about
pages, enrichment just failed. Now: falls back to a common role-address
guess (info@domain) as a last resort, clearly flagged as guessed/
unconfirmed (never presented as a confirmed find, never silently
overwrites a real email) — a free improvement matching the same
technique used by open-source OSINT email-finder tools.

### 4. Website-quality signal (new, free, piggybacks on an existing visit)
Previously: email discovery visited a lead's website but captured nothing
about the site itself. Now: also checks for a valid SSL cert and a mobile
viewport tag on that same visit — zero extra cost. Feeds two new rule-
engine tags (No SSL / Not Mobile-Friendly) with their own recommendation,
price tier, and email template — a concrete, evidence-backed pitch angle
that didn't exist before.

### 5. SMTP volume thresholds corrected
Previous defaults (warn at 400, stop at 480) were sized to Gmail's raw
technical ceiling (~500/day), not to what's actually safe for cold
outreach specifically. Research consensus across every deliverability
source checked: cold outreach should stay well under that, ~100-150/day
per mailbox. Lowered to warn at 80, stop at 120.

### Explicitly not built (real reasons, zero-cost mandate)
- Paid email verification/finder APIs (Hunter.io etc.) — free tier is
  25 lookups/month, breaks the zero-cost stack; the free site-crawl +
  pattern-fallback approach already covers the same use case
- Custom-domain SPF/DKIM/DMARC/warmup infrastructure — irrelevant at this
  sending volume; Gmail's own SMTP already carries valid authentication,
  this only matters for 5,000+/day bulk senders on a custom domain
- Website performance/speed audits — would need a headless Lighthouse-
  class tool, real scope on top of what SSL/mobile-viewport checks
  already deliver for free
- Kanban/multi-channel sequencing — real, separate scope, unchanged from
  prior ROADMAP entries

### Files changed
- `src/db/database.js` — name normalization, domain-based secondary dedup
- `src/email/templates.js` — follow-up templates (nudge/breakup)
- `src/email/mailer.js` — inReplyTo/references threading support
- `src/main/main.js` — corrected SMTP thresholds, follow-up render handler
- `src/main/emailDiscovery.js` — website-quality check, pattern fallback
- `src/rules/ruleEngine.js` — No SSL / Not Mobile-Friendly tags + pricing
- `src/preload/preload.js` — exposes renderFollowUp, threading params
- `src/renderer/index.html`, `app.js` — Send Follow-up UI + engine

### Verified
- Full regression: 78/78 across all six suites (added a new
  `test_followup_dedup.js` — 15/15 covering the new dedup logic, follow-up
  templates, and mailer threading)
- Real Electron launch (headless xvfb): clean boot, no errors, health
  check and connector server both start correctly with all changes wired
  together

### Migration steps
None. Existing leads keep their current dedupeKey; the new domain-based
check only applies going forward on new inserts.

## [1.10.0] — Fixed 4 real gaps found during a full architecture audit — 2026-07-26

### What changed
A ground-up audit (every module read in full, not sampled) surfaced four
real gaps between what was documented/wired-up and what actually worked.
All four fixed in this pass.

### 1. SMTP credentials had no UI at all
`saveEmailCredentials` was fully wired in preload.js and main.js, but
neither `index.html` nor `app.js` had any input field calling it. The
README's own setup instructions ("enter your Gmail address + App Password
in Agency OS") described a screen that didn't exist — Send Email was
unreachable in practice, verifiable only against a mocked transport.
Added a real Settings panel (`⚙️ Email Settings`, collapsible in the lead
panel) with email + App Password fields, a Save & Verify button, and live
account-status display.

### 2. SMTP credentials weren't persisted
`mailTransport` lived only in a `main.js` memory variable — gone on every
restart, meaning the startup health check's "SMTP configured" was
guaranteed to show false on every single launch even after a hypothetical
save. Fixed with `safeStorage` (Electron's OS-keychain-backed encryption
— Keychain/DPAPI/libsecret), with a plain-JSON fallback if encryption
isn't available on the machine. Both paths verified with a real Electron
run: encryption path round-trips correctly when a keyring is present;
falls back to plaintext (never silently loses the credential) when it
isn't — confirmed live in this sandbox, which has no dbus/keyring.
Credentials are now loaded and re-verified against Gmail on every
startup, before the health check runs.

### 3. `health:get` was dead code from the UI's perspective
Implemented in main.js, but never exposed on the `agencyOS` preload
bridge — health check results only ever reached the terminal/dev
console, never the running app. Added `getHealth()` to preload.js and a
small status banner in the renderer that shows real issues (or confirms
all-clear) on launch.

### 4. Connector server CORS was wide open (`Access-Control-Allow-Origin: *`)
Any ordinary website open in the user's regular browser could have hit
this local API on its fixed, predictable port — read the full lead list
or inject fake leads. Restricted to only echo the origin back when it's
a real `chrome-extension://` or `moz-extension://` caller; verified with
a real HTTP round-trip against three origins (extension origin allowed,
arbitrary website blocked, no-origin request blocked).

### Files changed
- `src/main/main.js` — credential load/save/verify via safeStorage,
  `email:getAccountStatus` handler, startup restore before health check
- `src/preload/preload.js` — exposes `getHealth()` and
  `getEmailAccountStatus()`, previously missing
- `src/main/connectorServer.js` — origin-aware CORS instead of wildcard
- `src/renderer/index.html` — Email Settings panel, health banner
- `src/renderer/app.js` — Settings save/verify flow, account-status
  refresh, health banner render

### Verified
- Full regression: 14/14, 17/17, 5/5, 13/13, 14/14 (all five suites,
  unaffected by these changes but re-run to confirm zero breakage)
- Real Electron launch (headless xvfb): backup, health check, connector
  server all still start correctly
- Real `safeStorage` round-trip test in this actual sandbox: encryption
  unavailable here (no keyring) → plaintext fallback correctly used,
  round-trip confirmed byte-for-byte
- Real HTTP CORS test against the running connector server: extension
  origin allowed, arbitrary website origin blocked, no-origin blocked

### Migration steps
None. Existing leads/DB untouched. Anyone who was already using the app
without SMTP configured (the only state that was actually reachable
before this fix) sees no change except a new Settings panel now
available.

## [1.9.0] — Real packaging, dependency hardening, a real race-condition bug found and fixed — 2026-07-26

### What changed
Continuing the architecture-owner directive without stopping between
items. Audited and verified several pieces that turned out to already be
implemented from earlier work (write-debouncing, SMTP limits, the
Express→native-http swap) rather than rebuilding them — then built the one
genuinely missing piece: real packaging.

### Real bug found and fixed
`backup()` copied the database file directly via `fs.copyFileSync()`
without first flushing the debounced write queue. Reproduced this
explicitly: a backup taken immediately after an insert captured a file
with the insert missing (or, worse, the file not existing yet at all,
since even the very first write is debounced). Fixed by calling `flush()`
at the top of `backup()` before touching the file.

### Packaging (new)
- `electron-builder` added, compared against `electron-forge` first via
  real research — chosen because AgencyOS has no bundler and no native
  modules needing rebuild hooks
- Real `.icns` (macOS) and `.ico` (Windows) icons generated via
  `png2icons` — no Mac required, verified via actual magic bytes
- **A real build was produced and run**: `npm run dist` produced a
  genuine 131MB AppImage. Extracted and launched it as a standalone
  packaged binary — confirmed backup, health check, and connector server
  all start correctly, identical to every source-based launch.

### Dependency hardening
- High-severity `brace-expansion` DoS vulnerability (inside
  electron-builder's build-time tooling only, never shipped) fixed via a
  targeted `overrides` pin — not the auto-suggested `--force`, which
  would have downgraded electron-builder to an alpha release
- `electron` moved from `dependencies` to `devDependencies` — required by
  electron-builder itself
- `package.json` metadata updated from `npm init` placeholders never
  touched since project start

### A real environment gap hit and fixed
After moving `electron` between dependency sections, its post-install
binary download silently didn't run on the next install — caught via a
failed launch, fixed by manually re-triggering `install.js`.

### Verified
- 14/14 (backend), 17/17 (rules/email) — re-run repeatedly through this batch
- npm audit: 16 high-severity findings → 0
- Real Electron source launch and real packaged AppImage launch both confirmed

### Migration steps
None for existing data.

## [1.8.0] — Email Discovery: the missing link in "search, find, mail, automate" — 2026-07-26

### What changed
Audited the exact request — "search find mail smtp automate all" — and
found that "find" (email) was the one step missing. Auto-Scan finds
businesses, SMTP sends to them, One-Click Outreach (1.7.0) automates the
CRM/follow-up loop — but most Google Maps cards don't expose an email
address, so a real fraction of found leads had no way into the outreach
chain at all. Added Email Discovery to close that gap.

### Architectural decision worth recording
This runs in a **hidden Electron BrowserWindow** (`show: false`), not the
visible embedded browser. This is a genuine advantage over the Chrome
extension's equivalent feature (Deep Enrich), which had no choice but to
borrow the one visible tab and interrupt whatever you were looking at.
Here, email discovery runs fully in the background while you keep
browsing normally.

### Files added
- `src/main/emailDiscovery.js` — `discoverEmail()`, checks homepage +
  /contact + /contact-us + /about, `extractEmail()` filters junk matches
  (image filenames, tracking-pixel domains)

### Files changed
- `src/main/main.js` — `leads:enrichEmail` IPC handler
- `src/db/database.js` — `email` added to the updatable field whitelist
  (a lead's email was previously only ever set at capture time, never
  after)
- `src/preload/preload.js` — exposes `enrichEmail()`
- `src/renderer/index.html`, `app.js` — "🔍 Find Email from Website"
  button, shown only when a lead has a website but no email

### A real design mistake caught before it shipped
First draft stored the discovered email in `customFields.discoveredEmail`
instead of the actual `email` column — which would have made it
invisible to Send Email, search, and the rule engine, all of which read
the real `email` field. Caught this during review, not after — fixed to
update the real column, with an explicit guard that **never overwrites an
existing email** (enrichment fills a gap, it doesn't second-guess a
real address you already have).

### Verified
- Email extraction logic: 8/8 against realistic page text, including
  junk-filtering (image filenames, sentry/wixpress tracking domains)
- Never-overwrite guard: 5/5, explicitly confirmed a lead with a real
  existing email is left untouched even when discovery finds a different
  address
- URL normalization: confirmed handles `https://x.com/menu`, bare
  `biz.com`, `www.biz.com`, and fails safely (returns null, not a crash)
  on garbage input
- Full existing suites re-run: 14/14, 17/17 — zero regression
- Real Electron relaunch: backup, health check, connector server all
  still working together

### Migration steps
None — additive only, no schema changes (email column already existed).

## [1.7.0] — One-Click Outreach, complete — 2026-07-26

### What changed
Continued autonomously per the established process — audited existing
code, found the real gap, built the highest-leverage next module without
waiting for further instruction. Send Email previously did open → load
template → preview → send, and stopped there. It now completes the full
chain: send → log to lead history → advance CRM stage → auto-schedule a
follow-up date — one click, not four separate manual steps.

### Files changed
- `src/db/database.js` — `history` and `customFields` (both already part
  of the Lead Model schema, unused until now) added to the updatable
  field whitelist; JSON serialization extended to cover them, matching
  the existing pattern for `tags`
- `src/renderer/app.js` — `sendEmailBtn` handler completes the outreach
  chain on a successful send only (a failed send does not advance the
  pipeline or schedule a follow-up); lead queue rows show a ⏰ indicator
  when a follow-up is due

### Why
This was flagged as "the biggest automation I'd build" across two
separate requests. It required no new schema, no new dependency — the
`history` and `customFields` columns already existed in the 1.0.0 schema
specifically for this, just never wired up.

### Design decisions worth recording
- **CRM stage only ever advances, never regresses.** A lead already at
  Replied/Interested/Call Scheduled/Won/Lost stays there even if you send
  it another email — sending a follow-up to someone who already replied,
  or a thank-you to a Won deal, must not silently reset their pipeline
  position.
- **Follow-up date is a fixed +3-day default**, not a guess — matches the
  project's deterministic, no-AI rule engine philosophy applied to
  scheduling.
- **Won/Lost leads never show as follow-up-due**, even with a stale date
  in `customFields` — a closed deal isn't an open task.

### Verified
- Database layer (history/customFields persistence): 6/6
- Stage-advance logic across all 8 pipeline stages, including the
  specific "Won lead must not regress" case: 10/10
- Follow-up-due badge logic, including the Won/Lost exclusion: 7/7
- Full existing suites re-run to confirm zero regression: 14/14
  (database+connector), 17/17 (rules+email)
- Real Electron relaunch: backup, health check, and connector server all
  confirmed still working together

### Migration steps
None — uses existing schema columns, no migration needed.

## [1.6.0] — Startup health check, auto-backup, extraction-failure visibility — 2026-07-26

### What changed
A real-world scoped subset of a much larger "self-healing system" request.
Most of that spec (continuous compatibility monitoring, module hot-restart,
config-driven selector rewriting) is infrastructure appropriate for a
team-maintained multi-tenant product, not a solo-user local tool — flagged
as disproportionate and skipped. Built the three pieces that are genuinely
useful and cheap:

1. **Startup health check** — verifies DB schema, SMTP config, logs
   Node/Electron/Chrome versions. Runs once on launch, never on a timer.
2. **Automatic backup on startup** — copies the database file, keeps the
   last 5, prunes older ones automatically.
3. **Extraction-failure visibility in Auto-Scan** — if the scraper finds
   listing containers but extracts zero leads from any of them, that's
   flagged plainly as "the site's structure may have changed," distinct
   from a normal empty page. This is the real actionable self-healing
   signal — telling you something changed, not silently guessing a fix.

### Files added
- `src/main/healthCheck.js`

### Files changed
- `src/db/database.js` — `backup()`, `verifySchema()`
- `src/main/main.js` — runs backup + health check once during startup,
  `health:get` IPC handler
- `src/renderer/app.js` — Auto-Scan surfaces the containers-found-but-
  zero-extracted warning

### Verified
- Schema verification: confirmed passes on a fresh, correctly-created database
- Backup: confirmed file actually exists on disk, byte-identical to the
  source, confirmed old backups are correctly pruned (6 created, 5 kept)
- Health check: 14/14 including SMTP-not-configured correctly flagged,
  SMTP-configured correctly clearing the flag
- **Real Electron runtime confirmation**: relaunched the actual app,
  confirmed the backup file was genuinely created on disk at a real path,
  confirmed the health check correctly read the real lead count, and
  confirmed `process.versions.electron` populates correctly inside the
  real runtime (a plain-Node test can't verify this — Node doesn't have
  an Electron version — this is the one thing only a real launch proves)

### Migration steps
None — additive only.

### Explicitly scoped down from the original request
Continuous website-change monitoring, module isolation/hot-restart,
config-driven selector externalization, log rotation, temp-file cleanup,
index optimization. Real reasons given for each, not silently dropped.

## [1.5.0] — Revenue Score + Close Probability, full system audit — 2026-07-26

### What changed
Added deterministic revenue estimation and close probability — the
foundation piece the bigger revenue-automation list (Opportunity Engine,
Money Dashboard, Daily Call List) all depend on. Every lead now shows an
estimated deal-value range and a likelihood-to-close percentage, and
Today's Mission shows a real "likely pipeline value" number, weighted by
close probability (not a naive sum of every estimate, which would
overstate reality).

### Files changed
- `src/rules/ruleEngine.js` — `estimateRevenue()`, `estimateCloseProbability()`,
  wired into `applyRules()`'s output
- `src/renderer/app.js`, `index.html` — revenue/probability shown on the
  selected lead panel; Today's Mission gained a 4th card (Likely Pipeline
  Value), grid updated from 3 to 4 columns

### Why
The next request explicitly named a large set of revenue-focused
automation modules. Rather than partially bolt on ten new modules at
once, this builds the one piece all of them share a dependency on, fully
tested, per the project's own "one module at a time" rule.

### Explicitly declined (again, for the record)
A request to add CAPTCHA image verification was declined in the previous
version and remains declined here — not revisited, not softened.

### Verified — full comprehensive audit this round, not just the new code
- **All 10 source files**: syntax-clean
- **Revenue/probability logic**: 11/11 tests — deterministic, correct
  service-range mapping, correct multi-gap bundling, pipeline value
  correctly excludes Won/Lost deals
- **Full backend suite re-run**: 14/14 (database + connector, real HTTP
  requests, real persistence-across-restart)
- **Full rules/email suite re-run**: 17/17 — confirms this session's
  ruleEngine.js changes did not regress anything from 1.0.0
- **Real Electron launch re-confirmed**: connector server starts cleanly

### Migration steps
None — additive only, no schema changes.

### Known gaps (deferred, explicitly not built this round)
Opportunity Engine ranking view, Offer Generator, Smart Service Matching
UI, Daily Call List, Email Performance tracking, Market Explorer, Money
Dashboard (beyond the one pipeline-value card added), Deal Machine
end-to-end pipeline automation, One-Click Outreach (open→fill→send→
update-CRM→schedule-followup chain). Real scope, genuinely not built —
next priority is your call.

## [1.4.0] — Universal Search, more human-like scrolling — 2026-07-26

### What changed
- Search now genuinely checks every field a person would search by (name,
  phone, email, website, category, notes, address, status, tags) — it
  previously only checked name + category.
- Auto-Scan's scroll behavior now moves in randomized incremental steps
  (250-700px per step, variable pauses including occasional longer
  "reading" pauses) instead of instantly jumping to the bottom of the page
  every cycle.

### Explicitly NOT built, and won't be
A request for CAPTCHA verification/solving was declined. Detecting a
CAPTCHA and pausing for manual human resolution (already built) is the
correct and only behavior here — this project does not attempt to solve,
verify, or bypass CAPTCHAs or any other site protection, regardless of
framing.

### Files changed
- `src/renderer/app.js` — `leadMatchesSearch()`, wired into the existing
  filter pipeline
- `src/scraper/pageScraper.js` — `AUTO_SCROLL_JS` rewritten from a fixed
  jump-to-bottom interval to incremental randomized-distance scrolling

### Why
The old scroll logic teleported straight to `scrollHeight` every call —
not how anyone actually scrolls, and a more obviously automated pattern
than it needed to be. Search only matching 2 of 9 documented fields was a
real functional gap against what was asked for.

### Verified
- Universal search: 9/9 field-match tests, plus case-insensitivity,
  empty-query, and false-positive checks
- **Real bug caught during testing**: the search function lowercased each
  lead field but not the incoming query itself, relying entirely on the
  caller to pre-lowercase it — worked in the app (which does lowercase
  before calling) but was silently broken if called any other way. Fixed
  so the function is correct standalone, not just correct-by-accident.
- Real Electron relaunch after these changes: connector server still
  starts correctly, no regression

### Migration steps
None — additive/behavioral changes only.

### Known gaps (deferred — this is a large list, staying disciplined)
Territory Manager, Contact Center dossier view, Saved Workspaces, Lead
Quality Score (🟢🟡🔴), Activity Timeline, Follow-up Calendar, File
Attachments, Proposal Tracker, Personal Performance dashboard, Session
Recovery, Bulk Operations, Knowledge Base, Reports, Opportunity Feed,
Business Profile Page. Real, valuable, un-built — next priority is your
call per the established one-module-at-a-time process.

## [1.3.0] — Real location spoofing, more reliable than the extension's — 2026-07-26

### What changed
Added location (GPS) spoofing to the embedded browser — pick a city or
enter coordinates, and Google/Bing Maps see that location instead of your
real one. This overrides what the browser reports, the same legitimate
technique the extension already used; it does not bypass CAPTCHAs, rate
limits, or any other site protection.

### Why the app's version is genuinely more reliable than the extension's
The extension injects its override via a content script at
`document_start`, racing the page's own scripts to see who reads
`navigator.geolocation` first — usually fine, but a race nonetheless.
Electron's `<webview>` supports an actual `preload` script that runs
before the guest page's scripts get a chance to run at all, assigned
securely from the main process via `will-attach-webview` (Electron's
documented pattern for this — a renderer is not allowed to assign webview
preloads directly, for security reasons). No race condition, by construction.

### Files added
- `src/renderer/webviewPreload.js` — the actual override, runs in the
  embedded browser's guest page context

### Files changed
- `src/main/main.js` — `will-attach-webview` handler, spoof config
  persisted to a JSON file in the app's userData folder (survives
  restarts — the extension's equivalent only persists via
  `chrome.storage.local`, this is the same durability, now on the app side)
- `src/preload/preload.js` — exposes `saveLocationSpoof()` / `getLocationSpoof()`
- `src/renderer/index.html`, `app.js` — spoof UI (city presets + manual
  lat/lng), matching the extension's UI pattern

### Verified
- Config save/load/persistence-across-restart: 4/4, including a corrupted-
  file resilience check (falls back to disabled, does not crash)
- Real Electron relaunch after these changes: connector server still
  starts correctly, no regression from the new `will-attach-webview` handler

### Migration steps
None — additive only.

## [1.2.0] — Independent Auto-Scan (standalone scraping) — 2026-07-26

### What changed
Agency OS can now scrape leads on its own — no Chrome/Firefox extension
required. A new "Auto-Scan" button in the embedded browser runs the same
scroll+scrape cycle logic already proven in the extension, capturing every
business found directly into the local database.

### Files added
- `src/scraper/pageScraper.js` — the extraction logic, reused (not
  rewritten) from the extension: schema.org/JSON-LD first, adaptive card
  detection as fallback, garbage-entry filtering, category inference

### Files changed
- `src/preload/preload.js` — exposes the scraper scripts to the renderer
- `src/renderer/index.html` — Auto-Scan / Stop buttons + status line
- `src/renderer/app.js` — `runAutoScan()` loop: scroll → dismiss cookie
  banner → scrape → capture each lead via IPC → try Load More on a dry
  cycle → stop after 4 consecutive empty cycles or a 200-cycle safety ceiling

### Why
The app was previously receive-only — leads had to come from the
extension. This makes it capable of standing entirely on its own.

### Verified
- Extraction logic tested against real sample markup: schema.org (5/5),
  adaptive card fields — name/phone/rating/reviewCount/category — verified
  via direct regex testing since jsdom (the test sandbox) doesn't
  implement `innerText` or `offsetParent` at all (a known jsdom gap, not a
  bug in the extraction code — the same logic is already proven working in
  the live Chrome extension against real Chromium)
- Garbage-entry filtering: confirmed sponsored/ad content correctly dropped
- Dry-cycle stop condition (the logic Auto-Scan's stop button depends on):
  5/5 — confirmed re-scanning identical results reports 0 new, confirmed
  genuinely new results after a scroll are correctly counted
- Real Electron relaunch after these changes: connector server still
  starts cleanly, no regression

### Migration steps
None — additive only.

### Known gaps
Auto-Scan currently only tries the "Load More" pagination pattern on a dry
cycle, not the extension's fuller zoom-out/pan escalation — that's real
follow-up scope, not built here to keep this change scoped to "does
independent scanning work at all."

## [1.1.0] — Lead Workspace completion + Today's Mission — 2026-07-26

### What changed
Completed the Lead Workspace module (Phase 1) and added the "Today's
Mission" work-queue landing view — the app now opens to a short, concrete
action list instead of a passive dashboard.

### Files changed
- `src/db/database.js` — added `updateLead()` (was previously insert-only;
  notes/status/priority/tags could never actually be saved)
- `src/main/main.js` — added `leads:update` and `leads:capture` IPC handlers
- `src/preload/preload.js` — exposed `updateLead()` and `captureLead()`
- `src/renderer/index.html` — search/filter bar, Capture button, Email
  field (was missing entirely), copy buttons, Today's Mission overlay
- `src/renderer/app.js` — search/filter logic, notes/status save (real
  persistence, was silently lost before), browser-based lead capture via
  webview page-text extraction, keyboard shortcuts (Ctrl+F, Ctrl+S, Esc),
  loading indicators, error surfacing, one-click copy, Today's Mission logic

### Why
Auditing the MVP found three real functional gaps: notes typed into the UI
were never saved, status changes were never saved, and there was no way to
add a lead from the embedded browser directly (only via the extension).
Fixed all three. Today's Mission was the one explicitly-requested feature
addition — turns lead entry into "start working," not "figure out what to
do."

### Verified
- `updateLead()`: 8/8 tests, including a field-whitelist security check
  (non-updatable columns like `businessName` cannot be overwritten via update)
- Today's Mission counting logic: 3/3 tests against real seeded leads
- Full syntax + element-reference cross-check on all touched files: clean
- Real Electron process launch re-confirmed after these changes (headless
  xvfb) — connector server still starts correctly, no startup regression

### Migration steps
None — additive changes, existing database schema unchanged (new columns
were already present from 1.0.0's schema, just newly writable).

### Known gaps (deferred, not built)
Dashboard module, Business Intelligence website scanner, bulk email/CRM
pipeline view, rule builder UI, saved filter presets, notifications,
import/export beyond JSON. Per the stated process, these wait for their
own dedicated pass rather than being bolted on here.

## [1.0.0] — MVP — 2026-07-26

### What changed
Initial MVP: Electron desktop app that receives leads from the Chrome/Firefox
extension, applies deterministic rule-based scoring, and sends templated
emails via Gmail SMTP.

### Files added
- `src/db/database.js` — SQLite (sql.js) storage, Lead Model schema, dedup
- `src/main/connectorServer.js` — Extension Connector HTTP API (localhost:8420)
- `src/main/main.js` — Electron entry point, IPC handlers
- `src/preload/preload.js` — context-isolated IPC bridge
- `src/rules/ruleEngine.js` — deterministic priority/tags/recommendations
- `src/email/templates.js` — merge-field email templates
- `src/email/mailer.js` — nodemailer/Gmail SMTP wiring
- `src/renderer/index.html`, `src/renderer/app.js` — 3-panel UI (browser / lead info / queue+log)
- `test_backend.js`, `test_rules_email.js` — module test suites

### Why
Spec required an MVP usable for client acquisition immediately, with the
extension staying collection-only and this app owning CRM/email/rules.

### Verified
- Real Electron launch (headless xvfb), not just code review
- Real HTTP round-trip: extension → live app → SQLite → back, with correct
  field mapping and cross-boundary duplicate detection (9/9 tests)
- Offline fallback: extension queues locally without data loss when the
  app isn't running, and doesn't clear the queue on a failed sync (6/6 tests)
- Rule engine fully deterministic — same input always produces same output
- Backend module tests: 14/14 (database + connector), 17/17 (rules + email)

### Migration steps
None — first release.

### Known gaps (real future work, not built)
Kanban view, bulk email/scheduling, analytics dashboard, automation engine,
plugin system for other lead sources, DB auto-backup, multiple SMTP accounts.
