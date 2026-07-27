// src/main/recommendationEngine.js
//
// Step 10: turns the opportunity list into a single bundled proposal — a
// prospect with 3 problems gets one pitch with 3 line items, not 3
// separate emails. Prices are the same deterministic ranges used
// elsewhere (src/rules/ruleEngine.js's SERVICE_PRICE_RANGES) — relative
// unit ranges, not fabricated numbers.

const PRICE_RANGES = {
  'Website Design + AI Booking Assistant': { low: 150000, high: 250000 },
  'Website Redesign': { low: 80000, high: 150000 },
  'Mobile-Responsive Rebuild': { low: 60000, high: 120000 },
  'Website Security Fix': { low: 15000, high: 30000 },
  'Website Performance Optimization': { low: 25000, high: 50000 },
  'Booking System': { low: 30000, high: 60000 },
  'AI Chat Assistant': { low: 25000, high: 50000 },
  'Analytics & Tracking Setup': { low: 10000, high: 20000 },
  'CRM Setup': { low: 20000, high: 45000 },
  'Email Marketing Setup': { low: 15000, high: 35000 },
  'Reputation & Review Growth Package': { low: 25000, high: 60000 },
  'SEO Fundamentals Package': { low: 12000, high: 25000 },
  'SEO Structured Data Setup': { low: 8000, high: 15000 },
  'Careers Page / Employer Branding': { low: 10000, high: 20000 },
};
const DEFAULT_RANGE = { low: 15000, high: 40000 };

// opportunities: Opportunity[] from findOpportunities(). Dedupes by
// service name (multiple gaps can point at the same fix) and sums a
// single price range across the whole bundle.
function buildProposal(opportunities) {
  if (!opportunities || !opportunities.length) {
    return { services: [], totalLow: 0, totalHigh: 0, bundled: false, pitchSummary: 'No gaps detected — no proposal to make right now.' };
  }

  const byService = new Map();
  for (const o of opportunities) {
    if (!byService.has(o.potentialService)) {
      byService.set(o.potentialService, { name: o.potentialService, gaps: [], severity: o.severity });
    }
    const entry = byService.get(o.potentialService);
    entry.gaps.push(o.gap);
    // Keep the worst (highest-priority) severity seen for this service.
    const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    if (rank[o.severity] < rank[entry.severity]) entry.severity = o.severity;
  }

  const services = [...byService.values()].map((s) => {
    const range = PRICE_RANGES[s.name] || DEFAULT_RANGE;
    return { name: s.name, severity: s.severity, gaps: s.gaps, priceLow: range.low, priceHigh: range.high };
  });
  // HIGH-severity services lead the pitch.
  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  services.sort((a, b) => rank[a.severity] - rank[b.severity]);

  const totalLow = services.reduce((sum, s) => sum + s.priceLow, 0);
  const totalHigh = services.reduce((sum, s) => sum + s.priceHigh, 0);

  const pitchSummary = services.length > 1
    ? `Bundled proposal covering ${services.length} services: ${services.map((s) => s.name).join(', ')}.`
    : `Single-service proposal: ${services[0].name}.`;

  return { services, totalLow, totalHigh, bundled: services.length > 1, pitchSummary };
}

module.exports = { buildProposal, PRICE_RANGES };
