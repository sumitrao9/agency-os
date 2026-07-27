// src/main/email/providers/GmailProvider.js
//
// Gmail account handling: OAuth2 (googleapis, Gmail API send + list) when
// account.authType === 'oauth', otherwise falls back to nodemailer's
// 'gmail' service + imapflow via ImapSmtpProvider (App Password path) —
// exactly what the old single-account mailer.js/replyTracker.js did.
//
// `googleapis` is a heavy, network-touching dependency; it's required
// lazily inside the OAuth branch so this module can still be require()'d
// (and the App Password path used) in environments where it isn't
// installed yet, or during a headless sanity check.

const { ProviderBase } = require('./ProviderBase');
const { ImapSmtpProvider } = require('./ImapSmtpProvider');

class GmailProvider extends ProviderBase {
  /**
   * @param {object} account - email_accounts row
   * @param {object} creds - decrypted credentials: { appPassword } for
   *   authType 'app_password', or { refreshToken, clientId, clientSecret } for 'oauth'
   */
  constructor(account, creds) {
    super(account);
    this.creds = creds;
    this._fallback = null;
    this._oauth2Client = null;
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

  async _getOAuthClient() {
    if (this._oauth2Client) return this._oauth2Client;
    // eslint-disable-next-line global-require
    const { google } = require('googleapis');
    const client = new google.auth.OAuth2(this.creds.clientId, this.creds.clientSecret, this.creds.redirectUri);
    client.setCredentials({ refresh_token: this.creds.refreshToken });
    this._oauth2Client = client;
    return client;
  }

  async verify() {
    if (!this._isOAuth) return this._getFallback().verify();
    try {
      const auth = await this._getOAuthClient();
      // eslint-disable-next-line global-require
      const { google } = require('googleapis');
      const gmail = google.gmail({ version: 'v1', auth });
      await gmail.users.getProfile({ userId: 'me' });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }

  async sendMail(mail) {
    if (!this._isOAuth) return this._getFallback().sendMail(mail);
    try {
      const auth = await this._getOAuthClient();
      // eslint-disable-next-line global-require
      const { google } = require('googleapis');
      const gmail = google.gmail({ version: 'v1', auth });
      const headers = [
        `To: ${mail.to}`,
        `Subject: ${mail.subject || ''}`,
        mail.fromName ? `From: "${mail.fromName}" <${this.account.email}>` : `From: ${this.account.email}`,
        'Content-Type: text/plain; charset="UTF-8"',
      ];
      if (mail.inReplyTo) {
        headers.push(`In-Reply-To: ${mail.inReplyTo}`);
        headers.push(`References: ${mail.references || mail.inReplyTo}`);
      }
      const raw = Buffer.from(`${headers.join('\r\n')}\r\n\r\n${mail.body}`)
        .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      return { ok: true, messageId: res.data.id };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }

  async fetchNew(sinceUid) {
    // The Gmail API's message-listing model (historyId-based) doesn't map
    // 1:1 onto an IMAP UID cursor. For OAuth Gmail accounts we still connect
    // over IMAP with an XOAUTH2 SASL token for inbound sync — Gmail supports
    // this natively, so ImapSmtpProvider's fetchNew logic is reused as-is,
    // just with an OAuth-derived access token instead of an app password.
    if (!this._isOAuth) return this._getFallback().fetchNew(sinceUid);
    const auth = await this._getOAuthClient();
    const { token } = await auth.getAccessToken();
    const imapProvider = new ImapSmtpProvider(this.account, {
      email: this.account.email,
      accessToken: token,
      imapHost: 'imap.gmail.com',
      imapPort: 993,
    });
    return imapProvider.fetchNew(sinceUid);
  }
}

module.exports = { GmailProvider };
