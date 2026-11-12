import type { MoneyInDoubt, MoneyObligation, MoneyObligationKind } from '@moviq/contracts';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { Database } from '../../infrastructure/database/database.js';
import { openObligations, type OpenObligation } from '../payments/open-obligations.js';
import { merchantBalances } from './merchant-balances.js';
import { safeDetail } from './safe-detail.js';

const HOUR_MS = 60 * 60_000;

/**
 * When an obligation needs a person. Reconciliation keeps retrying either way; this only raises a
 * notice in the control room, and nothing a traveller or a merchant sees changes.
 *
 * - Six failed looks in a row: reconciliation looks again after 30 s and doubles the wait, so six
 *   looks span about half an hour. PayPal answers in seconds, so six failures with an error
 *   recorded are a refusal or an outage, not a delay.
 * - Hours open, by kind. A release and a payment in doubt keep a traveller's money in the air:
 *   one hour. PayPal may keep a refund or a payout batch pending for a while on its side: a day.
 *   A merchant balance waits for the weekly payout by design: two payouts, fourteen days.
 */
export const MONEY_THRESHOLDS = {
  attempts: 6,
  hours: {
    'hold-release': 1,
    payment: 1,
    refund: 24,
    'payout-batch': 24,
    'merchant-balance': 14 * 24,
  } satisfies Record<MoneyObligationKind, number>,
} as const;

function escalation(open: OpenObligation, now: Date): MoneyObligation['escalation'] {
  const failing = open.detail !== null && (open.attempts ?? 0) >= MONEY_THRESHOLDS.attempts;
  if (failing) return 'attempts';
  const openMs = now.getTime() - Date.parse(open.since);
  return openMs >= MONEY_THRESHOLDS.hours[open.kind] * HOUR_MS ? 'age' : null;
}

function toObligation(open: OpenObligation, now: Date): MoneyObligation {
  return {
    id: open.id,
    kind: open.kind,
    reference: open.reference,
    status: open.status,
    amount: { amountMinor: open.amountMinor, currency: 'USD' },
    since: open.since,
    attempts: open.attempts,
    lastError: safeDetail(open.detail),
    nextCheckAt: open.nextCheckAt,
    escalation: escalation(open, now),
  };
}

/** Escalated first, then the oldest first. */
function byUrgency(a: MoneyObligation, b: MoneyObligation): number {
  const escalated = Number(b.escalation !== null) - Number(a.escalation !== null);
  return escalated !== 0 ? escalated : Date.parse(a.since) - Date.parse(b.since);
}

/** `GET /api/ops/money`: every amount not settled with PayPal, with what escalates it. */
export async function moneyInDoubt(deps: {
  readonly db: Database;
  readonly clock: Clock;
}): Promise<MoneyInDoubt> {
  const now = deps.clock.now();
  const [ledger, balances] = await Promise.all([
    openObligations(deps.db),
    merchantBalances(deps, now),
  ]);
  const obligations = [...ledger, ...balances]
    .map((open) => toObligation(open, now))
    .sort(byUrgency);
  return {
    generatedAt: now.toISOString(),
    thresholds: MONEY_THRESHOLDS,
    totals: {
      open: obligations.length,
      escalated: obligations.filter((obligation) => obligation.escalation !== null).length,
      amount: {
        amountMinor: obligations.reduce((sum, item) => sum + item.amount.amountMinor, 0),
        currency: 'USD',
      },
    },
    obligations,
  };
}
