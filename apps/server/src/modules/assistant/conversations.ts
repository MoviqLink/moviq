import { toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { Database } from '../../infrastructure/database/database.js';
import { parseRow, RowShapeError } from '../../infrastructure/database/rows.js';
import { conversationStateSchema, type ConversationState } from './planning/state.js';

/** A conversation ends after this long without a new message. */
const CONVERSATION_TTL_MS = 30 * 60_000;

const rowSchema = z.object({ state: z.string() });

/**
 * Sara's conversations, each visible only to the traveller who started it. A conversation of
 * someone else, or one that expired, is simply not found.
 */
export const conversationStore = {
  async load(
    db: Database,
    id: string,
    travellerId: string,
    now: Date,
  ): Promise<ConversationState | undefined> {
    const result = await db.query({
      sql: `SELECT state FROM assistant_conversations
            WHERE id = ? AND traveller_id = ? AND expires_at > ?`,
      args: [id, travellerId, toInstant(now)],
    });
    if (result.rows.length === 0) return undefined;
    const row = parseRow(rowSchema, result.rows[0], 'assistant_conversations');
    return parseState(row.state);
  },

  /** Saves the state, renews the expiry and removes conversations that have expired. */
  async save(
    db: Database,
    id: string,
    travellerId: string,
    state: ConversationState,
    now: Date,
  ): Promise<void> {
    const at = toInstant(now);
    const expires = toInstant(new Date(now.getTime() + CONVERSATION_TTL_MS));
    await db.transaction(async (tx) => {
      await tx.execute({
        sql: 'DELETE FROM assistant_conversations WHERE expires_at <= ?',
        args: [at],
      });
      await tx.execute({
        sql: `INSERT INTO assistant_conversations
                (id, traveller_id, state, created_at, updated_at, expires_at)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT (id) DO UPDATE SET state = excluded.state,
                updated_at = excluded.updated_at, expires_at = excluded.expires_at
              WHERE assistant_conversations.traveller_id = excluded.traveller_id`,
        args: [id, travellerId, JSON.stringify(state), at, at, expires],
      });
    });
  },
};

function parseState(text: string): ConversationState {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new RowShapeError('assistant_conversations', 'state is not JSON');
  }
  return parseRow(conversationStateSchema, value, 'assistant_conversations.state');
}
