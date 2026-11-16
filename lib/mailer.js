// Email (SMTP) sender: the fallback when WhatsApp is down, banned or not linked.
//   SMTP_HOST     your mail server, e.g. smtp.gmail.com  (email stays switched off while this is empty)
//   SMTP_PORT     587 (default, STARTTLS) or 465 (TLS from the start)
//   SMTP_SECURE   true for port 465; leave empty otherwise (it is also switched on automatically for port 465)
//   SMTP_USER     the mailbox login
//   SMTP_PASS     its password (for Gmail: an App Password, not your normal password)
//   SMTP_FROM     the sender shown to people, e.g. "Tap to Wash <you@example.com>" (defaults to SMTP_USER)
// send(to, subject, text, html?) never throws; text is the plain version, html is optional; it returns { ok, error }.
let nodemailer = null;
try {
  nodemailer = require('nodemailer');
} catch (e) {
  /* not installed: email stays off */
}

const cfg = () => {
  const e = process.env;
  const port = Number(e.SMTP_PORT) || 587;
  return {
    host: String(e.SMTP_HOST || '').trim(),
    port,
    secure: /^(1|true|yes)$/i.test(String(e.SMTP_SECURE || '')) || port === 465,
    user: String(e.SMTP_USER || '').trim(),
    pass: String(e.SMTP_PASS || ''),
    from: String(e.SMTP_FROM || e.SMTP_USER || '').trim(),
  };
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const validEmail = (v) => EMAIL_RE.test(String(v || '').trim());

const enabled = () => {
  const c = cfg();
  return !!(nodemailer && c.host && c.from && (!c.user || c.pass));
};

let transport = null;
let transportKey = '';
function getTransport() {
  const c = cfg();
  const key = JSON.stringify(c);
  if (transport && key === transportKey) return transport;
  if (transport) transport.close();
  transportKey = key;
  transport = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    ...(c.user ? { auth: { user: c.user, pass: c.pass } } : {}),
    pool: true,
    maxConnections: 2,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
  return transport;
}

async function send(to, subject, text, htmlBody = '') {
  if (!enabled()) return { ok: false, error: 'Email is not set up' };
  if (!validEmail(to)) return { ok: false, error: 'Invalid email address' };
  try {
    await getTransport().sendMail({ from: cfg().from, to: String(to).trim(), subject: String(subject).slice(0, 200), text: String(text).slice(0, 20000), ...(htmlBody ? { html: String(htmlBody).slice(0, 100000) } : {}) });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err).split('\n')[0] };
  }
}

// Closes the connection pool (called when the server shuts down).
function close() {
  if (transport) {
    transport.close();
    transport = null;
  }
}

module.exports = { enabled, validEmail, send, close };
