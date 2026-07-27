// src/scraper/pageScraper.js
//
// This is the SAME extraction logic already proven in the Chrome/Firefox
// extension (schema.org-first, attribute-based address, garbage-name
// filtering, category/pain-signal detection) — not a rewrite. It's
// exported as plain strings because webview.executeJavaScript() needs
// source text to inject into the page, the same mechanical requirement
// the extension has with chrome.scripting.executeScript's `func` option.
//
// Keeping this in its own module (rather than inlining strings in app.js)
// is what makes it independently testable and reusable — the extraction
// logic itself has zero Electron-specific code in it.

// Returns an array of extracted business objects from whatever page is
// currently loaded — schema.org/JSON-LD first (highest confidence),
// falling back to structural card detection for sites without it.
const SCRAPE_PAGE_JS = `
(function() {
  const results = [];
  const seen = new Set();
  const stats = { containersFound: 0, extracted: 0, schemaFound: 0 };

  try {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    scripts.forEach(s => {
      try {
        const data = JSON.parse(s.textContent);
        const items = Array.isArray(data) ? data : (data['@graph'] || [data]);
        items.forEach(item => {
          const type = item['@type'] || '';
          const types = Array.isArray(type) ? type : [type];
          const isBusiness = types.some(t => /LocalBusiness|Organization|Restaurant|Store|ProfessionalService|FoodEstablishment/i.test(t));
          if (!isBusiness || !item.name || seen.has(item.name)) return;
          const addr = item.address;
          const addressStr = addr && typeof addr === 'object'
            ? [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode].filter(Boolean).join(', ')
            : (addr || '');
          const rating = item.aggregateRating || {};
          seen.add(item.name);
          stats.schemaFound++; stats.extracted++;
          results.push({
            businessName: item.name, phone: item.telephone || '', address: addressStr,
            website: item.url || '', rating: rating.ratingValue ? String(rating.ratingValue) : '',
            reviewCount: rating.reviewCount ? String(rating.reviewCount) : '',
            category: types.join(', '), email: '',
          });
        });
      } catch (e) {}
    });
  } catch (e) {}

  const GARBAGE_NAME_PATTERNS = /^(sponsored|advertisement|see all|show more|next|previous|page \\d+)$|^results? for\\b/i;

  function safeExtract(container) {
    stats.containersFound++;
    try {
      const name = (container.getAttribute('aria-label') ||
        container.querySelector('.qBF1Pd, .fontHeadlineSmall, h2, .title, [class*="name"]')?.textContent || '').trim();
      if (!name || GARBAGE_NAME_PATTERNS.test(name) || name.length < 2 || seen.has(name)) return null;

      const text = container.innerText || '';
      const lines = text.split('\\n').map(l => l.trim()).filter(Boolean);
      const nameLineIdx = lines.findIndex(l => l === name || l.includes(name));

      let phone = null;
      for (const line of lines) {
        const m = line.match(/(\\+?\\(?\\d{1,4}\\)?[\\s\\-]?\\d{2,4}[\\s\\-]?\\d{3,4}[\\s\\-]?\\d{0,4})/);
        if (m && m[1].replace(/\\D/g, '').length >= 8) { phone = m[1].trim(); break; }
      }
      let rating = null;
      for (const line of lines) { if (/^\\d(\\.\\d)?$/.test(line)) { rating = line; break; } }
      let reviewCount = null;
      for (const line of lines) { const m = line.match(/^\\(([\\d,]+)\\)$/); if (m) { reviewCount = m[1].replace(/,/g, ''); break; } }

      const addressAttrEl = container.querySelector('[data-item-id^="address"]');
      const addressLine = (addressAttrEl && addressAttrEl.textContent.trim()) ||
        lines.find(l => /\\d.*\\b(St|Rd|Ave|Dr|Blvd|Hwy|Street|Road|Way|Ln|Pl|Tunnel|Tce|Terrace|Cct|Circuit|Pde|Parade)\\b/i.test(l)) || '';

      let category = '';
      if (nameLineIdx >= 0) {
        for (let i = nameLineIdx + 1; i < Math.min(nameLineIdx + 4, lines.length); i++) {
          const candidate = lines[i];
          const isNoise = candidate === rating || candidate === '(' + reviewCount + ')' ||
            candidate === addressLine || /^\\d/.test(candidate) || candidate.length > 40 ||
            /^(open|closed|closes|opens)\\b/i.test(candidate);
          if (!isNoise && candidate.length >= 2) { category = candidate; break; }
        }
      }

      const website = container.querySelector('a[data-value="Website"], a[href^="http"]:not([href*="google.com"]):not([href*="bing.com"])')?.href || '';

      // The Maps listing's own href (e.g. a.hfpxzc, or the container itself
      // when it IS that anchor) contains a stable place-ID segment
      // (!1s0x...:0x...) that survives across separate search sessions even
      // when the business's name/phone/domain listing varies slightly —
      // the strongest dedup signal available, stronger than phone or name.
      const mapsLink = container.querySelector('a.hfpxzc') || (container.matches && container.matches('a.hfpxzc') ? container : null);
      const googleMapsUrl = mapsLink ? mapsLink.href : '';

      seen.add(name);
      stats.extracted++;
      return { businessName: name, phone: phone || '', address: addressLine, website, googleMapsUrl, rating: rating || '', reviewCount: reviewCount || '', category, email: '' };
    } catch (e) { return null; }
  }

  try {
    const gArticles = document.querySelectorAll('div[role="feed"] > div > div[role="article"], a.hfpxzc');
    gArticles.forEach(el => {
      const container = el.closest('div[role="article"]') || el;
      const row = safeExtract(container);
      if (row) results.push(row);
    });
  } catch (e) {}

  try {
    const bCards = document.querySelectorAll('.listContainer .b_algo, .entity-item, [class*="listItem"]');
    bCards.forEach(card => { const row = safeExtract(card); if (row) results.push(row); });
  } catch (e) {}

  return { rows: results, stats };
})();
`;

