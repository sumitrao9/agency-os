// src/main/browserContextMenu.js
//
// Right-click menu inside the Browser module's <webview> — the whole point
// of merging Browser + Scraper into one workspace: whatever page you're
// looking at, you can act on it immediately without switching to a
// separate scrape flow. Every action reuses the exact same IPC handlers
// (runtime.handleIpcRequest) the toolbar buttons already call, so there's
// one code path for "extract a lead" / "save a lead" / "deep scan" no
// matter which UI triggered it.
//
// Electron detail: a <webview> guest is its own WebContents, so its
// 'context-menu' event doesn't fire on the host window — it has to be
// caught on the guest WebContents itself, obtained via the host's
// 'did-attach-webview' event.

const { Menu, clipboard, app } = require('electron');
const fs = require('fs');
const path = require('path');

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;

function uniq(arr) { return [...new Set(arr)]; }

async function extractLiveEmails(contents) {
  const raw = await contents.executeJavaScript(`(() => {
    const mailtos = Array.from(document.querySelectorAll('a[href^="mailto:"]')).map(a => a.href.replace('mailto:', '').split('?')[0]);
    const body = document.body ? document.body.innerText : '';
    return JSON.stringify({ mailtos, body });
  })()`).catch(() => '{"mailtos":[],"body":""}');
  const { mailtos, body } = JSON.parse(raw);
  return uniq([...mailtos, ...(body.match(EMAIL_RE) || [])]).filter(Boolean);
}

async function extractLivePhones(contents) {
  const raw = await contents.executeJavaScript(`(() => {
    const telHrefs = Array.from(document.querySelectorAll('a[href^="tel:"]')).map(a => a.href.replace('tel:', ''));
    const body = document.body ? document.body.innerText : '';
    return JSON.stringify({ telHrefs, body });
  })()`).catch(() => '{"telHrefs":[],"body":""}');
  const { telHrefs, body } = JSON.parse(raw);
  return uniq([...telHrefs, ...(body.match(PHONE_RE) || [])]).filter(Boolean).slice(0, 10);
}

function attachBrowserContextMenu(win, runtime) {
  win.webContents.on('did-attach-webview', (_event, contents) => {
    contents.on('context-menu', (_e2, params) => {
      const pageUrl = params.pageURL || contents.getURL();
      if (!pageUrl) return;

      const send = (payload) => { if (!win.isDestroyed()) win.webContents.send('browser:contextResult', payload); };

      // Every menu action follows the same shape: tell the renderer it
      // started (so it can show a "Working…" toast), run the work, then
      // report the outcome — one place that guarantees a start/done or
      // start/error pair is always sent, so the UI never gets stuck.
      const withBusy = (action, fn) => async () => {
        send({ action, status: 'start' });
        try {
          const result = await fn();
          send({ action, status: 'done', ...result });
        } catch (e) {
          send({ action, status: 'error', error: String(e.message || e) });
        }
      };

      const quickExtract = async () => {
        const result = await runtime.handleIpcRequest('browser:extractLead', pageUrl);
        if (!result.ok) throw new Error(result.error || 'Could not read this page');
        return result;
      };

      const ensureLead = async () => {
        const extracted = await quickExtract();
        const captureResult = await runtime.handleIpcRequest('leads:capture', {
          businessName: extracted.businessName || contents.getTitle() || new URL(pageUrl).hostname,
          website: extracted.website,
          email: extracted.email,
          phone: extracted.phone,
          notes: extracted.description,
          leadSource: 'browser-context-menu',
        });
        if (!captureResult.id) throw new Error(captureResult.blacklisted ? 'Blocked — on do-not-contact list' : 'Could not save this lead');
        return { extracted, captureResult };
      };

      const menu = Menu.buildFromTemplate([
        {
          label: '🔍 Scrape Page',
          click: withBusy('scrapePage', async () => ({ extracted: await quickExtract() })),
        },
        {
          label: '💾 Save Lead',
          click: withBusy('saveLead', async () => {
            const { captureResult } = await ensureLead();
            return { captureResult };
          }),
        },
        {
          label: '📧 Extract Emails',
          click: withBusy('extractEmails', async () => {
            const emails = await extractLiveEmails(contents);
            if (emails.length) clipboard.writeText(emails.join(', '));
            return { emails };
          }),
        },
        {
          label: '📞 Extract Phones',
          click: withBusy('extractPhones', async () => {
            const phones = await extractLivePhones(contents);
            if (phones.length) clipboard.writeText(phones.join(', '));
            return { phones };
          }),
        },
        {
          label: '📸 Capture Screenshot',
          click: withBusy('screenshot', async () => {
            const image = await contents.capturePage();
            const dir = path.join(app.getPath('userData'), 'screenshots');
            fs.mkdirSync(dir, { recursive: true });
            const filePath = path.join(dir, `screenshot_${Date.now()}.png`);
            fs.writeFileSync(filePath, image.toPNG());
            return { filePath };
          }),
        },
        {
          label: '🏢 Save Company',
          click: withBusy('saveCompany', async () => {
            // "Company" = the full deep-scan profile (SEO/accessibility/tech
            // stack/opportunities), not just a quick lead row — same
            // pipeline the Leads screen's Deep Scan button runs.
            const { captureResult, extracted } = await ensureLead();
            const deep = await runtime.handleIpcRequest('leads:deepScan', { leadId: captureResult.id, website: extracted.website });
            return { captureResult, deep };
          }),
        },
        {
          label: '📤 Send to CRM',
          click: withBusy('sendToCrm', async () => {
            const { captureResult } = await ensureLead();
            const queueResult = await runtime.handleIpcRequest('queue:addManual', { leadId: captureResult.id });
            return { captureResult, queueResult };
          }),
        },
      ]);
      menu.popup();
    });
  });
}

module.exports = { attachBrowserContextMenu };
