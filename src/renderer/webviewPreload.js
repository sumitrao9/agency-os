// src/renderer/webviewPreload.js
//
// Preload script for the embedded <webview> browser (Google Maps, Bing
// Maps, etc.) — NOT the same preload as the main app window. This is what
// gives Agency OS a real advantage over the Chrome extension: a webview
// preload runs at the earliest possible point in the guest page's
// lifecycle, and (unlike a content script fighting a page's own scripts
// for the timing race) it's not context-isolated by default, so it can
// directly override navigator.geolocation on the actual page `window`
// before Maps' own code ever runs — no timing gamble.
//
// This overrides the LOCATION the browser reports, exactly like the
// extension's spoof feature — it does not bypass CAPTCHAs, rate limits,
// or any other site protection, and never will.

const { ipcRenderer } = require('electron');

try {
  // Synchronous IPC — this MUST resolve before the page's own scripts run,
  // which is the entire point of doing this in a preload rather than an
  // executeJavaScript() call after the page has already started loading.
  const spoof = ipcRenderer.sendSync('spoof:getSync');

  if (spoof && spoof.enabled && spoof.lat && spoof.lng) {
    const FAKE_COORDS = {
      latitude: spoof.lat,
      longitude: spoof.lng,
      accuracy: 20,
      altitude: null, altitudeAccuracy: null, heading: null, speed: null,
    };
    const fakePosition = { coords: FAKE_COORDS, timestamp: Date.now() };

    if (window.navigator.geolocation) {
      window.navigator.geolocation.getCurrentPosition = function (success) {
        setTimeout(() => success(fakePosition), 30);
      };
      window.navigator.geolocation.watchPosition = function (success) {
        setTimeout(() => success(fakePosition), 30);
        return 1;
      };
      window.navigator.geolocation.clearWatch = function () {};
    }
  }
} catch (e) {
  // Spoofing is an enhancement — a failure here must never break the
  // embedded browser itself.
}

// Lightweight fingerprint realism — NOT evasion of any active protection
// (same hard boundary as the geolocation spoof above: this never touches
// CAPTCHAs, rate limits, or site defenses). The one thing worth fixing:
// every profile reporting the exact same hardwareConcurrency/deviceMemory
// as this specific dev machine is itself a correlation signal across
// scrape sessions. Seeded once per profile (this partition's own
// localStorage) and reused forever after — a value that changed on every
// page load would be a bigger tell than a machine-accurate one.
try {
  const SEED_KEY = '__agencyos_fp_seed';
  let seed = Number(window.localStorage.getItem(SEED_KEY));
  if (!seed) {
    seed = Math.floor(Math.random() * 2 ** 31);
    window.localStorage.setItem(SEED_KEY, String(seed));
  }
  // Deterministic small PRNG from the stored seed — same profile always
  // derives the same values, different profiles derive different ones.
  function seededRandom(offset) {
    const x = Math.sin(seed + offset) * 10000;
    return x - Math.floor(x);
  }

  const coreChoices = [4, 8, 12, 16];
  const memChoices = [4, 8, 16];
  const hardwareConcurrency = coreChoices[Math.floor(seededRandom(1) * coreChoices.length)];
  const deviceMemory = memChoices[Math.floor(seededRandom(2) * memChoices.length)];

  Object.defineProperty(window.navigator, 'hardwareConcurrency', { get: () => hardwareConcurrency, configurable: true });
  if ('deviceMemory' in window.navigator) {
    Object.defineProperty(window.navigator, 'deviceMemory', { get: () => deviceMemory, configurable: true });
  }
  // webdriver=true is Chromium's own automation flag, not something this
  // app sets — but a webview preload runs early enough to correct it if
  // any embedder flag ever left it on.
  if (window.navigator.webdriver) {
    Object.defineProperty(window.navigator, 'webdriver', { get: () => false, configurable: true });
  }
} catch (e) {
  // Same non-fatal policy as the block above.
}
