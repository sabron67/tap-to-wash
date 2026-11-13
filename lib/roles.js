// Staff roles and what each one may do. The owner can do everything.
// 'inventory' (stock, supply costs and profit) is deliberately given to the owner and manager only.
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
    desc: 'Runs daily work: dashboard, requests, billing, categories, customers, operations, inventory and profit, reports and the activity log. No staff accounts or settings.',
    perms: ['dashboard', 'requests', 'status', 'billing', 'notes', 'categories', 'customers', 'reports', 'activity', 'dispatch', 'accounts', 'operations', 'weigh', 'collect', 'billadmin', 'qcoverride', 'inventory'],
    visible: ALL_STATUSES,
    settable: ALL_STATUSES,
  },
  cashier: {
    label: 'Cashier',
    desc: 'Sees requests and customers, records prices and payments, and can reconcile cash. Cannot change delivery status.',
    perms: ['requests', 'billing', 'notes', 'customers', 'collect'],
    visible: ALL_STATUSES,
    settable: [],
  },
  rider: {
    label: 'Rider',
    desc: 'Sees only jobs to collect or deliver (confirmed, rider arrived, picked up, ready). Marks Rider arrived on reaching the customer, weighs or counts the laundry at the doorstep, sees the amount due once the customer confirms the bill, records the payment, and marks jobs picked up or delivered. Never sees prices or rates.',
    perms: ['requests', 'status', 'notes', 'weigh', 'collect'],
    visible: ['confirmed', 'rider_arrived', 'picked_up', 'ready'],
    settable: ['rider_arrived', 'picked_up', 'delivered'],
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
// A rider sees only jobs assigned to them, plus jobs nobody has been assigned to yet (so new jobs can still be picked up).
const riderSql = (admin, col = 'r.rider_admin_id') => {
  if (!admin || admin.role !== 'rider') return '';
  const id = Number(admin.id);
  return Number.isInteger(id) ? ` AND (${col} IS NULL OR ${col} = ${id})` : ' AND FALSE';
};
const riderMayView = (admin, row) => {
  if (!admin || admin.role !== 'rider') return true;
  if (!row) return false;
  return row.rider_admin_id === null || row.rider_admin_id === undefined || Number(row.rider_admin_id) === Number(admin.id);
};
const isRole = (x) => Object.prototype.hasOwnProperty.call(ROLES, x);

module.exports = { ROLES, roleOf, can, visibleStatuses, settableStatuses, isRole, riderSql, riderMayView };
