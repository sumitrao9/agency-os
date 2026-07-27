// src/main/websiteAnalyzer.js
//
// Runs a battery of pass/warning/fail checks against a site's homepage —
// the free, static-analysis half of a Lighthouse-style report (no paid
// PageSpeed/Lighthouse API involved). Each check returns one of
// PASS | WARNING | FAIL | UNKNOWN — UNKNOWN means "couldn't determine",
// never a guessed pass or fail.

const { fetchUrl } = require('./deepScan');

const PASS = 'PASS', WARNING = 'WARNING', FAIL = 'FAIL', UNKNOWN = 'UNKNOWN';

function has(html, pattern) { return pattern.test(html); }
function headerVal(headers, name) { return (headers && headers[name]) || ''; }

function check(name, status, detail) { return { check: name, status, detail }; }

// --- Checks computable purely from already-fetched HTML/headers/robots/sitemap ---
function staticChecks(website, scan) {
  const html = scan.html || '';
  const headers = scan.headers || {};
  const results = [];

  results.push(check('SSL', website.startsWith('https://') ? PASS : FAIL,
    website.startsWith('https://') ? 'Site loads over HTTPS' : 'Homepage is not served over HTTPS'));

  const viewport = has(html, /<meta[^>]+name=["']viewport["']/i);
  results.push(check('Mobile friendly', viewport ? PASS : FAIL, viewport ? 'Viewport meta tag present' : 'No viewport meta tag found'));

  const mediaQuery = has(html, /@media[^{]*\(/i);
  results.push(check('Responsive', viewport && mediaQuery ? PASS : viewport ? WARNING : FAIL,
    viewport && mediaQuery ? 'Viewport tag + inline media queries found' : viewport ? 'Viewport tag present, no inline media queries detected' : 'No responsive signals found'));

  const darkMode = has(html, /prefers-color-scheme|name=["']color-scheme["']/i);
  results.push(check('Dark mode', darkMode ? PASS : UNKNOWN, darkMode ? 'prefers-color-scheme / color-scheme signal found' : 'No dark-mode signal in homepage HTML (may still exist in external CSS)'));

  const imgTags = html.match(/<img\b[^>]*>/gi) || [];
  const optimizedCount = imgTags.filter((t) => /loading=["']lazy["']/i.test(t) || /\bwidth=/i.test(t)).length;
  results.push(check('Images optimized', imgTags.length === 0 ? UNKNOWN : optimizedCount / imgTags.length > 0.6 ? PASS : optimizedCount > 0 ? WARNING : FAIL,
    imgTags.length === 0 ? 'No <img> tags found on homepage' : `${optimizedCount}/${imgTags.length} images have lazy-loading or explicit dimensions`));

  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';
  results.push(check('Meta title', !title ? FAIL : title.length >= 10 && title.length <= 60 ? PASS : WARNING,
    title ? `"${title}" (${title.length} chars)` : 'No <title> tag found'));

  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i);
  const desc = descMatch ? descMatch[1].trim() : '';
  results.push(check('Meta description', !desc ? FAIL : desc.length >= 50 && desc.length <= 160 ? PASS : WARNING,
    desc ? `${desc.length} chars` : 'No meta description found'));

  const hasSchema = has(html, /application\/ld\+json/i);
  results.push(check('Schema', hasSchema ? PASS : FAIL, hasSchema ? 'JSON-LD structured data found' : 'No JSON-LD schema found'));

  results.push(check('Robots.txt', scan.robotsTxt ? PASS : WARNING, scan.robotsTxt ? 'robots.txt found and readable' : 'robots.txt missing or empty'));
  results.push(check('Sitemap', (scan.sitemapUrls || []).length ? PASS : WARNING, (scan.sitemapUrls || []).length ? `${scan.sitemapUrls.length} sitemap URL(s) found` : 'No sitemap referenced in robots.txt or at /sitemap.xml'));

  const canonical = has(html, /<link[^>]+rel=["']canonical["']/i);
  results.push(check('Canonical tags', canonical ? PASS : WARNING, canonical ? 'Canonical link tag present' : 'No canonical link tag found'));

  const favicon = has(html, /<link[^>]+rel=["'](?:shortcut icon|icon|apple-touch-icon)["']/i);
  results.push(check('Favicons', favicon ? PASS : WARNING, favicon ? 'Favicon link tag present' : 'No favicon link tag found'));

  const analytics = has(html, /google-analytics\.com|googletagmanager\.com|gtag\(|plausible\.io|matomo/i);
  results.push(check('Analytics', analytics ? PASS : WARNING, analytics ? 'Analytics script detected' : 'No common analytics script detected'));

  const pixel = has(html, /connect\.facebook\.net|fbq\(|snap\.licdn\.com|ttq\.load/i);
  results.push(check('Tracking pixels', pixel ? PASS : UNKNOWN, pixel ? 'Ad-platform tracking pixel detected' : 'No tracking pixel detected (may be intentional)'));

  const cookieBanner = has(html, /cookieconsent|onetrust|cc-window|cookie-notice|gdpr-cookie/i);
  results.push(check('Cookie banner', cookieBanner ? PASS : UNKNOWN, cookieBanner ? 'Cookie-consent script/markup detected' : 'No cookie-consent banner detected'));

  const form = has(html, /<form\b/i);
  results.push(check('Forms', form ? PASS : WARNING, form ? 'At least one <form> found' : 'No <form> element found on homepage'));

  const booking = has(html, /calendly\.com|acuityscheduling\.com|book(?:ing)?\.com|setmore\.com|square\.site\/book/i);
  results.push(check('Booking', booking ? PASS : UNKNOWN, booking ? 'Booking widget detected' : 'No booking widget detected'));

  const liveChat = has(html, /intercom|drift\.com|tawk\.to|crisp\.chat|zendesk|livechatinc/i);
  results.push(check('Live chat', liveChat ? PASS : UNKNOWN, liveChat ? 'Live-chat widget detected' : 'No live-chat widget detected'));

  const fonts = has(html, /fonts\.googleapis\.com|fonts\.gstatic\.com|@font-face/i);
  results.push(check('Fonts', fonts ? PASS : UNKNOWN, fonts ? 'Web font loading detected' : 'No custom web fonts detected (may use system fonts)'));

  const cdn = /cloudflare|cloudfront|fastly|akamai/i.test(headerVal(headers, 'server') + headerVal(headers, 'via') + headerVal(headers, 'x-cache')) ||
    has(html, /cdn\./i);
  results.push(check('CDN', cdn ? PASS : UNKNOWN, cdn ? 'CDN signal found in headers/markup' : 'No CDN signal found'));

  const cacheControl = headerVal(headers, 'cache-control');
  results.push(check('Caching', /no-store/i.test(cacheControl) ? FAIL : /max-age/i.test(cacheControl) ? PASS : WARNING,
    cacheControl ? `Cache-Control: ${cacheControl}` : 'No Cache-Control header set'));

  const encoding = headerVal(headers, 'content-encoding');
  results.push(check('Compression', /br|gzip/i.test(encoding) ? PASS : FAIL, encoding ? `Content-Encoding: ${encoding}` : 'No compression (gzip/br) detected'));

  const secHeaders = ['strict-transport-security', 'x-content-type-options', 'x-frame-options', 'content-security-policy']
    .filter((h) => headerVal(headers, h));
  results.push(check('Security headers', secHeaders.length >= 3 ? PASS : secHeaders.length > 0 ? WARNING : FAIL,
    `${secHeaders.length}/4 common security headers present (${secHeaders.join(', ') || 'none'})`));

  return results;
}

// --- Checks that need their own extra request(s) ---
async function httpsRedirectCheck(website) {
  try {
    const httpUrl = website.replace(/^https:\/\//i, 'http://');
    if (!httpUrl.startsWith('http://')) return check('HTTPS redirect', UNKNOWN, 'Site has no http:// variant to test');
    const res = await fetchUrl(httpUrl, undefined, { followRedirects: false });
    if (!res.ok) return check('HTTPS redirect', UNKNOWN, res.error || 'http:// request failed');
    if (res.redirected && /^https:/i.test(res.location || '')) return check('HTTPS redirect', PASS, `http:// redirects to ${res.location}`);
    if (res.status < 300) return check('HTTPS redirect', FAIL, 'http:// serves content directly instead of redirecting to https://');
    return check('HTTPS redirect', WARNING, `http:// responded ${res.status} without redirecting to https`);
  } catch (e) {
    return check('HTTPS redirect', UNKNOWN, String(e.message || e));
  }
}

async function notFoundCheck(base) {
  try {
    const res = await fetchUrl(`${base}/agencyos-404-check-${Date.now()}`);
    if (!res.ok) return check('404 pages', UNKNOWN, res.error || 'Request failed');
    if (res.status === 404) return check('404 pages', PASS, 'Nonexistent path correctly returns 404');
    if (res.status >= 200 && res.status < 300) return check('404 pages', WARNING, `Nonexistent path returned ${res.status} (soft-404 — bad for SEO)`);
    return check('404 pages', WARNING, `Nonexistent path returned ${res.status}`);
  } catch (e) {
    return check('404 pages', UNKNOWN, String(e.message || e));
  }
}

async function brokenLinksCheck(base, html) {
  const hrefs = [...(html.matchAll(/<a[^>]+href=["']([^"'#][^"']*)["']/gi))].map((m) => m[1]);
  const sameSite = [];
  for (const href of hrefs) {
    try {
      const u = new URL(href, base);
      if (u.origin === base) sameSite.push(u.href);
    } catch (e) { /* skip unparsable href */ }
  }
  const sample = [...new Set(sameSite)].slice(0, 5);
  if (!sample.length) return check('Broken links', UNKNOWN, 'No same-site links found to test');

  let broken = 0;
  for (const url of sample) {
    const res = await fetchUrl(url, 6000);
    if (!res.ok || res.status >= 400) broken++;
  }
  if (broken === 0) return check('Broken links', PASS, `Checked ${sample.length} internal link(s), none broken`);
  if (broken < sample.length) return check('Broken links', WARNING, `${broken}/${sample.length} sampled internal links broken`);
  return check('Broken links', FAIL, `${broken}/${sample.length} sampled internal links broken`);
}

function speedChecks(performance) {
  if (!performance) {
    return [check('Speed', UNKNOWN, 'No load-time measurement available'), check('Largest Contentful Paint', UNKNOWN, 'No LCP measurement available')];
  }
  const { loadTimeMs, lcpMs } = performance;
  const speed = loadTimeMs == null ? check('Speed', UNKNOWN, 'No load-time measurement available')
    : loadTimeMs < 1500 ? check('Speed', PASS, `Page load: ${loadTimeMs}ms`)
    : loadTimeMs < 3000 ? check('Speed', WARNING, `Page load: ${loadTimeMs}ms`)
    : check('Speed', FAIL, `Page load: ${loadTimeMs}ms`);
  const lcp = lcpMs == null ? check('Largest Contentful Paint', UNKNOWN, 'LCP not reported by renderer for this page')
    : lcpMs < 2500 ? check('Largest Contentful Paint', PASS, `LCP: ${lcpMs}ms`)
    : lcpMs < 4000 ? check('Largest Contentful Paint', WARNING, `LCP: ${lcpMs}ms`)
    : check('Largest Contentful Paint', FAIL, `LCP: ${lcpMs}ms`);
  return [speed, lcp];
}

function alpnCheck(scan) {
  const proto = scan.alpnProtocol;
  if (proto === 'h2' || proto === 'h3') return check('HTTP2/HTTP3', PASS, `Negotiated ${proto}`);
  if (proto === 'http/1.1') return check('HTTP2/HTTP3', WARNING, 'Server only negotiated HTTP/1.1');
  return check('HTTP2/HTTP3', UNKNOWN, 'Could not determine negotiated protocol');
}

// Real WCAG rule evaluation (axe-core, run inside a live renderer by
// screenshot.js) — not a heuristic. Falls back to UNKNOWN if the audit
// never ran (e.g. screenshot capture failed) rather than guessing.
function accessibilityCheck(accessibility) {
  if (!accessibility) return check('Accessibility', UNKNOWN, 'Accessibility audit did not run for this site');
  const critical = accessibility.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  if (critical.length > 0) return check('Accessibility', FAIL, `${critical.length} critical/serious WCAG violation(s): ${critical.slice(0, 3).map((v) => v.help).join('; ')}`);
  if (accessibility.violations.length > 0) return check('Accessibility', WARNING, `${accessibility.violations.length} minor WCAG violation(s) found`);
  return check('Accessibility', PASS, `No WCAG violations found (${accessibility.passCount} rules passed)`);
}

// scan: the raw object returned by deepScan.runDeepScan() — reused so this
// module never re-fetches the homepage. website: original lead website URL.
// performance: optional { loadTimeMs, lcpMs }, accessibility: optional
// axe-core result — both from screenshot.captureScreenshot().
async function analyzeWebsite(website, scan, performance, accessibility) {
  if (!scan || !scan.ok) return { ok: false, error: 'No deep-scan data to analyze', checks: [] };
  let base;
  try {
    base = new URL(website.startsWith('http') ? website : `https://${website}`).origin;
  } catch (e) {
    return { ok: false, error: 'Invalid website URL', checks: [] };
  }

  const checks = [
    ...staticChecks(base, scan),
    ...speedChecks(performance),
    accessibilityCheck(accessibility),
    alpnCheck(scan),
    await httpsRedirectCheck(base),
    await notFoundCheck(base),
    await brokenLinksCheck(base, scan.html || ''),
  ];

  const summary = checks.reduce((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1;
    return acc;
  }, {});

  return { ok: true, analyzedAt: new Date().toISOString(), checks, summary };
}

module.exports = { analyzeWebsite, PASS, WARNING, FAIL, UNKNOWN };
