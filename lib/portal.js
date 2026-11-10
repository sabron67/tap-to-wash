// Two sign-in doors into the same workspace:
//   /admin/login  -> the owner only
//   /staff        -> every other role (manager, cashier, rider, attendant)
// Both check the same accounts table; the door only decides who may come in through it.
const { isRole } = require('./roles');

const PORTALS = {
  admin: { login: '/admin/login', title: 'Owner sign in', allows: (role) => role === 'owner' },
  staff: { login: '/staff', title: 'Staff sign in', allows: (role) => role !== 'owner' && isRole(role) },
};

const portalOfRole = (role) => (role === 'owner' ? 'admin' : 'staff');
const loginUrlForRole = (role) => PORTALS[portalOfRole(role)].login;

// A small, non-secret cookie remembers which door a person last used, so an expired session
// sends them back to the right sign-in page. It grants nothing; the server still checks the role.
const COOKIE = 'ttw_portal';

function portalHint(req) {
  const m = String(req.headers.cookie || '').match(/(?:^|;\s*)ttw_portal=(admin|staff)(?:;|$)/);
  return m ? m[1] : 'admin';
}

function rememberPortal(res, portal) {
  res.cookie(COOKIE, portal, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 365, path: '/' });
}

const loginUrlFromHint = (req) => PORTALS[portalHint(req)].login;

module.exports = { PORTALS, portalOfRole, loginUrlForRole, portalHint, rememberPortal, loginUrlFromHint };
