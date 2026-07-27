// src/main/replyTracker.js
//
// Polls the same Gmail inbox already authenticated for SMTP sending (same
// email + App Password works for IMAP too — no separate setup) and matches
// incoming mail back to leads we've sent to, so "who replied" stops being
// something you have to check manually in Gmail.
//
// Matching is by sender address only, not thread headers — Gmail's own
// clients, forwarding, and mobile replies frequently drop or rewrite
// In-Reply-To/References, so anchoring to the envelope-from address the lead
// actually owns is the reliable signal, not the headers.

const { ImapFlow } = require('imapflow');

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

class ReplyTracker {
  /**
   * @param {object} opts
   * @param {() => {email: string, appPassword: string} | null} opts.getCredentials
   * @param {(message: string) => void} [opts.onError]
   */
  constructor({ getCredentials, onError } = {}) {
    this.getCredentials = getCredentials;
    this.onError = onError || (() => {});
    this._client = null;
    this._lastUidSeen = 0;
    this._backfilled = false;
  }

  async _connect() {
    const creds = this.getCredentials();
    if (!creds || !creds.email || !creds.appPassword) {
      throw new Error('No email credentials saved — configure SMTP in Email settings first');
    }
    const client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: { user: creds.email, pass: creds.appPassword },
      logger: false,
    });
    await client.connect();
    return client;
  }

  /**
   * Checks the inbox for messages from any of the given sender addresses.
   * `knownAddresses` is a Set of lowercased lead email addresses worth
   * matching against — checking against every message ever received would
   * be slow and pointless; we only care about people we actually emailed.
   *
   * Returns [{ fromAddress, subject, snippet, receivedAt, uid }].
   */
  async checkReplies(knownAddresses) {
    if (!knownAddresses || knownAddresses.size === 0) return [];

    let client;
    try {
      client = await this._connect();
    } catch (error) {
      this.onError(`IMAP connect failed: ${error.message || error}`);
      return [];
    }

    const found = [];
    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        // First run: scan the last 200 messages by sequence number so
        // replies that arrived before this feature existed still get
        // picked up. Every run after that fetches by UID, starting just
        // past the highest UID already seen — cheap and never re-scans.
        let range;
        let fetchByUid;
        if (this._backfilled) {
          range = `${this._lastUidSeen + 1}:*`;
          fetchByUid = true;
        } else {
          const status = await client.status('INBOX', { messages: true });
          const startSeq = Math.max(1, (status.messages || 0) - 200);
          range = `${startSeq}:*`;
          fetchByUid = false;
        }

        for await (const message of client.fetch(range, { envelope: true, uid: true, source: false }, { uid: fetchByUid })) {
          if (this._backfilled && message.uid <= this._lastUidSeen) continue;
          const fromAddress = extractAddress(message.envelope && message.envelope.from);
          if (fromAddress && knownAddresses.has(fromAddress)) {
            let bodyText = '';
            try {
              const { content } = await client.download(message.uid, undefined, { uid: true });
              bodyText = await streamToString(content, 20000);
            } catch {
              // Body fetch failing shouldn't drop the reply — we still know who replied and when.
            }
            found.push({
              fromAddress,
              subject: (message.envelope && message.envelope.subject) || '',
              snippet: snippetFrom(stripHtml(bodyText)),
              receivedAt: (message.envelope && message.envelope.date ? new Date(message.envelope.date) : new Date()).toISOString(),
              uid: message.uid,
            });
          }
          if (message.uid > this._lastUidSeen) this._lastUidSeen = message.uid;
        }
        this._backfilled = true;
      } finally {
        lock.release();
      }
    } catch (error) {
      this.onError(`IMAP scan failed: ${error.message || error}`);
    } finally {
      try { await client.logout(); } catch { /* connection already gone */ }
    }

    return found;
  }
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

function stripHtml(text) {
  if (!text) return '';
  if (!/<[a-z][\s\S]*>/i.test(text)) return text; // plain text already
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

module.exports = { ReplyTracker, extractAddress, snippetFrom, stripHtml };
