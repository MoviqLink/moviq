-- Sara's planning conversations, one per traveller and conversation id. Only the draft of the
-- trip is kept (places found by the geocoder, the time to arrive, the flight and the plan), never
-- what the traveller wrote. A conversation expires after a short idle time.
CREATE TABLE assistant_conversations (
  id TEXT PRIMARY KEY,
  traveller_id TEXT NOT NULL REFERENCES travellers (id),
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;

CREATE INDEX assistant_conversations_by_expiry ON assistant_conversations (expires_at);

-- Tokens the assistants used per New York day, all travellers together, against the daily
-- budget. A call holds its maximum before it starts and settles to what it used.
CREATE TABLE assistant_token_usage (
  day TEXT PRIMARY KEY,
  tokens INTEGER NOT NULL CHECK (tokens >= 0),
  calls INTEGER NOT NULL CHECK (calls >= 0),
  updated_at TEXT NOT NULL
) STRICT;
