// Safaricom calls this address after the customer answers the M-Pesa prompt. It is mounted in server.js before the
// session middleware (Safaricom has no cookies) and is protected by the secret in the address (MPESA_CALLBACK_SECRET).
// The address deliberately avoids the word "mpesa": Safaricom rejects callback addresses that contain it.
const express = require('express');
const { safeEqual } = require('../lib/security');
const stk = require('../lib/stk');

const router = express.Router();

router.post('/callback/:secret', async (req, res) => {
  const expected = stk.config().callbackSecret;
  // Always answer Safaricom with 200 and its expected shape; only a correct secret is acted on.
  const ok = { ResultCode: 0, ResultDesc: 'Accepted' };
  if (!expected || !safeEqual(req.params.secret, expected)) return res.status(404).end();
  try {
    await stk.handleCallback(req.body);
  } catch (err) {
    console.error('STK callback failed:', err.message);
    return res.status(500).json({ ResultCode: 1, ResultDesc: 'Try again' }); // Safaricom retries a failed callback
  }
  res.json(ok);
});

module.exports = router;
