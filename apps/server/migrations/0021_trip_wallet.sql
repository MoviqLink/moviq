-- The trip wallet. A top-up counts once its PayPal payment is captured (`payment_id` set by the
-- payment's own transaction). A spend is a ticket paid from the balance: its payment is recorded
-- in the same ledger as every other one, with no PayPal order.
CREATE TABLE wallet_top_ups (
  id TEXT PRIMARY KEY,
  traveller_id TEXT NOT NULL REFERENCES travellers(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (currency = 'USD'),
  created_at TEXT NOT NULL,
  payment_id TEXT UNIQUE REFERENCES payment_operations(id)
) STRICT;
CREATE INDEX wallet_top_ups_by_traveller ON wallet_top_ups (traveller_id, created_at);

CREATE TABLE wallet_spends (
  payment_id TEXT PRIMARY KEY REFERENCES payment_operations(id),
  traveller_id TEXT NOT NULL REFERENCES travellers(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (currency = 'USD'),
  label TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX wallet_spends_by_traveller ON wallet_spends (traveller_id, created_at);