const AUTO_SCROLL_JS = `
(function() {
  return new Promise((resolve) => {
    const panel = document.querySelector('div[role="feed"]') || document.querySelector('.listContainer') || document.scrollingElement;
    let step = 0;
    const totalSteps = 5 + Math.floor(Math.random() * 4); // 5-8 steps, varies per call

    function scrollStep() {
      try {
        // Incremental scroll by a randomized distance, not an instant jump
        // to the bottom — a real person scrolls in chunks, not teleports.
        const delta = 250 + Math.random() * 450; // 250-700px per step
        if (panel) panel.scrollTop += delta;
        window.scrollBy(0, delta);
      } catch (e) {}

      step++;
      if (step >= totalSteps) { resolve(true); return; }

      // Randomized pause between scroll steps — occasionally a longer pause
      // (as if reading a result), not a uniform interval every time.
      const pause = Math.random() < 0.2
        ? 1400 + Math.random() * 900   // ~20% of the time: a longer "reading" pause
        : 500 + Math.random() * 500;    // otherwise: a normal scroll-to-scroll gap
      setTimeout(scrollStep, pause);
    }
    scrollStep();
  });
})();
`;

// Dispatches real mouseover/mousemove events across a few of the visible
// result cards before extraction — the same "don't teleport straight to
// the data" naturalism principle as AUTO_SCROLL_JS's randomized pacing,
// applied to pointer movement instead of scroll position.
const HOVER_JS = `
(function() {
  try {
    const cards = document.querySelectorAll('div[role="article"], a.hfpxzc, .b_algo, [class*="listItem"]');
    const sample = Array.from(cards).slice(0, 5);
    sample.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y }));
      el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
    });
    return sample.length;
  } catch (e) { return 0; }
})();
`;

