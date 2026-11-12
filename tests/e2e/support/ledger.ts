import { DatabaseSync } from 'node:sqlite';

/** A payment as MovIQ's own ledger (`payment_operations`) keeps it. */
export interface LedgerPayment {
  readonly id: string;
  readonly status: string;
  readonly amountMinor: number;
  readonly paypalOrderId: string | null;
  readonly paypalCaptureId: string | null;
  /** When `payment_history` says it became `captured`, once per time it did. */
  readonly capturedAt: readonly string[];
}

/** An entry of `journey_events`. */
interface JourneyEvent {
  readonly at: string;
  readonly kind: string;
  readonly detail: unknown;
}

/** What the throwaway database of the run holds about one journey's payments and events. */
export interface JourneyLedger {
  readonly payments: readonly LedgerPayment[];
  readonly events: readonly JourneyEvent[];
}

const text = (value: unknown, name: string): string => {
  if (typeof value !== 'string') throw new Error(`The ledger's ${name} is not text.`);
  return value;
};
const optionalText = (value: unknown, name: string): string | null =>
  value === null ? null : text(value, name);
const json = (source: string): unknown => {
  const value: unknown = JSON.parse(source);
  return value;
};

function database(): DatabaseSync {
  const file = process.env['E2E_DATABASE_FILE'];
  if (file === undefined) throw new Error('E2E_DATABASE_FILE is set by the global setup.');
  return new DatabaseSync(file, { readOnly: true });
}

function paymentsOf(db: DatabaseSync, journeyId: string): LedgerPayment[] {
  const rows = db
    .prepare(
      `SELECT id, status, amount_minor, paypal_order_id, paypal_capture_id
         FROM payment_operations WHERE json_extract(purpose, '$.journeyId') = ? ORDER BY created_at`,
    )
    .all(journeyId);
  const captured = db.prepare(
    `SELECT at FROM payment_history WHERE payment_id = ? AND to_status = 'captured' ORDER BY id`,
  );
  return rows.map((row) => {
    const id = text(row['id'], 'payment id');
    const amountMinor = row['amount_minor'];
    if (typeof amountMinor !== 'number')
      throw new Error('The ledger has an amount that is not a number.');
    return {
      id,
      status: text(row['status'], 'status'),
      amountMinor,
      paypalOrderId: optionalText(row['paypal_order_id'], 'PayPal order id'),
      paypalCaptureId: optionalText(row['paypal_capture_id'], 'PayPal capture id'),
      capturedAt: captured.all(id).map((entry) => text(entry['at'], 'history time')),
    };
  });
}

function eventsOf(db: DatabaseSync, journeyId: string): JourneyEvent[] {
  return db
    .prepare('SELECT at, kind, detail FROM journey_events WHERE journey_id = ? ORDER BY id')
    .all(journeyId)
    .map((row) => ({
      at: text(row['at'], 'event time'),
      kind: text(row['kind'], 'event kind'),
      detail: json(text(row['detail'], 'event detail')),
    }));
}

/**
 * Reads, without writing, the payments of a journey's purchases and the journey's events from
 * the database the API and the worker of this run share.
 */
export function ledgerOf(journeyId: string): JourneyLedger {
  const db = database();
  try {
    return { payments: paymentsOf(db, journeyId), events: eventsOf(db, journeyId) };
  } finally {
    db.close();
  }
}
