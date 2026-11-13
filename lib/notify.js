// Who gets told what. Edit ROUTES to change which roles are alerted for each event.
const { pool } = require('../config/db');
const { payInstructions } = require('./mpesa');
const { STATUS_MAP } = require('./helpers');
const { pushToAdmin } = require('./push');
const wa = require('./whatsapp');
const { getSettings } = require('./settings');

const ROUTES = {
  new: ['owner', 'manager'], // a customer sent a request
  confirmed: ['rider'], // ready to collect
  picked_up: ['attendant'], // laundry arrived for washing
  ready: ['rider'], // washed - deliver it
  delivered_unpaid: ['cashier'], // delivered but a balance is still due
  bill_confirmed: ['rider'], // customer agreed the bill - collect payment
  no_rider: ['owner', 'manager'], // a request was confirmed automatically but there is no active rider to assign
  paid: ['rider'], // the bill is fully paid - the assigned rider can take the laundry
  bill_disputed: ['manager'], // customer queried the bill
  bill_needs_price: ['manager'], // weighed, but a service has no price
};

// Which event does this request's current state represent? (null = nobody to alert)
function eventFor(status, total, paid) {
  if (status === 'delivered') return Number(total) > Number(paid) ? 'delivered_unpaid' : null;
  return ROUTES[status] ? status : null;
}

const HEADLINES = {
  new: 'New request',
  confirmed: 'Ready to collect',
  picked_up: 'Laundry picked up',
  ready: 'Ready to deliver',
  delivered_unpaid: 'Delivered - payment due',
  bill_confirmed: 'Bill confirmed - collect payment',
  no_rider: 'Confirmed - no rider available, please assign one',
  paid: 'Payment received - take the laundry',
  bill_disputed: 'Customer queried the bill',
  bill_needs_price: 'Price needed for a weighed order',
};

async function loadRequest(id) {
  const { rows } = await pool.query(
    `SELECT r.id, r.ref_code, r.status, r.rider_admin_id, r.location_description, r.latitude, r.longitude, r.preferred_time, r.total_amount, r.amount_paid,
            c.name AS customer_name, c.phone AS customer_phone,
            (SELECT string_agg(i.category_name || ' x' || i.quantity, ', ' ORDER BY i.id) FROM request_items i WHERE i.request_id = r.id) AS items
       FROM requests r JOIN customers c ON c.id = r.customer_id WHERE r.id = $1`,
    [id]
  );
  return rows[0] || null;
}

function teamMessage(event, r, business) {
  const lines = [`${business}: ${HEADLINES[event]} - ${r.ref_code}`, `Customer: ${r.customer_name} (${r.customer_phone})`, `Items: ${r.items || '-'}`, `Where: ${r.location_description}`];
  if (r.latitude !== null && r.latitude !== undefined) lines.push(`Map: https://www.google.com/maps?q=${r.latitude},${r.longitude}`);
  if (event === 'paid') {
    lines.push(`Paid: ${Number(r.amount_paid)} of ${Number(r.total_amount)}`);
    lines.push('The customer has paid in full. Collect the laundry and take it for washing.');
  }
  if (event === 'delivered_unpaid') lines.push(`Balance due: ${Math.max(0, Number(r.total_amount) - Number(r.amount_paid))}`);
  if (r.preferred_time && (event === 'new' || event === 'confirmed')) lines.push(`Preferred time: ${r.preferred_time}`);
  return lines.join('\n');
}

