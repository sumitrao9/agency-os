const { Database } = require('./src/main/database');
const { createConnectorServer } = require('./src/main/connectorServer');
const http = require('http');

let PASS = 0, FAIL = 0;
function check(l, c, d = '') { if (c) { PASS++; console.log('  PASS  ' + l); } else { FAIL++; console.log('  FAIL  ' + l + (d ? ' -> ' + d : '')); } }

async function request(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ hostname: 'localhost', port, path, method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} },
      (res) => {
        let chunks = '';
        res.on('data', c => chunks += c);
        res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); } catch (e) { resolve({ status: res.statusCode, body: chunks }); } });
      });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  const testDbPath = '/tmp/test_agency.sqlite';
  try { require('fs').unlinkSync(testDbPath); } catch (e) {}

  const db = new Database(testDbPath);
  await db.init();
  console.log('=== DATABASE LAYER ===');
  check('Database initializes', db.db !== null);
  check('Starts with 0 leads', db.count() === 0);

  const server = createConnectorServer(db);
  const httpServer = server.listen(0);
  const port = httpServer.address().port;
  console.log(`Server listening on port ${port}`);

  console.log('\n=== CONNECTOR SERVER — REAL HTTP REQUESTS ===');
  const health = await request(port, 'GET', '/api/health');
  check('Health check responds', health.status === 200 && health.body.ok === true);

  const version = await request(port, 'GET', '/api/version');
  check('Version endpoint responds', version.status === 200 && !!version.body.version);

  const lead1 = { businessName: 'Test Cafe', phone: '0412345678', website: 'https://testcafe.com', category: 'Cafe', rating: 4.1, reviewCount: 80 };
  const r1 = await request(port, 'POST', '/api/leads', lead1);
  check('Single lead accepted', r1.status === 200 && r1.body.ok === true);
  check('New lead marked inserted, not duplicate', r1.body.duplicate === false);

  const r2 = await request(port, 'POST', '/api/leads', lead1);
  check('Duplicate (same phone) correctly detected', r2.body.duplicate === true);
  check('Duplicate detection did not create a second row', db.count() === 1);

  const badLead = await request(port, 'POST', '/api/leads', { phone: '123' }); // missing businessName
  check('Rejects lead with no businessName', badLead.status === 400 && badLead.body.ok === false);

  const batch = await request(port, 'POST', '/api/leads/batch', {
    leads: [
      { businessName: 'Batch Biz 1', phone: '0499999991' },
      { businessName: 'Batch Biz 2', phone: '0499999992' },
      { businessName: 'Test Cafe', phone: '0412345678' }, // duplicate of lead1
    ],
    source: 'chrome-extension-test',
  });
  check('Batch endpoint accepts multiple leads', batch.status === 200 && batch.body.ok === true);
  check('Batch correctly counts inserted vs duplicate', batch.body.inserted === 2 && batch.body.duplicates === 1, JSON.stringify(batch.body));

  const listRes = await request(port, 'GET', '/api/leads');
  check('GET /api/leads returns all leads', listRes.body.leads.length === 3, listRes.body.leads.length);
  check('Lead data round-trips correctly', listRes.body.leads.some(l => l.businessName === 'Test Cafe' && l.website === 'https://testcafe.com'));

  console.log('\n=== PERSISTENCE — survives a restart ===');
  httpServer.close();
  db.close();
  const db2 = new Database(testDbPath);
  await db2.init();
  check('Data persists after close+reopen', db2.count() === 3, db2.count());

  console.log('');
  console.log(`TOTAL: ${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL > 0 ? 1 : 0);
})();
