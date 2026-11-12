-- Plans keep the itineraries the server computed, so a journey is created from a plan id and
-- never from data sent by a client. They expire after a short while.
CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  traveller_id TEXT NOT NULL,
  request TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;

CREATE INDEX plans_by_expiry ON plans (expires_at);

-- A watched journey: its request and itinerary as validated JSON, the latest assessment of the
-- watch, its incidents and alternatives. `version` grows on every change, for optimistic
-- concurrency and so the trip screen knows when to refresh.
CREATE TABLE journeys (
  id TEXT PRIMARY KEY,
  traveller_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('watching', 'completed', 'cancelled')),
  request TEXT NOT NULL,
  itinerary TEXT NOT NULL,
  watch TEXT NOT NULL,
  incidents TEXT NOT NULL,
  alternatives TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0)
) STRICT;

CREATE INDEX journeys_by_traveller ON journeys (traveller_id, created_at);
CREATE INDEX journeys_by_state ON journeys (state);

-- What happened to each journey, in order: watch results, incidents, changes of itinerary.
CREATE TABLE journey_events (
  id INTEGER PRIMARY KEY,
  journey_id TEXT NOT NULL REFERENCES journeys (id),
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL
) STRICT;

CREATE INDEX journey_events_by_journey ON journey_events (journey_id, id);
