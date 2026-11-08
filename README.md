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
- Settings: business name, headline, contacts, hours, currency, change password

Payments are intentionally manual for now (admin records the total and amount paid) so online payment can be added later.

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
