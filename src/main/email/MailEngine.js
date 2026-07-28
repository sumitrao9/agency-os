// src/main/email/MailEngine.js
//
// Central orchestrator: send, sync, and the events the rest of the app
// (dashboard live-progress, reply notifications) hooks into. Replaces
// appRuntime.js's state.mailTransport/mailAccountEmail singleton and
// main.js's reply-poll setInterval (now MailEngine.syncAll() on the same
// interval, per-account instead of one hardcoded inbox).

const { EventEmitter } = require('events');

const SEND_WARN_AT = 80;
const SEND_HARD_STOP_AT = 120;
// Once a lead has reached one of these, an inbound reply is still meaningful
// — matches the address-matching heuristic that used to live in
// appRuntime.js's checkReplies().
const REPLY_UPGRADE_FROM = new Set(['New', 'Sent', 'Qualified']);

class MailEngine extends EventEmitter {
  /**
   * @param {object} opts
   * @param {import('./AccountManager').AccountManager} opts.accountManager
   * @param {import('../database').Database} opts.db
   * @param {(message: string) => void} [opts.onError]
   */
  constructor({ accountManager, db, onError } = {}) {
    super();
    this.accountManager = accountManager;
    this.db = db;
    this.onError = onError || (() => {});
  }

  _today() {
    return new Date().toISOString().slice(0, 10);
  }

  _dailyCount(account) {
    return account.dailySendDate === this._today() ? (account.dailySendCount || 0) : 0;
  }

  /**
   * @param {string} accountId
   * @param {{to: string, subject: string, body: string, leadId?: string, inReplyTo?: string, references?: string, fromName?: string}} mail
   */
  async send(accountId, mail) {
    const account = this.accountManager.getAccountRaw(accountId);
    if (!account) return { ok: false, error: 'Email account not found' };

    if (this.db) {
      const blocked = this.db.isBlacklisted({ email: mail.to });
      if (blocked) {
        return { ok: false, error: `This address is on the do-not-contact list${blocked.reason ? ` (${blocked.reason})` : ''} — send refused.`, blacklisted: true };
      }
    }

    const count = this._dailyCount(account);
    if (count >= SEND_HARD_STOP_AT) {
      return {
        ok: false,
        error: `Daily send limit reached (${count}/${SEND_HARD_STOP_AT}) for ${account.email} — resets at midnight.`,
        limitReached: true,
      };
    }

    const provider = this.accountManager.getProvider(accountId);
    if (!provider) return { ok: false, error: 'Could not load provider/credentials for this account' };

    let result;
    try {
      result = await provider.sendMail(mail);
    } catch (e) {
      result = { ok: false, error: String(e.message || e) };
    }

    if (!result.ok) {
      this.db && this.db.updateAccount(accountId, { status: 'error', lastError: result.error || 'Send failed' });
      this.emit('send:failed', { accountId, mail, error: result.error });
      return result;
    }

    // Record the message + thread, bump the per-account daily counter.
    if (this.db) {
      const today = this._today();
      this.db.updateAccount(accountId, {
        dailySendCount: (today === account.dailySendDate ? (account.dailySendCount || 0) : 0) + 1,
        dailySendDate: today,
        status: 'ok',
      });
      const threadId = mail.inReplyTo ? `thread_${mail.inReplyTo}` : `thread_${result.messageId || Date.now()}`;
      this.db.upsertThread({ id: threadId, accountId, leadId: mail.leadId, subject: mail.subject, lastMessageAt: new Date().toISOString() });
      this.db.insertMessage({
        threadId, accountId, leadId: mail.leadId, direction: 'outbound',
        fromAddr: account.email, toAddr: mail.to, subject: mail.subject, bodyText: mail.body,
        snippet: (mail.body || '').slice(0, 240), messageId: result.messageId || '', inReplyTo: mail.inReplyTo || '',
        status: 'sent', at: new Date().toISOString(),
      });
    }

    const newCount = this._dailyCount({ ...account, dailySendCount: (account.dailySendDate === this._today() ? account.dailySendCount : 0) }) + 1;
    if (newCount === SEND_WARN_AT) {
      result.warning = `You've sent ${newCount} emails today on ${account.email}. Approaching the safe daily limit for cold outreach.`;
    }

    this.emit('send:success', { accountId, mail, result });
    return result;
  }

