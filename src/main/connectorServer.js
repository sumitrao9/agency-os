// src/main/connectorServer.js
//
// Local HTTP server the Chrome extension's Connector.sendLead() talks to.
// Rewritten on Node's built-in `http` module — the original used Express +
// cors for 5 simple JSON routes, which is real dependency weight for
// something this small. "Prefer built-in Node.js capabilities before
// adding external libraries; every dependency must justify itself" — this
// one didn't, once actually measured against what it was doing.
//
// Same public interface as the Express version on purpose: createConnectorServer(db)
// returns an object with .listen(port, callback), so main.js needed zero changes.
//
// Endpoints (unchanged):
//   POST /api/leads          — receive a single lead
//   POST /api/leads/batch    — receive multiple leads at once
//   GET  /api/leads          — list all leads (used by the renderer UI)
//   GET  /api/health         — heartbeat
//   GET  /api/version        — version check

const http = require('http');

const APP_VERSION = '0.1.0-skeleton';
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB, matching the old express.json({ limit: '2mb' })

function sendJson(res, statusCode, payload, origin) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    // CORS: the extension calls this from a chrome-extension:// or
    // moz-extension:// origin. Previously this was '*', which meant any
    // ordinary website open in the user's regular browser could also POST
    // leads or read the full lead list from this local API — a real
    // localhost-drive-by risk, not just a theoretical one, since the port
    // is fixed and predictable. Only echo back the origin if it's one of
    // the two real callers; otherwise omit the header entirely (browsers
    // then block the response from being read cross-origin).
    ...(origin && /^(chrome|moz)-extension:\/\//.test(origin)
      ? { 'Access-Control-Allow-Origin': origin }
      : {}),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let totalBytes = 0;
    req.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) { resolve({}); return; }
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function createConnectorServer(database) {
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const send = (statusCode, payload) => sendJson(res, statusCode, payload, origin);

    // CORS preflight — browsers send this before the real POST from the extension
    if (req.method === 'OPTIONS') {
      send(204, {});
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const routeKey = `${req.method} ${url.pathname}`;

    try {
      if (routeKey === 'GET /api/health') {
        send(200, { ok: true, status: 'running', leadCount: database.count() });
        return;
      }

      if (routeKey === 'GET /api/version') {
        send(200, { version: APP_VERSION });
        return;
      }

      if (routeKey === 'GET /api/leads') {
        send(200, { ok: true, leads: database.getAllLeads() });
        return;
      }

      if (routeKey === 'POST /api/leads') {
        const lead = await readJsonBody(req);
        if (!lead || !lead.businessName) {
          send(400, { ok: false, error: 'businessName is required' });
          return;
        }
        const result = database.upsertLead(lead);
        database.logSync(1, lead.leadSource || 'chrome-extension');
        send(200, {
          ok: true,
          id: result.id,
          duplicate: result.duplicate,
          message: result.duplicate ? 'Already exists — skipped' : 'Lead received',
        });
        return;
      }

      if (routeKey === 'POST /api/leads/batch') {
        const body = await readJsonBody(req);
        const leads = body.leads;
        if (!Array.isArray(leads) || !leads.length) {
          send(400, { ok: false, error: 'leads must be a non-empty array' });
          return;
        }
        const results = leads.map(lead => {
          if (!lead.businessName) return { ok: false, error: 'businessName missing', skipped: true };
          return { ok: true, ...database.upsertLead(lead) };
        });
        database.logSync(leads.length, body.source || 'chrome-extension');
        const inserted = results.filter(r => r.inserted).length;
        const duplicates = results.filter(r => r.duplicate).length;
        send(200, { ok: true, received: leads.length, inserted, duplicates, results });
        return;
      }

      send(404, { ok: false, error: 'Not found' });
    } catch (e) {
      send(e.message === 'Invalid JSON body' || e.message === 'Request body too large' ? 400 : 500,
        { ok: false, error: String(e.message || e) });
    }
  });

  const originalClose = server.close.bind(server);
  let isClosing = false;
  server.close = function closeWrapper(callback) {
    if (isClosing) {
      if (typeof callback === 'function') callback();
      return server;
    }
    isClosing = true;
    if (typeof server.closeAllConnections === 'function') {
      try { server.closeAllConnections(); } catch (e) {}
    }
    if (typeof server.closeIdleConnections === 'function') {
      try { server.closeIdleConnections(); } catch (e) {}
    }
    return originalClose(() => {
      if (typeof callback === 'function') callback();
    });
  };

  return server;
}

module.exports = { createConnectorServer, APP_VERSION };
