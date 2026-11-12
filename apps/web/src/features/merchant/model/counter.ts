import type { Money } from '@moviq/contracts';

import type {
  KitchenTicket,
  OrderStatus,
  RefundAnswer,
  ScanAnswer,
  ScanRefusal,
  ScanRefusalReason,
} from '../schemas';
import type { MerchantDict } from '../texts';

/** What the kitchen does next with a ticket: a status it may set, or the scan that hands it over. */
export type NextStep = 'preparing' | 'ready' | 'scan' | null;

/** The kitchen moves a ticket forward; collecting is only by scanning, which charges. */
export function nextStep(status: OrderStatus): NextStep {
  switch (status) {
    case 'reserved':
      return 'preparing';
    case 'preparing':
      return 'ready';
    case 'ready':
      return 'scan';
    case 'picked_up':
    case 'cancelled':
      return null;
  }
}

/** The scan as the counter reads it: charged, PayPal still confirming, or refused and why. */
export type ScanResult =
  | { readonly kind: 'charged'; readonly code: string; readonly amount: Money }
  | { readonly kind: 'confirming'; readonly code: string }
  | { readonly kind: 'refused'; readonly reason: ScanRefusalReason };

export function scanResult(answer: ScanAnswer | ScanRefusal): ScanResult {
  if ('error' in answer) return { kind: 'refused', reason: answer.error.reason };
  return 'charged' in answer
    ? { kind: 'charged', code: answer.code, amount: answer.charged }
    : { kind: 'confirming', code: answer.code };
}

/** Orders handed over today, the only ones a missing line can be refunded from. */
export const collected = (tickets: readonly KitchenTicket[]): KitchenTicket[] =>
  tickets.filter((ticket) => ticket.status === 'picked_up');

/** A ticket line as the kitchen reads it: `2 × Tonkotsu ramen · without scallions`. */
export function lineText(line: KitchenTicket['lines'][number]): string {
  const name = line.quantity === 1 ? line.name : `${String(line.quantity)} × ${line.name}`;
  return line.changes === '' ? name : `${name} · ${line.changes}`;
}

/**
 * What a refund did, as the server answered: what PayPal confirmed is refunded, and what it has
 * not confirmed yet is a refund in progress, never said as refunded.
 */
export function refundSaid(
  answer: RefundAnswer,
  t: MerchantDict['refund'],
  money: (amount: Money) => string,
): string[] {
  const said: string[] = [];
  if (answer.refunded.amountMinor > 0) said.push(t.done(money(answer.refunded)));
  if (answer.pending.amountMinor > 0) said.push(t.inProgress(money(answer.pending)));
  return said;
}
