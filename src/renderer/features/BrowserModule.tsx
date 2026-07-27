import { useState, useRef, useCallback, useEffect } from 'react';
import type { WebviewTag } from 'electron';
import { PanelGroup, Panel, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels';
import { chromeUserAgent, BROWSER_PARTITION } from '../lib/webviewProfile';
import { useUIStore } from '../stores/ui.store';
import ipc from '../lib/ipc';
import type { DownloadUpdate } from '../lib/ipc';
import CountUp from '../components/CountUp';

// Multi-tab browsing. These are "soft" tabs — one <webview> is shared and
// re-pointed at whichever tab's URL is active, rather than a live webview
// per tab. That's a deliberate trade-off: the alternative (parallel mounted
// webviews) reopens the destroy/recreate black-screen class of bug the
// single-webview architecture below was specifically built to avoid, and
// would also mean the scraper/extractor would need to pick which of several
// live guest views to drive. Switching tabs reloads that tab's last URL
// instead of preserving scroll/JS state — acceptable since this browser's
// primary job is lead capture, not general tabbed browsing.
interface BrowserTab { id: string; url: string; title: string; }
function newTabId(): string { return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

interface Bookmark { title: string; url: string; }
const BOOKMARKS_KEY = 'browser-bookmarks';
function loadBookmarks(): Bookmark[] {
  try { return JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || '[]'); } catch { return []; }
}

// Browser Profile Manager — each profile is its own Electron session
// partition, so cookies/logins/local storage never leak between them
// (e.g. a "Client A" profile vs a "Client B" profile vs your own
// browsing). Electron persists partition data on disk automatically for
// any "persist:" prefixed partition — no extra storage code needed.
interface BrowserProfile { name: string; partition: string; proxy: string; }
const PROFILES_KEY = 'browser-profiles';
const DEFAULT_PROFILE: BrowserProfile = { name: 'Default', partition: BROWSER_PARTITION, proxy: '' };

function loadProfiles(): BrowserProfile[] {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILES_KEY) || 'null');
    if (Array.isArray(saved) && saved.length) return saved;
  } catch { /* fall through to default */ }
  return [DEFAULT_PROFILE];
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'profile';
}

interface ExtractedLead {
  businessName?: string;
  website?: string;
  email?: string;
  phone?: string;
  description?: string;
  socialLinks?: string[];
}

interface ScrapeParams {
  source: string;
  niche: string;
  location: string;
  maxLeads: number;
  fullArea: boolean;
}

interface ScanCounters { found: number; newLeads: number; duplicates: number; emails: number; websites: number; errors: number; }
interface LatestLead {
  businessName: string; website?: string; email?: string; phone?: string;
  rating?: string | number; reviewCount?: string | number; status: 'saved' | 'duplicate';
}
interface LogEntry { at: string; message: string; }

interface AutopilotJob {
  id: string; source: string; niche: string; location: string;
  maxLeads: number; fullArea: boolean; status: 'pending' | 'running' | 'done' | 'failed'; captured: number;
}
const AUTOPILOT_KEY = 'browser-autopilot-queue';
function loadAutopilotQueue(): AutopilotJob[] {
  try { return JSON.parse(localStorage.getItem(AUTOPILOT_KEY) || '[]'); } catch { return []; }
}

const EMPTY_COUNTERS: ScanCounters = { found: 0, newLeads: 0, duplicates: 0, emails: 0, websites: 0, errors: 0 };
const MAX_CYCLES = 200;
const MAX_ZOOM_OUT_ATTEMPTS = 5;
const PAN_DIRECTIONS = ['right', 'down', 'left', 'up'];
// Two named delay profiles instead of exposing raw millisecond knobs — the
// user picks a risk posture, not a number. "Safe" widens every pause the
// scan loop already takes; "Aggressive" tightens them for speed.
const ANTI_BAN_PRESETS = {
  safe: { cycleDelayMin: 1800, cycleDelayMax: 3600, preScrapeDelay: 1000 },
  aggressive: { cycleDelayMin: 600, cycleDelayMax: 1200, preScrapeDelay: 300 },
} as const;

const BOTTOM_TABS = ['Results', 'Activity', 'Errors', 'Downloads'] as const;
type BottomTab = typeof BOTTOM_TABS[number];

