const { html, raw } = require('../../lib/html');
const { adminLayout } = require('../layouts/admin');
const { csrfField } = require('../partials/ui');
const { icon } = require('../../lib/icons');
const { mpesaBadge } = require('../../lib/pay-ui');

function settingsPage(ctx) {
  const s = ctx.settings;
  const input = (name, label, attrs = '', hint = '') => {
    const extra = raw(`${attrs.includes('maxlength') ? '' : 'maxlength="200" '}${attrs}`);
    return html`<label class="field"><span>${label}</span><input name="${name}" value="${s[name]}" ${extra}>${hint ? html`<small class="muted">${hint}</small>` : ''}</label>`;
  };

  const m = ctx.backupView.mail;
  const bk = ctx.backupView.backup;
  const cp = ctx.backupView.captcha;
  const hours = Array.from({ length: 24 }, (_, i) => i);

  const body = html`
  <form class="glass pad stack" method="post" action="/admin/settings">
      ${csrfField(ctx)}
      <h2>Business details</h2>
      ${input('business_name', 'Business name')}
      ${input('tagline', 'Headline on the home page')}
      <label class="field"><span>Short description</span><textarea name="about" rows="3" maxlength="400">${s.about}</textarea></label>
      <div class="grid-2">
        ${input('phone', 'Phone', 'type="tel" autocomplete="tel"')}
        ${input('whatsapp', 'WhatsApp number', 'type="tel" autocomplete="tel"', 'With country code, e.g. 254712345678')}
      </div>
      ${input('email', 'Email', 'type="email" autocomplete="email"')}
      ${input('address', 'Address / service area', 'autocomplete="street-address"')}
      ${input('opening_hours', 'Opening hours', 'autocomplete="off"')}
      ${input('currency', 'Currency code', 'maxlength="6" autocomplete="off"', 'e.g. KES')}
      <button class="btn btn-primary" type="submit">Save settings</button>
    </form>

  <section class="glass pad" id="confirmCard">
    <form class="switch-row" method="post" action="/admin/settings/auto-confirm">
      ${csrfField(ctx)}
      <div class="switch-text">
        <h2>Auto-confirm new requests</h2>
        <p class="muted small">On: the moment a customer sends a request it is confirmed. The customer sees “Confirmed” on their screen straight away, orders with no per-kg service get their bill so they can pay at once, and a rider is assigned and alerted. Per-kg orders are weighed by the rider at the door first. When the bill is fully paid the assigned rider is alerted again. Off: the owner or manager confirms each request by hand.</p>
      </div>
      <input type="hidden" name="enabled" value="${s.auto_confirm !== '0' ? '0' : '1'}">
      <button type="submit" class="switch ${s.auto_confirm !== '0' ? 'on' : ''}" role="switch" aria-checked="${s.auto_confirm !== '0' ? 'true' : 'false'}" aria-label="Auto-confirm new requests">
        <span class="switch-knob"></span><span class="switch-txt">${s.auto_confirm !== '0' ? 'On' : 'Off'}</span>
      </button>
    </form>
  </section>

  <section class="glass pad" id="twofaCard">
    <form class="switch-row" method="post" action="/admin/settings/require-2fa">
      ${csrfField(ctx)}
      <div class="switch-text">
        <h2>Require two-step verification</h2>
        <p class="muted small">On: every owner and staff account must set up an authenticator app before using the admin area. Off: each person can choose. A person who loses their phone can use a recovery code, or you can reset them under Staff.</p>
      </div>
      <input type="hidden" name="enabled" value="${s.require_2fa === '1' ? '0' : '1'}">
      <button type="submit" class="switch ${s.require_2fa === '1' ? 'on' : ''}" role="switch" aria-checked="${s.require_2fa === '1' ? 'true' : 'false'}" aria-label="Require two-step verification">
        <span class="switch-knob"></span><span class="switch-txt">${s.require_2fa === '1' ? 'On' : 'Off'}</span>
      </button>
    </form>
  </section>

  <section class="glass pad" id="payCard">
    <form class="switch-row" method="post" action="/admin/settings/pay-before-cleaning">
      ${csrfField(ctx)}
      <div class="switch-text">
        <h2>Pay Before Cleaning</h2>
        <p class="muted small">On: the bill is weighed and confirmed, and payment must be received (or pay later approved) before the laundry is picked up. The moment the full payment is recorded, the order moves to Picked up by itself. Off (pay on delivery): the laundry is picked up once the bill is confirmed, and the customer settles the balance when it is delivered. Open staff screens update straight away when you change this.</p>
      </div>
      <input type="hidden" name="enabled" value="${s.pay_before_cleaning !== '0' ? '0' : '1'}">
      <button type="submit" class="switch ${s.pay_before_cleaning !== '0' ? 'on' : ''}" role="switch" aria-checked="${s.pay_before_cleaning !== '0' ? 'true' : 'false'}" aria-label="Pay Before Cleaning">
        <span class="switch-knob"></span><span class="switch-txt">${s.pay_before_cleaning !== '0' ? 'On' : 'Off'}</span>
      </button>
    </form>
  </section>

  <section class="glass pad" id="mpesaCard">
    <form class="stack" method="post" action="/admin/settings/mpesa" data-mpesa-form>
      ${csrfField(ctx)}
      <h2 class="h-with-badge">${mpesaBadge()} <span>M-Pesa payments</span></h2>
      <p class="muted small">Choose where customers send their M-Pesa money. It works with either a Till number (Buy Goods) or a Paybill. Customers see the number and the steps on their bill page and in the WhatsApp message. The rider or cashier still records the M-Pesa code from the customer's SMS.</p>
      <label class="field"><span>Payment method</span>
        <select name="mpesa_type" id="mpesaType">
          <option value="" ${!s.mpesa_type ? 'selected' : ''}>Not set up (cash and a general M-Pesa note only)</option>
          <option value="till" ${s.mpesa_type === 'till' ? 'selected' : ''}>Till number (Buy Goods and Services)</option>
          <option value="paybill" ${s.mpesa_type === 'paybill' ? 'selected' : ''}>Paybill</option>
        </select>
      </label>
      <div data-mpesa-fields ${s.mpesa_type ? '' : 'hidden'}>
        <label class="field"><span id="mpesaNumLabel">${s.mpesa_type === 'paybill' ? 'Paybill number' : 'Till number'}</span><input name="mpesa_number" value="${s.mpesa_number}" inputmode="numeric" autocomplete="off" maxlength="12" placeholder="e.g. 123456"><small class="muted">Digits only, 5 to 7 digits.</small></label>
        <label class="field" data-mpesa-account ${s.mpesa_type === 'paybill' ? '' : 'hidden'}><span>Paybill account number</span><input name="mpesa_account" value="${s.mpesa_account}" maxlength="30" autocomplete="off" placeholder="Leave empty to use the order reference"><small class="muted">Empty: each customer uses their order reference (for example TTW-ABC123) as the account, which makes every payment easy to match. Or set one fixed account for everyone.</small></label>
        <label class="field"><span>Name customers will see on M-Pesa (optional)</span><input name="mpesa_name" value="${s.mpesa_name}" maxlength="60" autocomplete="off" placeholder="e.g. TAP TO WASH LTD"><small class="muted">Shown on the bill page so customers can check the name before they confirm.</small></label>
      </div>
      <button class="btn btn-primary" type="submit">Save M-Pesa details</button>
    </form>
  </section>

  <section class="glass pad" id="branchCard">
    <form class="switch-row" method="post" action="/admin/settings/branches">
      ${csrfField(ctx)}
      <div class="switch-text">
        <h2>Multiple branches</h2>
        <p class="muted small">Switch on to add more branches. Customers can then pick their nearest branch when they place a request, and staff can assign every request to a branch. Switch off to run as a single outlet - your branches and past assignments are kept.</p>
      </div>
      <input type="hidden" name="enabled" value="${s.branches_enabled === '1' ? '0' : '1'}">
      <button type="submit" class="switch ${s.branches_enabled === '1' ? 'on' : ''}" role="switch" aria-checked="${s.branches_enabled === '1' ? 'true' : 'false'}" aria-label="Multiple branches">
        <span class="switch-knob"></span><span class="switch-txt">${s.branches_enabled === '1' ? 'On' : 'Off'}</span>
      </button>
    </form>
    ${s.branches_enabled === '1' ? html`<p class="small" style="margin:.8rem 0 0"><a class="link" href="/admin/operations#branches">Manage branches</a></p>` : ''}
  </section>

  <section class="glass pad stack" id="areasCard">
    <h2>Areas we serve</h2>
    ${s.branches_enabled === '1'
      ? html`<p class="muted small">Multiple branches is on, so customers see your branches instead. Switch it off above to list service areas here.</p>`
      : html`<form method="post" action="/admin/settings/areas" class="stack">
      ${csrfField(ctx)}
      <p class="muted small">The towns, estates or places where you pick up and deliver. They are shown on the home page, one place per line.</p>
      <label class="field"><span>Places (one per line)</span><textarea name="service_areas" rows="6" maxlength="1500" placeholder="Murang'a Town&#10;Kenol&#10;Maragua&#10;Kiriaini">${s.service_areas}</textarea><small class="muted">Up to 30 places. Leave empty to hide this section.</small></label>
      <button class="btn btn-primary" type="submit">Save areas</button>
    </form>`}
  </section>

  <section class="glass pad stack" id="faviconCard">
    <h2>Site icon (favicon)</h2>
    <p class="muted small">The small picture shown in the browser tab, bookmarks, the phone home screen and phone alerts. Choose a square logo or picture (PNG, JPG, WebP or SVG). It is resized to 512 × 512 in your browser and saved in the database. Browsers can keep an old icon for a while - refresh the page if the tab still shows the old one.</p>
    <div class="fav-row">
      <img class="fav-preview" src="/site-icon${s.icon_v ? `?v=${s.icon_v}` : ''}" alt="Current site icon" width="64" height="64">
      <div class="fav-controls">
        <p class="muted small" data-img-note style="margin:0 0 .5rem">${s.icon_v ? 'Using your uploaded icon.' : 'Using the built-in icon.'}</p>
        <div class="row-form">
          <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" id="faviconInput" aria-label="Choose a site icon">
          <button class="btn btn-primary btn-sm" type="button" id="faviconUpload">${icon('upload')} Upload icon</button>
        </div>
        <p class="err" id="faviconErr" role="alert"></p>
      </div>
    </div>
    ${s.icon_v
      ? html`<form method="post" action="/admin/settings/favicon/reset" class="inline" data-ajax-delete data-scope="#faviconCard" data-img=".fav-preview" data-note="[data-img-note]" data-note-text="Using the built-in icon." data-confirm="Go back to the built-in icon?">${csrfField(ctx)}<button class="btn btn-ghost btn-sm" type="submit">${icon('rotate-ccw')} Reset to built-in icon</button></form>`
      : ''}
    <input type="hidden" id="csrfToken" value="${ctx.csrf}">
  </section>

  <section class="glass pad stack" id="mailCard">
    <form class="stack" method="post" action="/admin/settings/mail" autocomplete="off">
      ${csrfField(ctx)}
      <h2>Email sending</h2>
      <p class="muted small">The mailbox the website uses to send email: backups, password-reset codes and staff alerts when WhatsApp is down. For Gmail use <span class="mono">smtp.gmail.com</span>, port <span class="mono">587</span>, your Gmail address as the user, and a Google “App Password” (Google Account &gt; Security &gt; 2-Step Verification &gt; App passwords) instead of your normal password.</p>
      <div class="grid-2">
        <label class="field"><span>Mail server</span><input name="mail_host" value="${m.host}" maxlength="120" placeholder="smtp.gmail.com" autocomplete="off" inputmode="url"></label>
        <label class="field"><span>Port</span><input name="mail_port" value="${m.host ? m.port : 587}" maxlength="5" inputmode="numeric" autocomplete="off"><small class="muted">587 is usual; 465 for secure-from-the-start.</small></label>
      </div>
      <div class="grid-2">
        <label class="field"><span>Mailbox login (user)</span><input name="mail_user" value="${m.user}" maxlength="160" autocomplete="off" placeholder="you@gmail.com"></label>
        <label class="field"><span>Password</span><input name="mail_pass" type="password" value="" maxlength="200" autocomplete="new-password" placeholder="${m.hasPass ? 'Saved. Leave empty to keep it' : 'Mailbox or App Password'}"><small class="muted">${m.hasPass ? 'A password is saved. Type a new one only to change it.' : 'Stored encrypted. It is never shown again.'}</small></label>
      </div>
      <label class="field"><span>Send emails from</span><input name="mail_from" value="${m.from}" maxlength="200" autocomplete="off" placeholder="Tap to Wash &lt;you@gmail.com&gt;"><small class="muted">Leave empty to use the mailbox login. Clear the mail server and save to remove all email settings.</small></label>
      <button class="btn btn-primary" type="submit">Save email settings</button>
    </form>
    <form class="row-form" method="post" action="/admin/settings/mail/test">
      ${csrfField(ctx)}
      <input name="test_to" type="email" value="${bk.to}" maxlength="160" placeholder="Send a test email to…" aria-label="Send a test email to" autocomplete="off">
      <button class="btn btn-ghost btn-sm" type="submit">Send a test email</button>
    </form>
  </section>

  <section class="glass pad stack" id="backupCard">
    <form class="stack" method="post" action="/admin/settings/backup" autocomplete="off">
      ${csrfField(ctx)}
      <h2>Email backups</h2>
      <p class="muted small">Every day the website emails a full copy of its data (customers, orders, payments, settings) as one encrypted attachment. Only someone with the backup password can open it, so keep that password somewhere safe: <strong>a backup cannot be read without it</strong>. Email sending (above) must be working. If the file grows too big for email, the Activity page will say so.</p>
      <label class="field"><span>Automatic backups</span>
        <select name="backup_on">
          <option value="0" ${!bk.on ? 'selected' : ''}>Off</option>
          <option value="1" ${bk.on ? 'selected' : ''}>On: send one every day</option>
        </select>
      </label>
      <div class="grid-2">
        <label class="field"><span>Send backups to</span><input name="backup_to" type="email" value="${bk.to}" maxlength="160" placeholder="owner@example.com" autocomplete="off"></label>
        <label class="field"><span>Send after</span>
          <select name="backup_hour">${hours.map((h) => html`<option value="${h}" ${bk.hour === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`)}</select>
          <small class="muted">Nairobi time. If the site is asleep then, it is sent when it wakes.</small>
        </label>
      </div>
      <label class="field"><span>Backup password</span><input name="backup_pass" type="password" value="" maxlength="200" autocomplete="new-password" placeholder="${bk.hasPass ? 'Saved. Leave empty to keep it' : 'At least 8 characters'}"><small class="muted">${bk.hasPass ? 'A password is saved. Changing it only affects new backups; old backups still need the old one.' : 'Choose a long phrase and write it down. It is stored encrypted and never shown again.'}</small></label>
      <button class="btn btn-primary" type="submit">Save backup settings</button>
    </form>
    <form class="row-form" method="post" action="/admin/settings/backup/now" data-confirm="Make a backup now and email it to ${bk.to || 'the backup address'}?">
      ${csrfField(ctx)}
      <button class="btn btn-ghost btn-sm" type="submit" ${bk.to && bk.hasPass ? '' : 'disabled'}>Send a backup now</button>
      <span class="muted small">${bk.lastNote ? bk.lastNote : 'No backup has been sent yet.'}</span>
    </form>
  </section>

  <section class="glass pad stack" id="captchaCard">
    <form class="stack" method="post" action="/admin/settings/captcha" autocomplete="off">
      ${csrfField(ctx)}
      <h2>Robot check (“I am not a robot”)</h2>
      <p class="muted small">Adds a free Cloudflare Turnstile check to the sign-in pages (owner, staff and customers), customer sign-up, forgot-password pages and the booking form on the home page. Most visitors just see a tick that completes by itself.</p>
      ${cp.disabledByEnv ? html`<p class="err show" role="alert">The check is forced off by the server setting TURNSTILE_DISABLE=1.</p>` : ''}
      <ol class="muted small" style="margin:0;padding-left:1.2rem">
        <li>Sign in at <span class="mono">dash.cloudflare.com</span> (a free account is enough) and open <strong>Turnstile</strong>.</li>
        <li>Choose <strong>Add widget</strong>, give it a name, add your website's domain (for example <span class="mono">yourlaundry.co.ke</span>), and pick <strong>Managed</strong>.</li>
        <li>Copy the <strong>Site key</strong> and the <strong>Secret key</strong> into the boxes below.</li>
      </ol>
      <label class="field"><span>Robot check</span>
        <select name="captcha_on">
          <option value="0" ${!cp.on ? 'selected' : ''}>Off</option>
          <option value="1" ${cp.on ? 'selected' : ''}>On</option>
        </select>
      </label>
      <div class="grid-2">
        <label class="field"><span>Site key</span><input name="captcha_site" value="${cp.site}" maxlength="100" autocomplete="off" placeholder="0x4AAAAAAA…"></label>
        <label class="field"><span>Secret key</span><input name="captcha_secret" type="password" value="" maxlength="200" autocomplete="new-password" placeholder="${cp.hasSecret ? 'Saved. Leave empty to keep it' : 'Paste the secret key'}"><small class="muted">${cp.hasSecret ? 'A secret key is saved.' : 'Stored encrypted. It is never shown again.'}</small></label>
      </div>
      <p class="muted small"><strong>Careful:</strong> a wrong key or a domain that is not on the Cloudflare widget will stop everyone, including you, from signing in. After saving, test in a private window <em>before</em> you sign out here. If you ever get locked out, set <span class="mono">TURNSTILE_DISABLE=1</span> on the server and restart.</p>
      <button class="btn btn-primary" type="submit">Save robot check</button>
    </form>
  </section>

  <section class="glass pad">
    <form class="stack" method="post" action="/admin/settings/terms">
      ${csrfField(ctx)}
      <div class="card-head"><h2>Terms of Service</h2><span class="muted small">Current version ${s.terms_version} · <a class="link" href="/terms" target="_blank" rel="noopener">View public page</a></span></div>
      <p class="muted small">Customers must accept these before sending a request. Use <span class="mono">## Heading</span> for headings, <span class="mono">- text</span> for bullet points and <span class="mono">{{business}}</span> for your business name. Saving a change creates a new version that customers accept afresh.</p>
      <textarea name="terms_text" rows="16" maxlength="20000" required>${s.terms_text}</textarea>
      <button class="btn btn-primary" type="submit">Save terms</button>
    </form>
  </section>

  <section class="glass pad">
    <form class="stack" method="post" action="/admin/settings/privacy">
      ${csrfField(ctx)}
      <div class="card-head"><h2>Privacy Notice</h2><span class="muted small">Current version ${s.privacy_version} · <a class="link" href="/privacy" target="_blank" rel="noopener">View public page</a></span></div>
      <p class="muted small">Shown to customers who create an account. Same format as the terms. This is a starting point - please check it matches how you really handle customer information.</p>
      <textarea name="privacy_text" rows="14" maxlength="20000" required>${s.privacy_text}</textarea>
      <button class="btn btn-primary" type="submit">Save Privacy Notice</button>
    </form>
  </section>`;

  return adminLayout(ctx, { title: 'Settings', active: 'settings', body });
}

module.exports = { settingsPage };
