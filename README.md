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
3. Sign in at `/admin/login` with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`, then change the password under **Settings**.

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
