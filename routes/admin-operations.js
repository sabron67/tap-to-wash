const express = require('express');
const QRCode = require('qrcode');
const { pool } = require('../config/db');
const { wrap, cleanText, cleanMultiline } = require('../lib/helpers');
const { audit } = require('../lib/audit');
const { operationsPage } = require('../views/admin/operations');
const { notifyEvent } = require('../lib/notify');
const { getSettings } = require('../lib/settings');
const { receiptPage } = require('../views/admin/receipt');

const num = (v, min=0) => { const n=Number(v); return Number.isFinite(n) && n>=min ? n : null; };
const dateOrNull = (v) => { if(!v) return null; const d=new Date(`${v}:00+03:00`); return Number.isNaN(d.getTime())?null:d; };

module.exports = function mount(router,{buildCtx,flash,need}) {
  router.get('/operations',need('operations'),wrap(async(req,res)=>{
    const [ctx,requests,riders,customers,garments,dispatch,inspections,machines,batches,expenses,inventory,complaints,refunds,loyalty,discounts,subscriptions,branches,reviews,counts]=await Promise.all([
      buildCtx(req),
      pool.query(`SELECT r.id,r.ref_code,c.name AS customer_name FROM requests r JOIN customers c ON c.id=r.customer_id ORDER BY r.created_at DESC LIMIT 250`),
      pool.query(`SELECT id,name,email,phone FROM admins WHERE is_active AND role='rider' ORDER BY name`),
      pool.query(`SELECT id,name,phone FROM customers ORDER BY name LIMIT 500`),
      pool.query(`SELECT li.*,r.ref_code FROM laundry_items li JOIN requests r ON r.id=li.request_id ORDER BY li.created_at DESC LIMIT 100`),
      pool.query(`SELECT r.id,r.ref_code,r.status,r.dispatch_stage,r.pickup_scheduled_at,r.delivery_scheduled_at,c.name AS customer_name,a.name AS rider_name FROM requests r JOIN customers c ON c.id=r.customer_id LEFT JOIN admins a ON a.id=r.rider_admin_id WHERE r.rider_admin_id IS NOT NULL OR r.pickup_scheduled_at IS NOT NULL OR r.delivery_scheduled_at IS NOT NULL ORDER BY r.updated_at DESC LIMIT 100`),
      pool.query(`SELECT qi.*,r.ref_code,a.name AS checked_by_name FROM quality_inspections qi JOIN requests r ON r.id=qi.request_id LEFT JOIN admins a ON a.id=qi.checked_by ORDER BY qi.created_at DESC LIMIT 50`),
      pool.query(`SELECT * FROM laundry_machines ORDER BY name`),
      pool.query(`SELECT b.*,m.name AS machine_name FROM laundry_batches b LEFT JOIN laundry_machines m ON m.id=b.machine_id ORDER BY b.created_at DESC LIMIT 50`),
      pool.query(`SELECT * FROM expenses ORDER BY spent_on DESC,id DESC LIMIT 100`),
      pool.query(`SELECT * FROM inventory_items ORDER BY name`),
      pool.query(`SELECT cc.*,r.ref_code,c.name AS customer_name FROM customer_complaints cc LEFT JOIN requests r ON r.id=cc.request_id LEFT JOIN customers c ON c.id=COALESCE(cc.customer_id,r.customer_id) ORDER BY cc.created_at DESC LIMIT 100`),
      pool.query(`SELECT rf.*,r.ref_code FROM refunds rf JOIN requests r ON r.id=rf.request_id ORDER BY rf.created_at DESC LIMIT 50`),
      pool.query(`SELECT c.name,c.phone,cl.points FROM customer_loyalty cl JOIN customers c ON c.id=cl.customer_id ORDER BY cl.points DESC LIMIT 100`),
      pool.query(`SELECT * FROM discounts ORDER BY created_at DESC LIMIT 100`),
      pool.query(`SELECT s.*,c.name AS customer_name FROM subscriptions s JOIN customers c ON c.id=s.customer_id ORDER BY s.created_at DESC LIMIT 100`),
      pool.query(`SELECT * FROM branches ORDER BY name`),
      pool.query(`SELECT cr.*,r.ref_code,c.name AS customer_name FROM customer_reviews cr JOIN requests r ON r.id=cr.request_id JOIN customers c ON c.id=cr.customer_id ORDER BY cr.created_at DESC LIMIT 100`),
      pool.query(`SELECT (SELECT COUNT(*) FROM laundry_items)::int AS garments,(SELECT COUNT(*) FROM customer_complaints WHERE status IN ('open','investigating'))::int AS open_complaints,(SELECT COALESCE(SUM(amount),0) FROM expenses WHERE date_trunc('month',spent_on::timestamp)=date_trunc('month',CURRENT_DATE::timestamp)) AS month_expenses,(SELECT COUNT(*) FROM inventory_items WHERE quantity<=reorder_level)::int AS low_stock`)
    ]);
    res.view(operationsPage(ctx,{requests:requests.rows,riders:riders.rows,customers:customers.rows,garments:garments.rows,dispatch:dispatch.rows,inspections:inspections.rows,machines:machines.rows,batches:batches.rows,expenses:expenses.rows,inventory:inventory.rows,complaints:complaints.rows,refunds:refunds.rows,loyalty:loyalty.rows,discounts:discounts.rows,subscriptions:subscriptions.rows,branches:branches.rows,reviews:reviews.rows,counts:counts.rows[0]}));
  }));

  router.get('/operations/export.csv',need('operations'),wrap(async(req,res)=>{
    const exports={
      expenses:{name:'expenses',sql:'SELECT spent_on,category,description,amount FROM expenses ORDER BY spent_on DESC',headers:['Date','Category','Description','Amount']},
      inventory:{name:'inventory',sql:'SELECT name,unit,quantity,reorder_level,unit_cost FROM inventory_items ORDER BY name',headers:['Supply','Unit','Quantity','Reorder level','Unit cost']},
      reviews:{name:'reviews',sql:'SELECT r.ref_code,c.name,c.phone,cr.rating,cr.comment,cr.created_at FROM customer_reviews cr JOIN requests r ON r.id=cr.request_id JOIN customers c ON c.id=cr.customer_id ORDER BY cr.created_at DESC',headers:['Order','Customer','Phone','Rating','Comment','Date']},
      complaints:{name:'complaints',sql:'SELECT cc.subject,cc.details,cc.status,cc.resolution,cc.created_at,c.name,c.phone FROM customer_complaints cc LEFT JOIN customers c ON c.id=cc.customer_id ORDER BY cc.created_at DESC',headers:['Subject','Details','Status','Resolution','Date','Customer','Phone']}
    };
    const spec=exports[req.query.type];if(!spec)return res.status(400).send('Choose a valid export type.');
    const result=await pool.query(spec.sql);
    const csvCell=(v)=>{const s=v instanceof Date?v.toISOString():String(v??'');return `"${s.replace(/"/g,'""')}"`;};
    const lines=[spec.headers,...result.rows.map(row=>Object.values(row))].map(row=>row.map(csvCell).join(','));
    await audit(req,'operations_export',spec.name);
    res.type('text/csv; charset=utf-8').set('Content-Disposition',`attachment; filename="taptowash-${spec.name}.csv"`).send('\uFEFF'+lines.join('\r\n'));
  }));

  router.get('/requests/:id/receipt',need('billing'),wrap(async(req,res)=>{
    const id=Number.parseInt(req.params.id,10);if(!Number.isInteger(id))return res.sendStatus(404);
    const [ctx,request,items]=await Promise.all([buildCtx(req),pool.query(`SELECT r.*,c.name AS customer_name,c.phone AS customer_phone FROM requests r JOIN customers c ON c.id=r.customer_id WHERE r.id=$1`,[id]),pool.query('SELECT category_name,quantity FROM request_items WHERE request_id=$1 ORDER BY id',[id])]);
    if(!request.rows.length)return res.sendStatus(404);
    res.view(receiptPage(ctx,{request:request.rows[0],items:items.rows}));
  }));

  router.get('/operations/qr/:id',need('operations'),wrap(async(req,res)=>{
    const id=Number.parseInt(req.params.id,10); if(!Number.isInteger(id)) return res.sendStatus(404);
    const q=await pool.query('SELECT ref_code FROM requests WHERE id=$1',[id]); if(!q.rows.length) return res.sendStatus(404);
    const url=`${req.protocol}://${req.get('host')}/track?ref=${encodeURIComponent(q.rows[0].ref_code)}`;
    const png=await QRCode.toBuffer(url,{type:'png',width:480,margin:2});
    res.type('png').set('Content-Disposition',`inline; filename="${q.rows[0].ref_code}-QR.png"`).send(png);
  }));

  router.post('/operations/garment',need('operations'),wrap(async(req,res)=>{
    const id=Number(req.body.request_id),name=cleanText(req.body.item_name,100),condition=cleanText(req.body.condition_in,80)||'Good';
    if(!Number.isInteger(id)||id<1||!name){flash(req,'error','Choose a valid request and enter the garment name.');return res.redirect('/admin/operations#garments');}
    const exists=await pool.query('SELECT id,ref_code FROM requests WHERE id=$1',[id]); if(!exists.rows.length){flash(req,'error','Request not found.');return res.redirect('/admin/operations#garments');}
    const tag=`${exists.rows[0].ref_code}-${Date.now().toString(36).toUpperCase()}`;
    await pool.query(`INSERT INTO laundry_items(request_id,item_name,tag_code,condition_in,notes) VALUES($1,$2,$3,$4,$5)`,[id,name,tag,condition,cleanMultiline(req.body.notes,500)]);
    await audit(req,'garment_registered',`${tag} on ${exists.rows[0].ref_code}`);flash(req,'success',`Garment registered with tag ${tag}.`);res.redirect('/admin/operations#garments');
  }));

  router.post('/operations/dispatch',need('operations'),wrap(async(req,res)=>{
    const id=Number(req.body.request_id),rider=req.body.rider_admin_id?Number(req.body.rider_admin_id):null;
    if(!Number.isInteger(id)||id<1){flash(req,'error','Select a valid request.');return res.redirect('/admin/operations#dispatch');}
    const stage=cleanText(req.body.dispatch_stage,30);
    if(rider){const rr=await pool.query(`SELECT id FROM admins WHERE id=$1 AND role='rider' AND is_active`,[rider]);if(!rr.rowCount){flash(req,'error','Select an active rider account.');return res.redirect('/admin/operations#dispatch');}}
    if(req.body.branch_id && !Number.isInteger(Number(req.body.branch_id))){flash(req,'error','Select a valid branch.');return res.redirect('/admin/operations#dispatch');}
    const current=await pool.query('SELECT status FROM requests WHERE id=$1',[id]);
    if(!current.rowCount){flash(req,'error','Request not found.');return res.redirect('/admin/operations#dispatch');}
    if(stage==='picked_up'&&!['confirmed','picked_up'].includes(current.rows[0].status)){flash(req,'error','A request must be confirmed before pickup.');return res.redirect('/admin/operations#dispatch');}
    if(['out_for_delivery','delivered'].includes(stage)&&!['ready','delivered'].includes(current.rows[0].status)){flash(req,'error','A request must pass quality control and be ready before delivery.');return res.redirect('/admin/operations#dispatch');}
    await pool.query(`UPDATE requests SET rider_admin_id=$1,pickup_scheduled_at=$2,delivery_scheduled_at=$3,branch_id=$4,dispatch_stage=$5,updated_at=now() WHERE id=$6`,[rider,dateOrNull(req.body.pickup_scheduled_at),dateOrNull(req.body.delivery_scheduled_at),req.body.branch_id?Number(req.body.branch_id):null,stage,id]);
    if(['picked_up','delivered'].includes(stage)&&current.rows[0].status!==stage){
      const upd=await pool.query('UPDATE requests SET status=$1,updated_at=now() WHERE id=$2 RETURNING id',[stage,id]);
      if(upd.rowCount){await pool.query(`INSERT INTO request_events(request_id,status,note,created_by) VALUES($1,$2,$3,$4)`,[id,stage,'Updated from dispatch management',req.session.admin.name]);notifyEvent(stage,id,req.session.admin.id,(await getSettings()).business_name);}
    }
    await audit(req,'dispatch_updated',`Dispatch updated for request #${id}`);flash(req,'success','Dispatch details saved.');res.redirect('/admin/operations#dispatch');
  }));

  router.post('/operations/quality',need('operations'),wrap(async(req,res)=>{
    const id=Number(req.body.request_id);if(!Number.isInteger(id)||id<1){flash(req,'error','Select a request.');return res.redirect('/admin/operations#quality');}
    const checks=[!!req.body.stain_check,!!req.body.count_check,!!req.body.damage_check,!!req.body.packaging_check];
    if(req.body.passed==='1'&&!checks.every(Boolean)){flash(req,'error','A passed inspection requires all four checks to be completed.');return res.redirect('/admin/operations#quality');}
    await pool.query(`INSERT INTO quality_inspections(request_id,checked_by,stain_check,count_check,damage_check,packaging_check,passed,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,req.session.admin.id,...checks,req.body.passed==='1',cleanMultiline(req.body.notes,1000)]);
    await audit(req,'quality_inspection',`Inspection recorded for request #${id}`);flash(req,'success','Quality inspection saved.');res.redirect('/admin/operations#quality');
  }));

  router.post('/operations/garment-status',need('operations'),wrap(async(req,res)=>{
    const id=Number(req.body.id),status=cleanText(req.body.process_status,20);
    if(!Number.isInteger(id)||!['received','washing','drying','ironing','packed','returned'].includes(status)){flash(req,'error','Invalid garment status.');return res.redirect('/admin/operations#garments');}
    await pool.query('UPDATE laundry_items SET process_status=$1,updated_at=now() WHERE id=$2',[status,id]);await audit(req,'garment_status',`Garment #${id}: ${status}`);flash(req,'success','Garment status updated.');res.redirect('/admin/operations#garments');
  }));
  router.post('/operations/machine-status',need('operations'),wrap(async(req,res)=>{
    const id=Number(req.body.id),status=cleanText(req.body.status,20);
    if(!Number.isInteger(id)||!['available','running','maintenance','inactive'].includes(status)){flash(req,'error','Invalid machine status.');return res.redirect('/admin/operations#machines');}
    await pool.query('UPDATE laundry_machines SET status=$1 WHERE id=$2',[status,id]);await audit(req,'machine_status',`Machine #${id}: ${status}`);flash(req,'success','Machine status updated.');res.redirect('/admin/operations#machines');
  }));
  router.post('/operations/batch-status',need('operations'),wrap(async(req,res)=>{
    const id=Number(req.body.id),status=cleanText(req.body.status,20);
    if(!Number.isInteger(id)||!['queued','washing','completed','cancelled'].includes(status)){flash(req,'error','Invalid batch status.');return res.redirect('/admin/operations#machines');}
    const client=await pool.connect();try{await client.query('BEGIN');const b=await client.query(`UPDATE laundry_batches SET status=$1,started_at=CASE WHEN $1='washing' AND started_at IS NULL THEN now() ELSE started_at END,completed_at=CASE WHEN $1='completed' THEN now() ELSE completed_at END WHERE id=$2 RETURNING machine_id`,[status,id]);if(!b.rowCount)throw new Error('Batch not found.');if(b.rows[0].machine_id){const machineStatus=status==='washing'?'running':status==='completed'?'available':null;if(machineStatus)await client.query('UPDATE laundry_machines SET status=$1 WHERE id=$2',[machineStatus,b.rows[0].machine_id]);}await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');flash(req,'error',e.message);return res.redirect('/admin/operations#machines');}finally{client.release();}
    await audit(req,'batch_status',`Batch #${id}: ${status}`);flash(req,'success','Batch status updated.');res.redirect('/admin/operations#machines');
  }));

  router.post('/operations/machine',need('operations'),wrap(async(req,res)=>{
    const name=cleanText(req.body.name,100);if(!name){flash(req,'error','Machine name is required.');return res.redirect('/admin/operations#machines');}
    await pool.query(`INSERT INTO laundry_machines(name,machine_type,capacity_kg,status,last_service,notes) VALUES($1,$2,$3,$4,$5,$6)`,[name,cleanText(req.body.machine_type,50),num(req.body.capacity_kg),['available','maintenance','inactive'].includes(req.body.status)?req.body.status:'available',req.body.last_service||null,cleanText(req.body.notes,500)]);
    await audit(req,'machine_added',name);flash(req,'success','Machine added.');res.redirect('/admin/operations#machines');
  }));
  router.post('/operations/batch',need('operations'),wrap(async(req,res)=>{
    const code=cleanText(req.body.batch_code,60);if(!code){flash(req,'error','Batch reference is required.');return res.redirect('/admin/operations#machines');}
    const client=await pool.connect();try{await client.query('BEGIN');const created=await client.query(`INSERT INTO laundry_batches(batch_code,machine_id,cycle,notes) VALUES($1,$2,$3,$4) RETURNING id`,[code,req.body.machine_id?Number(req.body.machine_id):null,cleanText(req.body.cycle,100),cleanText(req.body.notes,500)]);const selected=[...new Set((Array.isArray(req.body.laundry_item_ids)?req.body.laundry_item_ids:[req.body.laundry_item_ids]).filter(Boolean).map(Number).filter(Number.isInteger))];for(const itemId of selected){await client.query('INSERT INTO laundry_batch_items(batch_id,laundry_item_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[created.rows[0].id,itemId]);}await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');flash(req,'error',e.code==='23505'?'That batch reference already exists.':e.message);return res.redirect('/admin/operations#machines');}finally{client.release();}
    await audit(req,'batch_created',code);flash(req,'success','Wash batch created.');res.redirect('/admin/operations#machines');
  }));
  router.post('/operations/expense',need('operations'),wrap(async(req,res)=>{
    const amount=num(req.body.amount,0),category=cleanText(req.body.category,60),description=cleanText(req.body.description,200);if(amount===null||amount<=0||!category||!description){flash(req,'error','Enter a valid expense and amount.');return res.redirect('/admin/operations#finance');}
    await pool.query(`INSERT INTO expenses(category,description,amount,spent_on,recorded_by) VALUES($1,$2,$3,COALESCE($4::date,CURRENT_DATE),$5)`,[category,description,amount,req.body.spent_on||null,req.session.admin.id]);
    await audit(req,'expense_recorded',`${category}: ${amount}`);flash(req,'success','Expense recorded.');res.redirect('/admin/operations#finance');
  }));
  router.post('/operations/inventory',need('operations'),wrap(async(req,res)=>{
    const name=cleanText(req.body.name,100),quantity=num(req.body.quantity,0),reorder=num(req.body.reorder_level,0),cost=num(req.body.unit_cost||0,0);if(!name||quantity===null||reorder===null||cost===null){flash(req,'error','Enter valid inventory details.');return res.redirect('/admin/operations#inventory');}
    await pool.query(`INSERT INTO inventory_items(name,unit,quantity,reorder_level,unit_cost) VALUES($1,$2,$3,$4,$5)`,[name,cleanText(req.body.unit,30)||'pcs',quantity,reorder,cost]);
    await audit(req,'inventory_item_added',name);flash(req,'success','Supply added.');res.redirect('/admin/operations#inventory');
  }));
  router.post('/operations/stock',need('operations'),wrap(async(req,res)=>{
    const id=Number(req.body.inventory_item_id),delta=Number(req.body.quantity_change),reason=cleanText(req.body.reason,200);if(!Number.isInteger(id)||!Number.isFinite(delta)||delta===0||!reason){flash(req,'error','Enter a valid stock adjustment and reason.');return res.redirect('/admin/operations#inventory');}
    const client=await pool.connect();try{await client.query('BEGIN');const u=await client.query('UPDATE inventory_items SET quantity=quantity+$1,updated_at=now() WHERE id=$2 AND quantity+$1>=0 RETURNING id',[delta,id]);if(!u.rowCount)throw new Error('Stock adjustment would make the quantity negative or item does not exist.');await client.query(`INSERT INTO inventory_movements(inventory_item_id,quantity_change,reason,recorded_by) VALUES($1,$2,$3,$4)`,[id,delta,reason,req.session.admin.id]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');flash(req,'error',e.message);return res.redirect('/admin/operations#inventory');}finally{client.release();}
    await audit(req,'stock_adjusted',`Inventory #${id}: ${delta}`);flash(req,'success','Stock updated.');res.redirect('/admin/operations#inventory');
  }));
  router.post('/operations/complaint',need('operations'),wrap(async(req,res)=>{
    const subject=cleanText(req.body.subject,120);if(!subject){flash(req,'error','Complaint subject is required.');return res.redirect('/admin/operations#customers');}
    const rid=req.body.request_id?Number(req.body.request_id):null;
    await pool.query(`INSERT INTO customer_complaints(request_id,customer_id,subject,details) VALUES($1,(SELECT customer_id FROM requests WHERE id=$1),$2,$3)`,[rid,subject,cleanMultiline(req.body.details,2000)]);
    await audit(req,'complaint_logged',subject);flash(req,'success','Complaint logged.');res.redirect('/admin/operations#customers');
  }));
  router.post('/operations/complaint-status',need('operations'),wrap(async(req,res)=>{
    const id=Number(req.body.id),status=cleanText(req.body.status,20);if(!Number.isInteger(id)||!['open','investigating','resolved','closed'].includes(status)){flash(req,'error','Invalid complaint update.');return res.redirect('/admin/operations#customers');}
    await pool.query('UPDATE customer_complaints SET status=$1,resolution=$2,updated_at=now() WHERE id=$3',[status,cleanMultiline(req.body.resolution,500),id]);await audit(req,'complaint_status',`Complaint #${id}: ${status}`);flash(req,'success','Complaint updated.');res.redirect('/admin/operations#customers');
  }));
  router.post('/operations/refund-status',need('operations'),wrap(async(req,res)=>{
    const id=Number(req.body.id),status=cleanText(req.body.status,20);if(!Number.isInteger(id)||!['pending','approved','rejected','paid'].includes(status)){flash(req,'error','Invalid refund status.');return res.redirect('/admin/operations#customers');}
    await pool.query('UPDATE refunds SET status=$1 WHERE id=$2',[status,id]);await audit(req,'refund_status',`Refund #${id}: ${status}`);flash(req,'success','Refund status updated.');res.redirect('/admin/operations#customers');
  }));
  router.post('/operations/refund',need('operations'),wrap(async(req,res)=>{
    const id=Number(req.body.request_id),amount=num(req.body.amount,0),reason=cleanText(req.body.reason,250);if(!Number.isInteger(id)||amount===null||amount<=0||!reason){flash(req,'error','Enter a valid refund request.');return res.redirect('/admin/operations#customers');}
    await pool.query(`INSERT INTO refunds(request_id,amount,reason,recorded_by) VALUES($1,$2,$3,$4)`,[id,amount,reason,req.session.admin.id]);await audit(req,'refund_requested',`Request #${id}: ${amount}`);flash(req,'success','Refund submitted for approval.');res.redirect('/admin/operations#customers');
  }));
  router.post('/operations/discount',need('operations'),wrap(async(req,res)=>{
    const code=cleanText(req.body.code,40).toUpperCase(),value=num(req.body.value,0),type=req.body.discount_type,min=Math.max(1,Number(req.body.min_orders)||1);if(!code||value===null||value<=0||!['percent','fixed'].includes(type)||(type==='percent'&&value>100)){flash(req,'error','Enter a valid discount. Percentage discounts cannot exceed 100%.');return res.redirect('/admin/operations#growth');}
    await pool.query(`INSERT INTO discounts(code,description,discount_type,value,min_orders,ends_at,max_uses) VALUES($1,$2,$3,$4,$5,$6,$7)`,[code,cleanText(req.body.description,200),type,value,min,req.body.ends_at||null,req.body.max_uses?Math.max(1,Number(req.body.max_uses)):null]);await audit(req,'discount_created',code);flash(req,'success','Discount code created.');res.redirect('/admin/operations#growth');
  }));
  router.post('/operations/subscription',need('operations'),wrap(async(req,res)=>{
    const customer=Number(req.body.customer_id),price=num(req.body.price,0),name=cleanText(req.body.package_name,100),freq=req.body.frequency;if(!Number.isInteger(customer)||price===null||!name||!['weekly','fortnightly','monthly'].includes(freq)){flash(req,'error','Enter valid package details.');return res.redirect('/admin/operations#growth');}
    await pool.query(`INSERT INTO subscriptions(customer_id,package_name,price,frequency,starts_on,ends_on) VALUES($1,$2,$3,$4,COALESCE($5::date,CURRENT_DATE),$6)`,[customer,name,price,freq,req.body.starts_on||null,req.body.ends_on||null]);await audit(req,'subscription_created',name);flash(req,'success','Customer package created.');res.redirect('/admin/operations#growth');
  }));
  router.post('/operations/branch',need('operations'),wrap(async(req,res)=>{
    const name=cleanText(req.body.name,100);if(!name){flash(req,'error','Branch name is required.');return res.redirect('/admin/operations#branches');}
    await pool.query('INSERT INTO branches(name,phone,address) VALUES($1,$2,$3)',[name,cleanText(req.body.phone,30),cleanText(req.body.address,200)]);await audit(req,'branch_created',name);flash(req,'success','Branch added.');res.redirect('/admin/operations#branches');
  }));
};
