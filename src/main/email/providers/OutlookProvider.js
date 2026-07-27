// src/main/email/providers/OutlookProvider.js
//
// Outlook/Microsoft 365 account handling: OAuth2 (msal-node) + Microsoft
// Graph sendMail when account.authType === 'oauth', otherwise falls back to
// nodemailer/imapflow via ImapSmtpProvider (App Password path, same as
// GmailProvider's fallback).
//
// `msal-node` and Graph HTTP calls are lazily required so this module
// stays require()-able without the dependency installed / without network.

const https = require('https');
const { ProviderBase } = require('./ProviderBase');
const { ImapSmtpProvider } = require('./ImapSmtpProvider');

const GRAPH_SEND_MAIL_HOST = 'graph.microsoft.com';

function graphRequest(method, urlPath, accessToken, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      host: GRAPH_SEND_MAIL_HOST, path: urlPath, method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(data ? JSON.parse(data) : {});
        else reject(new Error(`Graph API ${res.statusCode}: ${data}`));
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

class OutlookProvider extends ProviderBase {
  /**
   * @param {object} account - email_accounts row
   * @param {object} creds - { appPassword } for 'app_password', or
   *   { refreshToken, clientId, clientSecret, tenantId } for 'oauth'
   */
  constructor(account, creds) {
    super(account);
    this.creds = creds;
    this._fallback = null;
    this._msalApp = null;
  }

  get _isOAuth() {
    return this.account.authType === 'oauth';
  }

  _getFallback() {
    if (!this._fallback) {
      this._fallback = new ImapSmtpProvider(this.account, {
        email: this.account.email,
        password: this.creds.appPassword,
      });
    }
    return this._fallback;
  }

  async _getAccessToken() {
    // eslint-disable-next-line global-require
    const msal = require('@azure/msal-node');
    if (!this._msalApp) {
      this._msalApp = new msal.ConfidentialClientApplication({
        auth: {
          clientId: this.creds.clientId,
          authority: `https://login.microsoftonline.com/${this.creds.tenantId || 'common'}`,
          clientSecret: this.creds.clientSecret,
        },
      });
    }
    const result = await this._msalApp.acquireTokenByRefreshToken({
      refreshToken: this.creds.refreshToken,
      scopes: ['https://graph.microsoft.com/Mail.Send', 'https://graph.microsoft.com/Mail.Read', 'offline_access'],
    });
    if (!result || !result.accessToken) throw new Error('Failed to acquire Microsoft access token');
    return result.accessToken;
  }

  async verify() {
    if (!this._isOAuth) return this._getFallback().verify();
    try {
      const token = await this._getAccessToken();
      await graphRequest('GET', '/v1.0/me', token);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }

  async sendMail(mail) {
    if (!this._isOAuth) return this._getFallback().sendMail(mail);
    try {
      const token = await this._getAccessToken();
      const message = {
        subject: mail.subject || '',
        body: { contentType: 'Text', content: mail.body },
        toRecipients: [{ emailAddress: { address: mail.to } }],
      };
      if (mail.inReplyTo) {
        message.internetMessageHeaders = [
          { name: 'In-Reply-To', value: mail.inReplyTo },
          { name: 'References', value: mail.references || mail.inReplyTo },
        ];
      }
      await graphRequest('POST', '/v1.0/me/sendMail', token, { message, saveToSentItems: true });
      return { ok: true, messageId: undefined };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }

  async fetchNew(sinceUid) {
    // Same rationale as GmailProvider: reuse IMAP for inbound sync (Outlook
    // supports XOAUTH2 over IMAP with a Graph-scoped access token) rather
    // than reimplementing message listing against the delta Graph API.
    if (!this._isOAuth) return this._getFallback().fetchNew(sinceUid);
    const token = await this._getAccessToken();
    const imapProvider = new ImapSmtpProvider(this.account, {
      email: this.account.email,
      accessToken: token,
      imapHost: 'outlook.office365.com',
      imapPort: 993,
    });
    return imapProvider.fetchNew(sinceUid);
  }
}

module.exports = { OutlookProvider };
