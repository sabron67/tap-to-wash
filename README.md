# Tap to Wash

Laundry services website — Node.js + Express, PostgreSQL, views written as plain `.js` files, flat, plain-colour design (warm white + clay, no gradients) with SVG icons (no emojis).

## What is included

**Public site (`/`)**
- Text wordmark (no logo art) and an animated "Tap to wash" button that starts a request
- Scroll experience: the page slides over a sticky hero, sections and cards reveal as you scroll, progress bar, active menu link; respects "reduce motion"
- Background pictures of laundry machines and clothes (drawn illustrations by default; upload real photos in **Admin → Photos**)
- **Terms of Service**: public `/terms` page, editable in Admin → Settings (each change = new version); customers must tick acceptance, stored with every request
- **Admin → Reports**: Excel workbook (A4, Calibri, author Sabron) with Summary, Inputs, Costing/break-even, Quote calculator, Rates, Requests, Items, By Category, By Month, Customers — all live formulas
- **Admin security**: strict CSP, lockout after 5 failed sign-ins (15 min), audit log (Admin → Activity), password policy (10+ chars, letter + number), forced change of the default password, 2-hour idle / 12-hour absolute sessions, no-store + noindex on admin
- Database indexes for the common queries, plus trigram (pg_trgm) indexes for the admin search boxes
- Warm white / clay flat design with a **System / Light / Dark** switch (System follows the device live; Light or Dark overrides it and is remembered in the browser). Available on the public site, the admin panel and the login page.
- Category section built from whatever the admin adds
- "Tap to wash" wizard: choose categories, share GPS location and describe where you are, then name and phone
- Reference code after sending, and an order tracking page (`/track`)

**Admin (`/admin`)**
- Dashboard (new / in progress / ready, money collected & outstanding, 7-day chart)
- Requests: search, filter by status, status pipeline with customer-visible notes, customer map location (Google Maps link), billing (total / paid), internal notes
- Categories: add / edit / hide / delete, icon, colour, price and unit
- Customers (repeat customers are merged by phone number)
- Settings: business name, headline, contacts, hours, currency, change password; WhatsApp link page

Payments are intentionally manual for now (admin records the total and amount paid) so online payment can be added later.

## Operations centre

**Admin → Operations** holds the day-to-day tools:

- **Pickup and delivery:** assign a rider, pickup and delivery slots and a dispatch stage. Pickup/delivery changes are added to the request history.
- **Quality control:** record stain, count, damage and packaging checks and whether the order passed.
- **Expenses and stock:** record operating costs, add supplies, adjust stock with a reason, see low-stock alerts. CSV exports for expenses, inventory, reviews and complaints.
- **Customer care:** log and follow up complaints, record refunds and read customer reviews (customers rate or complain from the tracking page).
- **Discount codes:** percentage or fixed codes with expiry and use limits, switched on/off from the list. Staff apply a code in the billing form of a request.
- **Receipts:** print or save a receipt as PDF from any request page.

Removed as unnecessary: garment-level tracking, machines and wash batches, customer packages (subscriptions) and loyalty points. Existing data in those old tables is left untouched; the points trigger is dropped so nothing new is awarded.

### Multiple branches (on/off switch)

**Admin → Settings → Multiple branches** switches multi-branch mode on or off (owner only).

- **Off (default):** single outlet. No branch pickers or branch columns anywhere.
- **On:** a **Branches** section appears in Operations (add branches, switch each one Active/Off). Customers see a "Nearest branch" choice when they tap to wash, staff can assign a branch in the dispatch form, and the branch shows on the request page.
- Switching off keeps all branches and past assignments; they simply stop being used.

After updating run `npm install` (adds `compression`) and `npm run db:init` once.

## Weigh, bill, confirm and pay (stage 1)

