const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAppRuntime } = require('./src/main/appRuntime');

(async function run() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agency-os-workflow-'));
  const app = { getPath: (name) => (name === 'userData' ? tempDir : tempDir) };
  const runtime = createAppRuntime({ app, isTest: true });

  try {
    await runtime.initialize();

    await runtime.handleIpcRequest('leads:capture', {
      businessName: 'Acme Plumbing',
      category: 'Plumber',
      website: 'https://acme.example',
      phone: '555-1234',
      email: 'ops@acme.example',
      address: '123 Main St',
      rating: 4.8,
      reviewCount: 25,
      status: 'New',
      customFields: { source: 'manual' },
    });

    const result = await runtime.handleIpcRequest('automation:runWorkflow', { format: 'json' });
    assert.ok(result.ok, 'workflow run should succeed');
    assert.ok(result.exportPath, 'workflow run should create an export file');
    assert.ok(fs.existsSync(result.exportPath), 'export file should be created on disk');

    const exported = JSON.parse(fs.readFileSync(result.exportPath, 'utf8'));
    assert.ok(Array.isArray(exported), 'workflow export should contain an array of leads');
    assert.ok(exported.length >= 1, 'workflow export should include at least one lead');

    console.log('PASS workflow engine');
  } catch (error) {
    console.error('FAIL workflow engine');
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  } finally {
    // The connector server started by initialize() keeps listening
    // indefinitely otherwise — without this the process never exits, pass
    // or fail, and silently hangs every run after it in the test chain.
    runtime.shutdown();
  }
})();
