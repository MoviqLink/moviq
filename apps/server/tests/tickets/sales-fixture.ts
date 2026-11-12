import { randomUUID } from 'node:crypto';
import type { Database } from '../../src/infrastructure/database/database.js';
import type { Clock } from '../../src/infrastructure/clock/clock.js';

/** Insert independent confirmed demo sales against the first unfulfilled fixture intent. */
export async function seedConfirmedSales(db: Database, clock: Clock, count: number): Promise<void> {
  await db.transaction(async (tx) => {
    for (let n = 0; n < count; n += 1) {
      const id = randomUUID();
      const intentId = randomUUID();
      const at = clock.now().toISOString();
      await tx.execute({
        sql: `INSERT INTO payment_operations
          (id, traveller_id, purpose, purpose_key, amount_minor, currency, description,
            status, pending, created_at, updated_at, version)
          SELECT ?, traveller_id, 'ticket-product', ?, 300, 'USD', 'Demo', 'unknown', 'capture', ?, ?, 1
          FROM ticket_intents LIMIT 1`,
        args: [id, id, at, at],
      });
      await tx.execute({
        sql: "UPDATE payment_operations SET status = 'captured', pending = NULL WHERE id = ?",
        args: [id],
      });
      await tx.execute({
        sql: `INSERT INTO payment_history (payment_id, at, from_status, to_status, source)
          VALUES (?, ?, 'unknown', 'captured', 'api')`,
        args: [id, at],
      });
      await tx.execute({
        sql: `INSERT INTO ticket_intents (id, traveller_id, product_id, product_json, created_at, payment_id)
          SELECT ?, traveller_id, product_id, product_json, ?, ? FROM ticket_intents WHERE payment_id IS NULL LIMIT 1`,
        args: [intentId, at, id],
      });
    }
  });
}
