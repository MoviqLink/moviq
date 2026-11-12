-- Independent sessions for the fictional transport provider, never general merchant access.
CREATE TABLE ticket_demo_partner_sessions (
  id_hash TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
) STRICT;