const CLICK_LOAD_MORE_JS = `
(function() {
  const pattern = /load more|show more|view more|see more|more results|^next$/i;
  const candidates = document.querySelectorAll('button, a[role="button"], a');
  for (const el of candidates) {
    const text = (el.innerText || el.textContent || '').trim();
    if (text.length > 0 && text.length < 40 && pattern.test(text) && el.offsetParent !== null) {
      try { el.click(); return true; } catch (e) {}
    }
  }
  return false;
})();
`;

const DISMISS_COOKIE_BANNER_JS = `
(function() {
  const KNOWN_IDS = ['#onetrust-accept-btn-handler', '#accept-cookies', '.cc-btn.cc-allow'];
  for (const sel of KNOWN_IDS) {
    const el = document.querySelector(sel);
    if (el && el.offsetParent !== null) { el.click(); return true; }
  }
  return false;
})();
`;

// Zoom/pan — same proven approach as the extension: click the site's real
// on-screen control first (fires the real handler reliably), falling back
// to synthetic keyboard/wheel events only if no button is found. The
// button-click-first order was chosen after live-testing showed that
// canvas/WebGL-rendered maps (Google's especially) often ignore
// JS-dispatched keyboard/wheel events outright — a real .click() on the
// site's own button does not have that problem.
const ZOOM_IN_JS = `
(function() {
  try {
    const btn = document.querySelector('[aria-label="Zoom in" i], [title="Zoom in" i], button[jsaction*="zoomIn"]');
    if (btn) { btn.click(); return true; }
    const mapEl = document.querySelector('#map, [role="application"]') || document.body;
    mapEl.focus?.();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
    const rect = mapEl.getBoundingClientRect();
    mapEl.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2, bubbles: true }));
    return true;
  } catch (e) { return false; }
})();
`;

const ZOOM_OUT_JS = `
(function() {
  try {
    const btn = document.querySelector('[aria-label="Zoom out" i], [title="Zoom out" i], button[jsaction*="zoomOut"]');
    if (btn) { btn.click(); return true; }
    const mapEl = document.querySelector('#map, [role="application"]') || document.body;
    mapEl.focus?.();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true }));
    const rect = mapEl.getBoundingClientRect();
    mapEl.dispatchEvent(new WheelEvent('wheel', { deltaY: 200, clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2, bubbles: true }));
    return true;
  } catch (e) { return false; }
})();
`;

// direction argument gets substituted before injection (see app.js's PAN_JS usage)
function panJs(direction) {
  return `
(function() {
  try {
    const mapEl = document.querySelector('#map, [role="application"]') || document.body;
    mapEl.focus?.();
    const keyMap = { right: 'ArrowRight', left: 'ArrowLeft', up: 'ArrowUp', down: 'ArrowDown' };
    const key = keyMap['${direction}'];
    if (!key) return false;
    for (let i = 0; i < 8; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
    return true;
  } catch (e) { return false; }
})();
`;
}

// Without an explicit region hint, Google/Bing Maps fall back to the
// machine's own locale/IP geolocation to disambiguate results — which is
// exactly what produces "search for a US city, get results from wherever
// the computer happens to be." Recognizing the location text and passing
// an explicit country bias fixes that regardless of the host machine's
// own locale.
const COUNTRY_HINTS = [
  [/\b(usa|u\.s\.a\.?|united states)\b/i, 'us'], [/\b([a-z]{2})\s*\d{5}(-\d{4})?$/i, 'us'], // "City, TX 78701" etc.
  [/\b(uk|united kingdom|england|scotland|wales)\b/i, 'gb'],
  [/\b(canada)\b/i, 'ca'], [/\b(australia)\b/i, 'au'], [/\b(new zealand)\b/i, 'nz'],
  [/\b(india)\b/i, 'in'], [/\b(singapore)\b/i, 'sg'], [/\b(uae|dubai|abu dhabi)\b/i, 'ae'],
  [/\b(germany|deutschland)\b/i, 'de'], [/\b(france)\b/i, 'fr'], [/\b(ireland)\b/i, 'ie'],
  [/,\s*(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy)\b/i, 'us'], // ", TX" style US state abbreviation
];