  getSendCount(accountId) {
    const account = this.accountManager.getAccountRaw(accountId);
    if (!account) return { count: 0, warnAt: SEND_WARN_AT, hardStopAt: SEND_HARD_STOP_AT };
    return { count: this._dailyCount(account), warnAt: SEND_WARN_AT, hardStopAt: SEND_HARD_STOP_AT };
  }

  /** Syncs one account: fetches new inbound mail, persists, matches to leads. */
  async syncAccount(accountId) {
    const account = this.accountManager.getAccountRaw(accountId);
    if (!account) return { ok: false, error: 'Account not found' };
    const provider = this.accountManager.getProvider(accountId);
    if (!provider) return { ok: false, error: 'Could not load provider/credentials' };

    let fetchResult;
    try {
      fetchResult = await provider.fetchNew(account.lastSyncUid || 0);
    } catch (e) {
      const error = String(e.message || e);
      // Deliberately does NOT touch account.status/lastError — those gate
      // whether *sending* is enabled in the UI, and a transient inbox-sync
      // failure (network blip, IMAP rate limit) has no bearing on whether
      // SMTP send still works. Conflating the two meant one flaky sync
      // silently disabled the Send button until a full app restart.
      this.onError(`Sync failed for ${account.email}: ${error}`);
      return { ok: false, error };
    }

    const { messages, highestUid } = fetchResult;
    const newMessages = [];

    if (this.db && messages.length) {
      const leads = this.db.getAllLeads();
      const addressToLead = new Map();
      for (const lead of leads) {
        if (!lead.email) continue;
        const key = lead.email.toLowerCase().trim();
        if (REPLY_UPGRADE_FROM.has(lead.status) || lead.status === 'Replied') {
          if (!addressToLead.has(key)) addressToLead.set(key, lead);
        }
      }

      for (const message of messages) {
        const lead = addressToLead.get(message.fromAddr);
        const threadId = message.inReplyTo ? `thread_${message.inReplyTo}` : `thread_inbound_${accountId}_${message.uid}`;
        this.db.upsertThread({ id: threadId, accountId, leadId: lead ? lead.id : null, subject: message.subject, lastMessageAt: message.at });
        this.db.insertMessage({
          threadId, accountId, leadId: lead ? lead.id : null, direction: 'inbound',
          fromAddr: message.fromAddr, toAddr: message.toAddr, subject: message.subject,
          bodyText: message.bodyText, snippet: message.snippet, messageId: message.messageId,
          inReplyTo: message.inReplyTo, uid: message.uid, status: 'received', at: message.at,
        });

        if (lead) {
          const fields = {
            customFields: {
              ...(lead.customFields || {}),
              lastReply: { snippet: message.snippet, receivedAt: message.at, subject: message.subject },
            },
            history: [
              ...(lead.history || []),
              { at: message.at, event: `Reply received: "${message.snippet.slice(0, 80)}"` },
            ],
          };
          if (REPLY_UPGRADE_FROM.has(lead.status)) fields.status = 'Replied';
          this.db.updateLead(lead.id, fields);
          addressToLead.delete(message.fromAddr); // one match per address per sync pass
        }

        newMessages.push({
          accountId, leadId: lead ? lead.id : null, businessName: lead ? lead.businessName : null,
          fromAddr: message.fromAddr, subject: message.subject, snippet: message.snippet, at: message.at,
        });
        this.emit('message:received', newMessages[newMessages.length - 1]);
      }
    }

    if (this.db && highestUid > (account.lastSyncUid || 0)) {
      // Same reasoning as the catch block above: sync success/failure and
      // send success/failure are independent signals, so this only ever
      // touches lastSyncUid — never account.status/lastError.
      this.db.updateAccount(accountId, { lastSyncUid: highestUid });
    }

    this.emit('account:status', { accountId, status: 'ok' });
    return { ok: true, newMessages };
  }

  /** Syncs every configured account. Called on the background poll interval. */
  async syncAll() {
    if (!this.accountManager) return { newMessages: [] };
    const accounts = this.accountManager.listAccounts();
    const allNew = [];
    for (const account of accounts) {
      try {
        const result = await this.syncAccount(account.id);
        if (result.ok && result.newMessages) allNew.push(...result.newMessages);
      } catch (e) {
        this.onError(`syncAll: account ${account.email} failed: ${e.message || e}`);
      }
    }
    return { newMessages: allNew };
  }
}

module.exports = { MailEngine, SEND_WARN_AT, SEND_HARD_STOP_AT };
