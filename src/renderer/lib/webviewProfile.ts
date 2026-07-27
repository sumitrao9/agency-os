// src/renderer/lib/webviewProfile.ts
//
// Makes the scraper/browser <webview>s behave like an actual Chrome tab
// instead of a bare Electron webview: a real Chrome user-agent (Electron's
// default UA appends its own app name + "Electron/x.x.x" tokens, which is
// exactly what tips sites into serving a stripped-down/limited experience
// — Google Maps included) and a persistent partition so cookies/session/
// zoom state survive between scrapes the same way a real browser profile
// would, instead of starting from a blank slate — and hitting a consent
// wall — on every single scrape.

// Electron's own UA is "<real Chrome UA> agency-os/1.x.x Electron/33.x.x
// Safari/537.36" — stripping the app-name and Electron tokens leaves the
// exact Chrome UA for the Chromium version actually bundled, so this never
// drifts out of sync with an Electron upgrade the way a hardcoded string would.
export const chromeUserAgent = navigator.userAgent
  .replace(/\s*agency-os\/\S+/i, '')
  .replace(/\s*Electron\/\S+/i, '');

// Shared across the Scraper and Browser modules so both feel like one
// continuous Chrome profile rather than two isolated, disposable sessions.
export const BROWSER_PARTITION = 'persist:agencyos-chrome';
