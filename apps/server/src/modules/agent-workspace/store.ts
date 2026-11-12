import { randomUUID } from 'node:crypto';
import {
  agentDetailSchema,
  agentListSchema,
  toInstant,
  type AssistantTurn,
} from '@moviq/contracts';
import { z } from 'zod';
import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';

const agentRow = z.object({
  id: z.string(),
  name: z.string(),
  is_primary: z.number(),
  conversation_id: z.string().nullable(),
});
const messageRow = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  created_at: z.string(),
  answer: z.string().nullable(),
});
const watchRow = z.object({
  id: z.string(),
  line: z.string(),
  kind: z.enum(['line', 'street']),
  status: z.string(),
  threshold_kmh: z.number().nullable(),
  speed_kmh: z.number().nullable(),
  measured_at: z.string().nullable(),
  checked_at: z.string().nullable(),
  source: z.string().nullable(),
  alerted_at: z.string().nullable(),
});
const agent = (row: z.infer<typeof agentRow>) => ({
  id: row.id,
  name: row.name,
  primary: row.is_primary === 1,
});
const parseJson = (text: string | null): unknown =>
  text === null ? null : (JSON.parse(text) as unknown);

export async function ensurePrimary(db: Database, traveller: string, now: Date): Promise<void> {
  await db.execute({
    sql: `INSERT INTO workspace_agents (id, traveller_id, name, is_primary, created_at)
    SELECT ?, ?, 'Sara', 1, ? WHERE NOT EXISTS
      (SELECT 1 FROM workspace_agents WHERE traveller_id = ? AND is_primary = 1)`,
    args: [randomUUID(), traveller, toInstant(now), traveller],
  });
}
export async function listAgents(db: Database, traveller: string) {
  const result = await db.query({
    sql: 'SELECT * FROM workspace_agents WHERE traveller_id = ? ORDER BY is_primary DESC, created_at, id',
    args: [traveller],
  });
  return agentListSchema.parse({
    agents: result.rows.map((row) => agent(parseRow(agentRow, row, 'workspace_agents'))),
  });
}
export async function createAgent(
  db: Database,
  traveller: string,
  name: string,
  now: Date,
): Promise<boolean> {
  const result = await db.execute({
    sql: `INSERT INTO workspace_agents (id, traveller_id, name, is_primary, created_at)
    SELECT ?, ?, ?, 0, ? WHERE (SELECT count(*) FROM workspace_agents WHERE traveller_id = ? AND is_primary = 0) < 2`,
    args: [randomUUID(), traveller, name, toInstant(now), traveller],
  });
  return result.rowsAffected === 1;
}
export async function ownedAgent(db: Database, traveller: string, id: string) {
  const result = await db.query({
    sql: 'SELECT * FROM workspace_agents WHERE id = ? AND traveller_id = ?',
    args: [id, traveller],
  });
  return result.rows.length === 0
    ? undefined
    : parseRow(agentRow, result.rows[0], 'workspace_agents');
}
export async function detail(db: Database, traveller: string, id: string) {
  const row = await ownedAgent(db, traveller, id);
  if (row === undefined) return undefined;
  const messages = await db.query({
    sql: `SELECT * FROM (SELECT rowid AS seq, * FROM workspace_messages WHERE agent_id = ? ORDER BY rowid
      DESC LIMIT 100) ORDER BY seq`,
    args: [id],
  });
  const watches = await db.query({
    sql: 'SELECT * FROM workspace_watches WHERE agent_id = ? ORDER BY created_at, id',
    args: [id],
  });
  return agentDetailSchema.parse({
    agent: agent(row),
    messages: messages.rows.map((value) => {
      const m = parseRow(messageRow, value, 'workspace_messages');
      return {
        id: m.id,
        role: m.role,
        text: m.text,
        at: m.created_at,
        answer: parseJson(m.answer),
      };
    }),
    watches: watches.rows.map((value) => {
      const w = parseRow(watchRow, value, 'workspace_watches');
      return {
        id: w.id,
        line: w.line,
        kind: w.kind,
        status: w.status,
        thresholdKmh: w.threshold_kmh,
        speedKmh: w.speed_kmh,
        measuredAt: w.measured_at,
        checkedAt: w.checked_at,
        source: parseJson(w.source),
        alertedAt: w.alerted_at,
      };
    }),
  });
}
export async function saveTurn(
  db: Database,
  traveller: string,
  id: string,
  token: string,
  text: string,
  answer: AssistantTurn,
  now: Date,
): Promise<boolean> {
  const at = toInstant(now);
  return db.transaction(async (tx) => {
    const updated = await tx.execute({
      sql: `UPDATE workspace_agents SET conversation_id = ? WHERE id = ? AND traveller_id = ? AND
        turn_token = ? AND turn_locked_until > ?`,
      args: [answer.conversationId, id, traveller, token, at],
    });
    if (updated.rowsAffected === 0) return false;
    for (const [role, value, json] of [
      ['user', text, null],
      ['assistant', answer.reply, JSON.stringify(answer)],
    ] as const) {
      await tx.execute({
        sql: 'INSERT INTO workspace_messages (id, agent_id, role, text, answer, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        args: [randomUUID(), id, role, value, json, at],
      });
    }
    await tx.execute({
      sql: `DELETE FROM workspace_messages WHERE agent_id = ? AND rowid NOT IN (SELECT rowid FROM
        workspace_messages WHERE agent_id = ? ORDER BY rowid DESC LIMIT 100)`,
      args: [id, id],
    });
    return true;
  });
}

