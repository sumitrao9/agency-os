// src/preload/preload.js
// Context-isolated bridge — the renderer never gets raw Node/IPC access,
// only these specific, named functions. Standard Electron security practice.

const { contextBridge, ipcRenderer } = require('electron');

let scraperScripts = {};
let scraperUtils = {};

try {
  const pageScraper = require('../scraper/pageScraper');
  scraperScripts = {
    scrapePage: pageScraper.SCRAPE_PAGE_JS,
    autoScroll: pageScraper.AUTO_SCROLL_JS,
    hover: pageScraper.HOVER_JS,
    clickLoadMore: pageScraper.CLICK_LOAD_MORE_JS,
    dismissCookieBanner: pageScraper.DISMISS_COOKIE_BANNER_JS,
    zoomIn: pageScraper.ZOOM_IN_JS,
    zoomOut: pageScraper.ZOOM_OUT_JS,
    pan: (direction) => pageScraper.panJs(direction),
    detectCaptcha: pageScraper.DETECT_CAPTCHA_JS,
    universalScrape: pageScraper.UNIVERSAL_SCRAPE_JS,
    universalDismiss: pageScraper.UNIVERSAL_DISMISS_JS,
    universalAutoScroll: pageScraper.UNIVERSAL_AUTO_SCROLL_JS,
    universalNextPage: pageScraper.UNIVERSAL_NEXT_PAGE_JS,
  };
  scraperUtils = {
    buildSearchUrl: pageScraper.buildSearchUrl,
  };
} catch (error) {
  console.error('[Agency OS] Failed to load scraper preload helpers:', error);
}

contextBridge.exposeInMainWorld('scraperScripts', scraperScripts);
contextBridge.exposeInMainWorld('scraperUtils', scraperUtils);

