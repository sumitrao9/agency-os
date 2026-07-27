// src/email/mailer.js
//
// Real nodemailer wiring, Gmail-ready. Credentials (email + Gmail App
// Password — not the regular account password, Gmail requires an App
// Password for SMTP) are entered in the app's own Settings screen and
// stored locally; they are never sent anywhere except directly to Gmail's
// SMTP server from this process.
//
// Kept swappable: createTransport() is the only function that knows about
// nodemailer specifically, so switching providers later (Outlook, a
// transactional API) touches one function, not the whole email flow.

const nodemailer = require('nodemailer');

function createTransport({ email, appPassword }) {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: email, pass: appPassword },
  });
}

async function sendEmail(transport, { to, subject, body, fromName, inReplyTo, references }) {
  if (!to || !body || (!subject && !inReplyTo)) {
    throw new Error('to and body are required, and subject unless replying in-thread');
  }
  const mail = {
    from: fromName ? `"${fromName}" <${transport.options.auth.user}>` : transport.options.auth.user,
    to,
    subject,
    text: body,
  };
  // Threading: when replying to a prior send, Gmail (and every major
  // client) groups messages into one conversation based on these headers
  // plus a matching subject — this is what makes a follow-up land as a
  // reply in the same thread rather than a brand-new cold email, which
  // measurably outperforms a fresh subject line per every outreach source.
  if (inReplyTo) {
    mail.inReplyTo = inReplyTo;
    mail.references = references || inReplyTo;
    if (!subject) mail.subject = ''; // caller fills this in from the stored original subject before calling
  }
  const info = await transport.sendMail(mail);
  return { ok: true, messageId: info.messageId };
}

async function verifyCredentials(transport) {
  try {
    await transport.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

module.exports = { createTransport, sendEmail, verifyCredentials };
