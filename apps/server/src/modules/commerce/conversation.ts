import { randomUUID } from 'node:crypto';

import type { Transaction } from '@libsql/client';
import {
  protocolMessageSchema,
  toInstant,
  type ConversationEntry,
  type ProtocolMessage,
} from '@moviq/contracts';
import { z } from 'zod';

import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';

type ThreadStatus = 'negotiating' | 'awaiting-traveller' | 'offered' | 'closed';

export interface Question {
  readonly topic: 'spice' | 'drink' | 'size';
  readonly text: string;
  readonly options: readonly string[];
}

export interface ThreadRecord {
  readonly id: string;
  readonly needId: string;
  readonly merchantId: string;
  readonly status: ThreadStatus;
  readonly passAt: string;
  readonly pickupBefore: string;
  readonly clarifications: number;
  readonly attempts: number;
  readonly question: Question | null;
  readonly createdAt: string;
  readonly version: number;
}

const questionSchema = z.object({
  topic: z.enum(['spice', 'drink', 'size']),
  text: z.string(),
  options: z.array(z.string()),
});

const threadRow = z
  .object({
    id: z.string(),
    need_id: z.string(),
    merchant_id: z.string(),
    status: z.enum(['negotiating', 'awaiting-traveller', 'offered', 'closed']),
    pass_at: z.string(),
    pickup_before: z.string(),
    clarifications: z.number().int(),
    attempts: z.number().int(),
    question: z
      .string()
      .nullable()
      .transform((text, context): Question | null => {
        if (text === null) return null;
        const parsed = questionSchema.safeParse(JSON.parse(text));
        if (parsed.success) return parsed.data;
        context.addIssue({ code: 'custom', message: parsed.error.message });
        return z.NEVER;
      }),
    created_at: z.string(),
    version: z.number().int(),
  })
  .transform((row): ThreadRecord => ({
    id: row.id,
    needId: row.need_id,
    merchantId: row.merchant_id,
    status: row.status,
    passAt: row.pass_at,
    pickupBefore: row.pickup_before,
    clarifications: row.clarifications,
    attempts: row.attempts,
    question: row.question,
    createdAt: row.created_at,
    version: row.version,
  }));

const messageRow = z.object({
  seq: z.number().int().positive(),
  at: z.string(),
  body: z.string().transform((text, context): ProtocolMessage => {
    const parsed = protocolMessageSchema.safeParse(JSON.parse(text));
    if (parsed.success) return parsed.data;
    context.addIssue({ code: 'custom', message: parsed.error.message });
    return z.NEVER;
  }),
});

const toThread = (row: unknown) => parseRow(threadRow, row, 'commerce_threads');

/** Someone else moved the conversation since it was read. */
class StaleThreadError extends Error {
  constructor(id: string) {
    super(`Conversation ${id} changed while it was being updated.`);
    this.name = 'StaleThreadError';
  }
}

/** Conversations between Sara and each merchant's agent, and their messages in order. */
export const conversations = {
  async open(
    tx: Transaction,
    input: {
      readonly needId: string;
      readonly merchantId: string;
      readonly passAt: Date;
      readonly pickupBefore: Date;
    },
    now: Date,
  ): Promise<ThreadRecord> {
    const result = await tx.execute({
      sql: `INSERT INTO commerce_threads (id, need_id, merchant_id, status, pass_at, pickup_before,
              created_at, updated_at, version) VALUES (?, ?, ?, 'negotiating', ?, ?, ?, ?, 1) RETURNING *`,
      args: [
        randomUUID(),
        input.needId,
        input.merchantId,
        toInstant(input.passAt),
        toInstant(input.pickupBefore),
        toInstant(now),
        toInstant(now),
      ],
    });
    return toThread(result.rows[0]);
  },

  async update(
    tx: Transaction,
    current: ThreadRecord,
    change: Partial<Pick<ThreadRecord, 'status' | 'clarifications' | 'attempts' | 'question'>>,
    now: Date,
  ): Promise<ThreadRecord> {
    const question = change.question === undefined ? current.question : change.question;
    const result = await tx.execute({
      sql: `UPDATE commerce_threads SET status = ?, clarifications = ?, attempts = ?, question = ?,
              updated_at = ?, version = version + 1 WHERE id = ? AND version = ? RETURNING *`,
      args: [
        change.status ?? current.status,
        change.clarifications ?? current.clarifications,
        change.attempts ?? current.attempts,
        question === null ? null : JSON.stringify(question),
        toInstant(now),
        current.id,
        current.version,
      ],
    });
    const row = result.rows[0];
    if (row === undefined) throw new StaleThreadError(current.id);
    return toThread(row);
  },

  /** Appends a message, validated against the protocol again before it is written. */
  async append(
    tx: Transaction,
    threadId: string,
    message: ProtocolMessage,
    now: Date,
  ): Promise<void> {
    const valid = protocolMessageSchema.parse(message);
    await tx.execute({
      sql: `INSERT INTO commerce_messages (thread_id, seq, at, type, body)
            VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM commerce_messages WHERE thread_id = ?), ?, ?, ?)`,
      args: [threadId, threadId, toInstant(now), valid.type, JSON.stringify(valid)],
    });
  },

  async messages(
    db: Database | Transaction,
    threadId: string,
  ): Promise<readonly ConversationEntry[]> {
    const statement = {
      sql: 'SELECT seq, at, body FROM commerce_messages WHERE thread_id = ? ORDER BY seq',
      args: [threadId],
    };
    const result = 'query' in db ? await db.query(statement) : await db.execute(statement);
    return result.rows.map((row) => {
      const entry = parseRow(messageRow, row, 'commerce_messages');
      return { seq: entry.seq, at: entry.at, message: entry.body };
    });
  },

  async find(db: Database | Transaction, id: string): Promise<ThreadRecord | undefined> {
    const statement = { sql: 'SELECT * FROM commerce_threads WHERE id = ?', args: [id] };
    const result = 'query' in db ? await db.query(statement) : await db.execute(statement);
    const row = result.rows[0];
    return row === undefined ? undefined : toThread(row);
  },

  async ofNeed(db: Database, needId: string): Promise<readonly ThreadRecord[]> {
    const result = await db.query({
      sql: 'SELECT * FROM commerce_threads WHERE need_id = ? ORDER BY created_at, id',
      args: [needId],
    });
    return result.rows.map(toThread);
  },

  async ofMerchant(
    db: Database,
    merchantId: string,
    limit: number,
  ): Promise<readonly ThreadRecord[]> {
    const result = await db.query({
      sql: 'SELECT * FROM commerce_threads WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?',
      args: [merchantId, limit],
    });
    return result.rows.map(toThread);
  },
};
