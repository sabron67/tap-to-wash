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

function portalHint(req) {
  // Infer the sign-in door from this tab's URL, not a browser-wide cookie.
  // Cookies are shared between tabs; a shared hint can be overwritten by another login.
  const path = String(req.cleanUrl || req.url || req.originalUrl || '').split('?')[0];
  return path === '/staff' || path.startsWith('/staff/') ? 'staff' : 'admin';
}

const loginUrlFromHint = (req) => PORTALS[portalHint(req)].login;

module.exports = { PORTALS, portalOfRole, loginUrlForRole, portalHint, loginUrlFromHint };
