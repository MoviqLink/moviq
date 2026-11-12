-- One row per named lease. Its holder renews it before it expires; anyone may take it once expired.
-- The fencing token grows on every change of holder, so stale holders can be told apart.
CREATE TABLE worker_leases (
  name TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  fencing_token INTEGER NOT NULL CHECK (fencing_token > 0),
  acquired_at TEXT NOT NULL,
  renewed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;
