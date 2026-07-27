// src/main/deepScan.js
//
// Raw-data collection pass for a lead's website: HTML, robots.txt,
// sitemap, HTTP headers, DNS (A/MX), plus values parsed out of that HTML
// (JSON-LD, meta description, social links, opening hours, image URLs,
// categories). Pure Node (http/https/dns) — no browser needed, so it's
// fast and works even on sites that don't need JS to render their basic
// markup. Screenshot capture (which does need a real renderer) lives
// separately in screenshot.js.

const https = require('https');
const http = require('http');
const dns = require('dns').promises;
const cheerio = require('cheerio');

const SOCIAL_HOSTS = /(facebook|instagram|twitter|x\.com|linkedin|youtube|tiktok|pinterest)\.com/i;
const FETCH_TIMEOUT_MS = 10000;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// name -> detection signature (checked against raw HTML + response headers).
// Free, static-pattern matching only — no third-party "what CMS is this"
// service involved.
const TECH_SIGNATURES = [
  ['WordPress', /wp-content|wp-includes|\/wp-json\//i],
  ['Shopify', /cdn\.shopify\.com|Shopify\.theme/i],
  ['Wix', /static\.wixstatic\.com|wix\.com/i],
  ['Squarespace', /squarespace\.com|static1\.squarespace/i],
  ['Webflow', /webflow\.com|data-wf-page/i],
  ['Joomla', /\/media\/jui\/|Joomla!/i],
  ['Drupal', /Drupal\.settings|sites\/default\/files/i],
  ['React', /data-reactroot|__NEXT_DATA__|react-dom/i],
  ['Cloudflare', /cloudflare/i],
];

function fetchOnce(url, timeoutMs) {
  return new Promise((resolve) => {
    let target;
    try { target = new URL(url); } catch (e) { return resolve({ ok: false, error: 'Invalid URL' }); }
    const lib = target.protocol === 'http:' ? http : https;
    const req = lib.get(target, { timeout: timeoutMs, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgencyOS/1.0)' } }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > 2_000_000) { req.destroy(); return; } // cap runaway bodies
        chunks.push(chunk);
      });
      res.on('end', () => resolve({
        ok: true,
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        alpnProtocol: res.socket && res.socket.alpnProtocol,
        redirected: res.statusCode >= 300 && res.statusCode < 400,
        location: res.headers.location,
      }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Request timed out' }); });
    req.on('error', (e) => resolve({ ok: false, error: String(e.message || e) }));
  });
}

// Most business homepages 301/302 the bare domain somewhere (www, https,
// a locale path) — without following that, every extractor downstream
// (SEO checks, tech detection, social links...) silently sees an empty
// body. followRedirects:false is used only by httpsRedirectCheck below,
// which needs to inspect the raw redirect response itself, not the page
// it points to.
async function fetchUrl(url, timeoutMs = FETCH_TIMEOUT_MS, { followRedirects = true, maxRedirects = 3 } = {}) {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await fetchOnce(current, timeoutMs);
    if (!followRedirects || !res.ok || !res.redirected || !res.location) return res;
    try { current = new URL(res.location, current).href; } catch (e) { return res; }
  }
  return fetchOnce(current, timeoutMs);
}

// Same as fetchUrl but keeps the body as a raw Buffer instead of decoding
// it as UTF-8 text — required for binary assets (favicons) where text
// decoding would corrupt the bytes.
function fetchBinary(url, timeoutMs = FETCH_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let target;
    try { target = new URL(url); } catch (e) { return resolve({ ok: false, error: 'Invalid URL' }); }
    const lib = target.protocol === 'http:' ? http : https;
    const req = lib.get(target, { timeout: timeoutMs, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgencyOS/1.0)' } }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > 2_000_000) { req.destroy(); return; }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ ok: true, status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Request timed out' }); });
    req.on('error', (e) => resolve({ ok: false, error: String(e.message || e) }));
  });
}

function extractJsonLd(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try { out.push(JSON.parse(m[1])); } catch (e) { /* skip malformed block */ }
  }
  return out;
}

// $: a cheerio.load(html) instance — parsed once in runDeepScan and passed
// into every extractor below, rather than each one re-parsing the HTML.
function extractSocialLinks($) {
  const links = new Set();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && SOCIAL_HOSTS.test(href)) links.add(href);
  });
  return [...links];
}

function extractMeta($, name) {
  return $(`meta[name="${name}"], meta[property="${name}"]`).first().attr('content') || '';
}

function extractImages($, baseUrl) {
  const out = new Set();
  $('img[src]').each((_, el) => {
    if (out.size >= 20) return;
    try { out.add(new URL($(el).attr('src'), baseUrl).href); } catch (e) { /* skip unresolvable src */ }
  });
  return [...out];
}

