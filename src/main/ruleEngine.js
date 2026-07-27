// src/rules/ruleEngine.js
//
// Deterministic only. No AI, no ML, no external calls — every decision here
// is a plain if/else against fields already on the lead. That's a hard
// requirement from the spec, and it also means this is trivially testable
// and trivially explainable to a person looking at why a lead got a
// particular priority.

const RULES = [
  { id: 'website-missing', test: lead => !lead.website, tag: 'No Website' },
  { id: 'website-present', test: lead => !!lead.website, tag: 'Has Website' },
  { id: 'phone-missing', test: lead => !lead.phone, tag: 'No Phone' },
  { id: 'low-reviews', test: lead => (lead.reviewCount || 0) > 0 && (lead.reviewCount || 0) < 20, tag: 'Low Reviews' },
  { id: 'high-reviews', test: lead => (lead.reviewCount || 0) >= 150, tag: 'High Reviews' },
  { id: 'no-email', test: lead => !lead.email, tag: 'No Email Found' },
  {
    id: 'no-ssl',
    test: lead => !!lead.website && lead.customFields?.websiteQuality?.checked && !lead.customFields.websiteQuality.hasSSL,
    tag: 'No SSL',
  },
  {
    id: 'not-mobile-friendly',
    test: lead => !!lead.website && lead.customFields?.websiteQuality?.checked && !lead.customFields.websiteQuality.isMobileFriendly,
    tag: 'Not Mobile-Friendly',
  },
];

function evaluateTags(lead) {
  return RULES.filter(r => r.test(lead)).map(r => r.tag);
}

// Priority: A = strongest opportunity (independent-feeling, digital gap,
// still has reviews showing they're active), C = weak fit or unreachable.
function evaluatePriority(lead) {
  const reviews = lead.reviewCount || 0;
  const hasWebsite = !!lead.website;
  const hasContact = !!(lead.phone || lead.email);

  if (!hasContact) return 'C';
  if (reviews >= 150 && hasWebsite) return 'C';
  if (reviews >= 3 && reviews <= 100 && !hasWebsite && (lead.email || lead.phone)) return 'A';
  if (hasContact) return 'B';
  return 'C';
}

// Recommended service + email template, chosen purely from which rule tags
// fired — same determinism requirement.
function evaluateRecommendation(tags) {
  if (tags.includes('No Website')) {
    return { service: 'Website Design + AI Booking Assistant', template: 'no-website' };
  }
  if (tags.includes('No SSL') || tags.includes('Not Mobile-Friendly')) {
    return { service: 'Website Modernization (SSL + Mobile-Responsive Rebuild)', template: 'outdated-website' };
  }
  if (tags.includes('No Phone') || tags.includes('No Email Found')) {
    return { service: 'AI Contact Assistant (WhatsApp/Chat)', template: 'missing-contact' };
  }
  if (tags.includes('Low Reviews')) {
    return { service: 'Reputation & Review Growth Package', template: 'low-reviews' };
  }
  return { service: 'General AI Automation Audit', template: 'general' };
}

function applyRules(lead) {
  const tags = evaluateTags(lead);
  const priority = evaluatePriority(lead);
  const recommendation = evaluateRecommendation(tags);
  const revenue = estimateRevenue(lead);
  const closeProbability = estimateCloseProbability(lead);
  return {
    ...lead, tags, priority,
    recommendedService: recommendation.service, recommendedTemplate: recommendation.template,
    revenueLow: revenue.low, revenueHigh: revenue.high, closeProbability,
  };
}

// Revenue estimation — deterministic ranges keyed to the exact gaps
// detected, not a guess. Every number here is a plain lookup, explainable
// to yourself later ("why did this show ₹1.8-2.5L" has a real answer).
// Currency-agnostic on purpose: these are relative unit ranges, multiply
// by your own local currency/pricing when you use them.
const SERVICE_PRICE_RANGES = {
  'Website Design + AI Booking Assistant': { low: 150000, high: 250000 },
  'Website Modernization (SSL + Mobile-Responsive Rebuild)': { low: 60000, high: 120000 },
  'AI Contact Assistant (WhatsApp/Chat)': { low: 40000, high: 80000 },
  'Reputation & Review Growth Package': { low: 25000, high: 60000 },
  'General AI Automation Audit': { low: 15000, high: 40000 },
};

function estimateRevenue(lead) {
  const tags = evaluateTags(lead);
  const recommendation = evaluateRecommendation(tags);
  const base = SERVICE_PRICE_RANGES[recommendation.service] || SERVICE_PRICE_RANGES['General AI Automation Audit'];

  // Multi-gap businesses (missing website AND no reviews AND no email, etc.)
  // are worth more — a real bundle, not a single fix — reflected as a
  // deterministic multiplier per additional gap tag, capped so it never
  // runs away on an unusually tag-heavy lead.
  const extraGaps = Math.max(0, tags.length - 1);
  const multiplier = 1 + Math.min(extraGaps * 0.15, 0.6);

  return {
    low: Math.round(base.low * multiplier),
    high: Math.round(base.high * multiplier),
    service: recommendation.service,
  };
}

// Close probability — deterministic, based on the same signals that drive
// priority, expressed as a percentage rather than a letter grade for the
// Daily Call List / Money Dashboard sort order.
function estimateCloseProbability(lead) {
  const priority = evaluatePriority(lead);
  const hasEmail = !!lead.email;
  const hasPhone = !!lead.phone;
  const reviews = lead.reviewCount || 0;

  let base = { A: 65, B: 40, C: 15 }[priority] || 15;
  if (hasEmail && hasPhone) base += 10; // multiple contact paths = easier to actually reach
  if (reviews >= 5 && reviews <= 80) base += 5; // active enough to be real, small enough to decide fast

  return Math.max(5, Math.min(90, base));
}

module.exports = { applyRules, evaluateTags, evaluatePriority, evaluateRecommendation, estimateRevenue, estimateCloseProbability, RULES };
