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

-- ---------- Weigh -> bill -> customer confirms -> payment (stage 1) ----------
-- Quantities measured by the rider. request_items.quantity stays the customer's estimate / order count.
ALTER TABLE request_items ADD COLUMN IF NOT EXISTS unit         TEXT;
ALTER TABLE request_items ADD COLUMN IF NOT EXISTS rate         NUMERIC(12,2);
ALTER TABLE request_items ADD COLUMN IF NOT EXISTS measured_qty NUMERIC(10,2);
ALTER TABLE request_items ADD COLUMN IF NOT EXISTS line_total   NUMERIC(12,2);

-- bill_status: none | needs_price | awaiting_confirm | confirmed | disputed | legacy
ALTER TABLE requests ADD COLUMN IF NOT EXISTS bill_status       TEXT        NOT NULL DEFAULT 'none';
ALTER TABLE requests ADD COLUMN IF NOT EXISTS bill_version      INTEGER     NOT NULL DEFAULT 0;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS bill_confirmed_at TIMESTAMPTZ;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS bill_confirmed_by TEXT        NOT NULL DEFAULT '';
ALTER TABLE requests ADD COLUMN IF NOT EXISTS weighed_by        TEXT        NOT NULL DEFAULT '';
ALTER TABLE requests ADD COLUMN IF NOT EXISTS weighed_at        TIMESTAMPTZ;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS pay_later         BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS pay_later_by      TEXT        NOT NULL DEFAULT '';

-- Orders that were already past pick-up before this feature existed are never blocked by it.
UPDATE requests SET bill_status = 'legacy' WHERE bill_status = 'none' AND status NOT IN ('new', 'confirmed');

