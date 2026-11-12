-- Travellers start as an anonymous device session; nothing personal is stored. Only a hash of
-- the session id is kept, so a copy of the database cannot be used to act as a traveller.
CREATE TABLE travellers (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
) STRICT;

CREATE TABLE traveller_sessions (
  id_hash TEXT PRIMARY KEY,
  traveller_id TEXT NOT NULL REFERENCES travellers (id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;

CREATE INDEX traveller_sessions_by_expiry ON traveller_sessions (expires_at);
