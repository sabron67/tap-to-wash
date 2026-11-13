// Slows down guessing of tracking links. A reference code plus phone number is the only proof for a tracking link, so
// repeated wrong phone numbers against ONE reference code (from any number of different IP addresses) are refused for a while.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 8;
const MAX_TRACKED = 5000;
const fails = new Map(); // ref -> { n, first }

function blocked(ref) {
  const e = fails.get(ref);
  if (!e) return false;
  if (Date.now() - e.first > WINDOW_MS) { fails.delete(ref); return false; }
  return e.n >= MAX_FAILS;
}

// Returns true when the lookup must be REFUSED: the code is temporarily blocked, or the phone key does not match.
function bad(ref, storedKey, givenKey) {
  const key = String(ref || '');
  if (blocked(key)) return true;
  if (storedKey === givenKey) return false;
  const now = Date.now();
  const e = fails.get(key);
  if (!e || now - e.first > WINDOW_MS) {
    if (fails.size > MAX_TRACKED) fails.clear();
    fails.set(key, { n: 1, first: now });
  } else {
    e.n += 1;
  }
  return true;
}

module.exports = { bad, blocked };
