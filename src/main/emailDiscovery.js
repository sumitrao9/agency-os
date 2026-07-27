// src/main/emailDiscovery.js
//
// Visits a lead's website in a HIDDEN BrowserWindow (show: false) to find
// an email address and social links — the same extraction goal as the
// Chrome extension's "Deep Enrich" feature, but architecturally better:
// the extension could only ever borrow your one visible tab to do this
// (interrupting whatever you were looking at). Electron can run this
// entirely in the background while you keep using the app normally.

const { BrowserWindow } = require('electron');
const { enableAdblock } = require('./adblock');

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const CONTACT_PATHS = ['', '/contact', '/contact-us', '/about'];
// Common role-address patterns — last-resort fallback when no real email
// is found anywhere on the site. Not guaranteed deliverable (that's why
// it's clearly flagged as a guess, not returned as a confirmed email),
// but a real, free improvement over finding nothing: many small
// businesses never publish an email at all but do accept mail to these.
const COMMON_PATTERNS = ['info', 'contact', 'hello', 'admin'];

// Visits a URL in the given (already-created) hidden window and returns
// its visible text. Shared by both the quality check and the email
// search below — a single window is created once per discoverEmail()
// call and reused across every page visit, rather than spinning up a new
// Electron BrowserWindow (a real, measurable cost — each one is a
// separate renderer process) for every single path checked.
async function loadAndReadPage(win, url, timeoutMs = 10000) {
  await Promise.race([
    win.loadURL(url),
    new Promise((_, reject) => setTimeout(() => reject(new Error('page load timed out')), timeoutMs)),
  ]);
  return win.webContents.executeJavaScript('document.body ? document.body.innerText : ""');
}

// Real, free signal missing before: whether the homepage even has a valid
// TLS cert and a mobile viewport tag — both are strong, concrete talking
// points for the exact pitch this app already generates ("Website Design"
// recommendation), and cost nothing extra since the page is already being
// visited for email discovery.
async function checkWebsiteQuality(win, url) {
  const result = { hasSSL: false, isMobileFriendly: false, checked: false };
  try {
    await Promise.race([
      win.loadURL(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
    ]);
    result.hasSSL = win.webContents.getURL().startsWith('https://');
    result.isMobileFriendly = await win.webContents.executeJavaScript(
      `!!document.querySelector('meta[name="viewport"]')`
    );
    result.checked = true;
  } catch (e) {
    // Site unreachable/slow — leave checked:false rather than guessing
  }
  return result;
}

function extractEmail(text) {
  const match = text.match(EMAIL_RE);
  if (!match) return '';
  const email = match[0];
  // Filter obvious junk matches — image filenames, tracking pixels, etc.
  if (/\.(png|jpe?g|gif|svg|webp|css|js)$/i.test(email)) return '';
  if (/sentry|wixpress|godaddy|cloudflare/i.test(email)) return '';
  return email;
}

// Returns { ok, email, guessed, pagesChecked, error, websiteQuality }.
// Never throws — a dead or slow website must never crash the caller.
async function discoverEmail(website) {
  if (!website) return { ok: false, error: 'No website on file', pagesChecked: 0 };

  let base;
  try {
    base = new URL(website.startsWith('http') ? website : `https://${website}`).origin;
  } catch (e) {
    return { ok: false, error: 'Invalid website URL', pagesChecked: 0 };
  }

  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, images: false }, // never render images — this is a text-extraction pass, not a visit
  });

  try {
    await enableAdblock(win.webContents.session);
    const websiteQuality = await checkWebsiteQuality(win, base);

    let pagesChecked = 0;
    let contactPageUrl = null;
    for (const path of CONTACT_PATHS) {
      pagesChecked++;
      try {
        const text = await loadAndReadPage(win, `${base}${path}`);
        // A dedicated contact/about page existing and loading is itself a
        // real signal ("this business has a way to reach it"), independent
        // of whether an email was actually found on it.
        if (/contact|about/i.test(path)) contactPageUrl = `${base}${path}`;
        const email = extractEmail(text);
        if (email) return { ok: true, email, guessed: false, pagesChecked, websiteQuality, contactPageUrl };
      } catch (e) {
        continue; // that specific page failed to load — try the next candidate path
      }
    }

    // Last-resort fallback: a common role-address guess at the same domain.
    // Clearly marked as guessed (never overwrites a real found/entered email
    // — see main.js's never-overwrite guard — and the UI should show this
    // differently from a confirmed address).
    try {
      const domain = new URL(base).hostname.replace(/^www\./, '');
      return {
        ok: true,
        email: `${COMMON_PATTERNS[0]}@${domain}`,
        guessed: true,
        pagesChecked,
        websiteQuality,
        contactPageUrl,
      };
    } catch (e) {
      return { ok: false, error: 'No email found on homepage/contact/about pages', pagesChecked, websiteQuality };
    }
  } finally {
    // Always close the hidden window, success or failure — this is what
    // prevents the exact "tab leak" class of bug the extension's Deep
    // Enrich had to guard against explicitly. Now closed exactly once per
    // discoverEmail() call instead of once per page visited.
    if (!win.isDestroyed()) win.destroy();
  }
}

module.exports = { discoverEmail };
