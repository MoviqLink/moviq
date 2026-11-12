-- MovIQ's own ledger of PayPal payments. Amounts are integer minor units with their currency;
-- instants are UTC text written by `toInstant`.

-- One row per payment: who pays, for what, how much, and where it stands with PayPal. Every
-- payment starts `unknown` (PayPal has not answered yet) and only moves along the transitions
-- listed below. `version` grows on every change, for optimistic concurrency.
CREATE TABLE payment_operations (
  id TEXT PRIMARY KEY,
  traveller_id TEXT NOT NULL REFERENCES travellers (id),
  purpose TEXT NOT NULL,
  purpose_key TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (currency = 'USD'),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 127),
  status TEXT NOT NULL CHECK (
    status IN ('created', 'approved', 'authorized', 'captured', 'voided', 'refunded', 'failed', 'unknown')
  ),
  -- What an `unknown` payment is waiting for PayPal to settle.
  pending TEXT CHECK (pending IN ('create', 'capture', 'refund')),
  paypal_order_id TEXT UNIQUE,
  paypal_capture_id TEXT UNIQUE,
  -- The last status PayPal reported for the order or its capture, as PayPal wrote it.
  paypal_status TEXT,
  -- Why the payment failed, or what is still unknown about it.
  detail TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- When reconciliation looks at it again; NULL once settled.
  next_check_at TEXT,
  checks INTEGER NOT NULL DEFAULT 0 CHECK (checks >= 0),
  version INTEGER NOT NULL CHECK (version > 0),
  CHECK ((status = 'unknown') = (pending IS NOT NULL))
) STRICT;

-- One open payment per traveller and purchase: a repeated request finds it instead of opening
-- another order, and a purchase already paid cannot be paid again.
CREATE UNIQUE INDEX payment_operations_one_open
  ON payment_operations (traveller_id, purpose_key)
  WHERE status IN ('unknown', 'created', 'approved', 'captured');

CREATE INDEX payment_operations_due
  ON payment_operations (next_check_at)
  WHERE next_check_at IS NOT NULL;

-- The only status changes a payment can make. The trigger below refuses any other, so no code
-- path can skip a step, whatever it writes.
CREATE TABLE payment_status_transitions (
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  PRIMARY KEY (from_status, to_status)
) STRICT;

INSERT INTO payment_status_transitions (from_status, to_status) VALUES
  ('unknown', 'created'),
  ('unknown', 'approved'),
  ('unknown', 'captured'),
  ('unknown', 'refunded'),
  ('unknown', 'failed'),
  ('unknown', 'voided'),
  ('created', 'approved'),
  ('created', 'unknown'),
  ('created', 'failed'),
  ('created', 'voided'),
  ('approved', 'unknown'),
  ('approved', 'failed'),
  ('approved', 'voided'),
  ('captured', 'refunded');

CREATE TRIGGER payment_operations_start_unknown
BEFORE INSERT ON payment_operations
WHEN NEW.status <> 'unknown'
BEGIN
  SELECT RAISE(ABORT, 'a payment starts unknown');
END;

CREATE TRIGGER payment_operations_allowed_transition
BEFORE UPDATE OF status ON payment_operations
WHEN NEW.status <> OLD.status AND NOT EXISTS (
  SELECT 1 FROM payment_status_transitions
  WHERE from_status = OLD.status AND to_status = NEW.status
)
BEGIN
  SELECT RAISE(ABORT, 'payment status transition not allowed');
END;

-- Every change of a payment, in order, with where it was learnt.
CREATE TABLE payment_history (
  id INTEGER PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payment_operations (id),
  at TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('api', 'webhook', 'reconciliation')),
  detail TEXT
) STRICT;

CREATE INDEX payment_history_by_payment ON payment_history (payment_id, id);

-- Money given back. A PayPal refund is recorded once, whatever repeats it; two refunds of the
-- same payment are told apart by their operation, which is also their PayPal-Request-Id.
CREATE TABLE payment_refunds (
  payment_id TEXT NOT NULL REFERENCES payment_operations (id),
  operation TEXT NOT NULL,
  paypal_refund_id TEXT NOT NULL UNIQUE,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (currency = 'USD'),
  paypal_status TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (payment_id, operation)
) STRICT;

-- Notifications from providers. An event is handled until it is marked processed, and once it
-- is, a repeat is acknowledged without being handled again.
CREATE TABLE provider_events (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  received_at TEXT NOT NULL,
  deliveries INTEGER NOT NULL CHECK (deliveries > 0),
  processed_at TEXT,
  outcome TEXT,
  payment_id TEXT REFERENCES payment_operations (id),
  last_error TEXT,
  PRIMARY KEY (provider, event_id)
) STRICT;
