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

module.exports = { SCRAPE_PAGE_JS, AUTO_SCROLL_JS, HOVER_JS, CLICK_LOAD_MORE_JS, DISMISS_COOKIE_BANNER_JS, ZOOM_IN_JS, ZOOM_OUT_JS, panJs, buildSearchUrl, DETECT_CAPTCHA_JS };
