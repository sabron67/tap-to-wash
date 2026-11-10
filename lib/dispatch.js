// Automatic rider assignment: when an order is confirmed and nobody is assigned yet, the active rider with the fewest open jobs gets it.
async function autoAssignRider(db, requestId, by = 'system') {
  const cur = await db.query('SELECT rider_admin_id FROM requests WHERE id = $1', [requestId]);
  if (!cur.rows.length || cur.rows[0].rider_admin_id) return null; // not found, or a rider is already assigned
  const pick = await db.query(
    `SELECT a.id, a.name,
            (SELECT COUNT(*) FROM requests r WHERE r.rider_admin_id = a.id AND r.status IN ('confirmed','rider_arrived','picked_up','ready')) AS open_jobs
       FROM admins a WHERE a.role = 'rider' AND a.is_active ORDER BY open_jobs, a.name LIMIT 1`
  );
  if (!pick.rows.length) return null;
  const upd = await db.query(
    "UPDATE requests SET rider_admin_id = $1, dispatch_stage = CASE WHEN dispatch_stage = 'unassigned' THEN 'scheduled' ELSE dispatch_stage END, updated_at = now() WHERE id = $2 AND rider_admin_id IS NULL RETURNING id",
    [pick.rows[0].id, requestId]
  );
  if (!upd.rows.length) return null;
  await db.query('INSERT INTO request_events (request_id, status, note, created_by) SELECT id, status, $2, $3 FROM requests WHERE id = $1', [requestId, `Rider assigned: ${pick.rows[0].name}.`, by]);
  return pick.rows[0];
}

module.exports = { autoAssignRider };
