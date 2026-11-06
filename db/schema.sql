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
  icon        TEXT          NOT NULL DEFAULT '🧺',
  color       TEXT          NOT NULL DEFAULT '#10b981',
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
CREATE INDEX IF NOT EXISTS requests_status_idx   ON requests(status);
CREATE INDEX IF NOT EXISTS requests_created_idx  ON requests(created_at DESC);
CREATE INDEX IF NOT EXISTS requests_customer_idx ON requests(customer_id);

CREATE TABLE IF NOT EXISTS request_items (
  id            SERIAL PRIMARY KEY,
  request_id    INTEGER NOT NULL REFERENCES requests(id)   ON DELETE CASCADE,
  category_id   INTEGER          REFERENCES categories(id) ON DELETE SET NULL,
  category_name TEXT    NOT NULL, -- snapshot, so history survives category edits/deletes
  quantity      INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS request_items_request_idx ON request_items(request_id);

CREATE TABLE IF NOT EXISTS request_events (
  id         SERIAL PRIMARY KEY,
  request_id INTEGER     NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  status     TEXT        NOT NULL,
  note       TEXT        NOT NULL DEFAULT '',
  created_by TEXT        NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS request_events_request_idx ON request_events(request_id);