const bridgeApi = {
  getAllLeads: () => ipcRenderer.invoke('leads:getAll'),
  getLead: (id) => ipcRenderer.invoke('leads:get', id),
  updateLead: (id, fields) => ipcRenderer.invoke('leads:update', { id, fields }),
  deleteLead: (id) => ipcRenderer.invoke('leads:delete', id),
  captureLead: (lead) => ipcRenderer.invoke('leads:capture', lead),
  saveLocationSpoof: (config) => ipcRenderer.invoke('spoof:save', config),
  getLocationSpoof: () => ipcRenderer.invoke('spoof:get'),
  enrichEmail: (leadId, website) => ipcRenderer.invoke('leads:enrichEmail', { leadId, website }),
  getSendCount: () => ipcRenderer.invoke('email:getSendCount'),
  applyRules: (lead) => ipcRenderer.invoke('leads:applyRules', lead),
  applyRulesBatch: (leadsArray) => ipcRenderer.invoke('leads:applyRulesBatch', leadsArray),
  renderTemplate: (templateKey, lead) => ipcRenderer.invoke('email:renderTemplate', { templateKey, lead }),
  renderFollowUp: (stage, lead) => ipcRenderer.invoke('email:renderFollowUp', { stage, lead }),
  saveEmailCredentials: (email, appPassword) => ipcRenderer.invoke('email:saveCredentials', { email, appPassword }),
  getEmailAccountStatus: () => ipcRenderer.invoke('email:getAccountStatus'),
  sendEmail: (to, subject, body, fromName, inReplyTo, references, leadId) =>
    ipcRenderer.invoke('email:send', { to, subject, body, fromName, inReplyTo, references, leadId }),
  getHealth: () => ipcRenderer.invoke('health:get'),
  getAutomationConsoleState: () => ipcRenderer.invoke('automation:consoleState'),
  applyAutomationConsoleAction: (action) => ipcRenderer.invoke('automation:consoleAction', action),
  getThemeSettings: () => ipcRenderer.invoke('theme:get'),
  saveThemeSettings: (settings) => ipcRenderer.invoke('theme:save', settings),
  getAppSettings: () => ipcRenderer.invoke('settings:get'),
  saveAppSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  getLaunchAtStartup: () => ipcRenderer.invoke('app:getLaunchAtStartup'),
  setLaunchAtStartup: (enabled) => ipcRenderer.invoke('app:setLaunchAtStartup', enabled),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  installUpdateNow: () => ipcRenderer.invoke('updater:installNow'),
  onUpdaterStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('updater:status', listener);
    return () => ipcRenderer.removeListener('updater:status', listener);
  },
  getDiagnostics: () => ipcRenderer.invoke('diagnostics:get'),
  checkReplies: () => ipcRenderer.invoke('replies:check'),
  onNewReplies: (callback) => {
    const listener = (_event, replies) => callback(replies);
    ipcRenderer.on('replies:new', listener);
    return () => ipcRenderer.removeListener('replies:new', listener);
  },
  onLeadAutoEnriched: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('leads:autoEnriched', listener);
    return () => ipcRenderer.removeListener('leads:autoEnriched', listener);
  },
  exportLeadsCsv: (leadIds) => ipcRenderer.invoke('files:exportCsv', leadIds),
  importLeadsCsv: () => ipcRenderer.invoke('files:importCsv'),
  addToBlacklist: (entry) => ipcRenderer.invoke('blacklist:add', entry),
  removeFromBlacklist: (id) => ipcRenderer.invoke('blacklist:remove', id),
  getBlacklist: () => ipcRenderer.invoke('blacklist:list'),
  checkBlacklist: (query) => ipcRenderer.invoke('blacklist:check', query),
  deepScan: (leadId, website) => ipcRenderer.invoke('leads:deepScan', { leadId, website }),
  getNormalizedBusiness: (leadId) => ipcRenderer.invoke('leads:getNormalized', leadId),
  getLeadScreenshot: (leadId) => ipcRenderer.invoke('leads:getScreenshot', leadId),
  extractLeadFromUrl: (url) => ipcRenderer.invoke('browser:extractLead', url),
  pickExtensionFolder: () => ipcRenderer.invoke('browser:pickExtensionFolder'),
  listExtensions: () => ipcRenderer.invoke('browser:listExtensions'),
  removeExtension: (id) => ipcRenderer.invoke('browser:removeExtension', id),
  setBrowserProxy: (partition, proxyRules) => ipcRenderer.invoke('browser:setProxy', { partition, proxyRules }),
  showDownloadInFolder: (savePath) => ipcRenderer.invoke('browser:showDownloadInFolder', savePath),
  onDownloadUpdate: (callback) => {
    const listener = (_event, update) => callback(update);
    ipcRenderer.on('browser:downloadUpdate', listener);
    return () => ipcRenderer.removeListener('browser:downloadUpdate', listener);
  },
  getActionQueue: () => ipcRenderer.invoke('queue:list'),
  advanceQueueStage: (leadId, stage) => ipcRenderer.invoke('queue:advance', { leadId, stage }),
  generatePitch: (leadId) => ipcRenderer.invoke('queue:generatePitch', { leadId }),
  addToQueue: (leadId) => ipcRenderer.invoke('queue:addManual', { leadId }),
  openExternal: (url) => ipcRenderer.invoke('system:openExternal', url),
  bulkStartDeepScan: (leadIds, force) => ipcRenderer.invoke('bulk:startDeepScan', { leadIds, force }),
  bulkStatus: () => ipcRenderer.invoke('bulk:status'),
  bulkCancel: () => ipcRenderer.invoke('bulk:cancel'),
  bulkDelete: (leadIds) => ipcRenderer.invoke('bulk:delete', { leadIds }),
  bulkTag: (leadIds, tag) => ipcRenderer.invoke('bulk:tag', { leadIds, tag }),
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximize: () => ipcRenderer.send('window:maximize'),
  windowClose: () => ipcRenderer.send('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),
};

contextBridge.exposeInMainWorld('agencyOS', bridgeApi);

