-- Sandbox-only purchase intents. A receipt is linked once to a confirmed payment; it is not a transit ticket.
CREATE TABLE ticket_intents (
  id TEXT PRIMARY KEY,
  traveller_id TEXT NOT NULL REFERENCES travellers(id),
  product_id TEXT NOT NULL,
  product_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payment_id TEXT UNIQUE REFERENCES payment_operations(id)
);
CREATE INDEX ticket_intents_by_traveller ON ticket_intents (traveller_id, created_at);