export default function BrowserModule() {
  const { addToast, setActiveModule } = useUIStore();

  // --- Browser state ---
  const [tabs, setTabs] = useState<BrowserTab[]>(() => [{ id: newTabId(), url: 'https://www.google.com/maps', title: '' }]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  const activeTabIdRef = useRef(activeTabId);
  useEffect(() => { activeTabIdRef.current = activeTabId; }, [activeTabId]);
  const [url, setUrl] = useState('https://www.google.com/maps');
  const [pageTitle, setPageTitle] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => loadBookmarks());
  const [history, setHistory] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<BrowserProfile[]>(() => loadProfiles());
  const [activeProfileName, setActiveProfileName] = useState(() => loadProfiles()[0].name);
  const [proxyInput, setProxyInput] = useState('');
  const [savingProxy, setSavingProxy] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'bookmarks' | 'history' | 'extract' | 'extensions' | 'profiles'>('extract');
  const [extensions, setExtensions] = useState<{ id: string; name: string; version: string; path: string }[]>([]);
  const [loadingExtension, setLoadingExtension] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedLead | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedLeadId, setSavedLeadId] = useState<string | null>(null);
  const [investigating, setInvestigating] = useState(false);
  const [investigateResult, setInvestigateResult] = useState<{
    scoring?: { total: number; decision: string };
    opportunities?: { gap: string; severity: string; potentialService: string }[];
    techStack?: { flat: { name: string; category: string }[] };
  } | null>(null);

  // --- Scrape Mode state (merged from the old standalone Scraper module —
  // same webview, same power, one workspace instead of two) ---
  const [scrapeMode, setScrapeMode] = useState(false);
  const [params, setParams] = useState<ScrapeParams>({ source: 'google', niche: '', location: '', maxLeads: 50, fullArea: false });
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [captured, setCaptured] = useState(0);
  const [counters, setCounters] = useState<ScanCounters>(EMPTY_COUNTERS);
  const [latestLead, setLatestLead] = useState<LatestLead | null>(null);
  const [retries, setRetries] = useState(0);
  const [ranOnce, setRanOnce] = useState(false);
  const [resultsLog, setResultsLog] = useState<LatestLead[]>([]);
  const [activityLog, setActivityLog] = useState<LogEntry[]>([]);
  const [errorLog, setErrorLog] = useState<LogEntry[]>([]);
  const [bottomTab, setBottomTab] = useState<BottomTab>('Results');
  const [configCollapsed, setConfigCollapsed] = useState(false);

  // --- Find-in-page ---
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findResult, setFindResult] = useState<{ active: number; total: number } | null>(null);
  const findInputRef = useRef<HTMLInputElement>(null);

  // --- Downloads ---
  const [downloads, setDownloads] = useState<DownloadUpdate[]>([]);

  // --- Autopilot: a queue of niche+location jobs that runs unattended —
  // auto-zooms to a sane starting view, scans, captures, and advances to
  // the next job on its own once the current one is exhausted/limited.
  const [autopilotJobs, setAutopilotJobs] = useState<AutopilotJob[]>(() => loadAutopilotQueue());
  const [autopilotOn, setAutopilotOn] = useState(false);
  const [autoZoom, setAutoZoom] = useState(true);
  const [domainDedup, setDomainDedup] = useState(true);
  const [antiBanPreset, setAntiBanPreset] = useState<'safe' | 'aggressive'>('safe');
  const [captchaPaused, setCaptchaPaused] = useState(false);
  const captchaResumeRef = useRef<(() => void) | null>(null);

  // Auto-enrich: newly captured leads get queued for the same deep-scan
  // pipeline the Leads screen's "bulk enrich" button runs — without this,
  // every lead a scrape captures still needs a human to go click enrich
  // manually, which defeats the point of an unattended Autopilot run.
  const [autoEnrich, setAutoEnrich] = useState(true);
  const pendingEnrichIdsRef = useRef<string[]>([]);
  const enrichPollingRef = useRef(false);
  const [queueLocationsInput, setQueueLocationsInput] = useState('');
  const autopilotRunningRef = useRef(false);
  const autopilotJobsRef = useRef<AutopilotJob[]>(autopilotJobs);
  useEffect(() => { autopilotJobsRef.current = autopilotJobs; }, [autopilotJobs]);

  const webviewRef = useRef<WebviewTag>(null);
  const runningRef = useRef(false);
  const readyRef = useRef(false);
  const startTimeRef = useRef(0);
  const configPanelRef = useRef<ImperativePanelHandle>(null);
  const bottomPanelRef = useRef<ImperativePanelHandle>(null);

  // The webview is mounted exactly ONCE, in a single fixed position in the
  // tree (see the return below) — toggling Scrape Mode used to render two
  // separate <webview> elements in two different conditional branches,
  // which force-destroyed and recreated the Electron guest view on every
  // toggle. That's what caused the black screen: a freshly recreated
  // webview's compositor surface frequently fails to paint on its first
  // mount inside a layout that's also resizing at the same instant.
  // Fix: one persistent webview; only the surrounding panels collapse/expand.
  useEffect(() => {
    if (scrapeMode) {
      bottomPanelRef.current?.expand();
    } else {
      configPanelRef.current?.collapse();
      bottomPanelRef.current?.collapse();
    }
  }, [scrapeMode]);

  const logActivity = useCallback((message: string) => {
    setActivityLog((prev) => [{ at: new Date().toISOString(), message }, ...prev].slice(0, 200));
  }, []);
  const logError = useCallback((message: string) => {
    setErrorLog((prev) => [{ at: new Date().toISOString(), message }, ...prev].slice(0, 200));
  }, []);

  const refreshExtensions = useCallback(() => { ipc.listExtensions().then(setExtensions); }, []);
  useEffect(() => { refreshExtensions(); }, [refreshExtensions]);

  const handleLoadExtension = async () => {
    setLoadingExtension(true);
    try {
      const result = await ipc.pickExtensionFolder();
      if (result.ok) { addToast(`Loaded "${result.extension?.name}"`, 'success'); refreshExtensions(); }
      else if (result.error !== 'Canceled') addToast(result.error || 'Failed to load extension', 'error');
    } finally {
      setLoadingExtension(false);
    }
  };

  const handleRemoveExtension = async (id: string) => {
    const result = await ipc.removeExtension(id);
    if (result.ok) { addToast('Extension removed', 'success'); refreshExtensions(); }
    else addToast(result.error || 'Failed to remove', 'error');
  };

  const activeProfile = profiles.find((p) => p.name === activeProfileName) || profiles[0] || DEFAULT_PROFILE;

  useEffect(() => { setProxyInput(activeProfile.proxy || ''); }, [activeProfile.name]);

  const persistProfiles = (next: BrowserProfile[]) => {
    setProfiles(next);
    localStorage.setItem(PROFILES_KEY, JSON.stringify(next));
  };

  const handleSwitchProfile = (name: string) => {
    setActiveProfileName(name);
    addToast(`Switched to profile "${name}"`, 'success');
  };

  const handleAddProfile = () => {
    const name = window.prompt('New profile name:');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    if (profiles.some((p) => p.name === trimmed)) { addToast('A profile with that name already exists', 'error'); return; }
    const next = [...profiles, { name: trimmed, partition: `persist:agencyos-profile-${slugify(trimmed)}`, proxy: '' }];
    persistProfiles(next);
    setActiveProfileName(trimmed);
    addToast(`Profile "${trimmed}" created`, 'success');
  };

  const handleDeleteProfile = (name: string) => {
    if (name === DEFAULT_PROFILE.name) { addToast('Cannot delete the Default profile', 'error'); return; }
    const next = profiles.filter((p) => p.name !== name);
    persistProfiles(next.length ? next : [DEFAULT_PROFILE]);
    if (activeProfileName === name) setActiveProfileName((next.length ? next : [DEFAULT_PROFILE])[0].name);
  };

  const handleSaveProxy = async () => {
    setSavingProxy(true);
    try {
      const result = await ipc.setBrowserProxy(activeProfile.partition, proxyInput.trim());
      if (result.ok) {
        const next = profiles.map((p) => p.name === activeProfile.name ? { ...p, proxy: proxyInput.trim() } : p);
        persistProfiles(next);
        addToast(proxyInput.trim() ? 'Proxy applied' : 'Proxy cleared', 'success');
      } else {
        addToast(result.error || 'Failed to set proxy', 'error');
      }
    } finally {
      setSavingProxy(false);
    }
  };

  useEffect(() => {
    const el = webviewRef.current;
    if (!el) return;
    const onStop = () => { setIsLoading(false); readyRef.current = true; };
    const onNav = (e: Event) => {
      const navUrl = (e as unknown as { url: string }).url;
      if (navUrl) {
        setHistory((prev) => [navUrl, ...prev.filter((h) => h !== navUrl)].slice(0, 50));
        setTabs((prev) => prev.map((t) => (t.id === activeTabIdRef.current ? { ...t, url: navUrl } : t)));
      }
    };
    const onTitle = (e: Event) => {
      const title = (e as unknown as { title: string }).title || '';
      setPageTitle(title);
      setTabs((prev) => prev.map((t) => (t.id === activeTabIdRef.current ? { ...t, title } : t)));
    };
    el.addEventListener('did-stop-load', onStop);
    el.addEventListener('did-navigate', onNav);
    el.addEventListener('did-navigate-in-page', onNav);
    el.addEventListener('page-title-updated', onTitle);
    return () => {
      el.removeEventListener('did-stop-load', onStop);
      el.removeEventListener('did-navigate', onNav);
      el.removeEventListener('did-navigate-in-page', onNav);
      el.removeEventListener('page-title-updated', onTitle);
    };
  }, []);

  // Find-in-page: Ctrl+F opens the bar and focuses it; Escape closes it and
  // clears the highlight. Uses the webview's own findInPage (Chromium API),
  // not a DOM-text-search reimplementation.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setFindOpen(true);
        setTimeout(() => findInputRef.current?.focus(), 0);
      } else if (e.key === 'Escape' && findOpen) {
        setFindOpen(false);
        setFindQuery('');
        setFindResult(null);
        try { webviewRef.current?.stopFindInPage('clearSelection'); } catch {}
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [findOpen]);

  useEffect(() => {
    const el = webviewRef.current;
    if (!el) return;
    const onFound = (e: Event) => {
      const result = e as unknown as { activeMatchOrdinal: number; matches: number };
      setFindResult({ active: result.activeMatchOrdinal, total: result.matches });
    };
    el.addEventListener('found-in-page', onFound);
    return () => { el.removeEventListener('found-in-page', onFound); };
  }, []);

  const runFind = (forward: boolean, findNext: boolean) => {
    if (!findQuery) return;
    try { webviewRef.current?.findInPage(findQuery, { forward, findNext }); } catch {}
  };

  // Downloads: one subscription for the lifetime of the module — the main
  // process pushes progress for every download across every profile session.
  useEffect(() => {
    return ipc.onDownloadUpdate((update) => {
      setDownloads((prev) => {
        const idx = prev.findIndex((d) => d.id === update.id);
        if (idx === -1) return [update, ...prev].slice(0, 100);
        const next = [...prev];
        next[idx] = update;
        return next;
      });
    });
  }, []);

  const navigate = useCallback((targetUrl: string) => {
    let finalUrl = targetUrl.trim();
    if (!/^https?:\/\//i.test(finalUrl)) finalUrl = 'https://' + finalUrl;
    setUrl(finalUrl);
    setIsLoading(true);
    setExtracted(null);
    setTabs((prev) => prev.map((t) => (t.id === activeTabIdRef.current ? { ...t, url: finalUrl } : t)));
  }, []);

  // Tabs are "soft" — switching one in reloads its last known URL into the
  // single shared webview (see the BrowserTab comment above for why).
  const handleNewTab = () => {
    const tab: BrowserTab = { id: newTabId(), url: 'https://www.google.com/maps', title: '' };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    navigate(tab.url);
  };

  const handleSwitchTab = (id: string) => {
    if (id === activeTabId || isRunning) return;
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    setActiveTabId(id);
    navigate(tab.url);
  };

  const handleCloseTab = (id: string) => {
    if (isRunning) return;
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const next = tabs.filter((t) => t.id !== id);
    if (next.length === 0) {
      const fresh: BrowserTab = { id: newTabId(), url: 'https://www.google.com/maps', title: '' };
      setTabs([fresh]);
      setActiveTabId(fresh.id);
      navigate(fresh.url);
      return;
    }
    setTabs(next);
    if (activeTabId === id) {
      const fallback = next[Math.max(0, idx - 1)];
      setActiveTabId(fallback.id);
      navigate(fallback.url);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') navigate((e.target as HTMLInputElement).value);
  };
  const handleGoBack = () => { try { webviewRef.current?.goBack(); } catch {} };
  const handleGoForward = () => { try { webviewRef.current?.goForward(); } catch {} };
  const handleReload = () => { try { webviewRef.current?.reload(); } catch {} };
  // webview.getURL() throws synchronously if the guest page hasn't fired
  // dom-ready yet — calling it unguarded during render is what crashed the
  // whole component (no error boundary => blank/black screen). Always go
  // through this helper instead of calling getURL() directly.
  const safeGetURL = () => { try { return webviewRef.current?.getURL(); } catch { return undefined; } };
  const applyZoom = (delta: number) => {
    const next = Math.max(-3, Math.min(5, zoom + delta));
    setZoom(next);
    try { webviewRef.current?.setZoomLevel(next); } catch {}
  };
  const toggleBookmark = () => {
    const currentUrl = safeGetURL() || url;
    const exists = bookmarks.some((b) => b.url === currentUrl);
    const next = exists ? bookmarks.filter((b) => b.url !== currentUrl) : [{ title: pageTitle || currentUrl, url: currentUrl }, ...bookmarks].slice(0, 100);
    setBookmarks(next);
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next));
    addToast(exists ? 'Bookmark removed' : 'Bookmarked', 'success');
  };
  const currentUrl = safeGetURL() || url;
  const isBookmarked = bookmarks.some((b) => b.url === currentUrl);

  const handleExtract = async () => {
    setExtracting(true);
    setExtracted(null);
    setSavedLeadId(null);
    setInvestigateResult(null);
    try {
      const target = safeGetURL() || url;
      const result = await ipc.extractLeadFromUrl(target);
      if (result.ok) { setExtracted(result); setSidebarTab('extract'); }
      else addToast(result.error || 'Extraction failed', 'error');
    } finally {
      setExtracting(false);
    }
  };

  const handleSaveAsLead = async () => {
    if (!extracted) return;
    setSaving(true);
    try {
      const result = await ipc.captureLead({
        businessName: extracted.businessName || pageTitle || new URL(extracted.website || currentUrl).hostname,
        website: extracted.website, email: extracted.email, phone: extracted.phone,
        notes: extracted.description, leadSource: 'browser',
      });
      addToast(result.inserted ? 'Saved as lead' : (result.blacklisted ? 'Blocked — on do-not-contact list' : 'Already a lead (duplicate)'), result.inserted ? 'success' : 'info');
      if (result.id) setSavedLeadId(result.id);
    } finally {
      setSaving(false);
    }
  };

  // "Investigate one business deeply" — reuses the exact same deep-scan
  // pipeline (SEO/SSL/accessibility/tech stack/opportunities/scoring)
  // already built for the Leads module, rather than duplicating any of
  // that analysis logic here.
  const handleDeepInvestigate = async () => {
    if (!savedLeadId || !extracted?.website) return;
    setInvestigating(true);
    setInvestigateResult(null);
    try {
      const result = await ipc.deepScan(savedLeadId, extracted.website);
      if (result.ok) {
        setInvestigateResult({
          scoring: result.scoring ? { total: result.scoring.total, decision: result.scoring.decision } : undefined,
          opportunities: result.opportunities,
          techStack: result.techStack,
        });
      } else {
        addToast(result.error || 'Deep investigation failed', 'error');
      }
    } finally {
      setInvestigating(false);
    }
  };

  // Only one bulk-enrichment job can run in the main process at a time
  // (see appRuntime.js's startBulkEnrichment) — it refuses a second call
  // with { ok: false } while one is already in flight rather than queuing
  // it. So newly-captured lead IDs are accumulated here and drained by a
  // light poller that waits for the slot to free up, instead of dropping
  // IDs whenever a batch arrives while enrichment is still busy.
  const drainEnrichQueue = useCallback(async () => {
    if (enrichPollingRef.current) return;
    enrichPollingRef.current = true;
    try {
      while (pendingEnrichIdsRef.current.length > 0) {
        const status = await ipc.bulkStatus();
        if (status.status === 'running') {
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        const batch = pendingEnrichIdsRef.current;
        pendingEnrichIdsRef.current = [];
        const result = await ipc.bulkStartDeepScan(batch, false);
        if (!result.ok) {
          // Lost the race to another caller (e.g. a manual bulk-enrich from
          // the Leads screen) — put the batch back and wait it out.
          pendingEnrichIdsRef.current = [...batch, ...pendingEnrichIdsRef.current];
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        logActivity(`Auto-enrich: queued ${batch.length} new lead(s) for deep scan`);
        // Wait for this batch to actually finish before checking the queue
        // again, so we don't spin rapid-fire bulkStartDeepScan calls.
        while (true) {
          await new Promise((r) => setTimeout(r, 3000));
          const s = await ipc.bulkStatus();
          if (s.status !== 'running') break;
        }
      }
    } finally {
      enrichPollingRef.current = false;
    }
  }, [logActivity]);

  const queueAutoEnrich = useCallback((ids: string[]) => {
    if (!ids.length) return;
    pendingEnrichIdsRef.current.push(...ids);
    drainEnrichQueue();
  }, [drainEnrichQueue]);

  // --- Scrape engine (identical logic to the old ScraperModule, now
  // driving the same webview the user browses with) ---
  const waitForReady = useCallback(async () => {
    readyRef.current = false;
    const start = Date.now();
    while (!readyRef.current && Date.now() - start < 15000) await new Promise((r) => setTimeout(r, 200));
  }, []);

  const runScan = useCallback(async (p: ScrapeParams, onProgress?: (captured: number) => void, onLeadCaptured?: (leadId: string) => void): Promise<number> => {
    const webview = webviewRef.current;
    if (!webview) return 0;
    let cycle = 0, emptyStreak = 0, zoomOutAttempts = 0, totalCaptured = 0, consecutiveFailures = 0;
    const stopAfterEmptyCycles = p.fullArea ? 3 : 4;
    const MAX_CONSECUTIVE_FAILURES = 4;
    const preset = ANTI_BAN_PRESETS[antiBanPreset];
    const c = { ...EMPTY_COUNTERS };
    startTimeRef.current = Date.now();

    while (runningRef.current && cycle < MAX_CYCLES && emptyStreak < stopAfterEmptyCycles && zoomOutAttempts < MAX_ZOOM_OUT_ATTEMPTS && totalCaptured < p.maxLeads) {
      cycle++;
      setStatus(`Scanning — cycle ${cycle}, ${totalCaptured} captured so far...`);
      logActivity(`Cycle ${cycle} started`);

      try {
        try { await webview.executeJavaScript(ipc.scraperScripts.dismissCookieBanner); } catch {}

        // CAPTCHA detect-and-pause — never attempted to solve automatically,
        // only surfaced to the human operator. Checked before each cycle's
        // scroll/scrape so a challenge page doesn't get silently scraped as
        // if it were real listings.
        let captchaDetected = false;
        try { captchaDetected = await webview.executeJavaScript(ipc.scraperScripts.detectCaptcha); } catch {}
        if (captchaDetected) {
          const msg = 'CAPTCHA detected — paused. Solve it in the browser, then click Resume.';
          setStatus(msg); logError(msg);
          setCaptchaPaused(true);
          await new Promise<void>((resolve) => { captchaResumeRef.current = resolve; });
          setCaptchaPaused(false);
          if (!runningRef.current) break;
          logActivity('Resumed after CAPTCHA');
        }

        await webview.executeJavaScript(ipc.scraperScripts.autoScroll);
        try { await webview.executeJavaScript(ipc.scraperScripts.hover); } catch {} // human-like pointer movement before reading the page
        await new Promise((r) => setTimeout(r, preset.preScrapeDelay));

        const result = await webview.executeJavaScript(ipc.scraperScripts.scrapePage);
        const rows = (result && result.rows) || [];
        const stats = (result && result.stats) || {};

        if (stats.containersFound > 0 && stats.extracted === 0) {
          const msg = `Found ${stats.containersFound} listing(s) but extracted 0 — the site's structure may have changed.`;
          setStatus(msg); logError(msg);
        }

        let addedThisCycle = 0;
        for (const row of rows) {
          if (!row.businessName) continue;
          c.found++;
          if (row.email) c.emails++;
          if (row.website) c.websites++;
          const captureResult = await ipc.captureLead({ ...row, leadSource: 'scraper', useDomainDedup: domainDedup });
          const entry: LatestLead = { businessName: row.businessName, website: row.website, email: row.email, phone: row.phone, rating: row.rating, reviewCount: row.reviewCount, status: 'saved' };
          if (captureResult && captureResult.inserted) {
            addedThisCycle++; c.newLeads++;
            setLatestLead(entry);
            setResultsLog((prev) => [entry, ...prev].slice(0, 300));
            logActivity(`Saved: ${row.businessName}`);
            if (captureResult.id) onLeadCaptured?.(captureResult.id);
          } else if (captureResult && captureResult.duplicate) {
            c.duplicates++;
            setResultsLog((prev) => [{ ...entry, status: 'duplicate' as const }, ...prev].slice(0, 300));
          } else if (!captureResult || !captureResult.blacklisted) {
            c.errors++;
            logError(`Failed to save: ${row.businessName}`);
          }
          if (totalCaptured + addedThisCycle >= p.maxLeads) break;
        }
        totalCaptured += addedThisCycle;
        setCaptured(totalCaptured);
        setCounters({ ...c });
        onProgress?.(totalCaptured);

        if (addedThisCycle === 0) {
          emptyStreak++;
          try { await webview.executeJavaScript(ipc.scraperScripts.clickLoadMore); } catch {}
          if (p.fullArea && emptyStreak >= stopAfterEmptyCycles) {
            try {
              const dir = PAN_DIRECTIONS[zoomOutAttempts % PAN_DIRECTIONS.length];
              await webview.executeJavaScript(ipc.scraperScripts.pan(dir));
              await new Promise((r) => setTimeout(r, 800));
              await webview.executeJavaScript(ipc.scraperScripts.zoomOut);
              zoomOutAttempts++; setRetries(zoomOutAttempts); emptyStreak = 0;
              const msg = `Area exhausted — panned + zoomed out to find more (attempt ${zoomOutAttempts}/${MAX_ZOOM_OUT_ATTEMPTS})...`;
              setStatus(msg); logActivity(msg);
              await new Promise((r) => setTimeout(r, 1500));
            } catch {}
          }
        } else {
          emptyStreak = 0;
        }
        consecutiveFailures = 0;
        await new Promise((r) => setTimeout(r, preset.cycleDelayMin + Math.random() * (preset.cycleDelayMax - preset.cycleDelayMin)));
      } catch (e) {
        c.errors++; setCounters({ ...c });
        consecutiveFailures++;
        const errMsg = e instanceof Error ? e.message : String(e);
        if (consecutiveFailures > MAX_CONSECUTIVE_FAILURES) {
          const msg = `Scan cycle failed ${consecutiveFailures} times in a row (${errMsg}) — stopping.`;
          setStatus(msg); logError(msg);
          break;
        }
        // Retry with exponential backoff instead of killing the whole scan
        // on one transient failure (network hiccup, page mid-repaint, etc).
        const backoffMs = 1000 * 2 ** (consecutiveFailures - 1);
        const msg = `Cycle ${cycle} failed (${errMsg}) — retrying in ${Math.round(backoffMs / 1000)}s (attempt ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})...`;
        setStatus(msg); logError(msg);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }

    runningRef.current = false;
    setIsRunning(false);
    setRanOnce(true);
    const finalMsg = totalCaptured >= p.maxLeads
      ? `Reached the ${p.maxLeads} lead limit — ${totalCaptured} lead(s) captured.`
      : emptyStreak >= stopAfterEmptyCycles
      ? `Scan complete: ${totalCaptured} lead(s) captured, this area is exhausted.`
      : `Scan stopped: ${totalCaptured} lead(s) captured.`;
    setStatus(finalMsg);
    logActivity(finalMsg);
    return totalCaptured;
  }, [logActivity, logError, antiBanPreset, domainDedup]);

  // Shared by manual "Start Scrape" and Autopilot — takes params explicitly
  // (rather than reading the `params` state) so a queued job's config can't
  // race with React's async state updates.
  const startScrapeWithParams = useCallback(async (p: ScrapeParams, onProgress?: (captured: number) => void): Promise<number> => {
    const searchUrl = ipc.scraperUtils.buildSearchUrl(p.source, p.niche, p.location);
    if (!searchUrl) { setStatus(`"${p.source}" isn't supported yet — try Google Maps.`); return 0; }

    setParams(p);
    setCaptured(0); setCounters(EMPTY_COUNTERS); setLatestLead(null);
    setResultsLog([]); setActivityLog([]); setErrorLog([]); setRetries(0); setRanOnce(false);
    setIsRunning(true); runningRef.current = true;
    setStatus(`Starting ${p.source} maps scrape for "${p.niche}" in "${p.location}"...`);
    navigate(searchUrl);
    configPanelRef.current?.collapse();
    await waitForReady();

    // Auto-zoom: Maps' default zoom for a text search is often too tight
    // to see the full listing feed for a city-wide query — widen it once
    // before scanning starts instead of making the user do it by hand.
    if (autoZoom) {
      try {
        await webviewRef.current?.executeJavaScript(ipc.scraperScripts.zoomOut);
        await new Promise((r) => setTimeout(r, 400));
        await webviewRef.current?.executeJavaScript(ipc.scraperScripts.zoomOut);
        await new Promise((r) => setTimeout(r, 600));
        logActivity('Auto-zoom: widened initial map view');
      } catch { /* best-effort */ }
    }

    const capturedIds: string[] = [];
    const total = await runScan(p, onProgress, (leadId) => capturedIds.push(leadId));
    if (autoEnrich && capturedIds.length) queueAutoEnrich(capturedIds);
    return total;
  }, [navigate, waitForReady, runScan, logActivity, autoZoom, autoEnrich, queueAutoEnrich]);

  const handleStartScrape = () => {
    if (!params.niche || !params.location) { setStatus('Please enter both niche and location'); return; }
    startScrapeWithParams(params);
  };

  const handleStopScrape = () => {
    runningRef.current = false;
    setIsRunning(false);
    setStatus('Stopping...');
    // If a CAPTCHA pause is in flight, release it so the loop can actually
    // exit instead of hanging on the pending promise forever.
    if (captchaResumeRef.current) { captchaResumeRef.current(); captchaResumeRef.current = null; }
  };

  const handleResumeAfterCaptcha = () => {
    if (captchaResumeRef.current) { captchaResumeRef.current(); captchaResumeRef.current = null; }
  };

  const persistAutopilotJobs = (jobs: AutopilotJob[]) => {
    setAutopilotJobs(jobs);
    localStorage.setItem(AUTOPILOT_KEY, JSON.stringify(jobs));
  };

  const updateAutopilotJob = (id: string, patch: Partial<AutopilotJob>) => {
    setAutopilotJobs((prev) => {
      const next = prev.map((j) => (j.id === id ? { ...j, ...patch } : j));
      localStorage.setItem(AUTOPILOT_KEY, JSON.stringify(next));
      return next;
    });
  };

  const handleAddAutopilotJobs = () => {
    if (!params.niche.trim()) { addToast('Enter a niche first', 'error'); return; }
    const locations = queueLocationsInput.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    if (!locations.length) { addToast('Enter at least one location', 'error'); return; }
    const newJobs: AutopilotJob[] = locations.map((location) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source: params.source, niche: params.niche, location,
      maxLeads: params.maxLeads, fullArea: params.fullArea,
      status: 'pending', captured: 0,
    }));
    persistAutopilotJobs([...autopilotJobs, ...newJobs]);
    setQueueLocationsInput('');
    addToast(`Added ${newJobs.length} job(s) to the autopilot queue`, 'success');
  };

  const handleRemoveAutopilotJob = (id: string) => persistAutopilotJobs(autopilotJobs.filter((j) => j.id !== id));
  const handleClearFinishedJobs = () => persistAutopilotJobs(autopilotJobs.filter((j) => j.status === 'pending' || j.status === 'running'));

  // Autopilot: drives the queue end-to-end without further clicks — starts
  // the next pending job as soon as the current one finishes (hits its lead
  // cap or exhausts the area), until the queue is empty or Stop is pressed.
  //
  // Smart Resume: a job's `captured` count is persisted to localStorage
  // continuously (via onProgress, every cycle) rather than only when the job
  // finishes — so if the app crashes mid-job, that job is left with
  // status:'running' and a partial captured count instead of losing all
  // progress. The next time Start Autopilot runs, any leftover 'running'
  // jobs are treated as interrupted, not finished, and are resumed: only
  // the REMAINING lead count is targeted (maxLeads - already captured),
  // since Maps-ID/phone/domain dedup already makes it safe to rescan the
  // same area without creating duplicate leads.
  const handleStartAutopilot = useCallback(async () => {
    if (autopilotRunningRef.current) return;

    const interrupted = autopilotJobsRef.current.filter((j) => j.status === 'running');
    if (interrupted.length) {
      persistAutopilotJobs(autopilotJobsRef.current.map((j) => (j.status === 'running' ? { ...j, status: 'pending' as const } : j)));
      logActivity(`Resuming ${interrupted.length} job(s) interrupted by a previous stop/crash`);
    }
    if (!autopilotJobsRef.current.some((j) => j.status === 'pending' || j.status === 'running')) {
      addToast('Queue is empty — add a niche + location(s) first', 'error');
      return;
    }
    autopilotRunningRef.current = true;
    setAutopilotOn(true);
    logActivity('Autopilot started');

    while (autopilotRunningRef.current) {
      const next = autopilotJobsRef.current.find((j) => j.status === 'pending');
      if (!next) break;
      const baseCaptured = next.captured || 0;
      const remainingTarget = Math.max(next.maxLeads - baseCaptured, 1);
      updateAutopilotJob(next.id, { status: 'running' });
      logActivity(baseCaptured > 0
        ? `Autopilot: resuming "${next.niche}" in "${next.location}" (${baseCaptured} already captured)`
        : `Autopilot: "${next.niche}" in "${next.location}"`);
      let thisRunCaptured = 0;
      let failed = false;
      try {
        thisRunCaptured = await startScrapeWithParams(
          { source: next.source, niche: next.niche, location: next.location, maxLeads: remainingTarget, fullArea: next.fullArea },
          (progress) => updateAutopilotJob(next.id, { captured: baseCaptured + progress }),
        );
      } catch (e) {
        failed = true;
        logError(`Autopilot job failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      updateAutopilotJob(next.id, { status: failed ? 'failed' : 'done', captured: baseCaptured + thisRunCaptured });
      if (!autopilotRunningRef.current) break;
      await new Promise((r) => setTimeout(r, 2500));
    }

    autopilotRunningRef.current = false;
    setAutopilotOn(false);
    const totalThisSession = autopilotJobsRef.current.reduce((sum, j) => sum + (j.captured || 0), 0);
    logActivity('Autopilot queue finished');
    addToast(`Autopilot finished — ${totalThisSession} lead(s) captured across the queue`, 'success');
  }, [startScrapeWithParams, logActivity, logError, addToast]);

  const handleStopAutopilot = () => {
    autopilotRunningRef.current = false;
    setAutopilotOn(false);
    handleStopScrape();
  };

  // Zoom the Maps view via the site's own on-screen controls — more
  // reliable than Electron page-zoom for canvas-rendered maps.
  const nativeZoom = async (dir: 'in' | 'out') => {
    try { await webviewRef.current?.executeJavaScript(dir === 'in' ? ipc.scraperScripts.zoomIn : ipc.scraperScripts.zoomOut); } catch {}
  };

  return (
    <div className="browser-module" style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 'var(--space-2)' }}>
      {/* Tab Strip */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', overflowX: 'auto' }}>
        {tabs.map((t) => (
          <div
            key={t.id}
            onClick={() => handleSwitchTab(t.id)}
            title={t.url}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-glass)', cursor: isRunning ? 'default' : 'pointer', maxWidth: 180, flexShrink: 0,
              background: t.id === activeTabId ? 'var(--bg-elevated)' : 'transparent',
              borderColor: t.id === activeTabId ? 'var(--accent-border)' : 'var(--border-glass)',
              opacity: isRunning && t.id !== activeTabId ? 0.5 : 1,
            }}
          >
            <span style={{ fontSize: 'var(--font-size-xs)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: t.id === activeTabId ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
              {t.title || t.url.replace(/^https?:\/\//, '')}
            </span>
            {tabs.length > 1 && (
              <span onClick={(e) => { e.stopPropagation(); handleCloseTab(t.id); }} style={{ fontSize: 10, color: 'var(--text-tertiary)', cursor: 'pointer' }}>✕</span>
            )}
          </div>
        ))}
        <button className="btn-icon" onClick={handleNewTab} disabled={isRunning} title="New tab">+</button>
      </div>

      {/* Address Bar */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
        <button className="btn-icon" onClick={handleGoBack} title="Back">◀</button>
        <button className="btn-icon" onClick={handleGoForward} title="Forward">▶</button>
        <button className="btn-icon" onClick={handleReload} title="Reload">⟳</button>
        <button className="btn-icon" onClick={toggleBookmark} title={isBookmarked ? 'Remove bookmark' : 'Add bookmark'} style={{ color: isBookmarked ? 'var(--accent)' : undefined }}>
          {isBookmarked ? '★' : '☆'}
        </button>
        {isLoading && <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>Loading…</span>}
        <input
          key={activeTabId} type="text" defaultValue={url} onKeyDown={handleKeyDown} placeholder="Enter URL or search..." disabled={isRunning}
          style={{ flex: 1, height: 32, padding: '0 var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 'var(--font-size-sm)' }}
        />
        <button className="btn-icon" onClick={() => applyZoom(-0.5)} title="Zoom out (page)">−</button>
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', width: 36, textAlign: 'center' }}>{Math.round((1 + zoom * 0.25) * 100)}%</span>
        <button className="btn-icon" onClick={() => applyZoom(0.5)} title="Zoom in (page)">+</button>
        <button className="btn-icon" onClick={() => nativeZoom('out')} title="Zoom out (map control)">🔍−</button>
        <button className="btn-icon" onClick={() => nativeZoom('in')} title="Zoom in (map control)">🔍+</button>
        <button className="btn-secondary" onClick={handleExtract} disabled={extracting || isRunning} title="Extract business info from this page">
          {extracting ? '⟳ Extracting…' : '🔍 Extract Lead'}
        </button>
        <button
          className={`btn-secondary ${scrapeMode ? 'active' : ''}`}
          onClick={() => setScrapeMode((v) => !v)}
          style={scrapeMode ? { borderColor: 'var(--accent-border)', color: 'var(--accent)' } : undefined}
          title="Toggle Scrape Mode — turns this browser into a mission-control scraper"
        >
          🗺 {scrapeMode ? 'Scrape Mode: On' : 'Scrape Mode'}
        </button>
      </div>

      {findOpen && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', padding: 'var(--space-1) var(--space-2)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }}>
          <input
            ref={findInputRef}
            type="text"
            value={findQuery}
            onChange={(e) => { setFindQuery(e.target.value); if (e.target.value) { try { webviewRef.current?.findInPage(e.target.value); } catch {} } else { setFindResult(null); try { webviewRef.current?.stopFindInPage('clearSelection'); } catch {} } }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runFind(!e.shiftKey, true);
              else if (e.key === 'Escape') { setFindOpen(false); setFindQuery(''); setFindResult(null); try { webviewRef.current?.stopFindInPage('clearSelection'); } catch {} }
            }}
            placeholder="Find in page…"
            style={{ flex: 1, height: 28, padding: '0 var(--space-2)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 'var(--font-size-sm)' }}
          />
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', minWidth: 50, textAlign: 'center' }}>
            {findResult ? `${findResult.active}/${findResult.total}` : findQuery ? '0/0' : ''}
          </span>
          <button className="btn-icon" onClick={() => runFind(false, true)} title="Previous match">▲</button>
          <button className="btn-icon" onClick={() => runFind(true, true)} title="Next match">▼</button>
          <button className="btn-icon" onClick={() => { setFindOpen(false); setFindQuery(''); setFindResult(null); try { webviewRef.current?.stopFindInPage('clearSelection'); } catch {} }} title="Close">✕</button>
        </div>
      )}

      <PanelGroup direction="vertical" autoSaveId="browser-vertical" style={{ flex: 1, minHeight: 0 }}>
        <Panel defaultSize={72} minSize={30}>
          <PanelGroup direction="horizontal" autoSaveId="browser-horizontal">
            <Panel ref={configPanelRef} defaultSize={0} minSize={16} maxSize={40} collapsible collapsedSize={0} onCollapse={() => setConfigCollapsed(true)} onExpand={() => setConfigCollapsed(false)}>
                <div className="dashboard-card" style={{ height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  <h4>Scrape Configuration</h4>
                  <div className="field-group">
                    <label>Source</label>
                    <select value={params.source} onChange={(e) => setParams({ ...params, source: e.target.value })} disabled={isRunning}
                      style={{ height: 32, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', padding: '0 var(--space-2)' }}>
                      <option value="google">Google Maps</option>
                      <option value="bing">Bing Maps</option>
                      <option value="yelp">Yelp</option>
                      <option value="yellowpages">Yellow Pages</option>
                      <option value="yell">Yell (UK)</option>
                      <option value="justdial">JustDial</option>
                      <option value="indiamart">IndiaMART</option>
                      <option value="openstreetmap">OpenStreetMap</option>
                    </select>
                  </div>
                  <div className="field-group">
                    <label>Niche / Business Type</label>
                    <input type="text" value={params.niche} onChange={(e) => setParams({ ...params, niche: e.target.value })} placeholder="e.g., plumber, restaurant, dentist" disabled={isRunning} />
                  </div>
                  <div className="field-group">
                    <label>Location</label>
                    <input type="text" value={params.location} onChange={(e) => setParams({ ...params, location: e.target.value })} placeholder="e.g., Austin, TX" disabled={isRunning} />
                  </div>
                  <div className="field-group">
                    <label>Max Leads to Extract</label>
                    <input type="number" value={params.maxLeads} onChange={(e) => setParams({ ...params, maxLeads: parseInt(e.target.value) || 10 })} min="1" max="500" disabled={isRunning} />
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>
                    <input type="checkbox" checked={params.fullArea} onChange={(e) => setParams({ ...params, fullArea: e.target.checked })} disabled={isRunning} />
                    Scan full area (pan + zoom out once exhausted)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>
                    <input type="checkbox" checked={autoZoom} onChange={(e) => setAutoZoom(e.target.checked)} />
                    Auto-zoom to a wide starting view before scanning
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>
                    <input type="checkbox" checked={domainDedup} onChange={(e) => setDomainDedup(e.target.checked)} />
                    Also treat matching website domain as a duplicate
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>
                    <input type="checkbox" checked={autoEnrich} onChange={(e) => setAutoEnrich(e.target.checked)} />
                    Auto-enrich newly captured leads (deep scan, no manual click needed)
                  </label>
                  <div className="field-group">
                    <label>Anti-ban profile</label>
                    <select value={antiBanPreset} onChange={(e) => setAntiBanPreset(e.target.value as 'safe' | 'aggressive')} disabled={isRunning}
                      style={{ height: 32, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', padding: '0 var(--space-2)' }}>
                      <option value="safe">Safe (slower, longer random delays)</option>
                      <option value="aggressive">Aggressive (fast, higher rate-limit risk)</option>
                    </select>
                  </div>
                  {captchaPaused && (
                    <div className="dashboard-card" style={{ borderLeft: '3px solid var(--red)', padding: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                      <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>⚠️ CAPTCHA detected</div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>Solve it in the map view above, then resume.</div>
                      <button className="btn-primary" onClick={handleResumeAfterCaptcha}>▶ Resume Scan</button>
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {!isRunning ? (
                      <button className="btn-primary" onClick={handleStartScrape}>▶ Start Scrape</button>
                    ) : (
                      <button className="btn-secondary" onClick={handleStopScrape}>⏹ Stop</button>
                    )}
                    {status && <span style={{ fontSize: 'var(--font-size-xs)', color: status.includes('failed') ? 'var(--red)' : 'var(--text-secondary)' }}>{status}</span>}
                  </div>
                  {captured > 0 && <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--green)' }}>{captured} lead(s) captured this session</div>}

                  {!isRunning && ranOnce && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--border-glass)' }}>
                      <strong style={{ fontSize: 'var(--font-size-sm)' }}>Scrape Complete</strong>
                      <button className="btn-secondary" onClick={async () => { const r = await ipc.exportLeadsCsv(); setStatus(r.ok ? `Exported ${r.count} lead(s)` : (r.error || 'Export failed')); }}>⬇ Export</button>
                      <button className="btn-secondary" onClick={() => setActiveModule('leads')}>📋 Open Leads</button>
                      <button className="btn-primary" onClick={handleStartScrape}>▶ Continue Scraping</button>
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--border-glass)' }}>
                    <h4 style={{ margin: 0 }}>🚀 Autopilot Queue</h4>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
                      Queue the current niche across multiple locations (one per line, or comma/semicolon-separated) and let it run unattended — it auto-advances to the next location as soon as one finishes.
                    </div>
                    <div className="field-group">
                      <label>Location(s) to queue</label>
                      <textarea
                        value={queueLocationsInput}
                        onChange={(e) => setQueueLocationsInput(e.target.value)}
                        placeholder={'Austin, TX\nDallas, TX\nHouston, TX'}
                        rows={3}
                        disabled={autopilotOn}
                        style={{ borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', padding: 'var(--space-2)', fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', resize: 'vertical' }}
                      />
                    </div>
                    <button className="btn-secondary" onClick={handleAddAutopilotJobs} disabled={autopilotOn}>➕ Add to Queue (uses niche/source/max/full-area above)</button>

                    {autopilotJobs.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflow: 'auto' }}>
                        {autopilotJobs.map((j) => (
                          <div key={j.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-glass)', fontSize: 'var(--font-size-xs)' }}>
                            <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              <span style={{ marginRight: 4 }}>
                                {j.status === 'running' ? '🟢' : j.status === 'done' ? '✅' : j.status === 'failed' ? '⚠️' : '⏳'}
                              </span>
                              {j.niche} — {j.location}
                              {(j.status === 'done' || j.status === 'running') && j.captured > 0 && <span style={{ color: 'var(--text-tertiary)' }}> ({j.captured} captured)</span>}
                            </div>
                            {j.status === 'pending' && (
                              <button className="btn-icon" onClick={() => handleRemoveAutopilotJob(j.id)} title="Remove">✕</button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      {!autopilotOn ? (
                        <button className="btn-primary" onClick={handleStartAutopilot} disabled={!autopilotJobs.some((j) => j.status === 'pending')}>▶ Start Autopilot</button>
                      ) : (
                        <button className="btn-secondary" onClick={handleStopAutopilot}>⏹ Stop Autopilot</button>
                      )}
                      {autopilotJobs.some((j) => j.status === 'done' || j.status === 'failed') && (
                        <button className="btn-secondary" onClick={handleClearFinishedJobs} disabled={autopilotOn}>Clear Finished</button>
                      )}
                    </div>
                  </div>
                </div>
              </Panel>

              <PanelResizeHandle className="resize-handle-v" />

              <Panel defaultSize={56} minSize={30}>
                <div className="dashboard-card" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                    <h4>Live Map</h4>
                    {configCollapsed && <button className="btn-secondary" onClick={() => configPanelRef.current?.expand()}>☰ Show Config</button>}
                  </div>
                  <div style={{ flex: 1, borderRadius: 'var(--radius-lg)', overflow: 'hidden', border: '1px solid var(--border)', background: 'white' }}>
                    <webview key={activeProfile.partition} ref={webviewRef} src={url} partition={activeProfile.partition} useragent={chromeUserAgent} allowpopups={true} style={{ width: '100%', height: '100%' }} />
                  </div>
                </div>
              </Panel>

              <PanelResizeHandle className="resize-handle-v" />

              <Panel defaultSize={28} minSize={20} maxSize={40}>
                <div className="dashboard-card" style={{ height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  {scrapeMode && <h4>🎛 Mission Control</h4>}
                  {scrapeMode && (() => {
                    const elapsedMin = Math.max((Date.now() - startTimeRef.current) / 60000, 0.01);
                    const rate = counters.newLeads / elapsedMin;
                    const remaining = Math.max(params.maxLeads - captured, 0);
                    const etaMin = isRunning && rate > 0.05 ? Math.ceil(remaining / rate) : null;
                    const tiles: { icon: string; label: string; value: string }[] = [
                      { icon: '🟢', label: 'Task', value: isRunning ? (status.slice(0, 40) || 'Scanning') : 'Idle' },
                      { icon: '⚡', label: 'Leads/min', value: isRunning ? rate.toFixed(1) : '—' },
                      { icon: '📦', label: 'Queue remaining', value: isRunning ? String(remaining) : '—' },
                      { icon: '🔁', label: 'Pan/zoom retries', value: String(retries) },
                      { icon: '❌', label: 'Failed captures', value: String(counters.errors) },
                      { icon: '⏱', label: 'ETA', value: etaMin != null ? `~${etaMin} min` : '—' },
                    ];
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                        {tiles.map((t) => (
                          <div key={t.label} style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-glass)' }}>
                            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>{t.icon} {t.label}</span>
                            <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>{t.value}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  {scrapeMode && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-2)' }}>
                      {([['Found', counters.found], ['New', counters.newLeads], ['Duplicates', counters.duplicates], ['Emails', counters.emails], ['Websites', counters.websites], ['Errors', counters.errors]] as [string, number][]).map(([label, value]) => (
                        <div key={label} style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 'var(--font-size-md)', fontWeight: 700 }}><CountUp value={value} durationMs={300} /></div>
                          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>{label}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {scrapeMode && latestLead && (
                    <div className="dashboard-card" style={{ borderLeft: `3px solid ${latestLead.status === 'saved' ? 'var(--green)' : 'var(--text-tertiary)'}`, padding: 'var(--space-2)' }}>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>Newest lead</div>
                      <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>{latestLead.status === 'saved' ? '✓' : '•'} {latestLead.businessName}</div>
                    </div>
                  )}

                  {scrapeMode && <div style={{ borderTop: '1px solid var(--border-glass)' }} />}

                  <div style={{ display: 'flex', gap: 4 }}>
                    {(['extract', 'bookmarks', 'history', 'extensions', 'profiles'] as const).map((tab) => (
                      <button key={tab} className={`btn-secondary ${sidebarTab === tab ? 'active' : ''}`} onClick={() => setSidebarTab(tab)} style={sidebarTab === tab ? { borderColor: 'var(--accent-border)', color: 'var(--accent)' } : undefined}>
                        {tab === 'extract' ? '🔍 Lead' : tab === 'bookmarks' ? '★ Marks' : tab === 'history' ? '🕐 History' : tab === 'extensions' ? '🧩 Ext' : '👤 Profiles'}
                      </button>
                    ))}
                  </div>

                  {sidebarTab === 'profiles' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
                        Each profile is an isolated session — its own cookies, logins, and local storage. Switching profiles reloads the page in that profile's session.
                      </div>
                      <button className="btn-secondary" onClick={handleAddProfile}>➕ New Profile</button>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {profiles.map((p) => (
                          <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-2)', border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-md)', cursor: 'pointer', ...(p.name === activeProfileName ? { borderColor: 'var(--accent-border)' } : {}) }} onClick={() => handleSwitchProfile(p.name)}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', color: p.name === activeProfileName ? 'var(--accent)' : undefined }}>
                                {p.name === activeProfileName ? '● ' : ''}{p.name}
                              </div>
                              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.proxy || 'No proxy'}</div>
                            </div>
                            {p.name !== DEFAULT_PROFILE.name && (
                              <button className="btn-icon" onClick={(e) => { e.stopPropagation(); handleDeleteProfile(p.name); }} title="Delete profile">✕</button>
                            )}
                          </div>
                        ))}
                      </div>
                      <div style={{ borderTop: '1px solid var(--border-glass)', paddingTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>Proxy for "{activeProfile.name}"</div>
                        <input
                          className="input"
                          placeholder="e.g. http://user:pass@host:port"
                          value={proxyInput}
                          onChange={(e) => setProxyInput(e.target.value)}
                        />
                        <button className="btn-primary" onClick={handleSaveProxy} disabled={savingProxy}>
                          {savingProxy ? '⟳ Applying…' : proxyInput.trim() ? 'Apply Proxy' : 'Clear Proxy'}
                        </button>
                      </div>
                    </div>
                  )}

                  {sidebarTab === 'extensions' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                      <button className="btn-secondary" onClick={handleLoadExtension} disabled={loadingExtension}>
                        {loadingExtension ? '⟳ Loading…' : '➕ Load Unpacked Extension…'}
                      </button>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
                        Loads a local unpacked extension folder (must contain manifest.json). No Chrome Web Store — Electron only supports unpacked extensions, and MV3 support is partial (background/content scripts work; some Chrome-only APIs don't exist here).
                      </div>
                      {extensions.length === 0 ? (
                        <div className="empty-state"><div className="empty-desc">No extensions loaded.</div></div>
                      ) : (
                        extensions.map((ext) => (
                          <div key={ext.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-2)', border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-md)' }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ext.name}</div>
                              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>v{ext.version}</div>
                            </div>
                            <button className="btn-icon" onClick={() => handleRemoveExtension(ext.id)} title="Remove">✕</button>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {sidebarTab === 'extract' && (
                    extracted ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>
                        <div><strong>{extracted.businessName || '(no title found)'}</strong></div>
                        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)' }}>
                          <div>✉ {extracted.email || '—'}</div>
                          <div>📞 {extracted.phone || '—'}</div>
                          <div>🌐 {extracted.website}</div>
                          {!!extracted.socialLinks?.length && <div>🔗 {extracted.socialLinks.length} social link(s)</div>}
                        </div>
                        {extracted.description && <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>{extracted.description}</div>}
                        <button className="btn-primary" onClick={handleSaveAsLead} disabled={saving}>{saving ? 'Saving…' : '💾 Save as Lead'}</button>
                        {savedLeadId && (
                          <button className="btn-secondary" onClick={handleDeepInvestigate} disabled={investigating}>
                            {investigating ? '⟳ Investigating…' : '🔬 Deep Investigate (SEO, tech, opportunities)'}
                          </button>
                        )}
                        {investigateResult && (
                          <div style={{ fontSize: 'var(--font-size-xs)', display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px solid var(--border-glass)', paddingTop: 'var(--space-2)' }}>
                            {investigateResult.scoring && (
                              <div><strong>Score:</strong> {investigateResult.scoring.total}/100 — <strong>{investigateResult.scoring.decision}</strong></div>
                            )}
                            {!!investigateResult.techStack?.flat?.length && (
                              <div><strong>Tech:</strong> {investigateResult.techStack.flat.map((t) => t.name).join(', ')}</div>
                            )}
                            {!!investigateResult.opportunities?.length && (
                              <div>
                                <strong>Opportunities:</strong>
                                <ul style={{ margin: '2px 0 0', paddingLeft: 16 }}>
                                  {investigateResult.opportunities.slice(0, 4).map((o) => (
                                    <li key={o.gap}>{o.gap} → {o.potentialService}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            <button className="btn-secondary" onClick={() => setActiveModule('leads')}>Open in Leads →</button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="empty-state">
                        <div className="empty-icon">🔍</div>
                        <div className="empty-desc">Browse to a business's website, then click "Extract Lead" to pull its name, email, phone, and socials.</div>
                      </div>
                    )
                  )}

                  {sidebarTab === 'bookmarks' && (
                    bookmarks.length === 0 ? (
                      <div className="empty-state"><div className="empty-desc">No bookmarks yet — click ☆ on any page.</div></div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {bookmarks.map((b) => (
                          <div key={b.url} onClick={() => navigate(b.url)} style={{ cursor: 'pointer', padding: 'var(--space-1)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-xs)' }} className="activity-item">
                            <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.title}</div>
                            <div style={{ color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.url}</div>
                          </div>
                        ))}
                      </div>
                    )
                  )}

                  {sidebarTab === 'history' && (
                    history.length === 0 ? (
                      <div className="empty-state"><div className="empty-desc">No history yet this session.</div></div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {history.map((h, i) => (
                          <div key={i} onClick={() => navigate(h)} style={{ cursor: 'pointer', padding: 'var(--space-1)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} className="activity-item">
                            {h}
                          </div>
                        ))}
                      </div>
                    )
                  )}
                </div>
              </Panel>
            </PanelGroup>
          </Panel>

          <PanelResizeHandle className="resize-handle-h" />

          <Panel ref={bottomPanelRef} defaultSize={0} minSize={12} collapsible collapsedSize={0}>
            <div className="dashboard-card" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                {BOTTOM_TABS.map((tab) => (
                  <button key={tab} className={`btn-secondary ${bottomTab === tab ? 'active' : ''}`} onClick={() => setBottomTab(tab)} style={bottomTab === tab ? { borderColor: 'var(--accent-border)', color: 'var(--accent)' } : undefined}>
                    {tab} {tab === 'Results' ? `(${resultsLog.length})` : tab === 'Errors' ? `(${errorLog.length})` : ''}
                  </button>
                ))}
              </div>
              <div style={{ flex: 1, overflow: 'auto' }}>
                {bottomTab === 'Results' && (
                  resultsLog.length === 0 ? (
                    <div className="empty-state"><div className="empty-desc">No results yet — start a scrape to see captured businesses here.</div></div>
                  ) : (
                    <table className="data-table">
                      <thead><tr><th>Business</th><th>Status</th><th>Website</th><th>Email</th><th>Phone</th><th>Rating</th></tr></thead>
                      <tbody>
                        {resultsLog.map((r, i) => (
                          <tr key={i}>
                            <td>{r.businessName}</td>
                            <td><span className={`badge ${r.status === 'saved' ? 'badge-green' : 'badge-accent'}`}>{r.status}</span></td>
                            <td>{r.website ? '✓' : '—'}</td>
                            <td>{r.email ? '✓' : '—'}</td>
                            <td>{r.phone ? '✓' : '—'}</td>
                            <td>{r.rating || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                )}
                {bottomTab === 'Activity' && (
                  activityLog.length === 0 ? (
                    <div className="empty-state"><div className="empty-desc">No activity yet.</div></div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {activityLog.map((e, i) => (
                        <div key={i} style={{ display: 'flex', gap: 'var(--space-2)', fontSize: 'var(--font-size-xs)' }}>
                          <span style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{e.at.slice(11, 19)}</span>
                          <span>{e.message}</span>
                        </div>
                      ))}
                    </div>
                  )
                )}
                {bottomTab === 'Errors' && (
                  errorLog.length === 0 ? (
                    <div className="empty-state"><div className="empty-desc">No errors — clean run so far.</div></div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {errorLog.map((e, i) => (
                        <div key={i} style={{ display: 'flex', gap: 'var(--space-2)', fontSize: 'var(--font-size-xs)' }}>
                          <span style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{e.at.slice(11, 19)}</span>
                          <span style={{ color: 'var(--red)' }}>{e.message}</span>
                        </div>
                      ))}
                    </div>
                  )
                )}
                {bottomTab === 'Downloads' && (
                  downloads.length === 0 ? (
                    <div className="empty-state"><div className="empty-desc">No downloads yet.</div></div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {downloads.map((d) => {
                        const pct = d.totalBytes > 0 ? Math.round((d.receivedBytes / d.totalBytes) * 100) : 0;
                        return (
                          <div
                            key={d.id}
                            onClick={() => { if (d.state === 'completed') ipc.showDownloadInFolder(d.savePath); }}
                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-glass)', fontSize: 'var(--font-size-xs)', cursor: d.state === 'completed' ? 'pointer' : 'default' }}
                          >
                            <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.filename}</div>
                            <span style={{ color: d.state === 'completed' ? 'var(--green)' : d.state === 'interrupted' || d.state === 'cancelled' ? 'var(--red)' : 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                              {d.state === 'completed' ? '✓ Done' : d.state === 'interrupted' ? 'Failed' : d.state === 'cancelled' ? 'Cancelled' : `${pct}%`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )
                )}
              </div>
            </div>
          </Panel>
        </PanelGroup>
    </div>
  );
}
