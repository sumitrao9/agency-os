// src/main/adblock.js
//
// Blocks ads/trackers in the hidden windows used for deep-scan/screenshot
// visits — reused from @ghostery/adblocker-electron (MIT/MPL-2.0, MIT
// license file for adblocker-electron itself, MPL-2.0 for the core
// engine) instead of hand-rolling a filter list. Purely a speed/noise
// win for a page we're only visiting to measure it, not browse it: fewer
// ad/tracker requests means a faster, more representative load.

let blockerPromise = null;

// Lazily fetches + compiles the prebuilt ads+tracking filter lists once
// per app run, then reuses the same engine for every subsequent call —
// downloading the lists on every scan would be wasteful and slow.
function getBlocker() {
  if (!blockerPromise) {
    blockerPromise = require('@ghostery/adblocker-electron')
      .ElectronBlocker.fromPrebuiltAdsAndTracking(fetch)
      .catch((e) => { blockerPromise = null; throw e; });
  }
  return blockerPromise;
}

// session: an Electron Session (e.g. win.webContents.session). Never
// throws — if the filter lists can't be fetched (offline, blocked), the
// scan just proceeds without ad-blocking rather than failing outright.
async function enableAdblock(session) {
  try {
    const blocker = await getBlocker();
    blocker.enableBlockingInSession(session);
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { enableAdblock };
