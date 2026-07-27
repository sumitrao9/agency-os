// src/main/healthCheck.js
//
// Runs ONCE on startup, not continuously — matches the explicit
// "reliability over new features, don't continuously monitor" principle.
// Checks the handful of things that would actually confuse a solo user if
// they silently broke: DB schema mismatch, missing SMTP config, and logs
// versions for reference if something needs debugging later.

const os = require('os');

function runStartupHealthCheck(db, spoofConfig, mailConfigured) {
  const results = [];

  const schemaCheck = db.verifySchema();
  results.push({
    check: 'Database schema',
    ok: schemaCheck.ok,
    detail: schemaCheck.ok ? `${db.count()} leads` : schemaCheck.error,
  });

  results.push({
    check: 'SMTP configured',
    ok: mailConfigured,
    detail: mailConfigured ? 'Ready to send' : 'Not set up yet — go to email settings before sending',
  });

  results.push({
    check: 'Location spoof config',
    ok: true, // spoof being off is a valid state, not a failure
    detail: spoofConfig.enabled ? `Enabled (${spoofConfig.lat}, ${spoofConfig.lng})` : 'Disabled',
  });

  const versions = {
    node: process.versions.node,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: `${os.platform()} ${os.release()}`,
  };
  results.push({ check: 'Environment', ok: true, detail: JSON.stringify(versions) });

  const anyFailed = results.some(r => !r.ok);
  return { ok: !anyFailed, results, versions };
}

module.exports = { runStartupHealthCheck };
