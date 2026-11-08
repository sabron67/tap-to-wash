// Staff roles and what each one may do. The owner can do everything.
const ALL_STATUSES = null; // null = no restriction

const ROLES = {
  owner: {
    label: 'Owner',
    desc: 'Everything, including staff accounts, settings, photos, terms and deleting requests.',
    perms: '*',
    visible: ALL_STATUSES,
    settable: ALL_STATUSES,
  },
  manager: {
    label: 'Manager',
    desc: 'Runs daily work: dashboard, all requests, billing, categories, customers, customer accounts, reports and the activity log. No staff accounts or settings.',
    perms: ['dashboard', 'requests', 'status', 'billing', 'notes', 'categories', 'customers', 'reports', 'activity', 'dispatch', 'accounts'],
    visible: ALL_STATUSES,
    settable: ALL_STATUSES,
  },
  cashier: {
    label: 'Cashier',
    desc: 'Sees requests and customers and records prices and payments. Cannot change delivery status.',
    perms: ['requests', 'billing', 'notes', 'customers'],
    visible: ALL_STATUSES,
    settable: [],
  },
  rider: {
    label: 'Rider',
    desc: 'Sees only jobs to collect or deliver (confirmed, picked up, ready) and can mark them picked up or delivered. No prices or payments.',
    perms: ['requests', 'status', 'notes'],
    visible: ['confirmed', 'picked_up', 'ready'],
    settable: ['picked_up', 'delivered'],
  },
  attendant: {
    label: 'Laundry attendant',
    desc: 'Sees items being processed (picked up, washing, ready) and can mark them washing or ready. No prices or payments.',
    perms: ['requests', 'status', 'notes'],
    visible: ['picked_up', 'washing', 'ready'],
    settable: ['washing', 'ready'],
  },
};

const roleOf = (role) => ROLES[role] || { label: 'No access', desc: '', perms: [], visible: [], settable: [] };
const can = (role, perm) => {
  const r = roleOf(role);
  return r.perms === '*' || r.perms.includes(perm);
};
const visibleStatuses = (role) => roleOf(role).visible; // null = all
const settableStatuses = (role) => {
  const r = roleOf(role);
  return can(role, 'status') ? r.settable : [];
};
const isRole = (x) => Object.prototype.hasOwnProperty.call(ROLES, x);

module.exports = { ROLES, roleOf, can, visibleStatuses, settableStatuses, isRole };
