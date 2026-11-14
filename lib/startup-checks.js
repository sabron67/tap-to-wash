// Refuses to start a production server with placeholder or weak secrets, and returns a safe random session secret for development.
const crypto = require('crypto');

const PLACEHOLDER = /^(change|changeme|put-|your-|example|secret|password|dev-only|xxx)/i;
const weak = (v, min) => !v || String(v).length < min || PLACEHOLDER.test(String(v).trim());

function runStartupChecks(env = process.env) {
  const prod = env.NODE_ENV === 'production';
  const problems = [];
  const warnings = [];
  if (weak(env.SESSION_SECRET, 32)) (prod ? problems : warnings).push('SESSION_SECRET is missing, too short (< 32 characters) or still a placeholder. Generate one: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  if (env.MPESA_CONSUMER_KEY && weak(env.MPESA_CALLBACK_SECRET, 24)) (prod ? problems : warnings).push('MPESA_CALLBACK_SECRET is missing, shorter than 24 characters or a placeholder. Anyone could fake payment confirmations.');
  if (prod && /your-laundry-site|localhost/i.test(env.APP_URL || '')) warnings.push('APP_URL is still a placeholder; set your real https:// address.');
  if (prod && /^(change|changeme)/i.test(env.ADMIN_PASSWORD || '')) warnings.push('ADMIN_PASSWORD in the environment is a default value; remove it from the environment after the first admin exists.');
  if (prod && env.MPESA_CONSUMER_KEY && !String(env.MPESA_CALLBACK_IPS || '').trim()) warnings.push('MPESA_CALLBACK_IPS is empty: callbacks are accepted from any address that knows the secret.');
  for (const w of warnings) console.warn('[security warning]', w);
  if (problems.length) {
    for (const p of problems) console.error('[security error]', p);
    console.error('Refusing to start in production with unsafe settings.');
    process.exit(1);
  }
  // Development with no usable secret: random per run, never a published default.
  if (weak(env.SESSION_SECRET, 32)) env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
}
module.exports = { runStartupChecks };
