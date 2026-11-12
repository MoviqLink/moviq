import type { MoneyObligationKind } from '@moviq/contracts';

import { useLang } from '../../../../shared/i18n/lang';

const s = String;

/** How the rule reads: hours under two days as hours, longer ones in days. */
const span = (hours: number): string =>
  hours >= 48 && hours % 24 === 0 ? `${s(hours / 24)} d` : `${s(hours)} h`;

type Hours = Readonly<Record<MoneyObligationKind, number>>;

// The "Money in doubt" screen's words. Spanish has exactly the same keys: TypeScript checks it.
const moneyEn = {
  nav: 'Money',
  title: 'Money in doubt',
  lead:
    'Money PayPal has not confirmed yet. Reconciliation keeps trying each item on its own; the ' +
    'escalated ones need a person.',
  open: 'Open',
  escalated: 'Escalated',
  amount: 'Amount in doubt',
  rule: (attempts: number, hours: Hours) =>
    `Escalated after ${s(attempts)} failed looks in a row, or when open longer than: releases ` +
    `${span(hours['hold-release'])}, payments ${span(hours.payment)}, refunds ` +
    `${span(hours.refund)}, payout batches ${span(hours['payout-batch'])}, merchant balances ` +
    `${span(hours['merchant-balance'])}. ` +
    'A notice for the team only: travellers and merchants see nothing of it.',
  nothing: 'Nothing in doubt',
  nothingLead:
    'Every release, refund, payment and payout batch is settled with PayPal, and no merchant owes ' +
    'refunds.',
  grid: 'Money not yet settled with PayPal',
  colKind: 'Obligation',
  colStatus: 'Status',
  colAmount: 'Amount',
  colSince: 'Open since',
  colAttempts: 'Looks',
  colError: 'Last error',
  colNext: 'Next look',
  colEscalation: 'Escalation',
  kinds: {
    'hold-release': 'Release a hold',
    refund: 'Refund pending',
    payment: 'Payment in doubt',
    'payout-batch': 'Payout batch unresolved',
    'merchant-balance': 'Merchant balance owed',
  } satisfies Record<MoneyObligationKind, string>,
  byAttempts: 'Failed looks',
  byAge: 'Open too long',
  retrying: 'Retrying',
};

export type MoneyDict = typeof moneyEn;

const moneyEs: MoneyDict = {
  nav: 'Dinero',
  title: 'Dinero en duda',
  lead:
    'Dinero que PayPal aún no ha confirmado. La conciliación reintenta cada caso por separado; ' +
    'los escalados necesitan a una persona.',
  open: 'Abiertas',
  escalated: 'Escaladas',
  amount: 'Importe en duda',
  rule: (attempts, hours) =>
    `Se escala tras ${s(attempts)} consultas fallidas seguidas o al seguir abierta más de: ` +
    `liberaciones ${span(hours['hold-release'])}, pagos ${span(hours.payment)}, reembolsos ` +
    `${span(hours.refund)}, lotes de Payouts ${span(hours['payout-batch'])}, saldos de comercio ` +
    `${span(hours['merchant-balance'])}. ` +
    'Es un aviso para el equipo: viajeros y comercios no ven nada.',
  nothing: 'Nada en duda',
  nothingLead:
    'Todas las liberaciones, reembolsos, pagos y lotes de Payouts están confirmados con PayPal, y ' +
    'ningún comercio debe reembolsos.',
  grid: 'Dinero aún sin confirmar con PayPal',
  colKind: 'Obligación',
  colStatus: 'Estado',
  colAmount: 'Importe',
  colSince: 'Abierta desde',
  colAttempts: 'Consultas',
  colError: 'Último error',
  colNext: 'Próxima consulta',
  colEscalation: 'Escalado',
  kinds: {
    'hold-release': 'Liberar autorización',
    refund: 'Reembolso pendiente',
    payment: 'Pago en duda',
    'payout-batch': 'Lote de Payouts sin resolver',
    'merchant-balance': 'Saldo deudor de comercio',
  },
  byAttempts: 'Consultas fallidas',
  byAge: 'Demasiado tiempo',
  retrying: 'Reintentando',
};

/** The screen's words in the language in use. */
export function useMoneyT(): MoneyDict {
  return useLang() === 'es' ? moneyEs : moneyEn;
}
