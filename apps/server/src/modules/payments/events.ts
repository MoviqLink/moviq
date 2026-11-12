import type { Transaction } from '@libsql/client';
import { toInstant } from '@moviq/contracts';
import { z } from 'zod';

import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';

const PROVIDER = 'paypal';

export type EventOutcome = 'settled' | 'unmatched';

const deliverySchema = z.object({ processed_at: z.string().nullable() });

/**
 * Notifications from PayPal, one row per event id. An event is handled on every delivery until
 * it is marked processed, which happens only after it was handled successfully.
 */
export const providerEvents = {
  /** Notes a delivery. True when the event was already processed, so it must not run again. */
  async receive(
    db: Database,
    event: { readonly id: string; readonly type: string },
    now: Date,
  ): Promise<{ readonly processed: boolean }> {
    const result = await db.execute({
      sql: `INSERT INTO provider_events (provider, event_id, event_type, received_at, deliveries)
            VALUES (?, ?, ?, ?, 1)
            ON CONFLICT (provider, event_id) DO UPDATE SET deliveries = deliveries + 1
            RETURNING processed_at`,
      args: [PROVIDER, event.id, event.type, toInstant(now)],
    });
    const row = parseRow(deliverySchema, result.rows[0], 'provider_events');
    return { processed: row.processed_at !== null };
  },

  async markProcessed(
    tx: Transaction,
    eventId: string,
    outcome: EventOutcome,
    paymentId: string | null,
    now: Date,
  ): Promise<void> {
    await tx.execute({
      sql: `UPDATE provider_events
            SET processed_at = ?, outcome = ?, payment_id = ?, last_error = NULL
            WHERE provider = ? AND event_id = ? AND processed_at IS NULL`,
      args: [toInstant(now), outcome, paymentId, PROVIDER, eventId],
    });
  },

  async markFailed(db: Database, eventId: string, error: string): Promise<void> {
    await db.execute({
      sql: 'UPDATE provider_events SET last_error = ? WHERE provider = ? AND event_id = ?',
      args: [error.slice(0, 500), PROVIDER, eventId],
    });
  },
};
