// src/main/email/oauth/outlookOAuth.js
//
// Desktop OAuth2 flow for Outlook/Microsoft 365, mirroring googleOAuth.js:
// loopback HTTP server on an ephemeral port + BrowserWindow-hosted
// Microsoft consent screen, resolves with tokens once MSAL's authorization
// code flow completes.

const http = require('http');

const MS_SCOPES = ['Mail.Send', 'Mail.Read', 'User.Read', 'offline_access'];

/**
 * @param {object} opts
 * @param {string} opts.clientId
 * @param {string} opts.clientSecret
 * @param {string} [opts.tenantId] - defaults to 'common' (personal + work/school accounts)
 * @param {(url: string) => import('electron').BrowserWindow} opts.openConsentWindow
 * @returns {Promise<{ok: boolean, email?: string, refreshToken?: string, error?: string}>}
 */
async function runOutlookOAuthFlow({ clientId, clientSecret, tenantId, openConsentWindow }) {
  if (!clientId || !clientSecret) {
    return { ok: false, error: 'Microsoft OAuth client ID/secret not configured — set built-in env vars or add your own in Settings > Integrations' };
  }

  // eslint-disable-next-line global-require
  const msal = require('@azure/msal-node');
  const authority = `https://login.microsoftonline.com/${tenantId || 'common'}`;

  return new Promise((resolve) => {
    const pca = new msal.ConfidentialClientApplication({
      auth: { clientId, authority, clientSecret },
    });

    let win = null;
    let redirectUri = '';
    const cleanup = () => {
      try { server.close(); } catch { /* already closed */ }
      try { if (win && !win.isDestroyed()) win.close(); } catch { /* already closed */ }
    };

    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1');
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body>Sign-in complete — you can close this window.</body></html>');

        if (error) { cleanup(); resolve({ ok: false, error }); return; }
        if (!code) return;

        const result = await pca.acquireTokenByCode({
          code, scopes: MS_SCOPES, redirectUri,
        });
        cleanup();
        resolve({
          ok: true,
          email: result.account && result.account.username,
          refreshToken: result.refreshToken, // present when offline_access scope granted + token cache configured
          accessToken: result.accessToken,
          redirectUri,
        });
      } catch (e) {
        cleanup();
        resolve({ ok: false, error: String(e.message || e) });
      }
    });

    server.on('error', (e) => resolve({ ok: false, error: `Loopback server failed: ${e.message || e}` }));

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      redirectUri = `http://127.0.0.1:${port}`;
      pca.getAuthCodeUrl({ scopes: MS_SCOPES, redirectUri }).then((authUrl) => {
        win = openConsentWindow(authUrl);
      }).catch((e) => { cleanup(); resolve({ ok: false, error: String(e.message || e) }); });
    });
  });
}

module.exports = { runOutlookOAuthFlow, MS_SCOPES };
