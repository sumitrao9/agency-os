// src/main/opportunityAnalyzer.js
//
// Turns detected gaps (missing tech, failed website checks, business
// signals) into a prioritized pitch list — deterministic rule lookups
// only, same as ruleEngine.js, so every "why is this HIGH severity" has
// a plain, explainable answer. This is what a Deep Scan actually sells:
// not raw data, but "here's what's missing and what to sell them."

const APPOINTMENT_BASED_RE = /salon|spa|clinic|dental|dentist|doctor|physio|therapy|barber|tattoo|studio|gym|fitness|consult|repair shop|garage|veterinary|vet\b/i;

function opportunity(gap, severity, potentialService, detail) {
  return { gap, severity, potentialService, detail };
}

// techStack: TechStack | null, analysis: WebsiteAnalysis | null,
// businessProfile: BusinessProfile | null, lead: the raw lead row.
function findOpportunities(lead, techStack, analysis, businessProfile) {
  const opportunities = [];
  const checksByName = new Map((analysis?.checks || []).map((c) => [c.check, c]));
  const hasCategory = (name) => (techStack?.categories?.[name] || []).length > 0;

  if (!lead.website) {
    opportunities.push(opportunity('No Website', 'HIGH', 'Website Design + AI Booking Assistant', 'This business has no website on file at all — the single biggest gap.'));
  }

  if (lead.website && techStack) {
    const looksAppointmentBased = APPOINTMENT_BASED_RE.test(lead.category || '') || APPOINTMENT_BASED_RE.test(lead.businessName || '');
    if (!hasCategory('Booking') && looksAppointmentBased) {
      opportunities.push(opportunity('Booking Missing', 'HIGH', 'Booking System', 'No online booking/scheduling tool detected on an appointment-based business.'));
    } else if (!hasCategory('Booking')) {
      opportunities.push(opportunity('Booking Missing', 'LOW', 'Booking System', 'No online booking tool detected (may not be needed for this business type).'));
    }

    if (!hasCategory('Chatbot')) {
      opportunities.push(opportunity('Live Chat Missing', 'MEDIUM', 'AI Chat Assistant', 'No live-chat or chatbot widget detected — visitors have no fast way to ask a question.'));
    }
    if (!hasCategory('Analytics')) {
      opportunities.push(opportunity('Analytics Missing', 'MEDIUM', 'Analytics & Tracking Setup', 'No analytics tool detected — the business can\'t see what traffic they get or where it comes from.'));
    }
    if (!hasCategory('CRM')) {
      opportunities.push(opportunity('CRM Missing', 'LOW', 'CRM Setup', 'No CRM tool detected — leads/customers are likely tracked manually or not at all.'));
    }
    if (!hasCategory('Email')) {
      opportunities.push(opportunity('Email Marketing Missing', 'LOW', 'Email Marketing Setup', 'No email marketing tool detected — no way to re-engage past customers.'));
    }
  }

  if (analysis) {
    const ssl = checksByName.get('SSL');
    if (ssl && ssl.status === 'FAIL') opportunities.push(opportunity('No SSL', 'HIGH', 'Website Security Fix', ssl.detail));

    const mobile = checksByName.get('Mobile friendly');
    if (mobile && mobile.status === 'FAIL') opportunities.push(opportunity('Not Mobile-Friendly', 'HIGH', 'Mobile-Responsive Rebuild', mobile.detail));

    const speed = checksByName.get('Speed');
    if (speed && speed.status === 'FAIL') opportunities.push(opportunity('Slow Page Load', 'MEDIUM', 'Website Performance Optimization', speed.detail));

    const secHeaders = checksByName.get('Security headers');
    if (secHeaders && secHeaders.status === 'FAIL') opportunities.push(opportunity('Missing Security Headers', 'MEDIUM', 'Website Security Fix', secHeaders.detail));

    const title = checksByName.get('Meta title');
    const desc = checksByName.get('Meta description');
    if ((title && title.status === 'FAIL') || (desc && desc.status === 'FAIL')) {
      opportunities.push(opportunity('Missing SEO Basics', 'LOW', 'SEO Fundamentals Package', 'Meta title and/or description missing — hurts search click-through.'));
    }

    const schema = checksByName.get('Schema');
    if (schema && schema.status === 'FAIL') opportunities.push(opportunity('No Structured Data', 'LOW', 'SEO Structured Data Setup', schema.detail));

    const failCount = (analysis.checks || []).filter((c) => c.status === 'FAIL').length;
    if (failCount >= 4) {
      opportunities.push(opportunity('Outdated Website', 'HIGH', 'Website Redesign', `${failCount} website checks failed — a full rebuild is likely more cost-effective than patching each issue.`));
    }
  }

  const reviewCount = lead.reviewCount || 0;
  if (reviewCount > 0 && reviewCount < 20) {
    opportunities.push(opportunity('Low Review Count', 'MEDIUM', 'Reputation & Review Growth Package', `Only ${reviewCount} review(s) — a review-generation push would help credibility.`));
  }

  if (businessProfile) {
    const hiring = businessProfile.answers.find((a) => a.question === 'Hiring?');
    if (hiring && hiring.answer === true) {
      opportunities.push(opportunity('Actively Hiring', 'LOW', 'Careers Page / Employer Branding', 'Business is hiring — a growth signal and a talking point for scaling their online presence too.'));
    }
  }

  const severityRank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  opportunities.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  return opportunities;
}

module.exports = { findOpportunities };
