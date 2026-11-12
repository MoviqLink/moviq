import { emptyState, recorderStateSchema, type RecorderState } from './state.js';
import type { Sql } from './ports.js';
import { BUFFER_TABLE } from './buffer.js';

const STATE_TABLE =
  'CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL)';

/** Creates the tables and reads the saved state; a state that no longer matches starts afresh. */
export function loadState(sql: Sql): RecorderState {
  sql.exec(STATE_TABLE);
  sql.exec(BUFFER_TABLE);
  const row = sql.exec('SELECT json FROM state WHERE id = 1').toArray()[0];
  const text = row?.['json'];
  if (typeof text !== 'string') return emptyState();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return emptyState();
  }
  const parsed = recorderStateSchema.safeParse(value);
  return parsed.success ? parsed.data : emptyState();
}

export function saveState(sql: Sql, state: RecorderState, nowMs: number): void {
  state.savedAt = nowMs;
  sql.exec('INSERT OR REPLACE INTO state (id, json) VALUES (1, ?)', JSON.stringify(state));
}
