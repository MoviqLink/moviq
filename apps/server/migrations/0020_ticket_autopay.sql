-- What the traveller lets the assistant do with PayPal. `enabled` is the traveller's own switch,
-- on by default. `agreement_id` is the PayPal billing agreement, null until PayPal returns the
-- traveller with `token_id` approved; orders are charged to it with no PayPal window.
CREATE TABLE ticket_autopay (
  traveller_id TEXT PRIMARY KEY REFERENCES travellers(id),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  token_id TEXT UNIQUE,
  agreement_id TEXT,
  updated_at TEXT NOT NULL,
  connected_at TEXT
) STRICT;
