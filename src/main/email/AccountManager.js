// src/main/email/AccountManager.js
//
// CRUD for email_accounts rows, credential encryption via credentialStore,
// and provider instantiation/caching per account. Owns the migration path
// from the old single-account smtp-credentials.json into the new
// multi-account table.

const fs = require('fs');
const { encryptSecret, decryptSecret } = require('./credentialStore');
const { GmailProvider } = require('./providers/GmailProvider');
const { OutlookProvider } = require('./providers/OutlookProvider');
const { ImapSmtpProvider } = require('./providers/ImapSmtpProvider');

function providerClassFor(providerName) {
  if (providerName === 'gmail') return GmailProvider;
  if (providerName === 'outlook') return OutlookProvider;
  return ImapSmtpProvider;
}

class AccountManager {
  /**
   * @param {object} opts
   * @param {import('../database').Database} opts.db
   * @param {(message: string) => void} [opts.onError]
   */
  constructor({ db, onError } = {}) {
    this.db = db;
    this.onError = onError || (() => {});
    this._providerCache = new Map(); // accountId -> provider instance
  }

  listAccounts() {
    if (!this.db) return [];
    // Never expose the encrypted credential blob to callers (IPC/renderer) —
    // only account metadata + status.
    return this.db.getAccounts().map(({ credentialsEncrypted, ...rest }) => rest);
  }

  getAccountRaw(id) {
    return this.db ? this.db.getAccount(id) : null;
  }

  /**
   * @param {object} config - { provider, authType, email, appPassword?,
   *   refreshToken?, clientId?, clientSecret?, tenantId?, displayName?,
   *   imapHost?, imapPort?, smtpHost?, smtpPort? }
   */
  addAccount(config) {
    if (!this.db) return { ok: false, error: 'Database not ready' };
    if (!config.email) return { ok: false, error: 'Email address is required' };

    let secretPayload;
    if (config.authType === 'oauth') {
      secretPayload = JSON.stringify({
        refreshToken: config.refreshToken, clientId: config.clientId,
        clientSecret: config.clientSecret, tenantId: config.tenantId,
      });
    } else {
      secretPayload = JSON.stringify({ appPassword: config.appPassword });
    }

    const result = this.db.addAccount({
      email: config.email,
      provider: config.provider || 'imap',
      authType: config.authType || 'app_password',
      displayName: config.displayName || config.email,
      signature: config.signature || '',
      imapHost: config.imapHost || null,
      imapPort: config.imapPort || null,
      smtpHost: config.smtpHost || null,
      smtpPort: config.smtpPort || null,
      credentialsEncrypted: encryptSecret(secretPayload),
      status: 'unverified',
    });
    return result;
  }

  removeAccount(id) {
    if (!this.db) return { ok: false, error: 'Database not ready' };
    this._providerCache.delete(id);
    return this.db.removeAccount(id);
  }

  /** Returns decrypted credentials object for an account, or null. */
  _decryptCreds(account) {
    const raw = decryptSecret(account.credentialsEncrypted);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /** @returns {import('./providers/ProviderBase').ProviderBase | null} */
  getProvider(accountId) {
    if (this._providerCache.has(accountId)) return this._providerCache.get(accountId);
    const account = this.getAccountRaw(accountId);
    if (!account) return null;
    const creds = this._decryptCreds(account);
    if (!creds) {
      this.onError(`Could not decrypt credentials for account ${account.email}`);
      return null;
    }
    const ProviderClass = providerClassFor(account.provider);
    const provider = new ProviderClass(account, creds);
    this._providerCache.set(accountId, provider);
    return provider;
  }

  async verifyAccount(id) {
    const provider = this.getProvider(id);
    if (!provider) return { ok: false, error: 'Account not found or credentials unreadable' };
    const result = await provider.verify();
    this.db.updateAccount(id, {
      status: result.ok ? 'ok' : 'error',
      lastError: result.ok ? '' : (result.error || 'Verification failed'),
    });
    return result;
  }

  // --- Migration: import the legacy single-account smtp-credentials.json
  // as one email_accounts row, on first run only. Old file is left in
  // place (not deleted) in case of rollback, per the plan's migration note.
  migrateLegacyCredentialsIfNeeded(credentialsPath) {
    if (!this.db) return { migrated: false };
    try {
      if (this.db.getAccounts().length > 0) return { migrated: false, reason: 'accounts already exist' };
      if (!fs.existsSync(credentialsPath)) return { migrated: false, reason: 'no legacy file' };

      const parsed = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
      let appPassword = parsed.appPassword;
      if (parsed.encrypted) {
        // Legacy file used electron safeStorage directly (base64 blob) —
        // decrypt with the same mechanism credentialStore uses under the hood.
        try {
          // eslint-disable-next-line global-require
          const electron = require('electron');
          if (electron.safeStorage.isEncryptionAvailable()) {
            appPassword = electron.safeStorage.decryptString(Buffer.from(parsed.appPassword, 'base64'));
          } else {
            return { migrated: false, reason: 'legacy credentials encrypted but decryption unavailable on this host' };
          }
        } catch (e) {
          return { migrated: false, reason: `legacy decrypt failed: ${e.message || e}` };
        }
      }
      if (!parsed.email || !appPassword) return { migrated: false, reason: 'legacy file incomplete' };

      const result = this.addAccount({
        provider: 'gmail', authType: 'app_password',
        email: parsed.email, appPassword, displayName: parsed.email,
      });
      return { migrated: !!result.ok, accountId: result.id };
    } catch (e) {
      this.onError(`Legacy credential migration failed: ${e.message || e}`);
      return { migrated: false, reason: String(e.message || e) };
    }
  }
}

module.exports = { AccountManager };