Payment now happens at pick-up, after the laundry is measured. Payments are recorded by hand (cash, or the M-Pesa code from the customer's SMS); automatic M-Pesa STK Push can be added later on the same flow.

1. **Rider weighs or counts** each service on the request page (kg for weighed services such as `kg`, whole counts for `item`, `pair` and so on). The rider never sees prices. The app prices the lines from the category rate (snapshotted on the order), applies any discount code and creates the bill.
2. **Customer confirms** on the tracking page (`/track`, reference code + phone). They see weights, rates and the total, and can **Confirm** or flag a problem. The rider is told to collect. A cashier or manager can **confirm on the customer's behalf** (with the reason recorded).
3. **Payment is recorded** (cash, or a 10-character M-Pesa code that can only be used once) by the rider, cashier or manager. The cashier or manager later marks each payment **received**.
4. **Pick-up is gated:** "Picked up" (and later statuses) is refused until the order is weighed, confirmed and paid, or a manager has approved **pay later**.

Other rules: only a manager or owner can **re-open** a confirmed bill to weigh again (earlier payments stay on the order); a service with no price puts the bill in "needs price" and alerts the manager; manual billing is only used for orders that were already under way when this was switched on (marked `legacy`, never blocked). New permissions in `lib/roles.js`: `weigh`, `collect`, `billadmin`. New alert events in `lib/notify.js`: `bill_confirmed` (rider), `bill_disputed` and `bill_needs_price` (manager).

**Quality gate override:** an order normally cannot be marked Ready until a passed quality inspection exists. Owners and managers (permission `qcoverride`) can release an order without one: on the request page, *Mark Ready anyway (override)* asks for a written reason, saves an `OVERRIDE by <name>: <reason>` entry under Operations, Quality control (shown as *Passed (override)*) and writes `qc_override` to the activity log. The reason is not shown to customers.

After updating run `npm run db:init` (adds columns and the `payments` table; safe to repeat).

## Database backups

The project includes `npm run db:backup`. It requires PostgreSQL's `pg_dump` utility to be installed on the server and `DATABASE_URL` to be configured. It creates a private custom-format dump in `backups/` and removes dumps older than 14 days by default. Configure `BACKUP_DIR` and `BACKUP_KEEP_DAYS` to change those defaults. Keep the backup directory outside public web roots and restrict server access because dumps contain customer information.

For scheduled backups, run `npm run db:backup` from the project directory using the host's scheduler (for example, a daily cron job). To restore a dump into a prepared database, use `pg_restore --clean --if-exists --no-owner --no-acl --dbname=YOUR_DATABASE backup-file.dump`. Test restores on a separate database before relying on backups.

## Setup

1. Install Node 18+ and PostgreSQL, then create a database:
   ```
   createdb taptowash
   ```
2. Install and configure:
   ```
   npm install
   cp .env.example .env      # edit DATABASE_URL, SESSION_SECRET, admin email/password
   npm run db:init           # creates tables, first admin, settings, starter categories
   npm start                 # http://localhost:3000
   ```
3. Sign in at `/admin/login` with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`, then change the password under **My account**.

## Two sign-in pages: owner and staff

| Page | Who may sign in | Everyone else |
|---|---|---|
| `/admin/login` | the **owner** only | refused with "This sign-in is for the owner only" |
| `/staff` | **manager, cashier, rider, laundry attendant** | owner accounts are refused and pointed to `/admin/login` |

- Both pages check the same accounts (**Admin → Staff**). The page only decides who may come in through it; the password is checked first, so a wrong page never reveals whether an account exists. A refused sign-in does not start a session and is written to the activity log (`login_wrong_door`).
- After signing in, everyone works in the same workspace, and each role still sees only what its permissions allow.
- Sign-out, an expired session and "Forgot password" all return the person to their own page (owner → `/admin/login`, staff → `/staff`).
- **Admin → Staff** shows both links, and the "account created" notice and WhatsApp message give the new person the right link for their role.
- Share `/staff` with your team; keep `/admin/login` for yourself.

## WhatsApp alerts and password reset codes (Baileys, no browser)

Staff job alerts and password-reset codes are sent by the server itself through **Baileys** (an unofficial WhatsApp library that needs no Chromium or browser).

1. `npm install` (installs @whiskeysockets/baileys, pino and qrcode; no browser is downloaded).
2. Deploy, sign in as the owner and open **Admin → WhatsApp**. Scan the QR code with the business phone
   (WhatsApp → Settings → Linked devices → Link a device). The status turns to **Linked and ready**.
3. Each staff member turns on **WhatsApp** and saves their number under **My account**. Alerts go out by role
   (new → owner/manager, confirmed → rider, picked up → attendant, ready → rider, delivered with a balance → cashier).

Hosting notes
- The WhatsApp login is stored **in the PostgreSQL database** (table `wa_auth`, created automatically), not in files, so
  Render restarts and redeploys do not unlink the number.
- Needs `git` during `npm install` (one dependency is fetched from GitHub); Render has it.
- `WHATSAPP_WEB=0` switches it off (tap-to-send wa.me links keep working, and Meta's API is used if `WHATSAPP_TOKEN` and
  `WHATSAPP_PHONE_ID` are set). If WhatsApp is not linked the site keeps running normally.
- Baileys is unofficial. Messages are sent one at a time, a moment apart, for staff alerts and reset codes only.

## Forgot password (staff and customers)

- Staff: `/admin/forgot` · Customers: `/account/forgot` (links are on both sign-in pages).
- A 6-digit code is WhatsApped to the number saved on the account. It works for 15 minutes, allows 5 wrong tries and can be used once.
  Staff need a number under **My account / Staff**; customers under **My account → My details**.
- The page never reveals whether an email exists. After a reset the person is signed out everywhere.
- If WhatsApp is not linked, the page tells the person to contact the business; the owner can still use **Staff → Reset** and
  **Customers → Reset**. If the owner is locked out: set `ADMIN_EMAIL`/`ADMIN_PASSWORD` for a new owner with `npm run db:init`
  on an empty database, or update the password hash directly in the database.

## Phones
- Public site and admin show a bottom navigation bar on phones (admin: first four sections your role may open + **More**).
- Tables turn into cards on phones; every password field has a show / hide (eye) button (`public/js/password.js`).

## Folder layout

```
server.js            app entry (sessions, routes, error pages)
config/db.js         PostgreSQL pool
db/schema.sql        tables        db/init.js   setup + seed
lib/                 html templating, helpers, settings, security
routes/public.js     home, request API, tracking
routes/admin.js      all admin actions
views/               .js views (layouts, partials incl. theme switch, public, admin)
public/              css, client js (app.js, admin.js, theme.js), favicon
```

## Notes
- Database pool: `DB_POOL_MAX` (default 12) caps open connections, `DB_POOL_MIN` (default 2) keeps connections warm, `DB_CONNECT_TIMEOUT_MS`, `DB_IDLE_TIMEOUT_MS` and `DB_STATEMENT_TIMEOUT_MS` stop slow queries from queueing customers. Keep `DB_POOL_MAX` below your database plan's connection limit.
- Billing: only clothes charged per kg are weighed and confirmed by the customer. Every other order is billed automatically when the order is confirmed, and payment can then be collected.
- Production: set `NODE_ENV=production`, a strong `SESSION_SECRET`, and `PGSSL=true` if your host requires SSL. Serve over HTTPS (browsers only allow location sharing on HTTPS).
- Starter categories and prices are examples — edit them in Admin > Categories (pick an icon from the icon grid for each category).

## Changing the colours
All colours are variables at the top of `public/css/style.css`, written as `light-dark(lightValue, darkValue)`. Edit `--bg`, `--surface`, `--accent` and `--text` to rebrand the whole site. Status badge colours are in `lib/helpers.js`. The drawn background illustrations are in `public/img/`.

## Icons
All icons are inline SVG from the open-source Lucide set (ISC licence), embedded in `lib/icons.js` — no icon font or CDN needed. To offer another icon for categories, add it to `PATHS` and `CATEGORY_ICONS` in that file.

## Updating an existing install
After copying these files over your project, run `npm install` (adds `exceljs`) and `npm run db:init` (adds new tables/columns/indexes; safe to repeat). If you still use the default password, you will be asked to change it at next sign-in.

## Notes on the Excel report
Numbers are calculated when the file is opened (Excel, LibreOffice, Google Sheets). Previewers that do not calculate formulas may show blanks. Up to 5,000 requests, 10,000 item lines and 2,000 customers per report - pick a shorter date range for more.

## Staff alerts and customer accounts

**Alerts (who is told what).** New request → owner + manager; confirmed → rider; picked up → laundry attendant; ready → rider; delivered with a balance due → cashier. Edit `ROUTES` in `lib/notify.js` to change this. Each person switches channels on or off in *My account*:
- *In the admin*: bell, sound and a pop-up while the page is open.
- *Phone push*: works even when the page is closed. Needs HTTPS, and each person taps "Enable on this device" once. On iPhone the site must be added to the Home Screen first.
- *WhatsApp*: today this uses tap-to-send links (the job page has "Alert the team on WhatsApp" and "WhatsApp customer" buttons; the customer's success screen has a "Message us on WhatsApp" button once a WhatsApp number is set in Settings). These links open WhatsApp with the message ready, and a person presses Send. When you connect Meta's WhatsApp Business API, set `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_ID` (see `.env.example`) and staff alerts go out automatically with no other change.

**Customer accounts** are optional; guest requests work exactly as before. Customers can sign up with email and password, see their orders, keep their details and earlier places, use "Request again", add an earlier guest order (reference code + phone), and delete their account. There is no email service yet, so a forgotten password is reset by staff (Customers → Customer accounts → Reset) and the temporary password is passed on by WhatsApp or phone. The Privacy Notice is editable in Settings.

After updating run `npm install` (adds `web-push`) and `npm run db:init`.
