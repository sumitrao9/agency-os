const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAppRuntime } = require('./src/main/appRuntime');

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agencyos-runtime-'));
  const runtime = createAppRuntime({
    app: {
      getPath: (name) => {
        if (name === 'userData') return tempDir;
        return tempDir;
      },
      quit: () => {},
    },
    browserWindowFactory: async () => ({
      webContents: { on: () => {}, },
      loadFile: () => {},
      destroy: () => {},
    }),
    isTest: true,
  });

  assert.strictEqual(runtime.getState().status, 'idle');

  await runtime.initialize();
  assert.strictEqual(runtime.getState().status, 'ready');
  assert.ok(runtime.getState().db);

  runtime.emitEvent('test', { ok: true });
  runtime.shutdown();

  assert.strictEqual(runtime.getState().status, 'stopped');
  console.log('PASS runtime architecture bootstrap/shutdown');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
