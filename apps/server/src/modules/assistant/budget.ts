import { toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { Clock } from '../../infrastructure/clock/clock.js';
import { toNewYorkWallClockText } from '../../infrastructure/clock/new-york.js';
import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';

/** Today's use of the assistants' shared token budget, for the control room. */
interface AssistantUsage {
  /** The New York date the budget applies to, `YYYY-MM-DD`. */
  readonly day: string;
  readonly tokens: number;
  /** Model calls answered or failed today. */
  readonly calls: number;
  readonly budget: number;
  readonly remaining: number;
  readonly exhausted: boolean;
}

/** Tokens held for one call, on the day they were held. */
interface Reservation {
  readonly day: string;
  readonly tokens: number;
}

/**
 * A daily token budget shared by every traveller, counted in the database so all processes see
 * the same total. Each call first holds the most it can use; once it answers, the hold becomes
 * what it really used. A call that never answers keeps its hold, so the budget is never exceeded.
 */
export interface TokenBudget {
  /** Holds `tokens` of today's budget, or undefined when they no longer fit. */
  reserve(tokens: number): Promise<Reservation | undefined>;
  /** Replaces a hold with what the call used; null keeps the whole hold (the use is unknown). */
  settle(reservation: Reservation, used: number | null): Promise<void>;
  today(): Promise<AssistantUsage>;
}

const rowSchema = z.object({ tokens: z.number().int(), calls: z.number().int() });

const newYorkDay = (instant: Date): string => toNewYorkWallClockText(instant).slice(0, 10);

export function createTokenBudget(db: Database, clock: Clock, dailyTokens: number): TokenBudget {
  return {
    async reserve(tokens) {
      const now = clock.now();
      const day = newYorkDay(now);
      const held = await db.transaction(async (tx) => {
        await tx.execute({
          sql: `INSERT INTO assistant_token_usage (day, tokens, calls, updated_at) VALUES (?, 0, 0, ?)
                ON CONFLICT (day) DO NOTHING`,
          args: [day, toInstant(now)],
        });
        const result = await tx.execute({
          sql: `UPDATE assistant_token_usage SET tokens = tokens + ?, updated_at = ?
                WHERE day = ? AND tokens + ? <= ?`,
          args: [tokens, toInstant(now), day, tokens, dailyTokens],
        });
        return result.rowsAffected === 1;
      });
      return held ? { day, tokens } : undefined;
    },
    async settle(reservation, used) {
      const refund = used === null ? 0 : reservation.tokens - used;
      await db.execute({
        sql: `UPDATE assistant_token_usage SET tokens = max(0, tokens - ?), calls = calls + 1,
              updated_at = ? WHERE day = ?`,
        args: [refund, toInstant(clock.now()), reservation.day],
      });
    },
    today: () => assistantUsageToday(db, clock, dailyTokens),
  };
}

/** What the assistants have used today against the budget, for the control room. */
export async function assistantUsageToday(
  db: Database,
  clock: Clock,
  dailyTokens: number,
): Promise<AssistantUsage> {
  const day = newYorkDay(clock.now());
  const result = await db.query({
    sql: 'SELECT tokens, calls FROM assistant_token_usage WHERE day = ?',
    args: [day],
  });
  const row =
    result.rows.length === 0
      ? { tokens: 0, calls: 0 }
      : parseRow(rowSchema, result.rows[0], 'assistant_token_usage');
  const remaining = Math.max(0, dailyTokens - row.tokens);
  return {
    day,
    tokens: row.tokens,
    calls: row.calls,
    budget: dailyTokens,
    remaining,
    exhausted: remaining === 0,
  };
}