function guessCountryCode(location) {
  for (const [pattern, code] of COUNTRY_HINTS) {
    if (pattern.test(location)) return code;
  }
  return '';
}

// Multi-platform URL builder — same 8-site coverage already proven in the
// extension. Adding a new site here is a one-line addition; the scraper
// itself is structure-based (schema.org first, then adaptive card
// detection), so it doesn't need per-site extraction rules.
function buildSearchUrl(source, niche, location) {
  const q = encodeURIComponent(`${niche} ${location}`.trim());
  const nicheEnc = encodeURIComponent(niche);
  const locEnc = encodeURIComponent(location);
  const countryCode = guessCountryCode(location);
  switch (source) {
    // hl/gl bias Google's results toward the country the location text
    // actually names, instead of silently falling back to the host
    // machine's own locale/IP.
    case 'google':        return `https://www.google.com/maps/search/${q}${countryCode ? `?hl=en&gl=${countryCode}` : ''}`;
    case 'bing':           return `https://www.bing.com/maps?q=${q}${countryCode ? `&cc=${countryCode}` : ''}`;
    case 'yelp':            return `https://www.yelp.com/search?find_desc=${nicheEnc}&find_loc=${locEnc}`;
    case 'yellowpages':      return `https://www.yellowpages.com/search?search_terms=${nicheEnc}&geo_location_terms=${locEnc}`;
    case 'yell':               return `https://www.yell.com/ucs/UcsSearchAction.do?keywords=${nicheEnc}&location=${locEnc}`;
    case 'justdial':            return `https://www.justdial.com/${locEnc}/${nicheEnc}`;
    case 'indiamart':             return `https://dir.indiamart.com/search.mp?ss=${nicheEnc}&cq=${locEnc}`;
    case 'openstreetmap':          return `https://www.openstreetmap.org/search?query=${q}`;
    default:                        return '';
  }
}

// Detects the common visual/DOM markers of an interstitial CAPTCHA/anti-bot
// challenge page (reCAPTCHA, hCaptcha, or a generic "unusual traffic"
// interstitial). This is detection only — the scan loop pauses and asks the
// human operator to solve it, rather than attempting to defeat it.
const DETECT_CAPTCHA_JS = `
(function() {
  try {
    const hasRecaptcha = !!document.querySelector('iframe[src*="recaptcha"], .g-recaptcha, #recaptcha');
    const hasHcaptcha = !!document.querySelector('iframe[src*="hcaptcha"], .h-captcha');
    const bodyText = (document.body && document.body.innerText || '').toLowerCase();
    const hasUnusualTrafficText = /unusual traffic|verify you.?re a human|are you a robot|automated queries/i.test(bodyText);
    return hasRecaptcha || hasHcaptcha || hasUnusualTrafficText;
  } catch (e) { return false; }
})();
`;

// ============================================================
// Universal Browser Engine — everything below works on ANY site,
// no per-site selectors. Same deterministic, no-AI approach as
// SCRAPE_PAGE_JS's JSON-LD tier, generalized: sites that don't publish
// schema.org/microdata/Open Graph fall through to a generic repeated-
// sibling-structure detector (group DOM siblings by tag+class signature,
// the group with the most similarly-shaped repeats IS the list — the
// same technique commercial "auto-detect" scrapers like Octoparse use,
// just without the paid product wrapped around it).
// ============================================================