/** A lease rejects simultaneous turns for one agent across processes and expires after a crash. */
export async function lockTurn(
  db: Database,
  traveller: string,
  id: string,
  now: Date,
): Promise<string | null> {
  const token = randomUUID();
  const result = await db.execute({
    sql: `UPDATE workspace_agents SET turn_token = ?, turn_locked_until = ? WHERE id = ? AND traveller_id
      = ? AND (turn_locked_until IS NULL OR turn_locked_until <= ?)`,
    args: [token, toInstant(new Date(now.getTime() + 600_000)), id, traveller, toInstant(now)],
  });
  return result.rowsAffected === 1 ? token : null;
}
export async function unlockTurn(db: Database, id: string, token: string): Promise<void> {
  await db.execute({
    sql: 'UPDATE workspace_agents SET turn_token = NULL, turn_locked_until = NULL WHERE id = ? AND turn_token = ?',
    args: [id, token],
  });
}

/** Empties an agent's conversation: its messages and the trip Sara was planning in it. */
export async function clearConversation(
  db: Database,
  traveller: string,
  id: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const owned = await tx.execute({
      sql: 'SELECT conversation_id FROM workspace_agents WHERE id = ? AND traveller_id = ?',
      args: [id, traveller],
    });
    if (owned.rows.length === 0) return false;
    await tx.execute({
      sql: `DELETE FROM assistant_conversations WHERE traveller_id = ? AND id IN
        (SELECT conversation_id FROM workspace_agents WHERE id = ?)`,
      args: [traveller, id],
    });
    await tx.execute({
      sql: 'UPDATE workspace_agents SET conversation_id = NULL WHERE id = ?',
      args: [id],
    });
    await tx.execute({ sql: 'DELETE FROM workspace_messages WHERE agent_id = ?', args: [id] });
    return true;
  });
}

/** The most watches one agent keeps, as the Agent screen's own form allows. */
const MAX_WATCHES = 10;

/**
 * Starts a watch of a line for the traveller's own Sara, as the form on the Agent screen does:
 * the same table, the same limit, and one watch per line.
 */
export async function watchLineForPrimary(
  db: Database,
  traveller: string,
  line: string,
  now: Date,
): Promise<'created' | 'exists' | 'limit'> {
  await ensurePrimary(db, traveller, now);
  return db.transaction(async (tx) => {
    const primary = await tx.execute({
      sql: 'SELECT id FROM workspace_agents WHERE traveller_id = ? AND is_primary = 1',
      args: [traveller],
    });
    const agentId = z.object({ id: z.string() }).parse(primary.rows[0]).id;
    const watches = await tx.execute({
      sql: 'SELECT line, kind FROM workspace_watches WHERE agent_id = ?',
      args: [agentId],
    });
    if (watches.rows.some((row) => row['kind'] === 'line' && row['line'] === line)) return 'exists';
    if (watches.rows.length >= MAX_WATCHES) return 'limit';
    await tx.execute({
      sql: `INSERT INTO workspace_watches (id, agent_id, line, kind, status, created_at)
        VALUES (?, ?, ?, 'line', 'waiting', ?)`,
      args: [randomUUID(), agentId, line, toInstant(now)],
    });
    return 'created';
  });
}
