// src/main/businessAnalyzer.js
//
// Answers judgment questions about a business from signals already
// collected (deep-scan HTML, normalized Business, lead fields). No paid
// "company intelligence" API involved — questions with no reliable free
// signal (review velocity, Google Posts, "is this social account still
// active") are answered UNKNOWN rather than guessed, the same rule
// applied to employees/traffic in normalizeBusiness.js.

const LUXURY_RE = /\bluxury\b|\bpremium\b|\bexclusive\b|\bbespoke\b|\bboutique\b|\bhigh[- ]end\b/i;
const BUDGET_RE = /\bbudget\b|\baffordable\b|\bcheap\b|\bdiscount\b|\blow[- ]cost\b|\bwholesale\b/i;
const FRANCHISE_RE = /\bfranchise\b|\blocations near you\b|\bfind a location\b|\bbranch(es)?\b/i;
const AGENCY_RE = /\bagency\b|\bconsulting\b|\bmarketing services\b|\bdigital agency\b/i;
const SOLO_RE = /\bsole proprietor\b|\bfounder\s*&\s*owner\b|\bi am the\b|\bone[- ]man\b|\bone[- ]woman\b/i;
const HIRING_RE = /\bwe'?re hiring\b|\bnow hiring\b|\bjoin our team\b|\bcareers\b|\bjob openings\b/i;
const BLOG_RE = /\/blog\b|\barticles\b/i;
const FOUNDING_RE = /\b(?:since|established(?: in)?|founded(?: in)?)\s+(\d{4})\b/i;

function answer(question, value, detail, confidence) {
  return { question, answer: value, detail, confidence };
}

function analyzeBusiness(lead, business, scan) {
  scan = scan || {};
  const html = scan.html || '';
  const jsonLdFounding = null; // deepScan doesn't currently keep raw JSON-LD around; html regex covers the common case

  const foundingMatch = html.match(FOUNDING_RE);
  const foundingYear = foundingMatch ? Number(foundingMatch[1]) : (jsonLdFounding || null);
  const yearsInBusiness = foundingYear ? new Date().getFullYear() - foundingYear : null;

  const answers = [
    answer('Luxury?', LUXURY_RE.test(html) ? true : BUDGET_RE.test(html) ? false : 'UNKNOWN',
      LUXURY_RE.test(html) ? 'Luxury/premium language found on site' : BUDGET_RE.test(html) ? 'Budget language found instead' : 'No pricing-tier language detected', LUXURY_RE.test(html) || BUDGET_RE.test(html) ? 70 : 20),

    answer('Budget?', BUDGET_RE.test(html) ? true : LUXURY_RE.test(html) ? false : 'UNKNOWN',
      BUDGET_RE.test(html) ? 'Budget/affordable language found on site' : LUXURY_RE.test(html) ? 'Premium language found instead' : 'No pricing-tier language detected', BUDGET_RE.test(html) || LUXURY_RE.test(html) ? 70 : 20),

    answer('Local?', FRANCHISE_RE.test(html) ? false : 'UNKNOWN',
      FRANCHISE_RE.test(html) ? 'Franchise/multi-location language found — likely not purely local' : 'No multi-location signal found (treat as likely local, not confirmed)',
      FRANCHISE_RE.test(html) ? 60 : 30),

    answer('Franchise?', FRANCHISE_RE.test(html), FRANCHISE_RE.test(html) ? 'Franchise/multi-location language found' : 'No franchise language found', FRANCHISE_RE.test(html) ? 70 : 40),

    answer('Agency?', AGENCY_RE.test(html) || AGENCY_RE.test(business.industry || ''),
      AGENCY_RE.test(html) ? 'Agency/consulting language found on site' : 'No agency language found', 50),

    answer('Solo?', SOLO_RE.test(html) ? true : 'UNKNOWN',
      SOLO_RE.test(html) ? 'Sole-founder/owner language found' : 'No solo-operator signal found (no free source confirms team size)', SOLO_RE.test(html) ? 65 : 10),

    answer('Premium pricing?', LUXURY_RE.test(html) && !BUDGET_RE.test(html) ? true : BUDGET_RE.test(html) ? false : 'UNKNOWN',
      'Derived from the same luxury/budget language check', LUXURY_RE.test(html) || BUDGET_RE.test(html) ? 60 : 15),

    answer('Number of services', (business.services || []).length,
      `${(business.services || []).length} distinct service/category tag(s) found`, business.services && business.services.length ? 70 : 20),

    answer('Review velocity', 'UNKNOWN', 'No time-series review data available (would need a paid review-monitoring API)', 0),

    answer('Average rating', business.reviews && business.reviews.rating != null ? business.reviews.rating : 'UNKNOWN',
      business.reviews && business.reviews.rating != null ? `${business.reviews.rating}★ from ${business.reviews.count} review(s)` : 'No rating found on scraped listing', business.reviews && business.reviews.rating != null ? 90 : 0),

    answer('Photos uploaded', (scan.images || []).length, `${(scan.images || []).length} image(s) found on homepage`, (scan.images || []).length ? 60 : 20),

    answer('Recent activity', 'UNKNOWN', 'No free source for posting/update recency (Google Business Profile API is paid)', 0),
    answer('Google Posts', 'UNKNOWN', 'Google Business Profile Posts require a paid/authenticated API — not checked', 0),

    answer('Facebook active', (scan.socialLinks || []).some((l) => /facebook\.com/i.test(l)) ? 'UNKNOWN' : false,
      (scan.socialLinks || []).some((l) => /facebook\.com/i.test(l)) ? 'Facebook link found, but activity/recency can\'t be verified without visiting the page' : 'No Facebook link found on site', (scan.socialLinks || []).some((l) => /facebook\.com/i.test(l)) ? 30 : 50),

    answer('Instagram active', (scan.socialLinks || []).some((l) => /instagram\.com/i.test(l)) ? 'UNKNOWN' : false,
      (scan.socialLinks || []).some((l) => /instagram\.com/i.test(l)) ? 'Instagram link found, but activity/recency can\'t be verified without visiting the page' : 'No Instagram link found on site', (scan.socialLinks || []).some((l) => /instagram\.com/i.test(l)) ? 30 : 50),

    answer('Blog active', BLOG_RE.test(html) ? 'UNKNOWN' : false,
      BLOG_RE.test(html) ? 'Blog/articles link found, but post recency not checked' : 'No blog/articles link found', BLOG_RE.test(html) ? 30 : 50),

    answer('Hiring?', HIRING_RE.test(html), HIRING_RE.test(html) ? 'Hiring/careers language found on site' : 'No hiring language found', 65),

    answer('Years in business', yearsInBusiness != null ? yearsInBusiness : 'UNKNOWN',
      yearsInBusiness != null ? `Founded ${foundingYear} per site text` : 'No founding year mentioned on homepage', yearsInBusiness != null ? 75 : 10),
  ];

  return { ...answers.reduce((acc, a) => { acc[a.question] = a; return acc; }, {}), _list: answers };
}

