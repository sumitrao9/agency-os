// src/main/main.js — Electron entry point
const { app, BrowserWindow, ipcMain, dialog, shell, session, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const { createAppRuntime } = require('./appRuntime');
const { parseCsv, stringifyCsv } = require('./csv');
const { applyRules } = require('./ruleEngine');
const { attachBrowserContextMenu } = require('./browserContextMenu');
// Lazy — importing electron-updater at module load time constructs its
// NsisUpdater singleton immediately, which reads app.getVersion() before
// Electron has finished wiring up the app module in this entry point,
// crashing the whole process before a window is ever created.
let autoUpdater;
function getAutoUpdater() {
  if (!autoUpdater) ({ autoUpdater } = require('electron-updater'));
  return autoUpdater;
}

// Last-resort safety net: without these, any unhandled error/rejection
// anywhere in the main process (e.g. a stray socket 'error' event from a
// background IMAP sync) surfaces as Electron's fatal "A JavaScript error
// occurred in the main process" dialog and kills the whole app. Individual
// modules should still handle their own errors (see ImapSmtpProvider's
// client.on('error', ...)) — this is only the floor beneath that.
process.on('uncaughtException', (err) => {
  console.error('[Agency OS] Uncaught exception (main process, recovered):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Agency OS] Unhandled promise rejection (main process, recovered):', reason);
});

const LEAD_CSV_HEADERS = [
  'businessName', 'category', 'website', 'phone', 'email', 'address',
  'rating', 'reviewCount', 'status', 'priority', 'closeProbability',
  'revenueLow', 'revenueHigh', 'leadSource', 'notes',
];

// Must match BROWSER_PARTITION in src/renderer/lib/webviewProfile.ts —
// the webview tag's `partition` attribute is what actually creates/selects
// this session; this constant is only used here to reach the *same*
// session from the main process for extension loading.
const BROWSER_PARTITION = 'persist:agencyos-chrome';

// Electron only supports *unpacked* extensions via session.loadExtension()
// — no Chrome Web Store, no packed .crx installs, and MV3 support is
// partial (background service workers and content scripts work; some
// Chrome-only APIs don't exist in Electron). That's the honest ceiling;
// this is not "Chrome extension support," it's "load a local unpacked
// extension folder," which is what Electron actually provides for free.
function extensionsConfigPath() {
  return path.join(app.getPath('userData'), 'browser-extensions.json');
}

function loadExtensionPaths() {
  try { return JSON.parse(fs.readFileSync(extensionsConfigPath(), 'utf-8')); } catch { return []; }
}

function saveExtensionPaths(paths) {
  try { fs.writeFileSync(extensionsConfigPath(), JSON.stringify(paths)); } catch { /* non-fatal */ }
}

async function loadPersistedExtensions() {
  const ses = session.fromPartition(BROWSER_PARTITION);
  const paths = loadExtensionPaths();
  const stillValid = [];
  for (const dir of paths) {
    try {
      await ses.extensions.loadExtension(dir, { allowFileAccess: true });
      stillValid.push(dir);
    } catch (e) {
      console.warn(`[Agency OS] Could not reload extension at ${dir}: ${e.message || e}`);
    }
  }
  if (stillValid.length !== paths.length) saveExtensionPaths(stillValid);
}

// Tracks download progress per browser-profile session and forwards it to
// the renderer — each profile is its own session partition (see
// BROWSER_PARTITION above), so this attaches once per partition the first
// time a webview using it is created, rather than once globally.
const downloadTrackedSessions = new Set();
function attachDownloadTracking(ses, win) {
  if (downloadTrackedSessions.has(ses)) return;
  downloadTrackedSessions.add(ses);
  ses.on('will-download', (_event, item) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const savePath = item.getSavePath();
    const send = (extra) => {
      if (win.isDestroyed()) return;
      win.webContents.send('browser:downloadUpdate', {
        id, filename: item.getFilename(), url: item.getURL(),
        state: item.getState(), receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(), savePath: item.getSavePath(), ...extra,
      });
    };
    send({});
    item.on('updated', () => send({}));
    item.on('done', () => send({ done: true, savePath: savePath || item.getSavePath() }));
  });
}

