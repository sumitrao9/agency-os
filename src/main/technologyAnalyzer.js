// src/main/technologyAnalyzer.js
//
// Identifies what a business already has in place — CMS, CDN,
// framework, analytics/pixels, email/CRM/booking/payments/chatbot/
// automation/marketing tools — from static signatures in the homepage
// HTML and response headers. Same free, pattern-matching approach as
// deepScan.js's TECH_SIGNATURES (which this supersedes/absorbs for the
// CMS/framework/CDN cases); no third-party "what tech does this site
// use" service involved.

// Each entry: [name, category, htmlPattern, headerTest?]
// headerTest, when present, is checked against the combined lowercased
// header values as a fallback/second signal.
const SIGNATURES = [
  // CMS
  ['WordPress', 'CMS', /wp-content|wp-includes|\/wp-json\//i],
  ['Shopify', 'CMS', /cdn\.shopify\.com|Shopify\.theme/i],
  ['Wix', 'CMS', /static\.wixstatic\.com|wix\.com/i],
  ['Squarespace', 'CMS', /squarespace\.com|static1\.squarespace/i],
  ['Webflow', 'CMS', /webflow\.com|data-wf-page/i],
  ['Joomla', 'CMS', /\/media\/jui\/|Joomla!/i],
  ['Drupal', 'CMS', /Drupal\.settings|sites\/default\/files/i],
  ['Ghost', 'CMS', /ghost\.io|casper\b/i],
  ['Magento', 'CMS', /Mage\.Cookies|\/skin\/frontend\//i],

  // Framework
  ['Next.js', 'Framework', /__NEXT_DATA__|_next\/static/i],
  ['React', 'Framework', /data-reactroot|react-dom/i],
  ['Vue.js', 'Framework', /data-v-[0-9a-f]{6,}|Vue\.config/i],
  ['Angular', 'Framework', /\bng-version=/i],
  ['Svelte', 'Framework', /svelte-[a-z0-9]{6,}/i],
  ['jQuery', 'Framework', /jquery(?:-[\d.]+)?(?:\.min)?\.js/i],

  // CDN
  ['Cloudflare', 'CDN', null, /cloudflare|cf-ray/i],
  ['Fastly', 'CDN', null, /\bfastly\b/i],
  ['Akamai', 'CDN', null, /akamai/i],
  ['Amazon CloudFront', 'CDN', null, /cloudfront/i],
  ['jsDelivr', 'CDN', /cdn\.jsdelivr\.net/i],
  ['unpkg', 'CDN', /unpkg\.com/i],

  // Analytics
  ['Google Analytics', 'Analytics', /google-analytics\.com|gtag\(|\bUA-\d{4,}|\bG-[A-Z0-9]{6,}/i],
  ['Google Tag Manager', 'Analytics', /googletagmanager\.com/i],
  ['Hotjar', 'Analytics', /hotjar\.com/i],
  ['Mixpanel', 'Analytics', /mixpanel\.com/i],
  ['Plausible', 'Analytics', /plausible\.io/i],
  ['Matomo', 'Analytics', /matomo\.(?:org|cloud)|piwik\.js/i],

  // Pixels
  ['Facebook Pixel', 'Pixels', /connect\.facebook\.net|fbq\(/i],
  ['LinkedIn Insight Tag', 'Pixels', /snap\.licdn\.com/i],
  ['TikTok Pixel', 'Pixels', /ttq\.load/i],
  ['Twitter/X Pixel', 'Pixels', /static\.ads-twitter\.com/i],
  ['Pinterest Tag', 'Pixels', /s\.pinimg\.com\/ct\//i],

  // Email
  ['Mailchimp', 'Email', /mailchimp\.com|list-manage\.com/i],
  ['Klaviyo', 'Email', /klaviyo\.com/i],
  ['ConvertKit', 'Email', /convertkit\.com/i],
  ['ActiveCampaign', 'Email', /activehosted\.com/i],
  ['SendGrid', 'Email', /sendgrid\.net/i],

  // CRM
  ['HubSpot', 'CRM', /hs-scripts\.com|hubspot\.com|_hsq\b/i],
  ['Salesforce', 'CRM', /force\.com|salesforce\.com/i],
  ['Pipedrive', 'CRM', /pipedrive\.com/i],
  ['Zoho', 'CRM', /zoho\.com/i],

  // Booking
  ['Calendly', 'Booking', /calendly\.com/i],
  ['Acuity Scheduling', 'Booking', /acuityscheduling\.com/i],
  ['Setmore', 'Booking', /setmore\.com/i],
  ['Square Appointments', 'Booking', /squareup\.com\/appointments/i],
  ['Booksy', 'Booking', /booksy\.com/i],

  // Payments
  ['Stripe', 'Payments', /js\.stripe\.com|Stripe\(/i],
  ['PayPal', 'Payments', /paypal\.com\/sdk|paypalobjects\.com/i],
  ['Razorpay', 'Payments', /checkout\.razorpay\.com/i],
  ['Square', 'Payments', /squareup\.com\/checkout/i],
  ['Braintree', 'Payments', /braintreegateway\.com/i],

  // Chatbot
  ['Intercom', 'Chatbot', /widget\.intercom\.io/i],
  ['Drift', 'Chatbot', /js\.driftt\.com/i],
  ['Tawk.to', 'Chatbot', /embed\.tawk\.to/i],
  ['Crisp', 'Chatbot', /client\.crisp\.chat/i],
  ['Zendesk Chat', 'Chatbot', /zdassets\.com/i],
  ['LiveChat', 'Chatbot', /cdn\.livechatinc\.com/i],

  // Automation
  ['Zapier', 'Automation', /zapier\.com|hooks\.zapier\.com/i],
  ['n8n', 'Automation', /\bn8n\.io\b|\/webhook\/[a-z0-9-]{8,}/i],
  ['Make (Integromat)', 'Automation', /integromat\.com|\bmake\.com\/en\/integrations/i],

  // Marketing tools
  ['OptinMonster', 'Marketing tools', /optinmonster\.com/i],
  ['Privy', 'Marketing tools', /privy\.com/i],
  ['Sumo', 'Marketing tools', /sumo\.com\/api/i],
  ['Unbounce', 'Marketing tools', /unbounce\.com/i],
];

const CATEGORIES = ['CMS', 'CDN', 'Framework', 'Analytics', 'Pixels', 'Email', 'CRM', 'Booking', 'Payments', 'Chatbot', 'Automation', 'Marketing tools'];

function headerText(headers) {
  if (!headers) return '';
  return Object.entries(headers).map(([k, v]) => `${k}:${Array.isArray(v) ? v.join(',') : v}`).join(' ').toLowerCase();
}

// scan: the raw object from deepScan.runDeepScan() (needs .html and .headers).
function analyzeTechnology(scan) {
  const html = (scan && scan.html) || '';
  const headers = headerText(scan && scan.headers);
  const found = [];

  for (const [name, category, htmlPattern, headerPattern] of SIGNATURES) {
    const hit = (htmlPattern && htmlPattern.test(html)) || (headerPattern && headerPattern.test(headers));
    if (hit) found.push({ name, category });
  }

  const byCategory = CATEGORIES.reduce((acc, c) => { acc[c] = []; return acc; }, {});
  for (const { name, category } of found) byCategory[category].push(name);

  return { detectedAt: new Date().toISOString(), categories: byCategory, flat: found };
}

module.exports = { analyzeTechnology, CATEGORIES };
