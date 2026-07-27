const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { Database } = require('./database');
const { createConnectorServer } = require('./connectorServer');
const { applyRules } = require('./ruleEngine');
const { renderTemplate, renderFollowUp } = require('./templates');
const { createTransport, sendEmail, verifyCredentials } = require('./mailer');
const { runStartupHealthCheck } = require('./healthCheck');
const { discoverEmail } = require('./emailDiscovery');
const { runDeepScan, fetchBinary } = require('./deepScan');
const { verifyEmail } = require('./emailVerification');
const { normalizeBusiness } = require('./normalizeBusiness');
const { analyzeWebsite } = require('./websiteAnalyzer');
const { analyzeBusiness, businessMaturity } = require('./businessAnalyzer');
const { analyzeTechnology } = require('./technologyAnalyzer');
const { findOpportunities } = require('./opportunityAnalyzer');
const { scoreLead } = require('./scoringEngine');
const { decideAction } = require('./decisionEngine');
const { buildProposal } = require('./recommendationEngine');
const { generateAutoNote } = require('./autoNotes');
const { captureScreenshot } = require('./screenshot');
const { ReplyTracker } = require('./replyTracker');
const { stringifyCsv } = require('./csv');

const WORKFLOW_CSV_HEADERS = [
  'businessName', 'category', 'website', 'phone', 'email', 'address',
  'rating', 'reviewCount', 'status', 'priority', 'leadSource', 'notes',
];

// Once a lead has reached one of these, an inbox reply is old news — it must
// never downgrade a lead a human has already moved further along manually.
const REPLY_UPGRADE_FROM = new Set(['New', 'Sent', 'Qualified']);

const CONNECTOR_PORT = 8420;
const SMTP_WARN_AT = 80;
const SMTP_HARD_STOP_AT = 120;

