// src/main/email/credentialStore.js
//
// safeStorage-backed encrypt/decrypt for any secret string (per-account app
// password/refresh token, or an OAuth app's client secret). Replaces the
// single-purpose encryption inlined in appRuntime.js's old
// loadCredentials/saveCredentials for smtp-credentials.json — same
// encrypted-when-available / plaintext-fallback behavior, just reusable.
//
// Electron's `safeStorage` is only available once `app` is ready and only
// inside the main process — this module lazily requires('electron') so it
// can still be `require()`d (e.g. by tests, or a headless sanity check)
// without Electron running, and degrades to a plaintext-with-flag fallback
// if encryption isn't available on the host OS.

function getSafeStorage() {
  try {
    // eslint-disable-next-line global-require
    const electron = require('electron');
    return electron && electron.safeStorage ? electron.safeStorage : null;
  } catch {
    return null;
  }
}

function isEncryptionAvailable() {
  const safeStorage = getSafeStorage();
  try {
    return !!(safeStorage && safeStorage.isEncryptionAvailable());
  } catch {
    return false;
  }
}

/**
 * Encrypts a plaintext secret, returning a JSON string envelope:
 * { encrypted: boolean, value: string } — value is base64 ciphertext when
 * encrypted is true, plaintext otherwise. Returns '' for empty input.
 */
function encryptSecret(plaintext) {
  if (!plaintext) return '';
  const safeStorage = getSafeStorage();
  if (safeStorage && isEncryptionAvailable()) {
    const blob = safeStorage.encryptString(String(plaintext)).toString('base64');
    return JSON.stringify({ encrypted: true, value: blob });
  }
  return JSON.stringify({ encrypted: false, value: String(plaintext) });
}

/**
 * Decrypts an envelope produced by encryptSecret(). Returns '' if the
 * envelope is empty/unparseable, or if it claims encryption but the current
 * host can't decrypt (e.g. moved to a different machine/user).
 */
function decryptSecret(envelope) {
  if (!envelope) return '';
  let parsed;
  try {
    parsed = JSON.parse(envelope);
  } catch {
    // Back-compat: a bare plaintext string stored before this envelope format existed.
    return String(envelope);
  }
  if (!parsed || typeof parsed !== 'object') return '';
  if (!parsed.encrypted) return parsed.value || '';
  const safeStorage = getSafeStorage();
  if (!safeStorage || !isEncryptionAvailable()) return '';
  try {
    return safeStorage.decryptString(Buffer.from(parsed.value, 'base64'));
  } catch {
    return '';
  }
}

module.exports = { encryptSecret, decryptSecret, isEncryptionAvailable };