let runtime;

// Checks GitHub Releases (see "publish" in package.json's build config) for
// a newer version, downloads it in the background, and prompts to restart —
// this repo is private, so electron-updater needs a GH_TOKEN with `repo`
// scope in the environment the packaged app runs under to read releases.
function setupAutoUpdater() {
  const autoUpdater = getAutoUpdater();
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const notify = (channel, payload) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  autoUpdater.on('update-available', (info) => notify('updater:status', { state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => notify('updater:status', { state: 'not-available' }));
  autoUpdater.on('error', (err) => notify('updater:status', { state: 'error', message: String(err.message || err) }));
  autoUpdater.on('download-progress', (p) => notify('updater:status', { state: 'downloading', percent: p.percent }));
  autoUpdater.on('update-downloaded', (info) => notify('updater:status', { state: 'downloaded', version: info.version }));

  ipcMain.handle('updater:check', () => autoUpdater.checkForUpdates().catch((e) => ({ error: String(e.message || e) })));
  ipcMain.handle('updater:installNow', () => autoUpdater.quitAndInstall());

  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch(() => {});
  }
}

async function createWindow() {
  const state = await runtime.initialize();
  if (state.mainWindow) runtime.emitEvent('windowCreated', { windowId: state.mainWindow.id });
}

app.on('ready', async () => {
  runtime = createAppRuntime({
    app,
    browserWindowFactory: async () => {
      const win = new BrowserWindow({
        width: 1440,
        height: 900,
        backgroundColor: '#0f1115',
        icon: path.join(__dirname, '..', '..', 'build-assets', 'icon.png'),
        frame: false, // custom traffic-light title bar is rendered in the UI instead of the OS chrome
        webPreferences: {
          preload: path.join(__dirname, '..', 'preload', 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          // The preload requires ../scraper/pageScraper to expose the scraper
          // scripts; Electron's default preload sandbox blocks requiring app
          // files. contextIsolation + nodeIntegration:false still keep the
          // renderer itself off Node.
          sandbox: false,
          webviewTag: true,
        },
      });
      win.webContents.on('will-attach-webview', (e, prefs) => {
        prefs.preload = path.join(__dirname, '..', 'renderer', 'webviewPreload.js');
        prefs.contextIsolation = false;
        if (prefs.partition) attachDownloadTracking(session.fromPartition(prefs.partition), win);
      });
      attachBrowserContextMenu(win, runtime);

      // The renderer is a Vite/React app: src/renderer/index.html references
      // main.tsx, which Chromium cannot execute directly. Always load the
      // compiled bundle, or the dev server when one is running.
      if (process.env.VITE_DEV_SERVER_URL) {
        await win.loadURL(process.env.VITE_DEV_SERVER_URL);
      } else {
        const bundledIndex = path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html');
        if (!fs.existsSync(bundledIndex)) {
          throw new Error(`Renderer bundle missing at ${bundledIndex} — run "npm run build" first.`);
        }
        await win.loadFile(bundledIndex);
      }
      return win;
    },
  });

  setupIpcHandlers();
  setupAutoUpdater();
  await createWindow();
  await loadPersistedExtensions();
  startReplyPolling();
  startDailyJobScheduler();
});

function setupIpcHandlers() {
  ipcMain.handle('leads:getAll', async (_, p) => runtime.handleIpcRequest('leads:getAll', p));
  ipcMain.handle('leads:update', async (_, p) => runtime.handleIpcRequest('leads:update', p));
  ipcMain.handle('leads:capture', async (_, p) => runtime.handleIpcRequest('leads:capture', p));
  ipcMain.handle('spoof:save', async (_, p) => runtime.handleIpcRequest('spoof:save', p));
  ipcMain.handle('spoof:get', async (_, p) => runtime.handleIpcRequest('spoof:get', p));
  ipcMain.handle('health:get', async (_, p) => runtime.handleIpcRequest('health:get', p));
  ipcMain.handle('leads:enrichEmail', async (_, p) => runtime.handleIpcRequest('leads:enrichEmail', p));
  ipcMain.handle('leads:applyRules', async (_, p) => runtime.handleIpcRequest('leads:applyRules', p));
  ipcMain.handle('leads:applyRulesBatch', async (_, p) => runtime.handleIpcRequest('leads:applyRulesBatch', p));
  ipcMain.handle('email:renderTemplate', async (_, p) => runtime.handleIpcRequest('email:renderTemplate', p));
  ipcMain.handle('email:renderFollowUp', async (_, p) => runtime.handleIpcRequest('email:renderFollowUp', p));
  ipcMain.handle('email:getSendCount', async (_, p) => runtime.handleIpcRequest('email:getSendCount', p));
  ipcMain.handle('email:accounts:list', async (_, p) => runtime.handleIpcRequest('email:accounts:list', p));
  ipcMain.handle('email:accounts:add', async (_, p) => runtime.handleIpcRequest('email:accounts:add', p));
  ipcMain.handle('email:accounts:remove', async (_, p) => runtime.handleIpcRequest('email:accounts:remove', p));
  ipcMain.handle('email:accounts:verify', async (_, p) => runtime.handleIpcRequest('email:accounts:verify', p));
  ipcMain.handle('email:oauth:start', async (_, p) => runtime.handleIpcRequest('email:oauth:start', p));
  ipcMain.handle('email:oauthApp:get', async (_, p) => runtime.handleIpcRequest('email:oauthApp:get', p));
  ipcMain.handle('email:oauthApp:save', async (_, p) => runtime.handleIpcRequest('email:oauthApp:save', p));
  ipcMain.handle('email:send', async (_, p) => runtime.handleIpcRequest('email:send', p));
  ipcMain.handle('email:sync', async (_, p) => runtime.handleIpcRequest('email:sync', p));
  ipcMain.handle('automation:consoleAction', async (_, p) => runtime.handleIpcRequest('automation:consoleAction', p));
  ipcMain.handle('automation:consoleState', async (_, p) => runtime.handleIpcRequest('automation:consoleState', p));
  ipcMain.handle('leads:get', async (_, p) => runtime.handleIpcRequest('leads:get', p));
  ipcMain.handle('leads:delete', async (_, p) => runtime.handleIpcRequest('leads:delete', p));
  ipcMain.handle('leads:deepScan', async (_, p) => runtime.handleIpcRequest('leads:deepScan', p));
  ipcMain.handle('leads:getNormalized', async (_, p) => runtime.handleIpcRequest('leads:getNormalized', p));
  ipcMain.handle('leads:getScreenshot', async (_, p) => runtime.handleIpcRequest('leads:getScreenshot', p));
  ipcMain.handle('browser:extractLead', async (_, p) => runtime.handleIpcRequest('browser:extractLead', p));

  // Single, user-provided proxy per profile — not rotation, not a bundled
  // proxy pool. The user supplies their own address (e.g. a corporate
  // proxy or a VPN's SOCKS endpoint they already have); this just wires
  // Electron's own session.setProxy() to that one address.
  ipcMain.handle('browser:setProxy', async (_, { partition, proxyRules }) => {
    try {
      const ses = session.fromPartition(partition);
      if (!proxyRules) { await ses.setProxy({ mode: 'direct' }); return { ok: true }; }
      await ses.setProxy({ proxyRules });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  });

  ipcMain.handle('browser:pickExtensionFolder', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: 'Select an unpacked extension folder (must contain manifest.json)',
      properties: ['openDirectory'],
    });
    if (canceled || !filePaths[0]) return { ok: false, error: 'Canceled' };
    const dir = filePaths[0];
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
      return { ok: false, error: 'That folder has no manifest.json — pick the extension\'s root folder (the one containing manifest.json), not a parent or subfolder.' };
    }
    try {
      const ses = session.fromPartition(BROWSER_PARTITION);
      const ext = await ses.extensions.loadExtension(dir, { allowFileAccess: true });
      const paths = loadExtensionPaths();
      if (!paths.includes(dir)) { paths.push(dir); saveExtensionPaths(paths); }
      return { ok: true, extension: { id: ext.id, name: ext.name, version: ext.version, path: dir } };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  });

  ipcMain.handle('browser:listExtensions', () => {
    const ses = session.fromPartition(BROWSER_PARTITION);
    return ses.extensions.getAllExtensions().map((e) => ({ id: e.id, name: e.name, version: e.version, path: e.path }));
  });

  ipcMain.handle('browser:showDownloadInFolder', (_, savePath) => {
    if (savePath && fs.existsSync(savePath)) shell.showItemInFolder(savePath);
    return { ok: true };
  });

  ipcMain.handle('browser:removeExtension', (_, extensionId) => {
    const ses = session.fromPartition(BROWSER_PARTITION);
    const ext = ses.extensions.getAllExtensions().find((e) => e.id === extensionId);
    try {
      ses.extensions.removeExtension(extensionId);
      if (ext) {
        const paths = loadExtensionPaths().filter((p) => p !== ext.path);
        saveExtensionPaths(paths);
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  });
  ipcMain.handle('queue:list', async () => runtime.handleIpcRequest('queue:list'));
  ipcMain.handle('queue:advance', async (_, p) => runtime.handleIpcRequest('queue:advance', p));
  ipcMain.handle('queue:generatePitch', async (_, p) => runtime.handleIpcRequest('queue:generatePitch', p));
  ipcMain.handle('queue:addManual', async (_, p) => runtime.handleIpcRequest('queue:addManual', p));
  ipcMain.handle('bulk:startDeepScan', async (_, p) => runtime.handleIpcRequest('bulk:startDeepScan', p));
  ipcMain.handle('bulk:status', async () => runtime.handleIpcRequest('bulk:status'));
  ipcMain.handle('bulk:cancel', async () => runtime.handleIpcRequest('bulk:cancel'));
  ipcMain.handle('bulk:delete', async (_, p) => runtime.handleIpcRequest('bulk:delete', p));
  ipcMain.handle('bulk:tag', async (_, p) => runtime.handleIpcRequest('bulk:tag', p));
  ipcMain.handle('system:openExternal', async (_, url) => {
    // One-click "Open Website" / "Google Maps" — only ever opens a URL the
    // user already had on file for a lead, never arbitrary renderer input.
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return { ok: false, error: 'Invalid URL' };
    try { await shell.openExternal(url); return { ok: true }; } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
  ipcMain.on('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
  ipcMain.on('window:maximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize(); else win.maximize();
  });
  ipcMain.on('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());
  ipcMain.handle('window:isMaximized', (e) => BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false);
  // A <webview> guest's compositor surface sometimes never repaints after
  // its container is resized by a collapsing/expanding layout panel (the
  // guest is a separate process — the renderer resizing its CSS box gives
  // Chromium no signal to recomposite). invalidate() forces a fresh frame;
  // this is called by BrowserModule after panel resize/collapse/expand.
  ipcMain.on('browser:invalidateView', (_, webContentsId) => {
    const wc = webContents.fromId(webContentsId);
    if (wc && !wc.isDestroyed()) wc.invalidate();
  });
  ipcMain.handle('blacklist:add', async (_, p) => runtime.handleIpcRequest('blacklist:add', p));
  ipcMain.handle('blacklist:remove', async (_, p) => runtime.handleIpcRequest('blacklist:remove', p));
  ipcMain.handle('blacklist:list', async () => runtime.handleIpcRequest('blacklist:list'));
  ipcMain.handle('blacklist:check', async (_, p) => runtime.handleIpcRequest('blacklist:check', p));
  ipcMain.handle('theme:get', async (_, p) => runtime.handleIpcRequest('theme:get', p));
  ipcMain.handle('theme:save', async (_, p) => runtime.handleIpcRequest('theme:save', p));
  ipcMain.handle('settings:get', async (_, p) => runtime.handleIpcRequest('settings:get', p));
  ipcMain.handle('settings:save', async (_, p) => runtime.handleIpcRequest('settings:save', p));

  // Windows/macOS "run at login" toggle — a real OS-level setting, not
  // something we can fake by writing to settings.json, so it goes through
  // app.setLoginItemSettings directly rather than the runtime's JSON store.
  ipcMain.handle('app:getLaunchAtStartup', () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle('app:setLaunchAtStartup', (_, enabled) => {
    app.setLoginItemSettings({ openAtLogin: !!enabled, path: process.execPath });
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle('diagnostics:get', async (_, p) => runtime.handleIpcRequest('diagnostics:get', p));
  ipcMain.handle('replies:check', async () => checkRepliesAndNotify());
  ipcMain.on('spoof:getSync', (e) => {
    e.returnValue = runtime.getState().spoofConfig;
  });

  ipcMain.handle('files:exportCsv', async (_, leadIds) => {
    let leads = await runtime.handleIpcRequest('leads:getAll');
    if (Array.isArray(leadIds) && leadIds.length) {
      const idSet = new Set(leadIds);
      leads = leads.filter((l) => idSet.has(l.id));
    }
    if (!leads.length) return { ok: false, error: 'No leads to export' };
    const { filePath, canceled } = await dialog.showSaveDialog({
      defaultPath: `leads-export-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (canceled || !filePath) return { ok: false, error: 'Export canceled' };
    try {
      // closeProbability/revenueLow/revenueHigh aren't columns on the lead
      // row itself — they're computed on demand by the same deterministic
      // rule engine the UI uses, applied here at export time so the CSV
      // always reflects current rules rather than a stale snapshot.
      const ruledLeads = leads.map((lead) => applyRules(lead));
      fs.writeFileSync(filePath, stringifyCsv(ruledLeads, LEAD_CSV_HEADERS), 'utf-8');
      return { ok: true, filePath, count: leads.length };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  });

  ipcMain.handle('files:importCsv', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      filters: [{ name: 'CSV', extensions: ['csv'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths[0]) return { ok: false, error: 'Import canceled' };
    let rows;
    try {
      rows = parseCsv(fs.readFileSync(filePaths[0], 'utf-8'));
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
    let inserted = 0;
    for (const row of rows) {
      if (!row.businessName) continue;
      const result = await runtime.handleIpcRequest('leads:capture', {
        ...row,
        leadSource: row.leadSource || 'csv-import',
      });
      if (result && result.inserted) inserted++;
    }
    return { ok: true, count: rows.length, inserted };
  });
}

// Runs the inbox check and, if anything new came in, pushes it straight to
// the renderer — this is what makes reply detection "automatic" rather than
// something the user has to remember to click.
async function checkRepliesAndNotify() {
  const result = await runtime.handleIpcRequest('replies:check');
  const win = runtime.getState().mainWindow;
  if (result && result.newReplies && result.newReplies.length && win && !win.isDestroyed()) {
    win.webContents.send('replies:new', result.newReplies);
  }
  return result;
}

const REPLY_POLL_INTERVAL_MS = 3 * 60 * 1000;
let replyPollTimer = null;
let dailyJobTimer = null;
const DAILY_JOB_CHECK_INTERVAL_MS = 60 * 60 * 1000; // checks hourly; runDailySmartJob itself no-ops if it already ran recently

function startReplyPolling() {
  if (replyPollTimer) return;
  replyPollTimer = setInterval(() => {
    checkRepliesAndNotify().catch(() => { /* errors are already recorded via runtime.recordError */ });
  }, REPLY_POLL_INTERVAL_MS);
}

function stopReplyPolling() {
  if (replyPollTimer) {
    clearInterval(replyPollTimer);
    replyPollTimer = null;
  }
}

function startDailyJobScheduler() {
  if (dailyJobTimer) return;
  const run = () => runtime.handleIpcRequest('automation:runDailyJob').catch(() => {});
  run(); // also check once on startup — covers "app wasn't open at the right hour"
  dailyJobTimer = setInterval(run, DAILY_JOB_CHECK_INTERVAL_MS);
}

function stopDailyJobScheduler() {
  if (dailyJobTimer) {
    clearInterval(dailyJobTimer);
    dailyJobTimer = null;
  }
}

app.on('before-quit', () => {
  stopReplyPolling();
  stopDailyJobScheduler();
  if (runtime) runtime.shutdown();
  require('./browserEngine').destroy();
});

app.on('window-all-closed', () => {
  stopReplyPolling();
  stopDailyJobScheduler();
  if (runtime) runtime.shutdown();
  require('./browserEngine').destroy();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