// Text a staff member can send to the customer for the request's current status.
function customerMessage(r, business, link = '', settings = null) {
  const hi = `Hello ${String(r.customer_name).split(' ')[0]}, this is ${business}.`;
  const ref = `Request ${r.ref_code}`;
  switch (r.status) {
    case 'new':
      return `${hi} We received your laundry request (${ref}). We will confirm your pick-up shortly.`;
    case 'confirmed': {
      // The amount is only put in the message once the customer has confirmed the bill (riders can open this link too).
      if (r.bill_status === 'awaiting_confirm' && link) return `${hi} We have weighed your clothes (${ref}). Please review and confirm your bill here: ${link}`;
      const due = Math.max(0, Number(r.total_amount) - Number(r.amount_paid));
      if (r.bill_status === 'confirmed' && due > 0 && !r.pay_later) {
        const how = payInstructions(settings, { ref: r.ref_code });
        return `${hi} Your bill for ${ref} is confirmed. Amount due: ${due}. ${how ? `Pay by cash, or by M-Pesa (${how.summary}).` : 'You can pay by cash or M-Pesa.'}`;
      }
      return `${hi} ${ref} is confirmed. Our rider will collect from: ${r.location_description}.`;
    }
    case 'rider_arrived':
      return `${hi} Our rider has arrived for ${ref}. Please confirm the bill and pay so we can take your laundry.`;
    case 'picked_up':
      return `${hi} We have picked up your laundry (${ref}) and are taking it for washing.`;
    case 'washing':
      return `${hi} Your laundry (${ref}) is being washed now.`;
    case 'ready':
      return `${hi} Your laundry (${ref}) is clean and ready. Our rider will deliver it - is now a good time?`;
    case 'delivered': {
      const due = Math.max(0, Number(r.total_amount) - Number(r.amount_paid));
      return due > 0 ? `${hi} Your laundry (${ref}) has been delivered. Balance due: ${due}. Thank you!` : `${hi} Your laundry (${ref}) has been delivered. Thank you for choosing us!`;
    }
    default:
      return `${hi} About your laundry ${ref}:`;
  }
}

async function recipientsFor(event) {
  const roles = ROUTES[event] || [];
  if (!roles.length) return [];
  const { rows } = await pool.query(
    `SELECT id, name, role, phone, notify_inapp, notify_push, notify_whatsapp FROM admins WHERE is_active AND role = ANY($1::text[]) ORDER BY name`,
    [roles]
  );
  return rows;
}

// Create the alerts for one event. Never throws: a notification problem must not break the request itself.
async function notifyEvent(event, requestId, actorId = null, business = 'Tap to Wash') {
  try {
    if (!ROUTES[event]) return;
    // "Payment received - take the laundry" only applies when customers pay before cleaning. With pay-on-delivery off-switch the rider is not alerted.
    if (event === 'paid' && (await getSettings()).pay_before_cleaning === '0') return;
    const r = await loadRequest(requestId);
    if (!r) return;
    const title = `${HEADLINES[event]} · ${r.ref_code}`;
    const body = `${r.customer_name} · ${r.items || 'no items'} · ${r.location_description}`.slice(0, 240);
    const url = `/admin/requests/${r.id}`;
    let people = (await recipientsFor(event)).filter((p) => p.id !== actorId);
    // A confirmed or paid order is announced to the rider it was assigned to, not to every rider.
    if ((event === 'confirmed' || event === 'paid') && r.rider_admin_id) people = people.filter((p) => p.id === r.rider_admin_id);
    await Promise.all(
      people.map(async (p) => {
        if (p.notify_inapp) {
          await pool.query('INSERT INTO notifications (admin_id, request_id, kind, title, body) VALUES ($1,$2,$3,$4,$5)', [p.id, r.id, event, title, body]);
        }
        if (p.notify_push) await pushToAdmin(p.id, { title, body, url: p.role === 'owner' ? url : `/s_staff${url}`, tag: `req-${r.id}` }).catch(() => {});
        if (p.notify_whatsapp && p.phone && wa.canSend()) await wa.send(p.phone, teamMessage(event, r, business)).catch(() => {});
      })
    );
  } catch (err) {
    console.error('notifyEvent failed:', err.message);
  }
}

module.exports = { ROUTES, HEADLINES, eventFor, notifyEvent, recipientsFor, loadRequest, teamMessage, customerMessage };
