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
  // Use this tab's URL rather than a browser-wide cookie. A shared cookie can be
  // overwritten by another tab's login and send an expired session to the wrong door.
  // cleanUrl is the path after the private slot prefix has been removed.
  const path = String(req.cleanUrl || req.url || req.originalUrl || '').split('?')[0];
  if (path === '/staff' || path.startsWith('/staff/')) return 'staff';
  return 'admin';
}

const loginUrlFromHint = (req) => PORTALS[portalHint(req)].login;

module.exports = { PORTALS, portalOfRole, loginUrlForRole, portalHint, loginUrlFromHint };
