const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAppRuntime } = require('./src/main/appRuntime');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async function run() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agency-os-console-'));
  const app = { getPath: (name) => (name === 'userData' ? tempDir : tempDir) };

  const runtime = createAppRuntime({ app, isTest: true });
  await runtime.initialize();

  // With nothing running, the console reports the real idle state — no
  // fabricated jobs, and an explicit "nothing running" alert.
  const idleState = await runtime.handleIpcRequest('automation:consoleState');
  assert(idleState.jobs.length === 0, 'idle state should report zero jobs, not seeded demo jobs');
  assert(idleState.alerts.length > 0, 'idle state should surface at least one real alert (e.g. SMTP not configured)');
  assert(!idleState.alerts.some((a) => a.id.startsWith('alert-00')), 'alerts must never be the old fabricated demo alerts');

  // Capture one real lead so the bulk job has something to actually process
  // (a network fetch, however it resolves, always yields at least one await
  // — enough for the job to still be 'running' the instant start returns).
  const captured = await runtime.handleIpcRequest('leads:capture', {
    businessName: 'Console Test Co', website: 'http://127.0.0.1:9/', source: 'test',
  });
  assert(captured.inserted, 'test lead should be captured');

  const start = await runtime.handleIpcRequest('bulk:startDeepScan', { leadIds: [captured.id], force: false });
  assert(start.ok, 'bulk deep scan should start');

  const runningState = await runtime.handleIpcRequest('automation:consoleState');
  const job = runningState.jobs.find((j) => j.id === 'bulk-enrichment');
  assert(job, 'a real bulk-enrichment job should appear in the console once started');
  assert(job.status === 'running', 'job should be running the instant it starts, not a fabricated status');

  // Cancelling through the console action should actually cancel the real
  // bulk job (verified via bulk:status), not just flip a fake label.
  await runtime.handleIpcRequest('automation:consoleAction', { type: 'cancel-job', jobId: 'bulk-enrichment' });
  const status = await runtime.handleIpcRequest('bulk:status');
  assert(status.status === 'cancelled' || status.status === 'done', 'cancel-job action should cancel the real bulk job');

  console.log('PASS automation console persistence');
})().catch((error) => {
  console.error('FAIL automation console persistence');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
