const { Database } = require('./src/main/database');
const { renderFollowUp, FOLLOWUP_TEMPLATES } = require('./src/main/templates');
const { createTransport, sendEmail } = require('./src/main/mailer');

let PASS = 0, FAIL = 0;
function check(l, c, d = '') { if (c) { PASS++; console.log('  PASS  ' + l); } else { FAIL++; console.log('  FAIL  ' + l + (d ? ' -> ' + d : '')); } }

(async () => {
  console.log('=== DEDUP — NAME NORMALIZATION + DOMAIN MATCHING ===');
  const db = new Database(`/tmp/test-followup-dedup-${Date.now()}.sqlite`);
  await db.init();

  const r1 = db.upsertLead({ businessName: 'Acme Plumbing', phone: '', website: '' });
  check('First insert succeeds', r1.inserted === true);

  const r2 = db.upsertLead({ businessName: 'Acme Plumbing LLC.', phone: '', website: '' });
  check('Legal-suffix variant (LLC.) detected as duplicate', r2.duplicate === true);

  const r3 = db.upsertLead({ businessName: 'ACME PLUMBING', phone: '', website: '' });
  check('Case variant detected as duplicate', r3.duplicate === true);

  const r4 = db.upsertLead({ businessName: 'Totally Different Co', phone: '', website: 'https://www.acmeplumbing.com' });
  check('First domain insert succeeds', r4.inserted === true);

  const r5 = db.upsertLead({ businessName: 'Yet Another Name Entirely', phone: '', website: 'https://acmeplumbing.com/contact' });
  check('Same domain, different name/path detected as duplicate', r5.duplicate === true);

  const r6 = db.upsertLead({ businessName: 'Unrelated Business', phone: '', website: 'https://unrelated-business.com' });
  check('Genuinely different business inserted, not falsely flagged', r6.inserted === true);

  console.log('\n=== FOLLOW-UP TEMPLATES ===');
  const lead = { businessName: 'Test Cafe' };
  const nudge = renderFollowUp('nudge', lead);
  check('Nudge template renders merge field', nudge.body.includes('Test Cafe'));
  check('Nudge avoids "just checking in"', !/just checking in/i.test(nudge.body));

  const breakup = renderFollowUp('breakup', lead);
  check('Breakup template renders merge field', breakup.body.includes('Test Cafe'));
  check('Breakup offers an exit rather than re-pitching', /stop reaching out/i.test(breakup.body));

  const unknownStage = renderFollowUp('not-a-real-stage', lead);
  check('Unknown stage falls back to nudge, does not crash', unknownStage.body === nudge.body);

  console.log('\n=== MAILER — SAME-THREAD REPLY HEADERS ===');
  const sentMail = [];
  const mockTransport = {
    options: { auth: { user: 'sy@gmail.com' } },
    sendMail: async (mail) => { sentMail.push(mail); return { messageId: '<reply-123@gmail.com>' }; },
  };

  await sendEmail(mockTransport, {
    to: 'lead@business.com', subject: 'Re: Quick idea', body: 'follow up body',
    fromName: 'Sy', inReplyTo: '<original-abc@gmail.com>',
  });
  check('inReplyTo header set on threaded send', sentMail[0].inReplyTo === '<original-abc@gmail.com>');
  check('references defaults to inReplyTo when not separately provided', sentMail[0].references === '<original-abc@gmail.com>');

  let threwWithNoSubjectNoReply = false;
  try {
    await sendEmail(mockTransport, { to: 'x@y.com', body: 'no subject, no thread' });
  } catch (e) { threwWithNoSubjectNoReply = true; }
  check('Rejects a send with neither subject nor inReplyTo', threwWithNoSubjectNoReply);

  let didNotThrowWithReplyOnly = true;
  try {
    await sendEmail(mockTransport, { to: 'x@y.com', body: 'threaded, no new subject needed', inReplyTo: '<abc@gmail.com>' });
  } catch (e) { didNotThrowWithReplyOnly = false; }
  check('Allows a threaded send with inReplyTo but no explicit subject', didNotThrowWithReplyOnly);

  db.close();

  console.log(`\nTOTAL: ${PASS} passed, ${FAIL} failed`);
  // Set the code and let Node unwind on its own — calling process.exit() here
  // tears down while sql.js's WASM handles are still closing, which aborts
  // the process with a libuv assertion on Windows.
  process.exitCode = FAIL ? 1 : 0;
})();
