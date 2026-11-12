import type { Transaction } from '@libsql/client';
import { toInstant } from '@moviq/contracts';
import type { Database } from '../../infrastructure/database/database.js';

/** Non-virtual purchases are unchanged; a virtual one needs a current feasible route. */
export async function virtualReservationAllowed(
  db: Database | Transaction,
  traveller: string,
  offerId: string,
  now: Date,
): Promise<boolean> {
  const query = {
    sql: `SELECT v.validation_offer_id, v.validation_expires_at, v.validation_depart_at
    FROM commerce_offers o JOIN commerce_threads t ON t.id = o.thread_id
    JOIN virtual_ride_needs v ON v.need_id = t.need_id
    JOIN virtual_rides r ON r.id = v.ride_id
    WHERE o.id = ? AND o.traveller_id = ? AND r.traveller_id = ?`,
    args: [offerId, traveller, traveller],
  };
  const result = await ('query' in db ? db.query(query) : db.execute(query));
  const row = result.rows[0];
  if (row === undefined) return true;
  return (
    row['validation_offer_id'] === offerId &&
    typeof row['validation_expires_at'] === 'string' &&
    row['validation_expires_at'] > toInstant(now) &&
    typeof row['validation_depart_at'] === 'string' &&
    row['validation_depart_at'] > toInstant(now)
  );
}
