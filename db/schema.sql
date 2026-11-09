-- Tap to Wash - PostgreSQL schema (safe to run more than once)

CREATE TABLE IF NOT EXISTS admins (
  id            SERIAL PRIMARY KEY,
  name          TEXT        NOT NULL,
  email         TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- What customers can choose to wash. Fully managed by the admin.
CREATE TABLE IF NOT EXISTS categories (
  id          SERIAL PRIMARY KEY,
  name        TEXT          NOT NULL,
  description TEXT          NOT NULL DEFAULT '',
  icon        TEXT          NOT NULL DEFAULT 'shopping-basket',
  color       TEXT          NOT NULL DEFAULT '#c2663a',
  price       NUMERIC(12,2),
  unit        TEXT          NOT NULL DEFAULT 'item',
  is_active   BOOLEAN       NOT NULL DEFAULT TRUE,
  sort_order  INTEGER       NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customers (
  id         SERIAL PRIMARY KEY,
  name       TEXT        NOT NULL,
  phone      TEXT        NOT NULL,
  phone_key  TEXT        NOT NULL UNIQUE, -- last 9 digits, used to recognise repeat customers
  email      TEXT,
  notes      TEXT        NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS requests (
  id                   SERIAL PRIMARY KEY,
  ref_code             TEXT             NOT NULL UNIQUE,
  customer_id          INTEGER          NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  location_description TEXT             NOT NULL,
  notes                TEXT             NOT NULL DEFAULT '',
  latitude             DOUBLE PRECISION,
  longitude            DOUBLE PRECISION,
  location_accuracy    DOUBLE PRECISION,
  preferred_time       TEXT             NOT NULL DEFAULT '',
  status               TEXT             NOT NULL DEFAULT 'new',
  total_amount         NUMERIC(12,2)    NOT NULL DEFAULT 0,
  amount_paid          NUMERIC(12,2)    NOT NULL DEFAULT 0,
  admin_notes          TEXT             NOT NULL DEFAULT '',
  created_at           TIMESTAMPTZ      NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ      NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS request_items (
  id            SERIAL PRIMARY KEY,
  request_id    INTEGER NOT NULL REFERENCES requests(id)   ON DELETE CASCADE,
  category_id   INTEGER          REFERENCES categories(id) ON DELETE SET NULL,
  category_name TEXT    NOT NULL, -- snapshot, so history survives category edits/deletes
  quantity      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS request_events (
  id         SERIAL PRIMARY KEY,
  request_id INTEGER     NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  status     TEXT        NOT NULL,
  note       TEXT        NOT NULL DEFAULT '',
  created_by TEXT        NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- later additions (all safe to re-run) ----------
ALTER TABLE admins   ADD COLUMN IF NOT EXISTS failed_attempts      INTEGER     NOT NULL DEFAULT 0;
ALTER TABLE admins   ADD COLUMN IF NOT EXISTS locked_until         TIMESTAMPTZ;
ALTER TABLE admins   ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE admins   ADD COLUMN IF NOT EXISTS last_login_at        TIMESTAMPTZ;
ALTER TABLE admins   ADD COLUMN IF NOT EXISTS role                 TEXT        NOT NULL DEFAULT 'owner';
ALTER TABLE admins   ADD COLUMN IF NOT EXISTS is_active            BOOLEAN     NOT NULL DEFAULT TRUE;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS terms_version     INTEGER;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;

-- Photos the admin uploads for the public page (hero, services, how, cta).
CREATE TABLE IF NOT EXISTS media (
  slot       TEXT PRIMARY KEY,
  mime       TEXT        NOT NULL,
  data       BYTEA       NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Who did what in the admin area.
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  admin_id    INTEGER,
  admin_email TEXT        NOT NULL DEFAULT '',
  action      TEXT        NOT NULL,
  detail      TEXT        NOT NULL DEFAULT '',
  ip          TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- indexes (match the queries the app really runs) ----------
DROP INDEX IF EXISTS requests_status_idx;
DROP INDEX IF EXISTS requests_customer_idx;
DROP INDEX IF EXISTS request_items_request_idx;
DROP INDEX IF EXISTS request_events_request_idx;
CREATE INDEX IF NOT EXISTS requests_created_idx         ON requests(created_at DESC);
CREATE INDEX IF NOT EXISTS requests_status_created_idx  ON requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS requests_customer_created_idx ON requests(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS request_items_request_idx2   ON request_items(request_id, category_id);
CREATE INDEX IF NOT EXISTS request_items_category_idx   ON request_items(category_id);
CREATE INDEX IF NOT EXISTS request_events_req_created_idx ON request_events(request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS categories_active_sort_idx   ON categories(is_active, sort_order, name);
CREATE INDEX IF NOT EXISTS customers_created_idx        ON customers(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_created_idx            ON audit_log(created_at DESC);

-- ---------- notifications (staff alerts) ----------
ALTER TABLE admins ADD COLUMN IF NOT EXISTS phone           TEXT    NOT NULL DEFAULT '';
ALTER TABLE admins ADD COLUMN IF NOT EXISTS notify_inapp    BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS notify_push     BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS notify_whatsapp BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS notifications (
  id         BIGSERIAL PRIMARY KEY,
  admin_id   INTEGER     NOT NULL REFERENCES admins(id)   ON DELETE CASCADE,
  request_id INTEGER              REFERENCES requests(id) ON DELETE CASCADE,
  kind       TEXT        NOT NULL DEFAULT '',
  title      TEXT        NOT NULL,
  body       TEXT        NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS notifications_admin_idx  ON notifications(admin_id, id DESC);
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications(admin_id) WHERE read_at IS NULL;

-- One row per phone/browser a staff member enabled push on.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         SERIAL PRIMARY KEY,
  admin_id   INTEGER     NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  endpoint   TEXT        NOT NULL UNIQUE,
  p256dh     TEXT        NOT NULL,
  auth       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subs_admin_idx ON push_subscriptions(admin_id);

-- Server-side secrets generated by the app (push keys).
CREATE TABLE IF NOT EXISTS app_secrets (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ---------- optional customer accounts ----------
CREATE TABLE IF NOT EXISTS accounts (
  id                   SERIAL PRIMARY KEY,
  name                 TEXT        NOT NULL,
  email                TEXT        NOT NULL UNIQUE, -- stored lower-case
  phone                TEXT        NOT NULL DEFAULT '',
  password_hash        TEXT        NOT NULL,
  must_change_password BOOLEAN     NOT NULL DEFAULT FALSE,
  is_active            BOOLEAN     NOT NULL DEFAULT TRUE,
  failed_attempts      INTEGER     NOT NULL DEFAULT 0,
  locked_until         TIMESTAMPTZ,
  last_login_at        TIMESTAMPTZ,
  terms_version        INTEGER,
  accepted_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS requests_account_idx  ON requests(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS accounts_created_idx  ON accounts(created_at DESC);

-- ---------- self-service password reset (staff and customers) ----------
CREATE TABLE IF NOT EXISTS password_resets (
  id         SERIAL PRIMARY KEY,
  kind       TEXT        NOT NULL CHECK (kind IN ('admin', 'customer')),
  user_id    INTEGER     NOT NULL,
  code_hash  TEXT        NOT NULL,
  attempts   INTEGER     NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_resets_lookup_idx ON password_resets(kind, user_id, created_at DESC);

-- ---------- laundry operations suite ----------
ALTER TABLE requests ADD COLUMN IF NOT EXISTS pickup_scheduled_at TIMESTAMPTZ;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS delivery_scheduled_at TIMESTAMPTZ;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS rider_admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS branch_id INTEGER;

CREATE TABLE IF NOT EXISTS branches (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'requests_branch_fk') THEN
    ALTER TABLE requests ADD CONSTRAINT requests_branch_fk FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS quality_inspections (
  id BIGSERIAL PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  checked_by INTEGER REFERENCES admins(id) ON DELETE SET NULL, stain_check BOOLEAN NOT NULL DEFAULT FALSE,
  count_check BOOLEAN NOT NULL DEFAULT FALSE, damage_check BOOLEAN NOT NULL DEFAULT FALSE,
  packaging_check BOOLEAN NOT NULL DEFAULT FALSE, passed BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expenses (
  id BIGSERIAL PRIMARY KEY, category TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', amount NUMERIC(12,2) NOT NULL CHECK(amount >= 0),
  spent_on DATE NOT NULL DEFAULT CURRENT_DATE, recorded_by INTEGER REFERENCES admins(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS inventory_items (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, unit TEXT NOT NULL DEFAULT 'pcs', quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
  reorder_level NUMERIC(12,2) NOT NULL DEFAULT 0, unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS inventory_movements (
  id BIGSERIAL PRIMARY KEY, inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  quantity_change NUMERIC(12,2) NOT NULL, reason TEXT NOT NULL DEFAULT '', recorded_by INTEGER REFERENCES admins(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS customer_complaints (
  id BIGSERIAL PRIMARY KEY, request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL, subject TEXT NOT NULL, details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','investigating','resolved','closed')),
  resolution TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS discounts (
  id SERIAL PRIMARY KEY, code TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', discount_type TEXT NOT NULL CHECK(discount_type IN ('percent','fixed')),
  value NUMERIC(12,2) NOT NULL CHECK(value > 0), min_orders INTEGER NOT NULL DEFAULT 1, starts_at DATE, ends_at DATE,
  max_uses INTEGER, uses INTEGER NOT NULL DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS refunds (
  id BIGSERIAL PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK(amount > 0), reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','paid')),
  recorded_by INTEGER REFERENCES admins(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expenses_date_idx ON expenses(spent_on DESC);
CREATE INDEX IF NOT EXISTS complaints_status_idx ON customer_complaints(status, created_at DESC);

-- Loyalty points were removed: stop awarding them on existing installs (old tables are left untouched).
DROP TRIGGER IF EXISTS requests_loyalty_award ON requests;
DROP FUNCTION IF EXISTS award_laundry_loyalty_points();

CREATE TABLE IF NOT EXISTS customer_reviews (
  id BIGSERIAL PRIMARY KEY, request_id INTEGER NOT NULL UNIQUE REFERENCES requests(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), comment TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_reviews_created_idx ON customer_reviews(created_at DESC);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS subtotal_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS discount_code TEXT NOT NULL DEFAULT '';
ALTER TABLE requests ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS dispatch_stage TEXT NOT NULL DEFAULT 'unassigned';
