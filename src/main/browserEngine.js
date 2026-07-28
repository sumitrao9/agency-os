// src/main/browserEngine.js
//
// Single shared hidden-BrowserWindow used for every headless/background
// browser task in the app (email/contact discovery, site screenshots,
// future site-preview/extraction work) instead of each caller spinning up
// its own BrowserWindow — every one of those is a separate renderer
// process, so reusing one is both a real resource saving and a single
// place to keep adblock/session setup consistent. Callers never touch
// BrowserWindow directly; they go through withPage().
//
// Calls are serialized (a FIFO queue) rather than run in parallel: the
// callers of this engine (emailDiscovery, screenshot, deep-scan) already
// process leads one at a time, so serializing costs nothing in practice
// and rules out two navigations racing on the same window.

const { BrowserWindow } = require('electron');
const { enableAdblock } = require('./adblock');

let win = null;
let adblockReady = null;
let queue = Promise.resolve();

async function getWindow() {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    // Deliberately NOT offscreen: capturePage() (used by screenshot.js)
    // expects normal compositor output. An offscreen window only produces
    // frames when something pumps its 'paint' event, so capturePage() on
    // one reliably returns a solid black image — a hidden (but normally
    // composited) window paints just fine without ever being shown.
    webPreferences: {},
  });
  adblockReady = enableAdblock(win.webContents.session);
  await adblockReady;
  return win;
}

/**
 * Runs `fn(win)` against the shared hidden window, queued behind any call
 * already in flight. `fn` gets a live BrowserWindow — load it, read it,
 * screenshot it, whatever the caller needs — the engine only owns
 * lifecycle, not navigation semantics.
 */
function withPage(fn) {
  const run = async () => {
    const w = await getWindow();
    return fn(w);
  };
  const result = queue.then(run, run); // run even if a prior call rejected
  // Keep the queue alive regardless of this call's outcome — one caller's
  // rejection must not wedge every call queued behind it.
  queue = result.catch(() => {});
  return result;
}

/** Convenience: navigate then return document.body.innerText. */
async function loadAndReadText(targetUrl, timeoutMs = 10000) {
  return withPage(async (w) => {
    await Promise.race([
      w.loadURL(targetUrl),
      new Promise((_, reject) => setTimeout(() => reject(new Error('page load timed out')), timeoutMs)),
    ]);
    return w.webContents.executeJavaScript('document.body ? document.body.innerText : ""');
  });
}

/** Destroys the shared window — call on app shutdown. */
function destroy() {
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}

module.exports = { withPage, loadAndReadText, destroy };
