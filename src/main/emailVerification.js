// src/main/emailVerification.js
//
// Free-tier email verification: syntax check + does the domain actually
// have mail servers (MX records). Deliberately stops there — a real SMTP
// handshake ("does this specific mailbox exist") is unreliable (most
// providers silently accept-then-bounce to avoid enabling exactly this
// kind of probing) and risks the sending IP's reputation for zero
// reliable signal in return. MX presence is the honest, free ceiling.

const EMAIL_SYNTAX_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

// mxRecords: the .mx array already resolved by deepScan.js's fetchDns()
// for this same domain — no extra DNS lookup needed if it's on hand.
function verifyEmail(email, mxRecords) {
  if (!email) return { status: 'UNKNOWN', reason: 'No email to verify' };
  if (!EMAIL_SYNTAX_RE.test(email)) return { status: 'INVALID', reason: 'Fails basic email syntax' };
  if (!mxRecords || mxRecords.length === 0) return { status: 'INVALID', reason: 'Domain has no mail servers (no MX record) — likely undeliverable' };
  return { status: 'VALID', reason: `Domain has ${mxRecords.length} mail server(s)` };
}

module.exports = { verifyEmail };
