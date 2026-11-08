// WhatsApp support. Three ways to send, all behind the same send() function:
//   web   (default) - Baileys (unofficial, no browser): the server signs in as a linked device (scan one QR code in
//                      Admin > WhatsApp; the login is kept in PostgreSQL) and sends staff alerts and password-reset codes by itself.
//                      Turn it off with WHATSAPP_WEB=0.
//   meta            - when WHATSAPP_TOKEN and WHATSAPP_PHONE_ID are set, Meta's WhatsApp Cloud API is used when the
//                      web session is not linked.
//   link            - always available: builds https://wa.me/<number>?text=... links a person taps and sends by hand.
const { usePgAuthState, clearAuth } = require('./wa-auth');
const DEFAULT_CC = String(process.env.WHATSAPP_DEFAULT_CC || '254').replace(/\D/g, '');

const digits = (s) => String(s || '').replace(/\D/g, '');

// 0712 345 678 / +254 712 345 678 / 712345678  ->  254712345678
function toIntl(phone) {
  let d = digits(phone);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = DEFAULT_CC + d.slice(1);
  else if (d.length === 9) d = DEFAULT_CC + d;
  return d;
}

const validWaNumber = (phone) => {
  const d = toIntl(phone);
  return d.length >= 11 && d.length <= 15;
};

