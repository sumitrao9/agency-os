// src/main/screenshot.js
//
// Renders a lead's website in a hidden window and saves a PNG — the one
// piece of "raw data collection" that genuinely needs a browser engine
// (deepScan.js's plain HTTP fetch can't rasterize a page). Same
// hidden-BrowserWindow-per-call pattern as emailDiscovery.js.

const { BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { enableAdblock } = require('./adblock');

// axe-core ships as a single injectable script — read once, reused across
// every scan rather than re-reading the file per call.
const AXE_SOURCE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

async function captureScreenshot(website, outDir, fileNameBase) {
  if (!website) return { ok: false, error: 'No website on file' };
  let base;
  try {
    base = new URL(website.startsWith('http') ? website : `https://${website}`).origin;
  } catch (e) {
    return { ok: false, error: 'Invalid website URL' };
  }

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { offscreen: true },
  });

  try {
    // Ads/trackers add nothing to a scan that only measures the business's
    // own site — blocking them keeps the load fast and representative.
    await enableAdblock(win.webContents.session);

    const start = Date.now();
    await Promise.race([
      win.loadURL(base),
      new Promise((_, reject) => setTimeout(() => reject(new Error('page load timed out')), 15000)),
    ]);
    const loadTimeMs = Date.now() - start;
    // Let above-the-fold content (fonts, lazy images) settle before capture,
    // and gives the LCP entry time to actually fire.
    await new Promise((r) => setTimeout(r, 1500));

    let performance = { loadTimeMs, lcpMs: null };
    try {
      const lcp = await win.webContents.executeJavaScript(
        `(() => { const e = performance.getEntriesByType('largest-contentful-paint'); return e.length ? e[e.length - 1].renderTime || e[e.length - 1].loadTime : null; })()`
      );
      performance.lcpMs = typeof lcp === 'number' && lcp > 0 ? Math.round(lcp) : null;
    } catch (e) { /* LCP unsupported on this page/renderer — leave null */ }

    // Real WCAG rule evaluation (axe-core), run in the actual rendered
    // page — a genuine accessibility audit, not a heuristic guess.
    let accessibility = null;
    try {
      await win.webContents.executeJavaScript(AXE_SOURCE);
      const axeResult = await win.webContents.executeJavaScript(
        `axe.run().then(r => ({ violations: r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodeCount: v.nodes.length })), passCount: r.passes.length }))`
      );
      accessibility = axeResult;
    } catch (e) { /* axe couldn't run on this page — leave null, not a guess */ }

    const image = await win.webContents.capturePage();
    fs.mkdirSync(outDir, { recursive: true });
    const filePath = path.join(outDir, `${fileNameBase}.png`);
    fs.writeFileSync(filePath, image.toPNG());
    return { ok: true, filePath, performance, accessibility };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

module.exports = { captureScreenshot };
