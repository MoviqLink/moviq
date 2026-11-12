-- Sessions of the control room. Only a hash of the session id is stored, so a copy of the
-- database cannot be used to log in.
CREATE TABLE ops_sessions (
  id_hash TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;

CREATE INDEX ops_sessions_by_expiry ON ops_sessions (expires_at);
