// src/main/email/oauth/googleOAuth.js
//
// Desktop OAuth2 code flow for Gmail: spins up a short-lived loopback HTTP
// server on an ephemeral port (http://127.0.0.1:<port>), opens the Google
// consent screen in a BrowserWindow pointed at that redirect URI, and
// resolves once Google redirects back with an authorization code — the
// standard Electron OAuth pattern that avoids custom URI scheme
// registration issues.
//
// Client ID/secret come from the caller (AccountManager resolves
// "built-in" env-var defaults vs. a user's BYOC override from the
// oauth_apps table before calling this).

const http = require('http');

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  // GmailProvider.fetchNew() syncs the inbox over raw IMAP (imap.gmail.com)
  // via XOAUTH2, not the Gmail REST API — Google requires this specific
  // legacy-protocol scope for that, separate from gmail.readonly/gmail.send
  // above which only cover REST API calls. Without it IMAP login fails with
  // "Command failed" even though the REST-based send/verify work fine.
  'https://mail.google.com/',
];

/**
 * @param {object} opts
 * @param {string} opts.clientId
 * @param {string} opts.clientSecret
 * @param {(url: string) => import('electron').BrowserWindow} opts.openConsentWindow -
 *   caller supplies this so this module doesn't hard-require Electron's
 *   BrowserWindow at module-load time (keeps it require()-able headlessly).
 * @returns {Promise<{ok: boolean, email?: string, refreshToken?: string, error?: string}>}
 */
async function runGoogleOAuthFlow({ clientId, clientSecret, openConsentWindow }) {
  if (!clientId || !clientSecret) {
    return { ok: false, error: 'Google OAuth client ID/secret not configured — set built-in env vars or add your own in Settings > Integrations' };
  }

  // eslint-disable-next-line global-require
  const { google } = require('googleapis');

  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1');
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body>Sign-in complete — you can close this window.</body></html>');

        if (error) { cleanup(); resolve({ ok: false, error }); return; }
        if (!code) return; // some other request hit the server; ignore

        const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const profile = await oauth2.userinfo.get();

        cleanup();
        resolve({
          ok: true,
          email: profile.data.email,
          refreshToken: tokens.refresh_token,
          accessToken: tokens.access_token,
          redirectUri,
        });
      } catch (e) {
        cleanup();
        resolve({ ok: false, error: String(e.message || e) });
      }
    });

    let win = null;
    let redirectUri = '';
    const cleanup = () => {
      try { server.close(); } catch { /* already closed */ }
      try { if (win && !win.isDestroyed()) win.close(); } catch { /* already closed */ }
    };

    server.on('error', (e) => resolve({ ok: false, error: `Loopback server failed: ${e.message || e}` }));

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      redirectUri = `http://127.0.0.1:${port}`;
      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline', prompt: 'consent', scope: GOOGLE_SCOPES,
      });
      win = openConsentWindow(authUrl);
    });
  });
}

module.exports = { runGoogleOAuthFlow, GOOGLE_SCOPES };
