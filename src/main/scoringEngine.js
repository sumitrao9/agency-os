// src/main/scoringEngine.js
//
// Step 7/8: IF/AND/THEN point rules, grouped into 5 categories (0-20 each,
// 100 total). Deterministic only — every rule is a plain function over
// already-computed data (lead, normalized Business, websiteAnalysis,
// techStack, businessProfile), same "no AI, explainable" requirement as
// ruleEngine.js. A single fact can fire rules in more than one category
// (e.g. "no SSL" both hurts Business Quality trust AND is a Website
// opportunity) — that's intentional, not double-counting, since the two
// categories measure different things.

const CATEGORIES = ['Website', 'SEO', 'Automation', 'Business Quality', 'Revenue Potential'];

function rule(id, category, points, test, description) {
  return { id, category, points, test, description };
}

function checkStatus(analysis, name) {
  const c = (analysis?.checks || []).find((x) => x.check === name);
  return c ? c.status : null;
}

function hasTech(techStack, category) {
  return (techStack?.categories?.[category] || []).length > 0;
}

const RULES = [
  // --- Website (0-20) ---
  rule('web-no-ssl-opportunity', 'Website', 8, (ctx) => checkStatus(ctx.analysis, 'SSL') === 'FAIL', 'No SSL — easy, obvious fix to sell'),
  rule('web-not-mobile', 'Website', 6, (ctx) => checkStatus(ctx.analysis, 'Mobile friendly') === 'FAIL', 'Not mobile-friendly'),
  rule('web-speed-fail', 'Website', 5, (ctx) => checkStatus(ctx.analysis, 'Speed') === 'FAIL', 'Page load is slow (FAIL)'),
  rule('web-speed-warn', 'Website', 2, (ctx) => checkStatus(ctx.analysis, 'Speed') === 'WARNING', 'Page load is sluggish (WARNING)'),
  rule('web-sec-headers-fail', 'Website', 3, (ctx) => checkStatus(ctx.analysis, 'Security headers') === 'FAIL', 'No security headers'),
  rule('web-compression-fail', 'Website', 2, (ctx) => checkStatus(ctx.analysis, 'Compression') === 'FAIL', 'No gzip/br compression'),
  rule('web-no-website', 'Website', 20, (ctx) => !ctx.lead.website, 'No website at all — maximum opportunity'),
  rule('web-all-solid', 'Website', -5, (ctx) => !!ctx.lead.website && ['SSL', 'Mobile friendly', 'Speed'].every((c) => checkStatus(ctx.analysis, c) === 'PASS'), 'Website already solid — little to sell'),

  // --- SEO (0-20) ---
  rule('seo-title-fail', 'SEO', 5, (ctx) => checkStatus(ctx.analysis, 'Meta title') === 'FAIL', 'Missing meta title'),
  rule('seo-desc-fail', 'SEO', 5, (ctx) => checkStatus(ctx.analysis, 'Meta description') === 'FAIL', 'Missing meta description'),
  rule('seo-schema-fail', 'SEO', 4, (ctx) => checkStatus(ctx.analysis, 'Schema') === 'FAIL', 'No structured data'),
  rule('seo-sitemap-warn', 'SEO', 3, (ctx) => checkStatus(ctx.analysis, 'Sitemap') === 'WARNING', 'No sitemap found'),
  rule('seo-canonical-warn', 'SEO', 2, (ctx) => checkStatus(ctx.analysis, 'Canonical tags') === 'WARNING', 'No canonical tags'),
  rule('seo-robots-warn', 'SEO', 2, (ctx) => checkStatus(ctx.analysis, 'Robots.txt') === 'WARNING', 'No robots.txt'),
  rule('seo-all-solid', 'SEO', -5, (ctx) => ['Meta title', 'Meta description', 'Schema'].every((c) => checkStatus(ctx.analysis, c) === 'PASS'), 'SEO fundamentals already solid'),

  // --- Automation (0-20) ---
  rule('auto-no-booking-appt', 'Automation', 8, (ctx) => !!ctx.lead.website && !hasTech(ctx.techStack, 'Booking') && ctx.opportunities.some((o) => o.gap === 'Booking Missing' && o.severity === 'HIGH'), 'No booking system — appointment-based business'),
  rule('auto-no-chatbot', 'Automation', 6, (ctx) => !!ctx.lead.website && !hasTech(ctx.techStack, 'Chatbot'), 'No chatbot/live chat'),
  rule('auto-has-chatbot', 'Automation', -10, (ctx) => hasTech(ctx.techStack, 'Chatbot'), 'Has chatbot (no chatbot service needed)'),
  rule('auto-no-crm', 'Automation', 5, (ctx) => !!ctx.lead.website && !hasTech(ctx.techStack, 'CRM'), 'No CRM detected'),
  rule('auto-no-email-marketing', 'Automation', 4, (ctx) => !!ctx.lead.website && !hasTech(ctx.techStack, 'Email'), 'No email marketing tool detected'),
  rule('auto-no-analytics', 'Automation', 3, (ctx) => !!ctx.lead.website && !hasTech(ctx.techStack, 'Analytics'), 'No analytics detected'),

  // --- Business Quality (0-20) ---
  rule('biz-no-ssl-trust', 'Business Quality', -30, (ctx) => checkStatus(ctx.analysis, 'SSL') === 'FAIL', 'No SSL — hurts credibility/trust'),
  rule('biz-maturity-high', 'Business Quality', 10, (ctx) => (ctx.businessProfile?.maturity?.stars || 0) >= 4, '4-5 star business maturity'),
  rule('biz-maturity-low', 'Business Quality', 3, (ctx) => (ctx.businessProfile?.maturity?.stars || 0) <= 2 && (ctx.businessProfile?.maturity?.stars || 0) > 0, '1-2 star business maturity'),
  rule('biz-rating-high', 'Business Quality', 8, (ctx) => typeof ctx.lead.rating === 'number' ? ctx.lead.rating >= 4.5 : Number(ctx.lead.rating) >= 4.5, 'Rating 4.5+'),
  rule('biz-rating-low', 'Business Quality', -5, (ctx) => ctx.lead.rating != null && Number(ctx.lead.rating) < 3.5, 'Rating below 3.5'),
  rule('biz-very-few-reviews', 'Business Quality', -5, (ctx) => (ctx.lead.reviewCount || 0) > 0 && (ctx.lead.reviewCount || 0) < 5, 'Fewer than 5 reviews'),
  rule('biz-hiring', 'Business Quality', 3, (ctx) => ctx.businessProfile?.answers?.find((a) => a.question === 'Hiring?')?.answer === true, 'Actively hiring — growing business'),
  rule('biz-years', 'Business Quality', 5, (ctx) => { const y = ctx.businessProfile?.answers?.find((a) => a.question === 'Years in business')?.answer; return typeof y === 'number' && y >= 5; }, '5+ years in business'),

  // --- Revenue Potential (0-20) ---
  rule('rev-high-reviews-slow-site', 'Revenue Potential', 18, (ctx) => (ctx.lead.reviewCount || 0) > 300 && ['FAIL', 'WARNING'].includes(checkStatus(ctx.analysis, 'Speed')), 'Established business (300+ reviews) with a slow, fixable site'),
  rule('rev-multi-high-severity', 'Revenue Potential', 8, (ctx) => ctx.opportunities.filter((o) => o.severity === 'HIGH').length >= 2, 'Multiple HIGH-severity gaps — bundle opportunity'),
  rule('rev-many-services', 'Revenue Potential', 4, (ctx) => (ctx.business?.services || []).length >= 3, 'Multiple services offered — broader upsell surface'),
  rule('rev-premium', 'Revenue Potential', 5, (ctx) => ctx.businessProfile?.answers?.find((a) => a.question === 'Premium pricing?')?.answer === true, 'Premium pricing — can afford real budget'),
  rule('rev-budget', 'Revenue Potential', -3, (ctx) => ctx.businessProfile?.answers?.find((a) => a.question === 'Budget?')?.answer === true, 'Budget-positioned business — smaller deal size'),
];

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// ctx: { lead, business, analysis (WebsiteAnalysis|null), techStack (TechStack|null),
//        businessProfile (BusinessProfile|null), opportunities (Opportunity[]) }
function scoreLead(ctx) {
  const hits = RULES.filter((r) => { try { return r.test(ctx); } catch (e) { return false; } });

  const categories = CATEGORIES.reduce((acc, c) => { acc[c] = 0; return acc; }, {});
  for (const hit of hits) categories[hit.category] += hit.points;
  for (const c of CATEGORIES) categories[c] = clamp(categories[c], 0, 20);

  const total = CATEGORIES.reduce((sum, c) => sum + categories[c], 0);

  return {
    categories,
    total,
    hits: hits.map((h) => ({ id: h.id, category: h.category, points: h.points, description: h.description })),
  };
}

module.exports = { scoreLead, RULES, CATEGORIES };
