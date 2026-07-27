// src/main/email/providers/ProviderBase.js
//
// Interface contract every provider (Gmail/Outlook/generic IMAP+SMTP) must
// implement. Not an abstract class with runtime enforcement — a JSDoc
// typedef + throw-if-unimplemented base, matching the codebase's existing
// preference for plain classes over heavier patterns.

/**
 * @typedef {Object} Message
 * @property {string} fromAddr
 * @property {string} toAddr
 * @property {string} subject
 * @property {string} bodyText
 * @property {string} snippet
 * @property {string} messageId
 * @property {string} inReplyTo
 * @property {number} uid
 * @property {string} at  ISO timestamp
 */

class ProviderBase {
  /** @param {object} account - the email_accounts row this provider instance is bound to */
  constructor(account) {
    this.account = account;
  }

  /** @returns {Promise<{ok: boolean, error?: string}>} */
  async verify() {
    throw new Error('verify() not implemented');
  }

  /**
   * @param {{to: string, subject: string, body: string, inReplyTo?: string, references?: string, fromName?: string}} mail
   * @returns {Promise<{ok: boolean, messageId?: string, error?: string}>}
   */
  async sendMail(_mail) {
    throw new Error('sendMail() not implemented');
  }

  /**
   * Incremental fetch of new inbound mail since the given UID cursor.
   * @param {number} sinceUid
   * @returns {Promise<Message[]>}
   */
  async fetchNew(_sinceUid) {
    throw new Error('fetchNew() not implemented');
  }
}

module.exports = { ProviderBase };
