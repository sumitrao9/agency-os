// src/email/templates.js
//
// Merge fields use {{fieldName}} syntax, filled from the lead object.
// Each template key matches a recommendedTemplate value from the rule
// engine, so "send the right template for this lead" is a lookup, not a
// judgment call.

const TEMPLATES = {
  'no-website': {
    subject: 'Quick idea for {{businessName}}',
    body: `Hi {{businessName}} team,

I noticed you don't have a website listed yet — that's often the single biggest reason people can't find or book with a great local business.

I help businesses like yours get a fast, simple site live with an AI assistant that answers questions and takes bookings automatically, even when you're busy.

Worth a quick look?

Sy`,
  },
  'outdated-website': {
    subject: 'Quick note on {{businessName}}\'s website',
    body: `Hi {{businessName}} team,

I took a quick look at your site — it's missing a secure connection (SSL) and/or isn't optimized for mobile, both of which Google and most visitors now expect by default.

I help businesses modernize their existing site (not a full rebuild) to fix exactly this, plus add simple AI tools like instant chat replies.

Want a quick look at what that would take for {{businessName}}?

Sy`,
  },
  'missing-contact': {
    subject: 'Are people able to reach {{businessName}} easily?',
    body: `Hi {{businessName}} team,

I couldn't find a direct phone or email listed for you, which often means potential customers give up and go elsewhere.

I build simple AI-powered contact tools (WhatsApp/chat) that make sure every inquiry gets an instant reply, even outside business hours.

Happy to show you a quick example — no obligation.

Sy`,
  },
  'low-reviews': {
    subject: '{{businessName}} — a quick way to get more reviews',
    body: `Hi {{businessName}} team,

You're doing solid work ({{reviewCount}} reviews so far), and a steady flow of new reviews usually means steady new customers too.

I help businesses set up simple automated review requests after each job/visit — no manual follow-up needed.

Want a quick look at how it works?

Sy`,
  },
  'general': {
    subject: 'A quick automation idea for {{businessName}}',
    body: `Hi {{businessName}} team,

I help local businesses save time with simple AI automation — missed-call recovery, instant replies, booking assistants.

Would a free 10-minute audit of what's possible for {{businessName}} be useful?

Sy`,
  },
};

function mergeFields(text, lead) {
  return text.replace(/\{\{(\w+)\}\}/g, (match, field) => {
    const value = lead[field];
    return (value === undefined || value === null || value === '') ? match : String(value);
  });
}

// Follow-up templates — deliberately generic (not keyed to the original
// rule-engine tag) since they reply into the same thread regardless of
// which opener was sent. Two touches only, matching the research
// consensus: 2-3 follow-ups max, first follow-up carries most of the
// remaining reply value, and touches beyond ~3 total measurably hurt
// reply rate and raise spam complaints rather than helping. No "just
// checking in" — every touch either adds something or, on the last one,
// explicitly offers an easy exit.
const FOLLOWUP_TEMPLATES = {
  nudge: {
    subject: '', // sent as a reply in the same thread — subject stays blank so mailer.js can prefix "Re: "
    body: `Hi {{businessName}} team,

Wanted to make sure this reached you — happy to send a couple of quick examples if useful, no pressure either way.

Sy`,
  },
  breakup: {
    subject: '',
    body: `Hi {{businessName}} team,

I'll stop reaching out after this — if it's ever useful down the line, feel free to reply anytime.

All the best,
Sy`,
  },
};

function renderFollowUp(stage, lead) {
  const tpl = FOLLOWUP_TEMPLATES[stage] || FOLLOWUP_TEMPLATES.nudge;
  return {
    subject: mergeFields(tpl.subject, lead),
    body: mergeFields(tpl.body, lead),
  };
}

function renderTemplate(templateKey, lead) {
  const tpl = TEMPLATES[templateKey] || TEMPLATES.general;
  return {
    subject: mergeFields(tpl.subject, lead),
    body: mergeFields(tpl.body, lead),
  };
}

module.exports = { TEMPLATES, renderTemplate, mergeFields, FOLLOWUP_TEMPLATES, renderFollowUp };