function createAppRuntime({ app, browserWindowFactory, isTest = false }) {
  let state = {
    status: 'idle',
    db: null,
    mainWindow: null,
    connectorServer: null,
    mailTransport: null,
    mailAccountEmail: null,
    lastHealthCheck: null,
    lastReplyCheck: null,
    spoofConfig: { enabled: false, lat: null, lng: null },
    sendCount: { date: '', count: 0 },
    env: {},
    errors: [],
    actionQueue: [],
  };

  let userDataDir, dbPath, spoofConfigPath, sendCountPath, credentialsPath, actionQueuePath;
  let actionQueueLoaded = false;

  function initializePaths() {
    if (!userDataDir) {
      // Always prefer the host app's userData path — tests pass a throwaway
      // temp dir this way, which keeps each run isolated. The test-data
      // fallback only applies when no app object was supplied at all.
      userDataDir = (app && typeof app.getPath === 'function')
        ? app.getPath('userData')
        : path.join(__dirname, '..', '..', 'test-data');
      dbPath = path.join(userDataDir, 'agency-os.sqlite');
      spoofConfigPath = path.join(userDataDir, 'location-spoof.json');
      sendCountPath = path.join(userDataDir, 'send-count.json');
      credentialsPath = path.join(userDataDir, 'smtp-credentials.json');
      actionQueuePath = path.join(userDataDir, 'action-queue.json');
    }
  }

  function recordError(message) {
    const error = { message, at: new Date().toISOString() };
    state.errors.push(error);
    if (state.errors.length > 20) state.errors.shift();
    return error;
  }

  function setStatus(status) {
    state.status = status;
  }

  function loadJsonFile(targetPath, fallback) {
    try {
      if (!fs.existsSync(targetPath)) return fallback;
      return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    } catch (error) {
      recordError(`Failed to load ${path.basename(targetPath)}: ${error.message || error}`);
      return fallback;
    }
  }

  function saveJsonFile(targetPath, payload) {
    try {
      // The data directory may not exist yet on a first run; without this the
      // write fails with ENOENT and the setting is silently dropped.
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, JSON.stringify(payload));
      return true;
    } catch (error) {
      recordError(`Failed to save ${path.basename(targetPath)}: ${error.message || error}`);
      return false;
    }
  }

  // Fire-and-forget webhook delivery for newly captured leads — lets a lead
  // flow straight into an external tool (Zapier/Make/n8n, or a CRM's own
  // webhook intake) the moment it's saved, with zero manual export step.
  // Never awaited by the caller and never throws — a slow or unreachable
  // webhook endpoint must not block or fail lead capture itself.
  function postWebhook(url, payload) {
    try {
      const target = new URL(url);
      const body = JSON.stringify(payload);
      const client = target.protocol === 'http:' ? http : https;
      const req = client.request(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 10000,
      }, (res) => {
        res.resume(); // drain the response so the socket can close
        if (res.statusCode >= 400) recordError(`Webhook responded ${res.statusCode} for ${target.hostname}`);
      });
      req.on('timeout', () => req.destroy());
      req.on('error', (e) => recordError(`Webhook delivery failed: ${e.message || e}`));
      req.write(body);
      req.end();
    } catch (e) {
      recordError(`Webhook delivery failed: ${e.message || e}`);
    }
  }

  function notifyWebhookOfCapture(lead) {
    const settings = loadJsonFile(path.join(userDataDir, 'settings.json'), {});
    if (!settings.webhookUrl) return;
    postWebhook(settings.webhookUrl, {
      event: 'lead.captured',
      at: new Date().toISOString(),
      lead: {
        id: lead.id, businessName: lead.businessName, category: lead.category,
        website: lead.website, phone: lead.phone, email: lead.email, address: lead.address,
        rating: lead.rating, reviewCount: lead.reviewCount, leadSource: lead.leadSource,
      },
    });
  }

  function loadSendCount() {
    const today = new Date().toISOString().slice(0, 10);
    const parsed = loadJsonFile(sendCountPath, { date: '', count: 0 });
    state.sendCount = parsed.date === today ? parsed : { date: today, count: 0 };
  }

  // The automation console shows real state only — no simulated/demo jobs.
  // The one background job this app actually runs is bulk deep-scan
  // enrichment; the "queue" is the real action queue; "alerts" surface
  // real recorded errors and configuration gaps.
  function buildAutomationConsoleState() {
    loadActionQueue();
    const jobs = [];
    if (bulkJob) {
      const progress = bulkJob.total > 0 ? Math.round((bulkJob.completed / bulkJob.total) * 100) : 0;
      jobs.push({
        id: 'bulk-enrichment',
        name: bulkJob.currentLead ? `Deep scan: ${bulkJob.currentLead}` : 'Bulk deep scan',
        status: bulkJob.status === 'running' ? 'running'
          : bulkJob.status === 'cancelled' ? 'paused'
          : bulkJob.status === 'done' ? 'completed' : 'failed',
        progress,
        profile: `${bulkJob.completed}/${bulkJob.total} leads`,
        retries: bulkJob.errors.length,
      });
    }

    const queue = state.actionQueue.slice(0, 20).map((e) => ({
      id: e.leadId,
      label: e.businessName,
      detail: `${e.decision} · ${e.stage.replace(/_/g, ' ')}`,
    }));

    const alerts = [];
    if (!state.mailAccountEmail) {
      alerts.push({ id: 'alert-smtp', label: 'Email not configured — outreach sending is disabled', severity: 'warning' });
    }
    for (const err of state.errors.slice(-5).reverse()) {
      alerts.push({ id: `alert-err-${err.at}`, label: err.message, severity: 'error' });
    }
    if (jobs.length === 0 && alerts.length === 0) {
      alerts.push({ id: 'alert-idle', label: 'No background jobs running', severity: 'info' });
    }

    return { jobs, queue, alerts };
  }

  // --- Action Queue (Step 11: Lead -> Decision -> Queue -> Pitch -> Send -> ... -> Won) ---
  function loadActionQueue() {
    initializePaths();
    if (actionQueueLoaded) return;
    actionQueueLoaded = true;
    const parsed = loadJsonFile(actionQueuePath, null);
    if (Array.isArray(parsed)) state.actionQueue = parsed;
  }

  function saveActionQueue() {
    initializePaths();
    return saveJsonFile(actionQueuePath, state.actionQueue);
  }

  // Only decisions worth acting on join the queue — "Follow later"/"Archive"
  // leads stay in the leads table but never clutter the action queue.
  const QUEUE_ELIGIBLE_DECISIONS = new Set(['Call today', 'Email today', 'Priority', 'Good lead']);

  function upsertQueueEntry(lead, decision, proposal) {
    loadActionQueue();
    const now = new Date().toISOString();
    const existing = state.actionQueue.find((e) => e.leadId === lead.id);
    if (!QUEUE_ELIGIBLE_DECISIONS.has(decision)) {
      // A re-scan can downgrade a lead below the queue threshold — drop it
      // from the queue rather than leaving a stale, no-longer-relevant entry.
      if (existing) state.actionQueue = state.actionQueue.filter((e) => e.leadId !== lead.id);
      saveActionQueue();
      return;
    }
    if (existing) {
      existing.decision = decision;
      existing.proposal = proposal;
      existing.businessName = lead.businessName;
      existing.updatedAt = now;
    } else {
      state.actionQueue.push({
        leadId: lead.id, businessName: lead.businessName, decision, proposal,
        stage: 'queued', pitch: null, createdAt: now, updatedAt: now,
      });
    }
    saveActionQueue();
  }

  function advanceQueueStage(leadId, stage) {
    loadActionQueue();
    const entry = state.actionQueue.find((e) => e.leadId === leadId);
    if (!entry) return null;
    entry.stage = stage;
    entry.updatedAt = new Date().toISOString();
    saveActionQueue();
    return entry;
  }

  // Smart cache: re-scanning a site you already scanned this week wastes
  // time and bandwidth for no new information — most small-business sites
  // don't change day to day. `force` bypasses this for a genuine re-check.
  const DEEP_SCAN_CACHE_MS = 7 * 24 * 60 * 60 * 1000;

  function isDeepScanCacheFresh(lead) {
    const scannedAt = lead.customFields && lead.customFields.deepScan && lead.customFields.deepScan.scannedAt;
    if (!scannedAt) return false;
    return Date.now() - new Date(scannedAt).getTime() < DEEP_SCAN_CACHE_MS;
  }

  // The full Step 3-11 pipeline (scan -> screenshot -> analyze -> score ->
  // recommend -> queue) for one lead, shared by the single-lead IPC path
  // and the bulk background job below so the two never drift apart.
  async function runFullEnrichment(lead, { website: websiteOverride, force = false } = {}) {
    const website = websiteOverride || lead.website;
    if (!website) return { ok: false, error: 'No website on file' };

    if (!force && isDeepScanCacheFresh(lead)) {
      return {
        ok: true,
        cached: true,
        deepScan: lead.customFields.deepScan,
        websiteAnalysis: lead.customFields.websiteAnalysis,
        businessProfile: lead.customFields.businessProfile,
        techStack: lead.customFields.techStack,
        opportunities: lead.customFields.opportunities,
        scoring: lead.customFields.scoring,
        proposal: lead.customFields.proposal,
        autoNote: lead.customFields.autoNote,
        emailVerification: lead.customFields.emailVerification,
      };
    }

    const scan = await runDeepScan(website);
    const scanDir = path.join(userDataDir, 'deepscan');
    let screenshotPath = null;
    let htmlPath = null;
    let performance = null;
    let accessibility = null;
    if (scan.ok) {
      try {
        fs.mkdirSync(scanDir, { recursive: true });
        htmlPath = path.join(scanDir, `${lead.id}.html`);
        fs.writeFileSync(htmlPath, scan.html, 'utf-8');
      } catch (e) { recordError(`Failed to save deep-scan HTML: ${e.message || e}`); }
      const shot = await captureScreenshot(website, scanDir, lead.id);
      if (shot.ok) { screenshotPath = shot.filePath; performance = shot.performance; accessibility = shot.accessibility; }
    }

    const summary = scan.ok
      ? {
          scannedAt: scan.scannedAt,
          socialLinks: scan.socialLinks,
          description: scan.description,
          openingHours: scan.openingHours,
          categories: scan.categories,
          images: scan.images,
          emails: scan.emails,
          technologies: scan.technologies,
          keywords: scan.keywords,
          robotsTxt: scan.robotsTxt,
          sitemapUrls: scan.sitemapUrls,
          dns: scan.dns,
          headers: scan.headers,
          language: scan.language,
          htmlPath,
          screenshotPath,
        }
      : { scannedAt: new Date().toISOString(), error: scan.error, dns: scan.dns || { a: [], mx: [] } };

    let faviconPath = null;
    if (scan.ok && scan.faviconUrl) {
      try {
        const favRes = await fetchBinary(scan.faviconUrl, 5000);
        if (favRes.ok && favRes.status === 200 && favRes.buffer && favRes.buffer.length) {
          fs.mkdirSync(scanDir, { recursive: true });
          const ext = /\.png/i.test(scan.faviconUrl) ? 'png' : /\.svg/i.test(scan.faviconUrl) ? 'svg' : 'ico';
          faviconPath = path.join(scanDir, `${lead.id}-favicon.${ext}`);
          fs.writeFileSync(faviconPath, favRes.buffer);
        }
      } catch (e) { /* favicon missing/unreachable — not worth failing the whole scan over */ }
    }

    const emailVerification = verifyEmail(lead.email, scan.ok ? scan.dns.mx : []);

    const analysis = scan.ok ? await analyzeWebsite(website, scan, performance, accessibility) : null;

    const business = normalizeBusiness({ ...lead, customFields: { ...(lead.customFields || {}), deepScan: summary } });
    const bizAnswers = analyzeBusiness(lead, business, scan.ok ? scan : {});
    const maturity = businessMaturity(bizAnswers);
    const businessProfile = { analyzedAt: new Date().toISOString(), answers: bizAnswers._list, maturity };
    const techStack = scan.ok ? analyzeTechnology(scan) : null;
    const opportunities = findOpportunities(lead, techStack, analysis && analysis.ok ? analysis : null, businessProfile);

    const scoring = scoreLead({
      lead, business, analysis: analysis && analysis.ok ? analysis : null,
      techStack, businessProfile, opportunities,
    });
    const decision = decideAction(scoring.total);
    const proposal = buildProposal(opportunities);
    const scoreResult = { scoredAt: new Date().toISOString(), ...scoring, decision };
    const autoNote = generateAutoNote(lead, scoreResult, opportunities);

    state.db.updateLead(lead.id, {
      customFields: {
        ...(lead.customFields || {}),
        deepScan: summary,
        ...(analysis && analysis.ok ? { websiteAnalysis: { analyzedAt: analysis.analyzedAt, checks: analysis.checks, summary: analysis.summary } } : {}),
        businessProfile,
        ...(techStack ? { techStack } : {}),
        opportunities,
        scoring: scoreResult,
        proposal,
        autoNote,
        faviconPath,
        emailVerification,
        timezone: business.timezone,
        language: business.language,
        suggestedCategory: business.suggestedCategory,
      },
    });
    upsertQueueEntry(lead, decision, proposal);

    return {
      ok: scan.ok,
      cached: false,
      deepScan: summary,
      websiteAnalysis: analysis && analysis.ok ? analysis : undefined,
      businessProfile,
      techStack: techStack || undefined,
      opportunities,
      scoring: scoreResult,
      proposal,
      autoNote,
      error: scan.ok ? undefined : scan.error,
    };
  }

  // Fired-and-forgotten right after a new lead lands (see 'leads:capture'
  // below) — turns "capture → scan → score → find email" from four manual
  // clicks into one. Runs one lead at a time inline (no queue needed: new
  // captures arrive one at a time from the scraper/extension, unlike a
  // bulk CSV import which already has startBulkEnrichment for that).
  async function autoEnrichNewLead(leadId) {
    if (!state.db) return;
    const lead = state.db.getAllLeads().find((l) => l.id === leadId);
    if (!lead || !lead.website) return;

    try {
      await runFullEnrichment(lead, { website: lead.website });

      const scanned = state.db.getAllLeads().find((l) => l.id === leadId);
      if (scanned && !scanned.email) {
        const result = await discoverEmail(scanned.website);
        if (result.ok && result.email) {
          const fields = { email: result.email };
          if (result.contactPageUrl) fields.customFields = { ...(scanned.customFields || {}), contactPageUrl: result.contactPageUrl, ...(result.guessed ? { emailGuessed: true } : {}) };
          state.db.updateLead(leadId, fields);
        }
      }
    } catch (e) {
      recordError(`Auto-enrich failed for lead ${leadId}: ${e.message || e}`);
    }

    const win = state.mainWindow;
    if (win && !win.isDestroyed()) win.webContents.send('leads:autoEnriched', { leadId });
  }

  // --- Bulk enrichment job (runs in the background, one lead at a time,
  // so a 50-lead selection doesn't freeze the UI or hammer sites at once) ---
  let bulkJob = null;

  function startBulkEnrichment(leadIds, force) {
    if (bulkJob && bulkJob.status === 'running') return { ok: false, error: 'A bulk job is already running' };
    bulkJob = {
      status: 'running', total: leadIds.length, completed: 0,
      currentLead: null, errors: [], startedAt: new Date().toISOString(), finishedAt: null,
    };
    const job = bulkJob;

    (async () => {
      for (const leadId of leadIds) {
        if (job.status === 'cancelled') break;
        const lead = state.db.getAllLeads().find((l) => l.id === leadId);
        if (!lead) { job.completed++; continue; }
        job.currentLead = lead.businessName;
        try {
          await runFullEnrichment(lead, { force });
        } catch (e) {
          job.errors.push({ leadId, businessName: lead.businessName, error: String(e.message || e) });
        }
        job.completed++;
      }
      job.status = job.status === 'cancelled' ? 'cancelled' : 'done';
      job.currentLead = null;
      job.finishedAt = new Date().toISOString();
    })();

    return { ok: true };
  }

  // "Auto Daily Smart Jobs" — self-paced (not clock-based) re-enrichment of
  // stale leads. Runs at most once per DAILY_JOB_INTERVAL_MS regardless of
  // when the app happens to be open, so it doesn't need the app running at
  // a specific hour to do its job. Reuses the exact same bulk-enrichment
  // engine as manual bulk actions — no separate code path to drift out of sync.
  const DAILY_JOB_INTERVAL_MS = 20 * 60 * 60 * 1000; // ~20h, tolerant of the app not being open exactly every 24h
  const DAILY_JOB_BATCH_CAP = 25; // a background job should never quietly hammer dozens of sites at once

  async function runDailySmartJob() {
    initializePaths();
    if (!state.db) return { ok: false, error: 'Database not ready' };
    const lastRunPath = path.join(userDataDir, 'daily-job-last-run.json');
    const last = loadJsonFile(lastRunPath, { lastRunAt: null });
    if (last.lastRunAt && Date.now() - new Date(last.lastRunAt).getTime() < DAILY_JOB_INTERVAL_MS) {
      return { ok: true, skipped: true, reason: 'Ran recently', lastRunAt: last.lastRunAt };
    }
    if (bulkJob && bulkJob.status === 'running') return { ok: true, skipped: true, reason: 'A bulk job is already running' };

    const stale = state.db.getAllLeads()
      .filter((l) => l.website && !isDeepScanCacheFresh(l))
      .slice(0, DAILY_JOB_BATCH_CAP)
      .map((l) => l.id);

    saveJsonFile(lastRunPath, { lastRunAt: new Date().toISOString() });

    const followUpResult = await runAutoFollowUpSequence();

    if (!stale.length) return { ok: true, skipped: true, reason: 'Nothing stale to refresh', followUp: followUpResult };

    startBulkEnrichment(stale, false);
    return { ok: true, started: stale.length, followUp: followUpResult };
  }

  // Auto-send follow-up sequences — OFF by default (settings.autoFollowUp
  // must be explicitly enabled) because unattended email sending is a real
  // risk (deliverability, sending to the wrong person, exceeding limits)
  // that a background scan/score job doesn't carry. Nudge at 4 days
  // untouched, breakup at 10, then stops — never a third auto-send.
  const FOLLOWUP_NUDGE_AFTER_MS = 4 * 24 * 60 * 60 * 1000;
  const FOLLOWUP_BREAKUP_AFTER_MS = 10 * 24 * 60 * 60 * 1000;
  const FOLLOWUP_BATCH_CAP = 15;

  function lastSentAt(lead) {
    const sent = (lead.history || []).filter((h) => /email sent|follow-up.*sent/i.test(h.event));
    return sent.length ? new Date(sent[sent.length - 1].at).getTime() : null;
  }

  async function runAutoFollowUpSequence() {
    if (!state.db) return { ok: false, error: 'Database not ready' };
    const settings = loadJsonFile(path.join(userDataDir, 'settings.json'), {});
    if (!settings.autoFollowUp) return { ok: true, skipped: true, reason: 'Auto follow-up disabled in Settings' };
    if (!state.mailTransport) return { ok: true, skipped: true, reason: 'No SMTP credentials configured' };

    const now = Date.now();
    const candidates = state.db.getAllLeads().filter((l) => l.status === 'Sent' && l.email);
    const sentResults = [];
    const skippedResults = [];

    for (const lead of candidates) {
      if (sentResults.length >= FOLLOWUP_BATCH_CAP) break;
      const stage = (lead.customFields && lead.customFields.followUpStage) || 'none';
      if (stage === 'breakup' || stage === 'completed') continue; // sequence already finished for this lead

      const since = lastSentAt(lead);
      if (since == null) continue;
      const elapsed = now - since;

      let nextStage = null;
      if (stage === 'none' && elapsed >= FOLLOWUP_NUDGE_AFTER_MS) nextStage = 'nudge';
      else if (stage === 'nudge' && elapsed >= FOLLOWUP_BREAKUP_AFTER_MS) nextStage = 'breakup';
      if (!nextStage) continue;

      const rendered = renderFollowUp(nextStage, lead);
      const result = await handleIpcRequest('email:send', {
        to: lead.email, subject: rendered.subject, body: rendered.body,
        fromName: settings.email?.fromName || '', leadId: lead.id, followUpStage: nextStage,
      });
      if (result.ok) sentResults.push({ leadId: lead.id, businessName: lead.businessName, stage: nextStage });
      else skippedResults.push({ leadId: lead.id, businessName: lead.businessName, reason: result.error });
      if (result.limitReached) break; // daily cap hit — stop, don't keep hammering
    }
    return { ok: true, sent: sentResults.length, sentResults, skippedResults };
  }

  function recordSend() {
    loadSendCount();
    state.sendCount.count += 1;
    saveJsonFile(sendCountPath, state.sendCount);
  }

  function loadSpoofConfig() {
    state.spoofConfig = loadJsonFile(spoofConfigPath, { enabled: false, lat: null, lng: null });
  }

  function saveSpoofConfig(config) {
    state.spoofConfig = config;
    return saveJsonFile(spoofConfigPath, config);
  }

  function loadCredentials() {
    try {
      if (!fs.existsSync(credentialsPath)) return null;
      const parsed = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
      if (parsed.encrypted && require('electron').safeStorage.isEncryptionAvailable()) {
        const appPassword = require('electron').safeStorage.decryptString(Buffer.from(parsed.appPassword, 'base64'));
        return { email: parsed.email, appPassword };
      }
      if (!parsed.encrypted) {
        return { email: parsed.email, appPassword: parsed.appPassword };
      }
      return null;
    } catch (error) {
      recordError(`Failed to load SMTP credentials: ${error.message || error}`);
      return null;
    }
  }

  function saveCredentials(email, appPassword) {
    const electron = require('electron');
    const canEncrypt = electron.safeStorage.isEncryptionAvailable();
    const payload = canEncrypt
      ? { encrypted: true, email, appPassword: electron.safeStorage.encryptString(appPassword).toString('base64') }
      : { encrypted: false, email, appPassword };
    fs.writeFileSync(credentialsPath, JSON.stringify(payload));
    return canEncrypt;
  }

  async function restoreSavedCredentials() {
    const savedCreds = loadCredentials();
    if (!savedCreds || !savedCreds.email || !savedCreds.appPassword) return;
    try {
      const transport = createTransport(savedCreds);
      const verify = await verifyCredentials(transport);
      if (verify.ok) {
        state.mailTransport = transport;
        state.mailAccountEmail = savedCreds.email;
      } else {
        recordError(`Saved SMTP credentials failed verification: ${verify.error}`);
      }
    } catch (error) {
      recordError(`Failed to restore SMTP credentials: ${error.message || error}`);
    }
  }

  let replyTracker = null;
  function getReplyTracker() {
    if (!replyTracker) {
      replyTracker = new ReplyTracker({
        getCredentials: () => loadCredentials(),
        onError: (message) => recordError(message),
      });
    }
    return replyTracker;
  }

  async function checkReplies() {
    if (!state.db) return { checked: false, newReplies: [] };

    const leads = state.db.getAllLeads();
    const addressToLead = new Map();
    for (const lead of leads) {
      if (!lead.email) continue;
      const key = lead.email.toLowerCase().trim();
      // A reply is only meaningful for a lead we've actually contacted —
      // matching against every lead with an email would also "detect" a
      // reply from someone who simply emailed in cold on their own.
      if (REPLY_UPGRADE_FROM.has(lead.status) || lead.status === 'Replied') {
        if (!addressToLead.has(key)) addressToLead.set(key, lead);
      }
    }

    const found = await getReplyTracker().checkReplies(new Set(addressToLead.keys()));
    state.lastReplyCheck = new Date().toISOString();

    const newReplies = [];
    for (const reply of found) {
      const lead = addressToLead.get(reply.fromAddress);
      if (!lead) continue;

      const fields = {
        customFields: {
          ...(lead.customFields || {}),
          lastReply: { snippet: reply.snippet, receivedAt: reply.receivedAt, subject: reply.subject },
        },
        history: [
          ...(lead.history || []),
          { at: reply.receivedAt, event: `Reply received: "${reply.snippet.slice(0, 80)}"` },
        ],
      };
      if (REPLY_UPGRADE_FROM.has(lead.status)) fields.status = 'Replied';

      state.db.updateLead(lead.id, fields);
      advanceQueueStage(lead.id, 'replied');
      newReplies.push({ leadId: lead.id, businessName: lead.businessName, snippet: reply.snippet, fromAddress: reply.fromAddress });
      // Multiple leads could theoretically share one email address; once
      // matched, don't match the same inbox message to a second lead too.
      addressToLead.delete(reply.fromAddress);
    }

    return { checked: true, newReplies };
  }

  async function initialize() {
    initializePaths();
    setStatus('initializing');
    loadSpoofConfig();
    loadSendCount();
    state.db = new Database(dbPath);
    await state.db.init();

    const backupDir = path.join(userDataDir, 'backups');
    const backupResult = state.db.backup(backupDir);
    if (backupResult.ok) {
      console.log(`[Agency OS] Backup created: ${backupResult.path} (keeping ${backupResult.totalBackups})`);
    } else {
      console.warn(`[Agency OS] Backup skipped: ${backupResult.error}`);
    }

    await restoreSavedCredentials();
    const health = runStartupHealthCheck(state.db, state.spoofConfig, !!state.mailTransport);
    state.lastHealthCheck = health;
    console.log('[Agency OS] Startup health check:', health.ok ? 'OK' : 'ISSUES FOUND');
    health.results.forEach((result) => {
      console.log(`  ${result.ok ? '✓' : '✗'} ${result.check}: ${result.detail}`);
    });

    // The connector is an optional convenience (the Chrome extension posts
    // leads to it). If the port is taken — a second instance, or a stale
    // process — degrade to running without it rather than letting an
    // unhandled 'error' event tear the whole app down on startup.
    state.connectorServer = createConnectorServer(state.db);
    state.connectorServer.on('error', (error) => {
      const detail = error && error.code === 'EADDRINUSE'
        ? `port ${CONNECTOR_PORT} is already in use — extension connector disabled for this session`
        : `connector server error: ${error.message || error}`;
      recordError(detail);
      console.warn(`[Agency OS] ${detail}`);
      try { state.connectorServer.close(); } catch { /* already down */ }
      state.connectorServer = null;
    });
    state.connectorServer.listen(CONNECTOR_PORT, () => {
      console.log(`[Agency OS] Extension Connector listening on http://localhost:${CONNECTOR_PORT}`);
    });

    if (!isTest) {
      state.mainWindow = await browserWindowFactory();
    }

    state.status = 'ready';
    return state;
  }

  function getState() {
    return {
      ...state,
      db: state.db,
      mainWindow: state.mainWindow,
      connectorServer: state.connectorServer,
      mailTransport: state.mailTransport,
      mailAccountEmail: state.mailAccountEmail,
      lastHealthCheck: state.lastHealthCheck,
      spoofConfig: state.spoofConfig,
      sendCount: state.sendCount,
      errors: [...state.errors],
    };
  }

  function emitEvent(name, payload) {
    return { name, payload };
  }

  function applyAutomationConsoleAction(action) {
    // Only one real action exists: cancelling the running bulk-enrichment
    // job. There's no per-job pause/retry to fake — a single background
    // job either is running or it isn't.
    if (action && action.type === 'cancel-job' && bulkJob && bulkJob.status === 'running') {
      bulkJob.status = 'cancelled';
    }
    return buildAutomationConsoleState();
  }

  function shutdown() {
    if (state.connectorServer) {
      try { state.connectorServer.close(); } catch (error) { recordError(`Connector shutdown warning: ${error.message || error}`); }
      state.connectorServer = null;
    }
    if (state.db) {
      try { state.db.flush(); } catch (error) { recordError(`DB flush warning: ${error.message || error}`); }
      try { state.db.close(); } catch (error) { recordError(`DB close warning: ${error.message || error}`); }
      state.db = null;
    }
    state.status = 'stopped';
  }

  async function handleIpcRequest(channel, payload) {
    switch (channel) {
      case 'leads:getAll':
        return state.db ? state.db.getAllLeads() : [];
      case 'leads:update': {
        if (!state.db) return { ok: false, error: 'Database not ready' };
        const result = state.db.updateLead(payload.id, payload.fields);
        if (payload.fields && payload.fields.status === 'Won') advanceQueueStage(payload.id, 'won');
        return result;
      }
      case 'leads:capture': {
        if (!state.db) return { ok: false, error: 'Database not ready' };
        const captureResult = state.db.upsertLead(payload);
        if (captureResult.inserted) {
          notifyWebhookOfCapture({ ...payload, id: captureResult.id });
          // Not awaited — capture returns immediately, scan/score/email-find
          // happens in the background. Skipped for CSV imports: those can be
          // dozens of rows in a tight loop (see main.js), and firing a hidden-
          // BrowserWindow scan per row with no concurrency cap would hammer
          // every imported site at once. Bulk imports already have a proper
          // one-at-a-time path via bulk:startDeepScan.
          if (payload.website && payload.leadSource !== 'csv-import') autoEnrichNewLead(captureResult.id);
        }
        return captureResult;
      }
      case 'spoof:save':
        return { ok: saveSpoofConfig(payload) };
      case 'spoof:get':
        return state.spoofConfig;
      case 'health:get':
        return state.lastHealthCheck;
      case 'leads:enrichEmail': {
        const result = await discoverEmail(payload.website);
        const current = state.db && state.db.getAllLeads().find((lead) => lead.id === payload.leadId);
        if (current) {
          const fields = {};
          if (result.ok && result.email && !current.email) fields.email = result.email;
          if (result.websiteQuality && result.websiteQuality.checked) {
            fields.customFields = { ...(current.customFields || {}), websiteQuality: result.websiteQuality };
            if (result.guessed) fields.customFields.emailGuessed = true;
          }
          if (result.contactPageUrl) {
            fields.customFields = { ...(fields.customFields || current.customFields || {}), contactPageUrl: result.contactPageUrl };
          }
          if (Object.keys(fields).length && state.db) state.db.updateLead(payload.leadId, fields);
        }
        return result;
      }
      case 'leads:applyRules':
        return applyRules(payload);
      case 'leads:applyRulesBatch':
        return payload.map((lead) => applyRules(lead));
      case 'email:renderTemplate':
        return renderTemplate(payload.templateKey, payload.lead);
      case 'email:saveCredentials': {
        try {
          const transport = createTransport({ email: payload.email, appPassword: payload.appPassword });
          const result = await verifyCredentials(transport);
          if (result.ok) {
            state.mailTransport = transport;
            state.mailAccountEmail = payload.email;
            const encrypted = saveCredentials(payload.email, payload.appPassword);
            return { ok: true, encrypted };
          }
          return result;
        } catch (error) {
          return { ok: false, error: String(error.message || error) };
        }
      }
      case 'email:getAccountStatus':
        return { configured: !!state.mailTransport, email: state.mailAccountEmail };
      case 'email:send': {
        if (!state.mailTransport) return { ok: false, error: 'No SMTP credentials saved yet — go to Settings first.' };
        if (state.db) {
          const blocked = state.db.isBlacklisted({ email: payload.to });
          if (blocked) {
            return { ok: false, error: `This address is on the do-not-contact list${blocked.reason ? ` (${blocked.reason})` : ''} — send refused.`, blacklisted: true };
          }
        }
        loadSendCount();
        if (state.sendCount.count >= SMTP_HARD_STOP_AT) {
          return {
            ok: false,
            error: `Daily send limit reached (${state.sendCount.count}/${SMTP_HARD_STOP_AT}) — stopping well short of Gmail's raw cap to keep cold outreach volume in a safe range. Resets at midnight.`,
            limitReached: true,
          };
        }
        try {
          const result = await sendEmail(state.mailTransport, payload);
          if (result.ok) {
            recordSend();
            if (payload.leadId) {
              advanceQueueStage(payload.leadId, 'sent');
              // Single source of truth for "when was this lead last emailed"
              // — both manual sends and the auto-follow-up job read this,
              // so the two never disagree about timing.
              const lead = state.db && state.db.getAllLeads().find((l) => l.id === payload.leadId);
              if (lead) {
                const label = payload.followUpStage ? `Auto follow-up (${payload.followUpStage}) sent` : 'Email sent';
                state.db.updateLead(payload.leadId, {
                  history: [...(lead.history || []), { at: new Date().toISOString(), event: label }],
                  customFields: payload.followUpStage
                    ? { ...(lead.customFields || {}), followUpStage: payload.followUpStage }
                    : lead.customFields,
                });
              }
            }
            if (state.sendCount.count === SMTP_WARN_AT) {
              result.warning = `You've sent ${state.sendCount.count} emails today. Approaching the safe daily limit for cold outreach — pace the rest, or resume tomorrow.`;
            }
          }
          return result;
        } catch (error) {
          return { ok: false, error: String(error.message || error) };
        }
      }
      case 'email:renderFollowUp':
        return renderFollowUp(payload.stage, payload.lead);
      case 'email:getSendCount':
        return { ...state.sendCount, warnAt: SMTP_WARN_AT, hardStopAt: SMTP_HARD_STOP_AT };
      case 'automation:consoleAction':
        return applyAutomationConsoleAction(payload);
      case 'leads:get': {
        if (!state.db) return null;
        const all = state.db.getAllLeads();
        return all.find(l => l.id === payload) || null;
      }
      case 'leads:delete': {
        if (!state.db) return { ok: false, error: 'Database not ready' };
        return state.db.deleteLead(payload);
      }
      case 'browser:extractLead': {
        // Fast path for "I'm browsing a site, quick-capture it as a lead" —
        // reuses runDeepScan's fetch+parse but skips the screenshot/axe/tech
        // passes (those are for the full Deep Scan action, too slow for an
        // interactive browse-then-save flow).
        const scan = await runDeepScan(payload);
        if (!scan.ok) return { ok: false, error: scan.error };
        return {
          ok: true,
          businessName: scan.title || '',
          website: payload,
          email: (scan.emails || [])[0] || '',
          phone: scan.phone || '',
          description: scan.description || '',
          socialLinks: scan.socialLinks || [],
        };
      }
      case 'leads:getScreenshot': {
        if (!state.db) return { ok: false, error: 'Database not ready' };
        const lead = state.db.getAllLeads().find((l) => l.id === payload);
        const screenshotPath = lead && lead.customFields && lead.customFields.deepScan && lead.customFields.deepScan.screenshotPath;
        if (!screenshotPath) return { ok: false, error: 'No screenshot on file' };
        // Only ever serve a file inside our own deepscan output directory —
        // never trust a path blindly, even one we generated ourselves earlier.
        const scanDir = path.join(userDataDir, 'deepscan');
        const resolved = path.resolve(screenshotPath);
        if (!resolved.startsWith(path.resolve(scanDir) + path.sep)) return { ok: false, error: 'Invalid screenshot path' };
        try {
          const buf = fs.readFileSync(resolved);
          const ext = path.extname(resolved).replace('.', '') || 'png';
          return { ok: true, dataUrl: `data:image/${ext};base64,${buf.toString('base64')}` };
        } catch (e) {
          return { ok: false, error: String(e.message || e) };
        }
      }
      case 'leads:getNormalized': {
        if (!state.db) return null;
        const lead = state.db.getAllLeads().find((l) => l.id === payload);
        return lead ? normalizeBusiness(lead) : null;
      }
      case 'leads:deepScan': {
        if (!state.db) return { ok: false, error: 'Database not ready' };
        const lead = state.db.getAllLeads().find((l) => l.id === payload.leadId);
        if (!lead) return { ok: false, error: 'Lead not found' };
        return runFullEnrichment(lead, { website: payload.website, force: !!payload.force });
      }
      case 'automation:runDailyJob':
        return runDailySmartJob();
      case 'bulk:startDeepScan':
        if (!state.db) return { ok: false, error: 'Database not ready' };
        return startBulkEnrichment(payload.leadIds || [], !!payload.force);
      case 'bulk:status':
        return bulkJob || { status: 'idle', total: 0, completed: 0, errors: [] };
      case 'bulk:cancel':
        if (bulkJob && bulkJob.status === 'running') bulkJob.status = 'cancelled';
        return { ok: true };
      case 'bulk:delete': {
        if (!state.db) return { ok: false, error: 'Database not ready' };
        for (const id of payload.leadIds || []) state.db.deleteLead(id);
        return { ok: true, count: (payload.leadIds || []).length };
      }
      case 'bulk:tag': {
        if (!state.db) return { ok: false, error: 'Database not ready' };
        const all = state.db.getAllLeads();
        let count = 0;
        for (const id of payload.leadIds || []) {
          const lead = all.find((l) => l.id === id);
          if (!lead) continue;
          const tags = new Set(lead.tags || []);
          tags.add(payload.tag);
          state.db.updateLead(id, { tags: [...tags] });
          count++;
        }
        return { ok: true, count };
      }
      case 'queue:addManual': {
        if (!state.db) return { ok: false, error: 'Database not ready' };
        const lead = state.db.getAllLeads().find((l) => l.id === payload.leadId);
        if (!lead) return { ok: false, error: 'Lead not found' };
        const proposal = (lead.customFields && lead.customFields.proposal) || buildProposal([]);
        upsertQueueEntry(lead, 'Priority', proposal); // manual add always joins as actionable
        loadActionQueue();
        return { ok: true, entry: state.actionQueue.find((e) => e.leadId === payload.leadId) };
      }
      case 'queue:list':
        loadActionQueue();
        return state.actionQueue;
      case 'queue:advance':
        return advanceQueueStage(payload.leadId, payload.stage) || { ok: false, error: 'Lead not in queue' };
      case 'queue:generatePitch': {
        if (!state.db) return { ok: false, error: 'Database not ready' };
        const lead = state.db.getAllLeads().find((l) => l.id === payload.leadId);
        if (!lead) return { ok: false, error: 'Lead not found' };
        const proposal = (lead.customFields && lead.customFields.proposal) || buildProposal([]);
        const rendered = renderTemplate(lead.customFields?.recommendedTemplate || 'general', lead);
        const bulletLines = proposal.services.map((s) => `- ${s.name} (${s.gaps.join(', ')})`).join('\n');
        const pitch = {
          subject: rendered.subject,
          body: `${rendered.body}\n\nWhat I found:\n${bulletLines}\n\nEstimated investment: ₹${proposal.totalLow.toLocaleString('en-IN')}–₹${proposal.totalHigh.toLocaleString('en-IN')}`,
        };
        loadActionQueue();
        const entry = state.actionQueue.find((e) => e.leadId === payload.leadId);
        if (entry) { entry.pitch = pitch; entry.stage = 'pitch_generated'; entry.updatedAt = new Date().toISOString(); saveActionQueue(); }
        return { ok: true, pitch };
      }
      case 'blacklist:add':
        return state.db ? state.db.addToBlacklist(payload) : { ok: false, error: 'Database not ready' };
      case 'blacklist:remove':
        return state.db ? state.db.removeFromBlacklist(payload) : { ok: false, error: 'Database not ready' };
      case 'blacklist:list':
        return state.db ? state.db.getBlacklist() : [];
      case 'blacklist:check':
        return state.db ? state.db.isBlacklisted(payload) : null;
      case 'theme:get':
        return loadJsonFile(path.join(userDataDir, 'theme.json'), {
          mode: 'dark', accentHue: 140, accentSaturation: 100, accentLightness: 70,
          fontSize: 13, spacing: 'comfortable'
        });
      case 'theme:save':
        return { ok: saveJsonFile(path.join(userDataDir, 'theme.json'), payload) };
      case 'settings:get':
        return loadJsonFile(path.join(userDataDir, 'settings.json'), {});
      case 'settings:save':
        return { ok: saveJsonFile(path.join(userDataDir, 'settings.json'), payload) };
      case 'automation:consoleState':
        return buildAutomationConsoleState();
      case 'replies:check':
        return checkReplies();
      case 'automation:runWorkflow': {
        // The one-click "run everything" action: re-score every lead against
        // the current rules, then export the full pipeline snapshot to disk
        // — the automated version of what "Auto report generation" means.
        if (!state.db) return { ok: false, error: 'Database not ready' };
        initializePaths();
        const leads = state.db.getAllLeads();
        for (const lead of leads) {
          const ruled = applyRules(lead);
          state.db.updateLead(lead.id, { priority: ruled.priority, tags: ruled.tags });
        }
        const rescored = state.db.getAllLeads();

        const format = (payload && payload.format === 'csv') ? 'csv' : 'json';
        const exportDir = path.join(userDataDir, 'exports');
        fs.mkdirSync(exportDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const exportPath = path.join(exportDir, `workflow-export-${stamp}.${format}`);
        const content = format === 'csv'
          ? stringifyCsv(rescored, WORKFLOW_CSV_HEADERS)
          : JSON.stringify(rescored, null, 2);
        fs.writeFileSync(exportPath, content, 'utf-8');

        return { ok: true, exportPath, count: rescored.length };
      }
      case 'diagnostics:get': {
        let dbSizeBytes = 0;
        try {
          if (dbPath && fs.existsSync(dbPath)) dbSizeBytes = fs.statSync(dbPath).size;
        } catch {
          dbSizeBytes = 0;
        }
        return {
          dbSizeBytes,
          dbPath: dbPath || '',
          userDataDir: userDataDir || '',
          status: state.status,
          connectorPort: state.connectorServer ? CONNECTOR_PORT : null,
          env: state.env,
          errors: [...state.errors],
        };
      }
      default:
        return { ok: false, error: `Unhandled channel: ${channel}` };
    }
  }

  return {
    initialize,
    getState,
    emitEvent,
    shutdown,
    handleIpcRequest,
    applyAutomationConsoleAction,
    loadSpoofConfig,
    saveSpoofConfig,
    setStatus,
    recordError,
  };
}

module.exports = { createAppRuntime, CONNECTOR_PORT, SMTP_WARN_AT, SMTP_HARD_STOP_AT };
