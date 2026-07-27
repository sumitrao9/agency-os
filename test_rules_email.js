const { applyRules, evaluatePriority, evaluateTags } = require('./src/main/ruleEngine');
const { renderTemplate, mergeFields } = require('./src/main/templates');
const { sendEmail } = require('./src/main/mailer');

let PASS = 0, FAIL = 0;
function check(l, c, d = '') { if (c) { PASS++; console.log('  PASS  ' + l); } else { FAIL++; console.log('  FAIL  ' + l + (d ? ' -> ' + d : '')); } }

console.log('=== RULE ENGINE — DETERMINISTIC, NO AI ===');
{
  const noWebsiteLead = { businessName: 'No Site Cafe', phone: '0412345678', reviewCount: 40 };
  const result1 = applyRules(noWebsiteLead);
  check('No-website lead tagged correctly', result1.tags.includes('No Website'));
  check('No-website lead gets Priority A (sweet spot: has contact, no site, moderate reviews)', result1.priority === 'A', result1.priority);
  check('Recommended service matches the actual gap', result1.recommendedService.includes('Website'));

  const bigChainLead = { businessName: 'Big Chain Co', phone: '0499999999', website: 'https://bigchain.com', reviewCount: 5000 };
  const result2 = applyRules(bigChainLead);
  check('Established business (150+ reviews + website) gets Priority C', result2.priority === 'C', result2.priority);

  const unreachableLead = { businessName: 'Ghost Biz', reviewCount: 10 };
  const result3 = applyRules(unreachableLead);
  check('No phone/email at all -> Priority C (can\'t be contacted)', result3.priority === 'C', result3.priority);

  const lowReviewLead = { businessName: 'New Salon', phone: '0411111111', website: 'https://newsalon.com', reviewCount: 5 };
  const result4 = applyRules(lowReviewLead);
  check('Low review count correctly tagged', result4.tags.includes('Low Reviews'));

  // Determinism check: same input, same output, every time (no randomness/AI variance)
  const resultA = applyRules(noWebsiteLead);
  const resultB = applyRules(noWebsiteLead);
  check('Fully deterministic — identical input produces identical output', JSON.stringify(resultA) === JSON.stringify(resultB));
}

console.log('\n=== EMAIL TEMPLATES — MERGE FIELDS ===');
{
  const lead = { businessName: 'Rich Cafe', reviewCount: 45 };
  const rendered = renderTemplate('no-website', lead);
  check('Subject line has merge field filled', rendered.subject === 'Quick idea for Rich Cafe', rendered.subject);
  check('Body has merge field filled', rendered.body.includes('Rich Cafe'));
  check('No unfilled {{}} placeholders leak into a real field that exists', !rendered.subject.includes('{{'));

  const reviewTpl = renderTemplate('low-reviews', lead);
  check('Numeric merge field works too', reviewTpl.body.includes('45 reviews'), reviewTpl.body.match(/\d+ reviews/));

  const unknownLead = { businessName: 'Mystery Biz' }; // no reviewCount at all
  const missingFieldTpl = renderTemplate('low-reviews', unknownLead);
  check('Missing field leaves placeholder intact rather than printing "undefined"', !missingFieldTpl.body.includes('undefined'));

  const unknownTemplate = renderTemplate('does-not-exist', lead);
  check('Unknown template key falls back to general template, does not crash', unknownTemplate.subject.includes('Rich Cafe'));
}

console.log('\n=== SMTP MAILER — WIRING LOGIC (mocked transport, no real send) ===');
(async () => {
  {
    const sentMessages = [];
    const mockTransport = {
      options: { auth: { user: 'agency@gmail.com' } },
      sendMail: async (msg) => { sentMessages.push(msg); return { messageId: 'mock-123' }; },
    };
    const result = await sendEmail(mockTransport, { to: 'lead@business.com', subject: 'Test', body: 'Hello', fromName: 'Sy' });
    check('sendEmail returns ok + messageId', result.ok === true && result.messageId === 'mock-123');
    check('Correct recipient set', sentMessages[0].to === 'lead@business.com');
    check('From name formatted correctly with the Gmail address', sentMessages[0].from === '"Sy" <agency@gmail.com>');
  }
  {
    const mockTransport = { options: { auth: { user: 'x@gmail.com' } }, sendMail: async () => ({ messageId: 'x' }) };
    let threw = false;
    try { await sendEmail(mockTransport, { to: '', subject: 'x', body: 'x' }); } catch (e) { threw = true; }
    check('Rejects sending with no recipient (fails loud, not silent)', threw === true);
  }

  console.log('');
  console.log(`TOTAL: ${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL > 0 ? 1 : 0);
})();
