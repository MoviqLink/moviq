-- The recorder writes its events to compressed files under RECORDING_DIR. The database keeps only
-- where it is, what it wrote, what it could not record and the aggregates of each night.

-- The last run of `source_runs` the recorder has looked at. One row.
CREATE TABLE recorder_cursor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_run_id INTEGER NOT NULL CHECK (last_run_id >= 0),
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

-- The last version recorded of each source.
CREATE TABLE recorder_sources (
  source_id TEXT PRIMARY KEY,
  last_run_id INTEGER NOT NULL,
  last_version TEXT NOT NULL,
  last_data_time TEXT NOT NULL,
  last_written_at TEXT NOT NULL
) STRICT;

-- What was written per New York day (of the data) and source.
CREATE TABLE recorder_days (
  day TEXT NOT NULL,
  source_id TEXT NOT NULL,
  versions INTEGER NOT NULL CHECK (versions >= 0),
  events INTEGER NOT NULL CHECK (events >= 0),
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  lost_versions INTEGER NOT NULL CHECK (lost_versions >= 0),
  PRIMARY KEY (day, source_id)
) STRICT;

-- Admitted versions that could not be recorded, in runs of consecutive ones, with the evidence.
CREATE TABLE recorder_gaps (
  id INTEGER PRIMARY KEY,
  source_id TEXT NOT NULL,
  day TEXT NOT NULL,
  from_run_id INTEGER NOT NULL,
  to_run_id INTEGER NOT NULL CHECK (to_run_id >= from_run_id),
  versions INTEGER NOT NULL CHECK (versions > 0),
  first_data_time TEXT NOT NULL,
  last_data_time TEXT NOT NULL,
  evidence TEXT NOT NULL,
  recorded_at TEXT NOT NULL
) STRICT;

CREATE INDEX recorder_gaps_by_day ON recorder_gaps (day, source_id);

-- Every incident seen (alerts, outages, airport programmes, weather alerts), kept for good: the
-- durations of each kind are measured from here, counting the ones still open.
CREATE TABLE recorder_incidents (
  source_id TEXT NOT NULL,
  incident_id TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  kind TEXT NOT NULL,
  type TEXT NOT NULL,
  routes TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  -- Both null while it is still published.
  last_seen TEXT,
  closed_at TEXT,
  PRIMARY KEY (source_id, incident_id, first_seen)
) STRICT;

CREATE INDEX recorder_incidents_open ON recorder_incidents (source_id, closed_at);
CREATE INDEX recorder_incidents_by_start ON recorder_incidents (first_seen);

-- One row per day the nightly process reduced, with what was missing that day.
CREATE TABLE recorder_nightly (
  day TEXT PRIMARY KEY,
  outcome TEXT NOT NULL CHECK (outcome IN ('complete', 'incomplete', 'no-recording')),
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  detail TEXT NOT NULL
) STRICT;

-- Time between consecutive stops of a trip, in whole seconds, per day, with every sample. Kept
-- for the detail window, then folded into recorder_segment_months.
CREATE TABLE recorder_segment_times (
  day TEXT NOT NULL,
  mode TEXT NOT NULL,
  route TEXT NOT NULL,
  direction TEXT NOT NULL,
  from_stop TEXT NOT NULL,
  to_stop TEXT NOT NULL,
  band TEXT NOT NULL,
  day_type TEXT NOT NULL,
  n INTEGER NOT NULL CHECK (n > 0),
  p10 REAL NOT NULL,
  p50 REAL NOT NULL,
  p90 REAL NOT NULL,
  samples TEXT NOT NULL,
  PRIMARY KEY (day, mode, route, from_stop, to_stop, band)
) STRICT;

CREATE INDEX recorder_segment_times_by_key
  ON recorder_segment_times (route, from_stop, to_stop, band, day_type, day);

-- Segment run times of whole months, kept for good once their days leave the detail window.
CREATE TABLE recorder_segment_months (
  month TEXT NOT NULL,
  mode TEXT NOT NULL,
  route TEXT NOT NULL,
  direction TEXT NOT NULL,
  from_stop TEXT NOT NULL,
  to_stop TEXT NOT NULL,
  band TEXT NOT NULL,
  day_type TEXT NOT NULL,
  n INTEGER NOT NULL CHECK (n > 0),
  p10 REAL NOT NULL,
  p50 REAL NOT NULL,
  p90 REAL NOT NULL,
  p95 REAL NOT NULL,
  days INTEGER NOT NULL CHECK (days > 0),
  first_day TEXT NOT NULL,
  last_day TEXT NOT NULL,
  PRIMARY KEY (route, from_stop, to_stop, band, day_type, month, mode)
) STRICT;

-- Time between consecutive vehicles of a line at the same stop, per day and band.
CREATE TABLE recorder_headways (
  day TEXT NOT NULL,
  mode TEXT NOT NULL,
  route TEXT NOT NULL,
  direction TEXT NOT NULL,
  band TEXT NOT NULL,
  day_type TEXT NOT NULL,
  n INTEGER NOT NULL CHECK (n > 0),
  p50 REAL NOT NULL,
  p90 REAL NOT NULL,
  sum REAL NOT NULL,
  sum_squares REAL NOT NULL,
  bunched INTEGER NOT NULL CHECK (bunched >= 0),
  PRIMARY KEY (day, mode, route, direction, band)
) STRICT;

CREATE INDEX recorder_headways_by_route ON recorder_headways (route, band, day_type, day);

-- Error of the provider's predictions (predicted minus observed, whole seconds) by lead time.
CREATE TABLE recorder_prediction_errors (
  day TEXT NOT NULL,
  source_id TEXT NOT NULL,
  horizon_from INTEGER NOT NULL,
  horizon_to INTEGER NOT NULL CHECK (horizon_to > horizon_from),
  n INTEGER NOT NULL CHECK (n > 0),
  p50_abs REAL NOT NULL,
  p90_abs REAL NOT NULL,
  bias_p50 REAL NOT NULL,
  histogram TEXT NOT NULL,
  PRIMARY KEY (day, source_id, horizon_from)
) STRICT;

-- Vehicles seen standing still between two stops of their trip, each with its proof.
CREATE TABLE recorder_stoppages (
  id INTEGER PRIMARY KEY,
  day TEXT NOT NULL,
  mode TEXT NOT NULL,
  route TEXT NOT NULL,
  trip TEXT NOT NULL,
  vehicle TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  seconds INTEGER NOT NULL CHECK (seconds > 0),
  proof TEXT NOT NULL
) STRICT;

CREATE INDEX recorder_stoppages_by_day ON recorder_stoppages (day, route);

-- How long incidents last, as a survival curve that counts the ones still open, per night.
CREATE TABLE recorder_incident_durations (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  type TEXT NOT NULL,
  route TEXT NOT NULL,
  n INTEGER NOT NULL CHECK (n > 0),
  closed INTEGER NOT NULL CHECK (closed >= 0),
  still_open INTEGER NOT NULL CHECK (still_open >= 0),
  p50_seconds REAL,
  p90_seconds REAL,
  curve TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  PRIMARY KEY (day, kind, type, route)
) STRICT;