// Cookie-consent frameworks in the wild almost all boil down to one of a
// few vendor widgets (OneTrust, Cookiebot, Quantcast, TrustArc, Osano) or
// a bare button with predictable text — covering both means this works
// on the large majority of sites without a single site-specific rule.
const UNIVERSAL_DISMISS_JS = `
(function() {
  let dismissed = 0;
  const VENDOR_SELECTORS = [
    '#onetrust-accept-btn-handler',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '.qc-cmp2-summary-buttons button[mode="primary"]',
    '#truste-consent-button',
    '.osano-cm-accept-all',
    '.cc-btn.cc-allow',
    '#accept-cookies',
  ];
  for (const sel of VENDOR_SELECTORS) {
    try {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) { el.click(); dismissed++; }
    } catch (e) {}
  }

  // Generic fallback: any visible button/link whose text is a common
  // consent-accept phrase — same "match by text, not by selector"
  // principle already proven in CLICK_LOAD_MORE_JS.
  try {
    const pattern = /^(accept all|accept cookies|allow all|i accept|agree|got it|ok, got it|understood)$/i;
    const candidates = document.querySelectorAll('button, a[role="button"]');
    for (const el of candidates) {
      const text = (el.innerText || el.textContent || '').trim();
      if (pattern.test(text) && el.offsetParent !== null) { el.click(); dismissed++; break; }
    }
  } catch (e) {}

  // Generic popup/modal dismissal: a fixed/sticky element covering a large
  // share of the viewport with its own close control — the shape of
  // newsletter signups, age-gates, and app-install nags regardless of
  // what site built them.
  try {
    const all = document.querySelectorAll('div, section, aside');
    const vw = window.innerWidth, vh = window.innerHeight;
    for (const el of all) {
      const style = window.getComputedStyle(el);
      if (style.position !== 'fixed' && style.position !== 'sticky') continue;
      if (parseInt(style.zIndex || '0', 10) < 100) continue;
      const rect = el.getBoundingClientRect();
      const coverage = (rect.width * rect.height) / (vw * vh);
      if (coverage < 0.25) continue; // too small to be a blocking modal
      const closeBtn = el.querySelector('[aria-label="Close" i], [aria-label="Dismiss" i], .close, .modal-close, [class*="close-button" i]') ||
        Array.from(el.querySelectorAll('button, a')).find(b => (b.textContent || '').trim() === '\\u00d7' || (b.textContent || '').trim().toLowerCase() === 'close');
      if (closeBtn) { closeBtn.click(); dismissed++; break; }
    }
  } catch (e) {}

  return dismissed;
})();
`;

// Scrolls until the page stops growing — the actual definition of
// "infinite scroll finished" — instead of a fixed step count that either
// stops short on a long page or over-scrolls a short one.
const UNIVERSAL_AUTO_SCROLL_JS = `
(function() {
  return new Promise((resolve) => {
    let lastHeight = 0, stableStreak = 0;
    const MAX_STEPS = 40;
    const STABLE_STREAK_TARGET = 3; // 3 consecutive no-growth checks = actually done, not just a slow-loading gap
    let step = 0;

    function tick() {
      const scroller = document.scrollingElement || document.documentElement;
      const currentHeight = scroller.scrollHeight;
      window.scrollBy(0, 400 + Math.random() * 500);

      if (currentHeight === lastHeight) stableStreak++; else stableStreak = 0;
      lastHeight = currentHeight;
      step++;

      if (stableStreak >= STABLE_STREAK_TARGET || step >= MAX_STEPS) { resolve({ steps: step, finalHeight: currentHeight }); return; }

      const pause = Math.random() < 0.2 ? 1200 + Math.random() * 800 : 450 + Math.random() * 450;
      setTimeout(tick, pause);
    }
    tick();
  });
})();
`;

// rel="next" (the actual HTML/HTTP standard for this), then the common
// "Next"/">"/"›" link-text convention used by everything that doesn't
// bother with rel=next.
const UNIVERSAL_NEXT_PAGE_JS = `
(function() {
  try {
    const relNext = document.querySelector('a[rel~="next"], link[rel="next"]');
    if (relNext && relNext.href) return relNext.href;
    const pattern = /^(next|next page|older|more results|\\u203a|\\u2192|»)$/i;
    const links = document.querySelectorAll('a[href]');
    for (const a of links) {
      const text = (a.innerText || a.textContent || '').trim();
      if (pattern.test(text) && a.offsetParent !== null) return a.href;
    }
    return null;
  } catch (e) { return null; }
})();
`;

