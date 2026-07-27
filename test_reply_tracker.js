const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { extractAddress, snippetFrom, stripHtml } = require('./src/main/replyTracker');
const { createAppRuntime } = require('./src/main/appRuntime');

let PASS = 0, FAIL = 0;
function check(label, cond, detail = '') {
  if (cond) { PASS++; console.log('  PASS  ' + label); }
  else { FAIL++; console.log('  FAIL  ' + label + (detail ? ' -> ' + detail : '')); }
}

console.log('=== REPLY MATCHING — PURE FUNCTIONS ===');

check(
  'extractAddress reads and lowercases the envelope address',
  extractAddress({ value: [{ address: 'Owner@BusinessName.com' }] }) === 'owner@businessname.com'
);
check('extractAddress handles missing header', extractAddress(undefined) === '');
check('extractAddress handles empty value array', extractAddress({ value: [] }) === '');

check(
  'snippetFrom collapses whitespace',
  snippetFrom('Hi\n\n  there,   thanks for reaching out') === 'Hi there, thanks for reaching out'
);
check(
  'snippetFrom truncates long text with an ellipsis',
  snippetFrom('a'.repeat(300), 240).length === 241 && snippetFrom('a'.repeat(300), 240).endsWith('…')
);
check('snippetFrom handles empty input', snippetFrom('') === '');

check(
  'stripHtml passes plain text through untouched',
  stripHtml('Sounds good, call me tomorrow.') === 'Sounds good, call me tomorrow.'
);
check(
  'stripHtml converts <br>/<p> to newlines and strips tags',
  stripHtml('<p>Hi there</p><br><p>Thanks!</p>') === 'Hi there\n\nThanks!'
);
check(
  'stripHtml removes <style>/<script> blocks entirely',
  !stripHtml('<style>.x{color:red}</style><p>Real content</p><script>evil()</script>').includes('color:red')
);
check(
  'stripHtml decodes common entities',
  stripHtml('<p>Ben &amp; Co&nbsp;said yes</p>') === 'Ben & Co said yes'
);

(async () => {
  console.log('\n=== REPLY CHECK — GRACEFUL DEGRADATION (no IMAP credentials saved) ===');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agency-os-replies-'));
  const app = { getPath: (name) => (name === 'userData' ? tempDir : tempDir) };
  const runtime = createAppRuntime({ app, isTest: true });
  await runtime.initialize();

  try {
    // A lead that's been emailed but hasn't replied — eligible for matching.
    await runtime.handleIpcRequest('leads:capture', {
      businessName: 'Acme Plumbing',
      email: 'owner@acmeplumbing.com',
      phone: '+1 555 0100',
    });
    const leads = await runtime.handleIpcRequest('leads:getAll');
    await runtime.handleIpcRequest('leads:update', { id: leads[0].id, fields: { status: 'Sent' } });

    const result = await runtime.handleIpcRequest('replies:check');
    check('replies:check does not throw with no SMTP credentials configured', true);
    check('replies:check reports checked:true (it did run, just found nothing)', result.checked === true);
    check('replies:check returns an empty newReplies array, not a crash', Array.isArray(result.newReplies) && result.newReplies.length === 0);

    const state = runtime.getState();
    check(
      'the missing-credentials condition was recorded as a real error, not swallowed silently',
      state.errors.some((e) => /credentials|IMAP/i.test(e.message))
    );

    const noDbRuntime = createAppRuntime({ app: { getPath: () => tempDir }, isTest: true });
    const noDbResult = await noDbRuntime.handleIpcRequest('replies:check');
    check(
      'replies:check on an uninitialized runtime returns checked:false rather than throwing',
      noDbResult.checked === false && Array.isArray(noDbResult.newReplies)
    );
  } finally {
    runtime.shutdown();
  }

  console.log(`\nTOTAL: ${PASS} passed, ${FAIL} failed`);
  process.exitCode = FAIL ? 1 : 0;
})();
