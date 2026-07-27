// Temporary renderer smoke test — boots the real app (main.js registers its
// own ready handler on require) then inspects the live renderer.
const { app, BrowserWindow } = require('electron');

require('./src/main/main.js');

const consoleErrors = [];
const pageErrors = [];

function log(...args) { process.stdout.write(args.join(' ') + '\n'); }

async function waitForWindow(timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length) return wins[0];
    await new Promise(r => setTimeout(r, 200));
  }
  return null;
}

app.whenReady().then(async () => {
  const win = await waitForWindow();
  if (!win) { log('SMOKE: FAIL — no BrowserWindow was ever created'); app.exit(1); return; }

  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) consoleErrors.push(message);
  });
  win.webContents.on('render-process-gone', (_e, d) => pageErrors.push('render-process-gone: ' + JSON.stringify(d)));
  win.webContents.on('did-fail-load', (_e, code, desc) => pageErrors.push(`did-fail-load ${code} ${desc}`));

  if (win.webContents.isLoading()) {
    await new Promise(r => win.webContents.once('did-finish-load', r));
  }
  // Let React commit and effects/IPC settle.
  await new Promise(r => setTimeout(r, 3000));

  try {
    const result = await win.webContents.executeJavaScript(`(() => {
      const root = document.getElementById('root');
      const cs = getComputedStyle(document.body);
      const sidebarBtns = Array.from(document.querySelectorAll('aside button')).map(b => b.textContent.trim());
      return {
        url: location.href,
        rootChildCount: root ? root.children.length : -1,
        renderedTextLength: document.body.innerText.trim().length,
        h2: Array.from(document.querySelectorAll('h2')).map(h => h.textContent.trim()),
        bodyBg: cs.backgroundColor,
        bodyColor: cs.color,
        themeAttr: document.documentElement.getAttribute('data-theme'),
        accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
        sidebarBtns,
        hasAgencyOS: typeof window.agencyOS === 'object' && window.agencyOS !== null,
        agencyOSKeys: window.agencyOS ? Object.keys(window.agencyOS).length : 0,
        hasScraperScripts: !!(window.scraperScripts && window.scraperScripts.scrapePage),
      };
    })()`);

    log('SMOKE_RESULT ' + JSON.stringify(result, null, 2));

    // Exercise a real IPC round trip the way the UI does.
    const leads = await win.webContents.executeJavaScript(
      `window.agencyOS.getAllLeads().then(l => ({ ok: true, count: l.length })).catch(e => ({ ok: false, error: String(e) }))`
    );
    log('SMOKE_IPC_getAllLeads ' + JSON.stringify(leads));

    const theme = await win.webContents.executeJavaScript(
      `window.agencyOS.getThemeSettings().then(t => ({ ok: true, t })).catch(e => ({ ok: false, error: String(e) }))`
    );
    log('SMOKE_IPC_getThemeSettings ' + JSON.stringify(theme));

    log('SMOKE_CONSOLE_ERRORS ' + JSON.stringify(consoleErrors));
    log('SMOKE_PAGE_ERRORS ' + JSON.stringify(pageErrors));

    const ok = result.rootChildCount > 0 && result.renderedTextLength > 50 && consoleErrors.length === 0 && pageErrors.length === 0;
    log('SMOKE: ' + (ok ? 'PASS' : 'FAIL'));
    app.exit(ok ? 0 : 1);
  } catch (err) {
    log('SMOKE: FAIL — executeJavaScript threw: ' + (err && err.message));
    app.exit(1);
  }
});
