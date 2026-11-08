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
