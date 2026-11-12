import { DatabaseSync } from 'node:sqlite';

/**
 * The demo merchants of the run's throwaway database open all day: a run happens at any hour,
 * and the journey of the captures passes the demo ramen bar at whatever time it is now. Their
 * menus, prices and rules stay as the migration seeds them.
 */
export function openDemoMerchantsAllDay(): void {
  const file = process.env['E2E_DATABASE_FILE'];
  if (file === undefined) throw new Error('E2E_DATABASE_FILE is set by the global setup.');
  const db = new DatabaseSync(file, { timeout: 5_000 });
  try {
    const day = [{ opens: '00:00', closes: '24:00' }];
    const week = { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day };
    db.prepare('UPDATE commerce_agent_rules SET hours = ?').run(JSON.stringify(week));
  } finally {
    db.close();
  }
}

/**
 * The ids of the orders the run's database holds now. Walk-throughs share that database, so one
 * takes these before it starts and then reads only the orders made after them.
 */
export function orderIds(): ReadonlySet<string> {
  const file = process.env['E2E_DATABASE_FILE'];
  if (file === undefined) throw new Error('E2E_DATABASE_FILE is set by the global setup.');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare('SELECT id FROM commerce_orders').all();
    return new Set(rows.map((row) => String(row['id'])));
  } finally {
    db.close();
  }
}

/** An order as MovIQ's own tables keep it, with its PayPal hold. */
export interface LedgerOrder {
  readonly id: string;
  readonly code: string;
  readonly merchantId: string;
  readonly status: string;
  /** What the traveller paid for each line of the kitchen ticket, in minor units. */
  readonly paidPerLine: readonly number[];
  readonly hold: {
    readonly id: string;
    readonly status: string;
    readonly amountMinor: number;
    readonly capturedMinor: number;
    readonly paypalOrderId: string | null;
    readonly paypalAuthorizationId: string | null;
    readonly paypalCaptureId: string | null;
    /** How many times `payment_hold_history` says the hold became `captured`. */
    readonly captures: number;
  };
}

const text = (value: unknown, name: string): string => {
  if (typeof value !== 'string') throw new Error(`The ledger's ${name} is not text.`);
  return value;
};
const optionalText = (value: unknown, name: string): string | null =>
  value === null ? null : text(value, name);
const count = (value: unknown, name: string): number => {
  if (typeof value !== 'number') throw new Error(`The ledger's ${name} is not a number.`);
  return value;
};

/** What each line of a ticket, as `commerce_orders` keeps it, was paid. */
function paidPerLine(ticket: string): number[] {
  const lines: unknown = JSON.parse(ticket);
  if (!Array.isArray(lines)) throw new Error("The ledger's ticket is not a list.");
  return lines.map((line: unknown) =>
    count(
      typeof line === 'object' && line !== null && 'paidMinor' in line ? line.paidMinor : null,
      'paid amount of a line',
    ),
  );
}

/** Each order made since `before` was taken, with its hold, as MovIQ's own tables keep them. */
export function ledgerOrders(before: ReadonlySet<string>): readonly LedgerOrder[] {
  const file = process.env['E2E_DATABASE_FILE'];
  if (file === undefined) throw new Error('E2E_DATABASE_FILE is set by the global setup.');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db
      .prepare(
        `SELECT o.id, o.code, o.merchant_id, o.status, o.ticket, h.id AS hold_id,
                h.status AS hold_status,
                h.amount_minor,
                h.captured_minor, h.paypal_order_id, h.paypal_authorization_id, h.paypal_capture_id,
                (SELECT count(*) FROM payment_hold_history c
                  WHERE c.hold_id = h.id AND c.to_status = 'captured') AS captures
           FROM commerce_orders o JOIN payment_holds h ON h.id = o.hold_id ORDER BY o.created_at`,
      )
      .all()
      .filter((row) => !before.has(String(row['id'])))
      .map((row) => ({
        id: text(row['id'], 'order id'),
        code: text(row['code'], 'order code'),
        merchantId: text(row['merchant_id'], 'merchant id'),
        status: text(row['status'], 'order status'),
        paidPerLine: paidPerLine(text(row['ticket'], 'ticket')),
        hold: {
          id: text(row['hold_id'], 'hold id'),
          status: text(row['hold_status'], 'hold status'),
          amountMinor: count(row['amount_minor'], 'held amount'),
          capturedMinor: count(row['captured_minor'], 'captured amount'),
          paypalOrderId: optionalText(row['paypal_order_id'], 'PayPal order id'),
          paypalAuthorizationId: optionalText(row['paypal_authorization_id'], 'authorization id'),
          paypalCaptureId: optionalText(row['paypal_capture_id'], 'PayPal capture id'),
          captures: count(row['captures'], 'number of captures'),
        },
      }));
  } finally {
    db.close();
  }
}

/** The status of each order made since `before` was taken, and of its PayPal hold. */
export function ordersInLedger(
  before: ReadonlySet<string>,
): readonly { status: string; hold: string }[] {
  return ledgerOrders(before).map((order) => ({ status: order.status, hold: order.hold.status }));
}

/** A refund of a hold as MovIQ's own ledger (`payment_hold_refunds`) keeps it. */
export interface LedgerRefund {
  /** What is given back, such as `missing:0`: a missing line. */
  readonly operation: string;
  readonly amountMinor: number;
  /** `unknown` until PayPal confirms it, then `completed`, or `failed`. */
  readonly status: string;
  readonly paypalRefundId: string | null;
}

/** The refunds of one hold, oldest first, as MovIQ's own ledger keeps them. */
export function ledgerRefunds(holdId: string): readonly LedgerRefund[] {
  const file = process.env['E2E_DATABASE_FILE'];
  if (file === undefined) throw new Error('E2E_DATABASE_FILE is set by the global setup.');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db
      .prepare(
        `SELECT operation, amount_minor, status, paypal_refund_id FROM payment_hold_refunds
          WHERE hold_id = ? ORDER BY created_at, operation`,
      )
      .all(holdId)
      .map((row) => ({
        operation: text(row['operation'], 'refund operation'),
        amountMinor: count(row['amount_minor'], 'refunded amount'),
        status: text(row['status'], 'refund status'),
        paypalRefundId: optionalText(row['paypal_refund_id'], 'PayPal refund id'),
      }));
  } finally {
    db.close();
  }
}
