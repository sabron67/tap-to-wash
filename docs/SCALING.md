# Scaling and load balancing Tap to Wash

The app is built so that **any number of copies can run side by side behind a load balancer**. No sticky sessions are needed.

## What already worked, and what was added

| Part | How it is shared between copies |
|---|---|
| Logins (sessions), rate limits, photos, WhatsApp login, settings | PostgreSQL (already so) |
| Live updates (order tracking, staff screens, service list) | **New:** announced to all copies over PostgreSQL `LISTEN/NOTIFY` (`lib/bus.js`, `lib/live.js`) |
| Email, backup and captcha settings saved in the admin page | **New:** every copy re-reads them when one saves (`lib/backup-settings.js`) |
| WhatsApp connection and M-Pesa "reconciler" (must run once) | **New:** one *leader* copy runs them, chosen by a PostgreSQL lock (`lib/leader.js`). If it stops, another copy takes over within 15 s. Other copies show its status/QR code in Admin > WhatsApp and hand it messages to send. |
| Daily backup | Already protected by its own lock |
| Load balancer health check | **New:** `GET /healthz` (200 healthy, 503 database down or shutting down) |
| Clean redeploys | **New:** `DRAIN_MS` lets the balancer remove a copy before it stops |

No database changes or migrations are needed.

## Run it (VPS / any server with Docker)

    # .env next to docker-compose.yml: SESSION_SECRET, APP_URL, MPESA_*, SMTP_*, DB_PASSWORD ...
    docker compose up -d --build

This starts PostgreSQL, **three app copies** and **nginx** (`nginx/nginx.conf`, `least_conn`, passive health checks, live-update streams unbuffered). Run `docker compose exec app1 node db/init.js` once on a new database. Test: `curl -sI http://localhost:8080/healthz` and watch the `X-Upstream` header change.

To add capacity: add an `app4` block in `docker-compose.yml` and a `server app4:3000 ...;` line in `nginx/nginx.conf`.

## Run it on Render, Railway, Fly, etc.

Use the platform's own load balancer: raise the number of instances of the web service (a paid plan is needed). Set `NODE_ENV=production`, `DRAIN_MS=5000`, and the health check path to `/healthz`. Nothing else changes.

## Settings (environment variables)

| Variable | Meaning |
|---|---|
| `TRUST_PROXY` | Proxies in front of the app. `1` = one (nginx or one load balancer), `2` = e.g. Cloudflare + nginx. Wrong values make every visitor share one IP and one rate limit. |
| `DRAIN_MS` | Wait this long after SIGTERM, with `/healthz` returning 503, before stopping (use `5000`). |
| `DB_POOL_MAX` | Connections per copy (default 12). **Copies x DB_POOL_MAX + 2 per copy must stay below PostgreSQL `max_connections`.** |
| `DATABASE_DIRECT_URL` | Only if `DATABASE_URL` goes through PgBouncer in *transaction* mode: a direct (or session-mode) URL for the bus and leader lock, which need a long-lived connection. |
| `LEADER_ELIGIBLE=0` | This copy never becomes leader (web only). |
| `INSTANCE_ID` | Name shown by `/healthz` and in logs (default: hostname-pid). |

## Scaling the database

Adding app copies moves the bottleneck to PostgreSQL. In order: (1) keep `DB_POOL_MAX` small, (2) move to a managed PostgreSQL with automatic backups, (3) add PgBouncer (set `DATABASE_DIRECT_URL`), (4) a read replica only if reports become slow. A single PostgreSQL comfortably serves many app copies for a business of this kind.

## Good to know

* `npm start` runs `npm audit fix` first (`prestart`). Do not use it for many copies; run `node server.js` (the Dockerfile does).
* M-Pesa callbacks and the site must be reachable on the public **https** `APP_URL`; terminate TLS at Cloudflare, your cloud load balancer, or add certbot to nginx.
* The app compresses responses itself and sets cache headers for images, so nginx does not need to.
