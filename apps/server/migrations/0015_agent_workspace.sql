-- Separate conversations and deterministic line watches belong to one anonymous traveller.
CREATE TABLE workspace_agents (
 id TEXT PRIMARY KEY, traveller_id TEXT NOT NULL REFERENCES travellers(id), name TEXT NOT NULL,
 is_primary INTEGER NOT NULL CHECK (is_primary IN (0,1)), conversation_id TEXT,
 turn_token TEXT, turn_locked_until TEXT,
 created_at TEXT NOT NULL, UNIQUE (id, traveller_id)
);
CREATE UNIQUE INDEX workspace_primary ON workspace_agents (traveller_id) WHERE is_primary = 1;
CREATE TABLE workspace_messages (
 id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES workspace_agents(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK (role IN ('user','assistant')), text TEXT NOT NULL,
 answer TEXT CHECK (answer IS NULL OR json_valid(answer)), created_at TEXT NOT NULL
);
CREATE INDEX workspace_messages_agent ON workspace_messages(agent_id, created_at);
CREATE TABLE workspace_watches (
 id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES workspace_agents(id) ON DELETE CASCADE,
 line TEXT NOT NULL,
 kind TEXT NOT NULL DEFAULT 'line' CHECK (kind IN ('line','street')),
 generation INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL CHECK (status IN ('waiting','active','clear','unavailable','paused','needs_setup')),
 saw_alert INTEGER NOT NULL DEFAULT 0 CHECK (saw_alert IN (0,1)), checked_at TEXT,
 source TEXT CHECK (source IS NULL OR json_valid(source)),
 alerted_at TEXT,
 segment_id TEXT,
 threshold_kmh REAL,
 speed_kmh REAL,
 measured_at TEXT,
 consecutive INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL
);
CREATE INDEX workspace_watches_agent ON workspace_watches(agent_id);