const PHONE_RE = /(\+?\d{1,3}[\s.-]?)?\(?\d{3,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g;

function extractPhone(html) {
  const text = html.replace(/<[^>]+>/g, ' '); // crude but sufficient: strip tags before hunting for phone-shaped text
  const matches = text.match(PHONE_RE) || [];
  const candidate = matches.find((m) => m.replace(/\D/g, '').length >= 8 && m.replace(/\D/g, '').length <= 14);
  return candidate ? candidate.trim() : '';
}

function extractTitle($) {
  return ($('title').first().text() || '').trim();
}

function extractLanguage($) {
  return ($('html').attr('lang') || '').split('-')[0].toLowerCase() || '';
}

function extractFaviconUrl($, baseUrl) {
  const href = $('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').first().attr('href');
  if (!href) return `${baseUrl}/favicon.ico`; // conventional fallback location
  try { return new URL(href, baseUrl).href; } catch (e) { return ''; }
}

function extractEmails(html) {
  const found = new Set();
  let m;
  EMAIL_RE.lastIndex = 0;
  while ((m = EMAIL_RE.exec(html))) {
    const email = m[0];
    if (/\.(png|jpe?g|gif|svg|webp|css|js)$/i.test(email)) continue;
    if (/sentry|wixpress|godaddy|cloudflare|example\.com/i.test(email)) continue;
    found.add(email.toLowerCase());
  }
  return [...found];
}

function extractTechnologies(html, headers) {
  const found = new Set();
  for (const [name, pattern] of TECH_SIGNATURES) {
    if (pattern.test(html)) found.add(name);
  }
  const server = (headers && (headers.server || headers['x-powered-by'])) || '';
  if (/nginx/i.test(server)) found.add('Nginx');
  if (/apache/i.test(server)) found.add('Apache');
  if (/php/i.test(server)) found.add('PHP');
  return [...found];
}

function extractKeywords($) {
  const raw = extractMeta($, 'keywords');
  return raw ? raw.split(',').map((k) => k.trim()).filter(Boolean) : [];
}

function extractOpeningHours(jsonLdItems) {
  for (const item of jsonLdItems) {
    const items = Array.isArray(item) ? item : (item['@graph'] || [item]);
    for (const i of items) {
      if (i.openingHoursSpecification) return i.openingHoursSpecification;
      if (i.openingHours) return i.openingHours;
    }
  }
  return null;
}

function extractDescription($, jsonLdItems) {
  for (const item of jsonLdItems) {
    const items = Array.isArray(item) ? item : (item['@graph'] || [item]);
    for (const i of items) if (i.description) return i.description;
  }
  return extractMeta($, 'description') || extractMeta($, 'og:description') || '';
}

function extractCategories(jsonLdItems) {
  const cats = new Set();
  for (const item of jsonLdItems) {
    const items = Array.isArray(item) ? item : (item['@graph'] || [item]);
    for (const i of items) {
      const type = i['@type'];
      (Array.isArray(type) ? type : [type]).filter(Boolean).forEach((t) => cats.add(t));
    }
  }
  return [...cats];
}

async function fetchDns(hostname) {
  const result = { a: [], mx: [] };
  try { result.a = await dns.resolve4(hostname); } catch (e) { /* no A record or lookup failed */ }
  try { result.mx = (await dns.resolveMx(hostname)).map((r) => r.exchange); } catch (e) { /* no MX record or lookup failed */ }
  return result;
}

async function findSitemapUrls(base, robotsTxt) {
  const fromRobots = (robotsTxt || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^sitemap:/i.test(l))
    .map((l) => l.replace(/^sitemap:/i, '').trim());
  if (fromRobots.length) return fromRobots;
  const guess = await fetchUrl(`${base}/sitemap.xml`);
  return guess.ok && guess.status === 200 ? [`${base}/sitemap.xml`] : [];
}

// Never throws — an unreachable or malformed site must degrade to partial
// results, not take down whatever triggered the scan.
async function runDeepScan(website) {
  if (!website) return { ok: false, error: 'No website on file' };

  let base, hostname;
  try {
    const url = new URL(website.startsWith('http') ? website : `https://${website}`);
    base = url.origin;
    hostname = url.hostname;
  } catch (e) {
    return { ok: false, error: 'Invalid website URL' };
  }

  const [homepage, robots, dnsRecords] = await Promise.all([
    fetchUrl(base),
    fetchUrl(`${base}/robots.txt`),
    fetchDns(hostname),
  ]);

  if (!homepage.ok) {
    return { ok: false, error: homepage.error || 'Website unreachable', dns: dnsRecords };
  }

  const html = homepage.body;
  const $ = cheerio.load(html);
  const jsonLd = extractJsonLd(html);
  const sitemapUrls = await findSitemapUrls(base, robots.ok ? robots.body : '');

  return {
    ok: true,
    scannedAt: new Date().toISOString(),
    html,
    headers: homepage.headers,
    robotsTxt: robots.ok ? robots.body : '',
    sitemapUrls,
    dns: dnsRecords,
    socialLinks: extractSocialLinks($),
    description: extractDescription($, jsonLd),
    openingHours: extractOpeningHours(jsonLd),
    categories: extractCategories(jsonLd),
    images: extractImages($, base),
    emails: extractEmails(html),
    technologies: extractTechnologies(html, homepage.headers),
    keywords: extractKeywords($),
    language: extractLanguage($),
    faviconUrl: extractFaviconUrl($, base),
    title: extractTitle($),
    phone: extractPhone(html),
  };
}

module.exports = { runDeepScan, fetchUrl, fetchBinary };