CREATE TABLE IF NOT EXISTS payments (
  id          SERIAL PRIMARY KEY,
  request_id  INTEGER       NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  method      TEXT          NOT NULL CHECK (method IN ('cash', 'mpesa')),
  reference   TEXT          NOT NULL DEFAULT '',
  recorded_by TEXT          NOT NULL DEFAULT '',
  reconciled  BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_request_idx ON payments(request_id);
-- The same M-Pesa confirmation code can never be counted twice.
CREATE UNIQUE INDEX IF NOT EXISTS payments_mpesa_ref_uq ON payments(reference) WHERE method = 'mpesa';

-- Deleting a request must never delete the money earned on it. The money stays in two places:
--  * payments keep their rows (request_id becomes empty, request_ref keeps the order code), and the M-Pesa code stays used;
--  * deleted_requests keeps a one-line record of the order (totals, who deleted it and when). Dashboard, Operations,
--    Reports and the Excel report all still count this money.
CREATE TABLE IF NOT EXISTS deleted_requests (
  id             SERIAL PRIMARY KEY,
  original_id    INTEGER,
  ref_code       TEXT          NOT NULL,
  customer_id    INTEGER       REFERENCES customers(id) ON DELETE SET NULL,
  customer_name  TEXT          NOT NULL DEFAULT '',
  customer_phone TEXT          NOT NULL DEFAULT '',
  status         TEXT          NOT NULL DEFAULT '',
  total_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_paid    NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ   NOT NULL,
  deleted_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  deleted_by     TEXT          NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS deleted_requests_created_idx ON deleted_requests(created_at);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS request_ref TEXT NOT NULL DEFAULT '';
ALTER TABLE payments ALTER COLUMN request_id DROP NOT NULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_request_id_fkey' AND confdeltype = 'c') THEN
    ALTER TABLE payments DROP CONSTRAINT payments_request_id_fkey;
    ALTER TABLE payments ADD CONSTRAINT payments_request_id_fkey FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Indexes on foreign-key columns that had none. They speed up the per-request lookups (quality gate, refunds, complaints,
-- alerts) and, importantly, deleting a request, which has to find its related rows in every one of these tables.
CREATE INDEX IF NOT EXISTS quality_request_idx        ON quality_inspections(request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS refunds_request_idx        ON refunds(request_id);
CREATE INDEX IF NOT EXISTS complaints_request_idx     ON customer_complaints(request_id);
CREATE INDEX IF NOT EXISTS complaints_customer_idx    ON customer_complaints(customer_id);
CREATE INDEX IF NOT EXISTS reviews_customer_idx       ON customer_reviews(customer_id);
CREATE INDEX IF NOT EXISTS notifications_request_idx  ON notifications(request_id);
CREATE INDEX IF NOT EXISTS requests_branch_idx        ON requests(branch_id) WHERE branch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS requests_rider_idx         ON requests(rider_admin_id) WHERE rider_admin_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS deleted_requests_customer_idx ON deleted_requests(customer_id);
CREATE INDEX IF NOT EXISTS inventory_moves_item_idx   ON inventory_movements(inventory_item_id);

-- ---------- forward-only order status (enforced in the database, so no route, admin action or script can bypass it) ----------
-- new -> confirmed -> rider_arrived -> picked_up -> washing -> ready -> delivered. Cancelling is allowed until delivery; delivered and cancelled are final.
CREATE OR REPLACE FUNCTION requests_forward_only() RETURNS trigger AS $$
DECLARE
  flow TEXT[] := ARRAY['new','confirmed','rider_arrived','picked_up','washing','ready','delivered'];
  o INT;
  n INT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'Order status cannot move backward: a cancelled order cannot be re-opened (% -> %)', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'delivered' THEN
    RAISE EXCEPTION 'Order status cannot move backward: a delivered order is final (% -> %)', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'cancelled' THEN RETURN NEW; END IF;
  o := array_position(flow, OLD.status);
  n := array_position(flow, NEW.status);
  IF o IS NOT NULL AND n IS NOT NULL AND n < o THEN
    RAISE EXCEPTION 'Order status cannot move backward (% -> %)', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS requests_forward_only_trg ON requests;
CREATE TRIGGER requests_forward_only_trg BEFORE UPDATE OF status ON requests
  FOR EACH ROW EXECUTE FUNCTION requests_forward_only();

-- ---------- M-Pesa STK push (Daraja): one row per prompt sent to a customer's phone ----------
-- The row is created when the prompt is sent (pending) and settled once, by Safaricom's callback.
CREATE TABLE IF NOT EXISTS mpesa_stk (
  id                  SERIAL PRIMARY KEY,
  request_id          INTEGER       REFERENCES requests(id) ON DELETE SET NULL,
  request_ref         TEXT          NOT NULL DEFAULT '',
  phone               TEXT          NOT NULL,
  amount              INTEGER       NOT NULL CHECK (amount > 0),
  merchant_request_id TEXT          NOT NULL DEFAULT '',
  checkout_request_id TEXT          NOT NULL UNIQUE,
  status              TEXT          NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'cancelled', 'timeout')),
  result_code         INTEGER,
  result_desc         TEXT          NOT NULL DEFAULT '',
  receipt             TEXT          NOT NULL DEFAULT '',
  paid_amount         NUMERIC(12,2),
  last_query_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS mpesa_stk_request_idx ON mpesa_stk(request_id, created_at DESC);


-- ---------- customer pickup booking calendar ----------
-- pickup_scheduled_at is the canonical booked slot (stored as timestamptz).
CREATE INDEX IF NOT EXISTS requests_pickup_slot_idx
  ON requests(pickup_scheduled_at)
  WHERE pickup_scheduled_at IS NOT NULL AND status NOT IN ('cancelled','delivered');

-- ---------- Promotions: timed popup ads + an automatic discount for every request made while one is running ----------
CREATE TABLE IF NOT EXISTS promotions (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL UNIQUE,                       -- auto-generated (PROMO-XXXXXX); stamped on each request made during the promotion
  discount_type TEXT NOT NULL CHECK(discount_type IN ('percent','fixed')),
  value NUMERIC(12,2) NOT NULL CHECK(value > 0),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS promotions_window_idx ON promotions(starts_at, ends_at);


-- ---------- Inventory and profit (owner and manager only) ----------
-- inventory_items.unit_cost is the weighted-average cost per unit; it is re-calculated every time stock is bought.
-- inventory_movements keeps a cost snapshot of every movement so profit history never changes when prices change later.
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS category  TEXT    NOT NULL DEFAULT 'General';
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS supplier  TEXT    NOT NULL DEFAULT '';
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- kind: opening | purchase | usage | waste | adjustment  (old rows stay 'adjustment' with no cost, so they never change your profit)
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS kind        TEXT          NOT NULL DEFAULT 'adjustment'
  CHECK (kind IN ('opening','purchase','usage','waste','adjustment'));
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS unit_cost   NUMERIC(14,4) NOT NULL DEFAULT 0;
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS supplier    TEXT          NOT NULL DEFAULT '';
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS reference   TEXT          NOT NULL DEFAULT '';
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS occurred_on DATE          NOT NULL DEFAULT CURRENT_DATE;
CREATE INDEX IF NOT EXISTS inventory_moves_date_idx ON inventory_movements(occurred_on DESC, id DESC);
CREATE INDEX IF NOT EXISTS inventory_moves_kind_idx ON inventory_movements(kind, occurred_on);

-- Average cost needs more than 2 decimals (e.g. KES 1,000 for 3 litres = 333.3333 per litre), or stock value drifts.
DO $$ BEGIN
  IF (SELECT numeric_scale FROM information_schema.columns WHERE table_name = 'inventory_items' AND column_name = 'unit_cost' LIMIT 1) = 2 THEN
    ALTER TABLE inventory_items ALTER COLUMN unit_cost TYPE NUMERIC(14,4);
  END IF;
END $$;