// The universal extractor: JSON-LD -> microdata -> Open Graph -> generic
// repeated-sibling-structure detection. Each tier only runs if the
// previous one found nothing, cheapest/highest-confidence first.
const UNIVERSAL_SCRAPE_JS = `
(function() {
  const results = [];
  const seen = new Set();
  const stats = { containersFound: 0, extracted: 0, tier: '' };

  function addResult(row) {
    if (!row.businessName || seen.has(row.businessName)) return;
    seen.add(row.businessName);
    stats.extracted++;
    results.push(row);
  }

  // Tier 1: JSON-LD (same logic as the Maps/Bing extractor — reused here
  // because a generic business directory is exactly as likely to publish
  // schema.org as a Maps listing is).
  try {
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
      try {
        const data = JSON.parse(s.textContent);
        const items = Array.isArray(data) ? data : (data['@graph'] || [data]);
        items.forEach(item => {
          const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type'] || ''];
          if (!types.some(t => /LocalBusiness|Organization|Restaurant|Store|ProfessionalService|Product|Person/i.test(t))) return;
          if (!item.name) return;
          const addr = item.address;
          const addressStr = addr && typeof addr === 'object'
            ? [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode].filter(Boolean).join(', ')
            : (addr || '');
          addResult({
            businessName: item.name, phone: item.telephone || '', address: addressStr,
            website: item.url || '', email: item.email || '', category: types.join(', '),
          });
        });
      } catch (e) {}
    });
    if (results.length) stats.tier = 'json-ld';
  } catch (e) {}

  // Tier 2: microdata (itemscope/itemtype) — older but still common,
  // especially on WordPress/Yoast-generated directory sites.
  if (!results.length) {
    try {
      document.querySelectorAll('[itemscope][itemtype*="schema.org"]').forEach(el => {
        const type = el.getAttribute('itemtype') || '';
        if (!/LocalBusiness|Organization|Product|Person/i.test(type)) return;
        const get = (prop) => el.querySelector('[itemprop="' + prop + '"]');
        const nameEl = get('name');
        if (!nameEl) return;
        addResult({
          businessName: (nameEl.getAttribute('content') || nameEl.textContent || '').trim(),
          phone: (get('telephone')?.getAttribute('content') || get('telephone')?.textContent || '').trim(),
          address: (get('address')?.textContent || '').trim().replace(/\\s+/g, ' '),
          website: (get('url')?.getAttribute('href') || get('url')?.textContent || '').trim(),
          email: (get('email')?.textContent || '').trim(),
          category: type.split('/').pop(),
        });
      });
      if (results.length) stats.tier = 'microdata';
    } catch (e) {}
  }

  // Tier 3: generic repeated-sibling-structure detection — the actual
  // "universal" fallback for sites with no structured data at all.
  // Groups every element's children by tag+className signature; the
  // group with the most same-shaped repeats (min 3) is treated as "the
  // list." This is deliberately structural, not content-based — it works
  // the same whether the repeated items are business cards, product
  // tiles, or job postings.
  if (!results.length) {
    try {
      // Chrome, not content — a page's nav/TOC/header/footer is exactly as
      // structurally repetitive as a real list (that's what made Wikipedia's
      // table-of-contents outscore its actual data table in testing), so
      // this excludes anything nested inside them before scoring even starts.
      const isChrome = (el) => !!el.closest('nav, header, footer, aside, [role="navigation"], .toc, #toc, .navbox, .infobox, .sidebar, .menu');

      const signatureOf = (el) => el.tagName + '.' + (el.className || '').toString().trim().split(/\\s+/).slice(0, 3).join('.');
      const groups = new Map();
      document.querySelectorAll('body *').forEach((parent) => {
        if (isChrome(parent)) return;
        const bySignature = new Map();
        for (const child of parent.children) {
          const sig = signatureOf(child);
          if (!bySignature.has(sig)) bySignature.set(sig, []);
          bySignature.get(sig).push(child);
        }
        for (const [sig, els] of bySignature) {
          if (els.length < 3) continue;
          const key = parent.tagName + '>' + sig;
          const existing = groups.get(key);
          if (!existing || els.length > existing.length) groups.set(key, els);
        }
      });

      let bestGroup = null;
      let bestScore = 0;
      for (const els of groups.values()) {
        const visible = els.filter((el) => el.offsetParent !== null && (el.innerText || '').trim().length > 10);
        if (visible.length < 3) continue;
        // Real listing entries (business cards, product tiles, member
        // profiles) link somewhere — a directory entry with no link is the
        // exception, not the rule. Prose sections (article headings, TOC
        // entries) mostly don't. This is what actually separates "a list of
        // things" from "a page that happens to repeat structurally" once
        // the nav/header/footer/TOC exclusion above still lets something
        // through (e.g. a wiki-style article's per-section heading wrapper).
        const withLink = visible.filter((el) => el.querySelector('a[href]')).length;
        if (withLink / visible.length < 0.5) continue;
        const avgLen = visible.reduce((sum, el) => sum + (el.innerText || '').length, 0) / visible.length;
        const score = visible.length * Math.min(avgLen, 400); // frequency x substance, capped so one giant card doesn't dominate
        if (score > bestScore) { bestScore = score; bestGroup = visible; }
      }

      if (bestGroup) {
        stats.tier = 'generic-structure';
        stats.containersFound = bestGroup.length;
        const PHONE_RE = /(\\+?\\(?\\d{1,4}\\)?[\\s\\-]?\\d{2,4}[\\s\\-]?\\d{3,4}[\\s\\-]?\\d{0,4})/;
        const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/;
        const ADDRESS_RE = /\\d+\\s+[A-Za-z0-9.\\s]+\\b(St|Rd|Ave|Dr|Blvd|Hwy|Street|Road|Way|Ln|Pl)\\b/i;

        bestGroup.forEach((container) => {
          try {
            const heading = container.querySelector('h1, h2, h3, h4, [class*="title" i], [class*="name" i], a');
            const name = (heading?.textContent || container.textContent || '').trim().split('\\n')[0].slice(0, 120);
            if (!name || name.length < 2) return;

            const text = container.innerText || '';
            const mailtoEl = container.querySelector('a[href^="mailto:"]');
            const telEl = container.querySelector('a[href^="tel:"]');
            const externalLink = container.querySelector('a[href^="http"]:not([href*="' + location.hostname + '"])');

            const email = (mailtoEl ? mailtoEl.href.replace('mailto:', '') : (text.match(EMAIL_RE) || [])[0]) || '';
            const phone = (telEl ? telEl.href.replace('tel:', '') : (text.match(PHONE_RE) || [])[0]) || '';
            const addressMatch = text.match(ADDRESS_RE);

            addResult({
              businessName: name,
              phone: phone.trim(),
              email: email.trim(),
              website: externalLink ? externalLink.href : '',
              address: addressMatch ? addressMatch[0].trim() : '',
              category: '',
            });
          } catch (e) {}
        });
      }
    } catch (e) {}
  }

  return { rows: results, stats };
})();
`;

module.exports = {
  SCRAPE_PAGE_JS, AUTO_SCROLL_JS, HOVER_JS, CLICK_LOAD_MORE_JS, DISMISS_COOKIE_BANNER_JS,
  ZOOM_IN_JS, ZOOM_OUT_JS, panJs, buildSearchUrl, DETECT_CAPTCHA_JS,
  UNIVERSAL_SCRAPE_JS, UNIVERSAL_DISMISS_JS, UNIVERSAL_AUTO_SCROLL_JS, UNIVERSAL_NEXT_PAGE_JS,
};
