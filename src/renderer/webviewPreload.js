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
