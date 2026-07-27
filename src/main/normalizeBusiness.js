// src/main/normalizeBusiness.js
//
// Different sources (scraper cards, JSON-LD, deep-scan HTML) all describe
// the same business in different shapes. This is the one place that
// merges them into a single Business structure — every downstream
// consumer (rule engine, templates, UI) reads that shape and doesn't
// need to know or care where any given field came from.

const GENERIC_SCHEMA_TYPES = new Set(['Organization', 'LocalBusiness', 'Thing', 'Place']);

// Small, free heuristic — a real IP/WHOIS geolocation service costs money
// (against the "no paid APIs" constraint), so this only handles the
// unambiguous case: a country-coded TLD.
const TLD_COUNTRY = {
  in: 'India', uk: 'United Kingdom', us: 'United States', ca: 'Canada',
  au: 'Australia', nz: 'New Zealand', sg: 'Singapore', ae: 'UAE',
  de: 'Germany', fr: 'France', es: 'Spain', it: 'Italy', nl: 'Netherlands',
  ie: 'Ireland', za: 'South Africa',
};

// One representative IANA zone per country — approximate for
// multi-timezone countries (US/Canada/Australia), which is the honest
// ceiling for a free, no-geolocation-API heuristic based only on TLD.
const TIMEZONE_BY_COUNTRY = {
  India: 'Asia/Kolkata', 'United Kingdom': 'Europe/London', 'United States': 'America/New_York',
  Canada: 'America/Toronto', Australia: 'Australia/Sydney', 'New Zealand': 'Pacific/Auckland',
  Singapore: 'Asia/Singapore', UAE: 'Asia/Dubai', Germany: 'Europe/Berlin', France: 'Europe/Paris',
  Spain: 'Europe/Madrid', Italy: 'Europe/Rome', Netherlands: 'Europe/Amsterdam', Ireland: 'Europe/Dublin',
  'South Africa': 'Africa/Johannesburg',
};

function inferCountry(website) {
  if (!website) return 'Unknown';
  try {
    const host = new URL(website.startsWith('http') ? website : `https://${website}`).hostname;
    const tld = host.split('.').pop();
    return TLD_COUNTRY[tld] || 'Unknown';
  } catch (e) {
    return 'Unknown';
  }
}

function inferTimezone(country) {
  return TIMEZONE_BY_COUNTRY[country] || null;
}

// Non-destructive: never overwrites the scraped category — a specific
// schema.org type (e.g. "ItalianRestaurant") found on the site itself is
// often more precise than a directory's generic listing category, but
// it's still a suggestion, surfaced separately, same "guessed, not
// silently applied" rule as the email-discovery guess.
function suggestCategory(lead, scan) {
  const cats = (scan && scan.categories) || [];
  const specific = cats.find((c) => !GENERIC_SCHEMA_TYPES.has(c));
  if (!specific || specific === lead.category) return null;
  return specific;
}

function dedupe(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function inferIndustry(lead, scan) {
  if (lead.category) return lead.category;
  const cats = (scan && scan.categories) || [];
  const specific = cats.find((c) => !GENERIC_SCHEMA_TYPES.has(c));
  return specific || cats[0] || '';
}

// lead: a row from Database.getAllLeads()/getAllLeads() (has customFields.deepScan
// if leads:deepScan has run). Never throws — a lead with no deep-scan data
// yet still normalizes cleanly, just with fewer fields populated.
function normalizeBusiness(lead) {
  const scan = (lead.customFields && lead.customFields.deepScan) || {};
  const country = inferCountry(lead.website);

  return {
    name: lead.businessName || '',
    industry: inferIndustry(lead, scan),
    country,
    timezone: inferTimezone(country),
    language: scan.language || null,
    suggestedCategory: suggestCategory(lead, scan),
    website: lead.website || '',
    employees: null, // no free/reliable source
    emails: dedupe([lead.email, ...(scan.emails || [])]),
    phones: dedupe([lead.phone]),
    services: dedupe([lead.category, ...(scan.categories || [])].filter((c) => !GENERIC_SCHEMA_TYPES.has(c))),
    socials: dedupe(scan.socialLinks || []),
    reviews: {
      rating: lead.rating != null && lead.rating !== '' ? Number(lead.rating) : null,
      count: lead.reviewCount != null && lead.reviewCount !== '' ? Number(lead.reviewCount) : 0,
    },
    traffic: null, // no free/reliable source
    technologies: dedupe(scan.technologies || []),
    keywords: dedupe(scan.keywords || []),
  };
}

module.exports = { normalizeBusiness };