const waLink = (phone, text) => `https://wa.me/${toIntl(phone)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

const metaConfigured = () => !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);
const webEnabled = () => process.env.WHATSAPP_WEB !== '0';
const mode = () => (webEnabled() ? 'web' : metaConfigured() ? 'meta' : 'link');

// Sends one WhatsApp message through Meta's Cloud API. Never throws; returns { ok, error }.
// Note: WhatsApp only delivers free text inside 24 hours of the person last messaging the business number.
// For anything outside that window set WHATSAPP_TEMPLATE to an approved template with one body variable.
async function sendMeta(phone, text) {
  if (!metaConfigured()) return { ok: false, error: 'Meta WhatsApp is not configured' };
  const to = toIntl(phone);
  const payload = process.env.WHATSAPP_TEMPLATE
    ? {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: process.env.WHATSAPP_TEMPLATE,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'en' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: String(text).replace(/\s+/g, ' ').slice(0, 900) }] }],
        },
      }
    : { messaging_product: 'whatsapp', to, type: 'text', text: { body: String(text).slice(0, 3800) } };
  try {
    const res = await fetch(`https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || 'v21.0'}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, error: `Meta API ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}


// ---------------------------------------------------------------------------------------------------------------
// Baileys session (talks to WhatsApp directly - no browser needed)
// ---------------------------------------------------------------------------------------------------------------
// state: off | starting | qr | ready | disconnected | error
const web = { sock: null, state: 'off', qr: '', error: '', number: '', timer: null, manualStop: false, starting: false, queue: Promise.resolve() };

const setState = (state, extra = {}) => {
  web.state = state;
  if (state !== 'qr') web.qr = '';
  web.error = extra.error || (state === 'error' || state === 'disconnected' ? web.error : '');
  if (extra.number !== undefined) web.number = extra.number;
};

async function start() {
  if (!webEnabled() || web.sock || web.starting) return;
  web.starting = true;
  let baileys, QRCode, pino;
  try {
    baileys = require('@whiskeysockets/baileys');
    pino = require('pino');
  } catch (err) {
    web.starting = false;
    return setState('error', { error: 'The WhatsApp package is not installed. Run: npm install' });
  }
  try {
    QRCode = require('qrcode');
  } catch (err) {
    QRCode = null;
  }
  const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = baileys;
  web.manualStop = false;
  clearTimeout(web.timer);
  if (web.state !== 'qr') setState('starting');
  try {
    const logger = pino({ level: process.env.WHATSAPP_LOG || 'silent' });
    const { state, saveCreds } = await usePgAuthState(); // the login lives in PostgreSQL (table wa_auth)
    const { version } = await fetchLatestBaileysVersion().catch(() => ({}));
    const sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      logger,
      browser: ['Tap to Wash', 'Chrome', '1.0.0'],
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    web.sock = sock;

    sock.ev.on('creds.update', () => saveCreds().catch((e) => console.error('WhatsApp login could not be saved:', e.message)));
    sock.ev.on('connection.update', async (u) => {
      if (web.sock !== sock) return; // an older connection
      const { connection, lastDisconnect, qr } = u;
      if (qr) {
        web.state = 'qr';
        web.error = '';
        try {
          web.qr = QRCode ? await QRCode.toDataURL(qr, { margin: 1, width: 280 }) : '';
        } catch (e) {
          web.qr = '';
        }
      }
      if (connection === 'open') {
        const num = sock.user && sock.user.id ? String(sock.user.id).split('@')[0].split(':')[0] : '';
        setState('ready', { number: num });
        console.log(`WhatsApp is ready${num ? ` as +${num}` : ''}`);
      }
      if (connection === 'close') {
        web.sock = null;
        const code = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output ? lastDisconnect.error.output.statusCode : 0;
        if (code === DisconnectReason.loggedOut) {
          // unlinked from the phone: forget the login and show a fresh QR code
          await clearAuth().catch(() => {});
          setState('off');
          if (!web.manualStop) web.timer = setTimeout(start, 1000);
        } else if (!web.manualStop) {
          if (code !== DisconnectReason.restartRequired) {
            web.error = `Connection closed${code ? ` (${code})` : ''}. Reconnecting…`;
            setState('disconnected');
          }
          web.timer = setTimeout(start, code === DisconnectReason.restartRequired ? 300 : 5000);
        }
      }
    });
  } catch (err) {
    console.error('WhatsApp could not start:', err.message);
    web.sock = null;
    web.error = err.message.split('\n')[0];
    setState('error');
    if (!web.manualStop) web.timer = setTimeout(start, 30000);
  } finally {
    web.starting = false;
  }
}

function teardown() {
  clearTimeout(web.timer);
  const s = web.sock;
  web.sock = null;
  if (s) {
    try {
      s.end(undefined);
    } catch (e) {
      /* already closed */
    }
  }
}

async function restart() {
  web.manualStop = true;
  teardown();
  web.error = '';
  setState('off');
  web.manualStop = false;
  return start();
}

// Unlinks this server from the WhatsApp account (the phone then shows it as logged out).
async function logout() {
  web.manualStop = true;
  const s = web.sock;
  try {
    if (s && web.state === 'ready') await s.logout();
  } catch (e) {
    /* ignore */
  }
  teardown();
  await clearAuth().catch(() => {});
  setState('off');
  web.manualStop = false;
  return start();
}

const status = () => ({ enabled: webEnabled(), state: web.state, qr: web.qr, error: web.error, number: web.number, meta: metaConfigured() });

// True when send() can deliver right now (WhatsApp linked, or Meta configured).
const canSend = () => (webEnabled() && web.state === 'ready') || metaConfigured();

async function sendWeb(phone, text) {
  if (!web.sock || web.state !== 'ready') return { ok: false, error: 'WhatsApp is not linked yet' };
  const num = toIntl(phone);
  try {
    let jid = `${num}@s.whatsapp.net`;
    try {
      const found = await web.sock.onWhatsApp(num);
      if (found && found[0]) {
        if (!found[0].exists) return { ok: false, error: 'That number is not on WhatsApp' };
        jid = found[0].jid || jid;
      }
    } catch (e) {
      /* lookup failed - try the plain address */
    }
    await Promise.race([web.sock.sendMessage(jid, { text: String(text).slice(0, 3800) }), new Promise((_, rej) => setTimeout(() => rej(new Error('Timed out')), 25000))]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Sends one WhatsApp message. Never throws; returns { ok, error }. Messages go out one at a time, a moment apart.
function send(phone, text) {
  const job = web.queue.then(async () => {
    if (!validWaNumber(phone)) return { ok: false, error: 'Invalid number' };
    let res = { ok: false, error: 'No automatic WhatsApp sender is available' };
    if (webEnabled() && web.state === 'ready') {
      res = await sendWeb(phone, text);
      await new Promise((r) => setTimeout(r, 1200));
    }
    if (!res.ok && metaConfigured()) res = await sendMeta(phone, text);
    return res;
  });
  web.queue = job.catch(() => {});
  return job;
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, () => {
    web.manualStop = true;
    teardown();
    process.exit(0);
  });
}

module.exports = { toIntl, validWaNumber, waLink, mode, sendMeta, start, restart, logout, status, canSend, send };
