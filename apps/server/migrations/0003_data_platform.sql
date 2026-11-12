-- Facts about each source, written by the worker after every run. The state shown to people is
-- recomputed from these facts at read time, so a served copy keeps ageing.
CREATE TABLE source_health (
  source_id TEXT PRIMARY KEY,
  served_version TEXT,
  data_time TEXT,
  received_at TEXT,
  coverage TEXT,
  etag TEXT,
  last_good_at TEXT,
  last_attempt_at TEXT,
  last_outcome TEXT,
  last_error_at TEXT,
  last_error_code TEXT,
  last_error_detail TEXT,
  latency_ms INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  retry_not_before TEXT,
  state TEXT NOT NULL,
  state_since TEXT NOT NULL,
  evidence TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

-- Every collection attempt, kept 30 days.
CREATE TABLE source_runs (
  id INTEGER PRIMARY KEY,
  source_id TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('schedule', 'manual')),
  requested_by TEXT,
  reason TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  outcome TEXT NOT NULL,
  http_status INTEGER,
  bytes INTEGER,
  duration_ms INTEGER NOT NULL,
  data_time TEXT,
  version TEXT,
  coverage TEXT,
  error_code TEXT,
  detail TEXT
) STRICT;

CREATE INDEX source_runs_by_source ON source_runs (source_id, id);
CREATE INDEX source_runs_by_start ON source_runs (started_at);

-- Admitted versions: the served one and, for timetables, a few before it. One row per run that
-- changed something, so real-time feeds cost one write per update, not one per vehicle.
CREATE TABLE source_snapshots (
  source_id TEXT NOT NULL,
  version TEXT NOT NULL,
  data_time TEXT NOT NULL,
  admitted_at TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  payload BLOB NOT NULL,
  PRIMARY KEY (source_id, version)
) STRICT;

-- Every change of state, with the evidence at that moment.
CREATE TABLE source_incidents (
  id INTEGER PRIMARY KEY,
  source_id TEXT NOT NULL,
  at TEXT NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  evidence TEXT NOT NULL
) STRICT;

CREATE INDEX source_incidents_by_source ON source_incidents (source_id, id);

-- Explicit, expiring interest in a source: a watched journey, a virtual ride, an open screen.
CREATE TABLE interests (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;

CREATE INDEX interests_by_source ON interests (source_id, expires_at);

-- Work asked for by people or the API and carried out by the worker.
CREATE TABLE jobs (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'done', 'failed', 'cancelled')),
  requested_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
) STRICT;

CREATE INDEX jobs_by_state ON jobs (state, id);

-- Every sensitive action, with who did it and why.
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  reason TEXT
) STRICT;
