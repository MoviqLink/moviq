-- One row per heartbeat of the leading worker: the hosting probe. Gaps between rows reveal
-- restarts and outages; a new fencing token marks a change of leader. latency_ms is how long the
-- worker waited to hold the write lock and confirm its lease.
CREATE TABLE worker_heartbeats (
  id INTEGER PRIMARY KEY,
  beat_at TEXT NOT NULL,
  holder TEXT NOT NULL,
  fencing_token INTEGER NOT NULL CHECK (fencing_token > 0),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0)
) STRICT;

CREATE INDEX worker_heartbeats_beat_at ON worker_heartbeats (beat_at);