// Composite score — weighted toward the signals that actually correlate
// with an established, sellable business: age, review volume/rating,
// service breadth, hiring. Confidence reflects how many of those
// specific signals were determinable (not UNKNOWN), not overall answer count.
function businessMaturity(answers) {
  const list = answers._list;
  const byQ = (q) => list.find((a) => a.question === q);

  const rating = byQ('Average rating').answer;
  const reviewCount = typeof rating === 'number' ? (byQ('Average rating').detail.match(/from (\d+)/) || [])[1] : null;
  const years = byQ('Years in business').answer;
  const services = byQ('Number of services').answer;
  const hiring = byQ('Hiring?').answer;

  let points = 0, maxPoints = 0, determined = 0, signalCount = 0;

  signalCount++; maxPoints += 2;
  if (typeof years === 'number') { determined++; points += years >= 10 ? 2 : years >= 3 ? 1 : 0; }

  signalCount++; maxPoints += 2;
  if (typeof rating === 'number') { determined++; points += rating >= 4.5 ? 2 : rating >= 3.5 ? 1 : 0; }

  signalCount++; maxPoints += 1;
  if (reviewCount != null) { determined++; points += Number(reviewCount) >= 50 ? 1 : 0; }

  signalCount++; maxPoints += 1;
  if (typeof services === 'number') { determined++; points += services >= 3 ? 1 : 0; }

  signalCount++; maxPoints += 1;
  if (hiring === true) points += 1; // hiring is a definite boolean, always "determined"
  determined++;

  const stars = maxPoints > 0 ? Math.max(1, Math.min(5, Math.round((points / maxPoints) * 5))) : 1;
  const confidencePercent = Math.round((determined / signalCount) * 100);

  return { stars, confidencePercent };
}

module.exports = { analyzeBusiness, businessMaturity };
