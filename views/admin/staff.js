const { html } = require('../../lib/html');
const { fmtDate } = require('../../lib/helpers');
const { adminLayout } = require('../layouts/admin');
const { csrfField } = require('../partials/ui');
const { icon } = require('../../lib/icons');
const { ROLES } = require('../../lib/roles');
const { waLink, validWaNumber } = require('../../lib/whatsapp');

const roleOptions = (sel) => Object.entries(ROLES).map(([k, r]) => html`<option value="${k}" ${k === sel ? 'selected' : ''}>${r.label}</option>`);

function staffPage(ctx, { rows, created }) {
  const body = html`
  ${created
    ? html`<section class="glass pad notice">
        <h2>${created.what === 'reset' ? 'New temporary password' : 'Account created'} for ${created.name}</h2>
        <p>Give these sign-in details to ${created.name} now. <strong>The password is shown only once</strong> and they must choose their own at first sign-in.</p>
        <p class="mono" style="font-size:1rem">Sign in at: <strong>${created.role === 'owner' ? `${ctx.baseUrl}/admin/login` : `${ctx.baseUrl}/staff`}</strong><br>Email: <strong>${created.email}</strong><br>Temporary password: <strong>${created.password}</strong></p>
        ${created.phone && validWaNumber(created.phone)
          ? html`<p><a class="btn btn-accent btn-sm" href="${waLink(created.phone, `Hello ${String(created.name).split(' ')[0]}, your ${ctx.settings.business_name} staff account is ready.\nEmail: ${created.email}\nTemporary password: ${created.password}\nSign in here: ${created.role === 'owner' ? ctx.baseUrl + '/admin/login' : ctx.baseUrl + '/staff'}\nPlease choose your own password when you first sign in.`)}" target="_blank" rel="noopener">${icon('message-circle')} Send on WhatsApp</a></p>`
          : ''}
      </section>`
    : ''}

  <section class="glass pad">
    <div class="card-head"><h2>Staff accounts</h2><span class="muted small">${rows.filter((r) => r.is_active).length} active · everyone signs in with their own email</span></div>
    <p class="muted small">Staff sign-in page (manager, cashier, rider, attendant): <strong class="mono">${ctx.baseUrl}/staff</strong> · Owner sign-in page: <strong class="mono">${ctx.baseUrl}/admin/login</strong>. Each page refuses the other group's accounts.</p>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
      <tbody>${rows.map((r) => {
        const me = r.id === ctx.admin.id;
        const f = `f${r.id}`;
        return html`<tr>
        <td><strong>${r.name}</strong><div class="muted small">${r.email}</div>
          <input class="phone-in" name="phone" form="${f}" value="${r.phone}" maxlength="20" placeholder="WhatsApp number" aria-label="WhatsApp number for ${r.name}" inputmode="tel"></td>
        <td>
          <select name="role" form="${f}" aria-label="Role for ${r.name}" ${me ? 'disabled' : ''}>${roleOptions(r.role)}</select>
          ${me ? html`<input type="hidden" form="${f}" name="role" value="${r.role}">` : ''}
        </td>
        <td>
          <select name="is_active" form="${f}" aria-label="Status for ${r.name}" ${me ? 'disabled' : ''}><option value="1" ${r.is_active ? 'selected' : ''}>Active</option><option value="0" ${r.is_active ? '' : 'selected'}>Disabled</option></select>
          ${me ? html`<input type="hidden" form="${f}" name="is_active" value="1">` : ''}
          ${r.totp_enabled ? html`<span class="badge">2-step on</span>` : html`<span class="badge pay-partial">2-step off</span>`}${r.locked ? html`<span class="badge pay-unpaid">Locked</span>` : ''}${r.must_change_password ? html`<span class="badge pay-partial">Temp password</span>` : ''}
        </td>
        <td class="nowrap">${r.last_login_at ? fmtDate(r.last_login_at) : html`<span class="muted">Never</span>`}</td>
        <td class="nowrap">
          <form method="post" action="/admin/staff/${r.id}" id="${f}" class="inline">${csrfField(ctx)}<input type="hidden" name="name" value="${r.name}"><button class="btn btn-ghost btn-sm" type="submit">Save</button></form>
          ${!me
            ? html`<form method="post" action="/admin/staff/${r.id}/reset" class="inline" data-confirm="Create a new temporary password for ${r.name}? Their current password will stop working.">${csrfField(ctx)}<button class="btn btn-ghost btn-sm" type="submit" title="Reset password" aria-label="Reset password for ${r.name}">${icon("key-round")} Reset</button></form>`
            : html`<span class="muted small">You</span>`}
          ${!me && r.totp_enabled ? html`<form method="post" action="/admin/staff/${r.id}/2fa-reset" class="inline" data-confirm="Remove two-step verification for ${r.name}? They will sign in with their password only until they set it up again.">${csrfField(ctx)}<button class="btn btn-ghost btn-sm" type="submit">Reset 2-step</button></form>` : ''}
        </td>
      </tr>`;
      })}</tbody>
    </table></div>
  </section>

  <section class="grid-2 gap">
    <form class="glass pad stack" method="post" action="/admin/staff">
      ${csrfField(ctx)}
      <h2>Add a staff member</h2>
      <label class="field"><span>Full name</span><input name="name" maxlength="80" required></label>
      <label class="field"><span>Email (their sign-in)</span><input type="email" name="email" maxlength="120" required autocomplete="off"></label>
      <label class="field"><span>WhatsApp / phone number</span><input type="tel" name="phone" maxlength="20" placeholder="0712 345 678"><small class="muted">Optional. Used for job alerts on WhatsApp.</small></label>
      <label class="field"><span>Role</span><select name="role" required>${roleOptions('rider')}</select><small class="muted">Owners sign in at /admin/login. Every other role signs in at /staff.</small></label>
      <button class="btn btn-primary" type="submit">${icon('plus')} Create account</button>
      <p class="muted small">A temporary password is generated and shown once.</p>
    </form>
    <div class="glass pad">
      <h2>What each role can do</h2>
      <ul class="sheet-list">${Object.values(ROLES).map((r) => html`<li><strong>${r.label}</strong> - ${r.desc}</li>`)}</ul>
    </div>
  </section>`;
  return adminLayout(ctx, { title: 'Staff', active: 'staff', body });
}

module.exports = { staffPage };
