// src/main/email/providers/ImapSmtpProvider.js
//
// Generic nodemailer (SMTP) + imapflow (IMAP) provider — used directly for
// Zoho/Fastmail/iCloud/custom-domain accounts, and as the App-Password
// fallback path underneath GmailProvider/OutlookProvider. Absorbs the logic
// that used to live in the module-level singletons src/main/mailer.js and
// src/main/replyTracker.js: timeout tuning, threading headers,
// UID-cursor incremental fetch, HTML stripping — now parameterized per
// account instead of assuming one global Gmail account.
//
// Unlike the old ReplyTracker, the UID cursor is NOT kept in memory only —
// the caller (MailEngine) persists `account.lastSyncUid` to the DB after
// each fetchNew() call, fixing the "re-scans 200 messages every restart" gap.

const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { ProviderBase } = require('./ProviderBase');

const DEFAULT_IMAP_PORT = 993;
const DEFAULT_SMTP_PORT = 465;
const CONNECT_TIMEOUT_MS = 15000;
const BACKFILL_MESSAGE_COUNT = 200;

function extractAddress(fromHeader) {
  if (!fromHeader) return '';
  const addr = fromHeader.value && fromHeader.value[0] && fromHeader.value[0].address;
  return (addr || '').toLowerCase().trim();
}

function snippetFrom(text, max = 240) {
  if (!text) return '';
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

function stripHtml(text) {
  if (!text) return '';
  if (!/<[a-z][\s\S]*>/i.test(text)) return text;
  return text
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

function streamToString(stream, maxBytes) {
  return new Promise((resolve, reject) => {
    if (!stream) { resolve(''); return; }
    const chunks = [];
    let size = 0;
    stream.on('data', (chunk) => {
      size += chunk.length;
      if (size <= maxBytes) chunks.push(chunk);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

/**
 * @param {object} creds - { email, password, imapHost, imapPort, smtpHost, smtpPort }
 */
class ImapSmtpProvider extends ProviderBase {
  constructor(account, creds) {
    super(account);
    this.creds = creds; // { email, password, imapHost, imapPort, smtpHost, smtpPort }
  }

  _smtpConfig() {
    const { email, password, smtpHost, smtpPort } = this.creds;
    // Gmail/Outlook fall back here without explicit host/port — nodemailer's
    // named 'service' shortcuts keep the same convenience the old
    // mailer.js's `service: 'gmail'` had.
    if (!smtpHost && this.account && this.account.provider === 'gmail') {
      return { service: 'gmail', auth: { user: email, pass: password } };
    }
    if (!smtpHost && this.account && this.account.provider === 'outlook') {
      return { service: 'hotmail', auth: { user: email, pass: password } };
    }
    return {
      host: smtpHost, port: smtpPort || DEFAULT_SMTP_PORT, secure: (smtpPort || DEFAULT_SMTP_PORT) === 465,
      auth: { user: email, pass: password },
      connectionTimeout: CONNECT_TIMEOUT_MS,
    };
  }

  _transport() {
    if (!this._cachedTransport) this._cachedTransport = nodemailer.createTransport(this._smtpConfig());
    return this._cachedTransport;
  }

  async verify() {
    try {
      await this._transport().verify();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }

  async sendMail({ to, subject, body, inReplyTo, references, fromName }) {
    if (!to || !body || (!subject && !inReplyTo)) {
      return { ok: false, error: 'to and body are required, and subject unless replying in-thread' };
    }
    const transport = this._transport();
    const fromAddr = (transport.options.auth && transport.options.auth.user) || this.creds.email;
    const mail = {
      from: fromName ? `"${fromName}" <${fromAddr}>` : fromAddr,
      to, subject: subject || '', text: body,
    };
    // Threading headers: what makes a follow-up land as a reply in the same
    // conversation rather than a fresh cold email.
    if (inReplyTo) {
      mail.inReplyTo = inReplyTo;
      mail.references = references || inReplyTo;
    }
    try {
      const info = await transport.sendMail(mail);
      return { ok: true, messageId: info.messageId };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }

  _imapConfig() {
    const { email, password, accessToken, imapHost, imapPort } = this.creds;
    let host = imapHost;
    const port = imapPort || DEFAULT_IMAP_PORT;
    if (!host) {
      if (this.account && this.account.provider === 'gmail') host = 'imap.gmail.com';
      else if (this.account && this.account.provider === 'outlook') host = 'outlook.office365.com';
    }
    // OAuth path (GmailProvider/OutlookProvider) passes an access token
    // instead of a password — imapflow's XOAUTH2 SASL mechanism.
    const auth = accessToken ? { user: email, accessToken } : { user: email, pass: password };
    return { host, port, secure: true, auth, logger: false };
  }

  async _connectImap() {
    const config = this._imapConfig();
    if (!config.host) throw new Error('No IMAP host configured for this account');
    const client = new ImapFlow(config);
    await client.connect();
    return client;
  }

  /**
   * Incremental fetch. sinceUid === 0 triggers a one-time backfill of the
   * last BACKFILL_MESSAGE_COUNT messages by sequence number (mirrors the old
   * ReplyTracker's first-run behavior); any sinceUid > 0 fetches strictly by
   * UID range, cheap and never re-scans.
   * @returns {Promise<{messages: import('./ProviderBase').Message[], highestUid: number}>}
   */
  async fetchNew(sinceUid) {
    let client;
    try {
      client = await this._connectImap();
    } catch (error) {
      throw new Error(`IMAP connect failed: ${error.message || error}`);
    }

    const messages = [];
    let highestUid = sinceUid || 0;
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        let range;
        let fetchByUid;
        if (sinceUid && sinceUid > 0) {
          range = `${sinceUid + 1}:*`;
          fetchByUid = true;
        } else {
          const status = await client.status('INBOX', { messages: true });
          const startSeq = Math.max(1, (status.messages || 0) - BACKFILL_MESSAGE_COUNT);
          range = `${startSeq}:*`;
          fetchByUid = false;
        }

        for await (const message of client.fetch(range, { envelope: true, uid: true, source: false }, { uid: fetchByUid })) {
          if (sinceUid && message.uid <= sinceUid) continue;
          const fromAddr = extractAddress(message.envelope && message.envelope.from);
          let bodyText = '';
          try {
            const { content } = await client.download(message.uid, undefined, { uid: true });
            bodyText = await streamToString(content, 20000);
          } catch {
            // Body fetch failing shouldn't drop the message — we still know who/when.
          }
          const toEnvelope = message.envelope && message.envelope.to && message.envelope.to[0];
          messages.push({
            fromAddr,
            toAddr: (toEnvelope && toEnvelope.address) || this.creds.email || '',
            subject: (message.envelope && message.envelope.subject) || '',
            bodyText: stripHtml(bodyText),
            snippet: snippetFrom(stripHtml(bodyText)),
            messageId: (message.envelope && message.envelope.messageId) || '',
            inReplyTo: (message.envelope && message.envelope.inReplyTo) || '',
            uid: message.uid,
            at: (message.envelope && message.envelope.date ? new Date(message.envelope.date) : new Date()).toISOString(),
          });
          if (message.uid > highestUid) highestUid = message.uid;
        }
      } finally {
        lock.release();
      }
    } catch (error) {
      throw new Error(`IMAP scan failed: ${error.message || error}`);
    } finally {
      try { await client.logout(); } catch { /* connection already gone */ }
    }

    return { messages, highestUid };
  }
}

module.exports = { ImapSmtpProvider, extractAddress, snippetFrom, stripHtml };
