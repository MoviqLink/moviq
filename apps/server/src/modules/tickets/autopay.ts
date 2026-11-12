import { toInstant, type Money, type TicketAutopay, type TicketProduct } from '@moviq/contracts';
import { z } from 'zod';

import type { Clock } from '../../infrastructure/clock/clock.js';
import type { Database } from '../../infrastructure/database/database.js';
import { parseRow } from '../../infrastructure/database/rows.js';
import type { Logger } from '../../infrastructure/telemetry/logger.js';
import type { PurchaseCatalog } from '../payments/catalog.js';
import type { PaymentContext } from '../payments/context.js';
import { startPayment } from '../payments/service.js';
import { settle } from '../payments/settlement.js';
import type { PaymentsSetup } from '../payments/setup.js';
import { createTopUp, payFromWallet, readWallet } from '../wallet/store.js';
import { productOf } from './catalog.js';
import { createIntent } from './store.js';

/** Shown to the traveller in PayPal when they approve; no personal data and no ids. */
const AGREEMENT_DESCRIPTION = 'MovIQ: transit tickets bought by your assistant (sandbox)';
/** The most the assistant may spend in one request, whatever it is asked. */
const SPENDING_LIMIT: Money = { amountMinor: 6000, currency: 'USD' };
/** The most tickets in one request. */
export const MAX_TICKETS = 8;

const rowSchema = z.object({
  enabled: z.number(),
  agreement_id: z.string().nullable(),
  connected_at: z.string().nullable(),
});

/** One ticket the assistant bought, or why it was not. */
export type AutopayReceipt =
  | {
      readonly bought: true;
      /** The ticket's id in the traveller's wallet of tickets. */
      readonly ticketId: string;
      readonly product: TicketProduct;
      /** From the trip wallet's balance, or charged to the PayPal agreement. */
      readonly paidWith: 'wallet' | 'paypal';
      readonly paypalOrderId: string | null;
    }
  | { readonly bought: false; readonly product: TicketProduct; readonly reason: string };

type AutopayPurchase =
  | { readonly ok: true; readonly receipts: readonly AutopayReceipt[] }
  | {
      readonly ok: false;
      readonly reason: 'unavailable' | 'switched-off' | 'no-funds' | 'unknown-product' | 'limit';
    };

/**
 * The assistant's way to pay. A ticket is paid from the trip wallet when its balance covers it;
 * otherwise it is an order charged to the PayPal billing agreement the traveller approved once.
 * Either way the payment is recorded in the same ledger as every other one.
 */
export interface TicketAutopayService {
  status(travellerId: string | undefined): Promise<TicketAutopay>;
  setEnabled(travellerId: string, enabled: boolean): Promise<TicketAutopay>;
  /** Opens the approval in PayPal; undefined when PayPal sandbox is not set up. */
  begin(travellerId: string, origin: string): Promise<{ readonly approvalUrl: string } | undefined>;
  /** PayPal returned the traveller with this token approved. */
  complete(tokenId: string): Promise<boolean>;
  disconnect(travellerId: string, logger: Logger): Promise<TicketAutopay>;
  buy(travellerId: string, productIds: readonly string[], logger: Logger): Promise<AutopayPurchase>;
  /**
   * Adds money to the trip wallet with the connected PayPal, with no PayPal window. False, with
   * nothing added, when PayPal is not connected or did not confirm the capture.
   */
  addFunds(travellerId: string, amountMinor: number, logger: Logger): Promise<boolean>;
}

interface AutopayDeps {
  readonly db: Database;
  readonly clock: Clock;
  readonly payments: PaymentsSetup;
  readonly catalog: PurchaseCatalog;
  /** The sandbox test buyer's agreement: every traveller without their own starts on it. */
  readonly demoAgreementId?: string | undefined;
}

type AutopayRow = z.infer<typeof rowSchema>;

/** What the connection and the spending share: the stored row, the agreement and the status. */
interface AutopayCore extends AutopayDeps {
  readonly agreements: Extract<PaymentsSetup, { available: true }>['agreements'] | undefined;
  readonly read: (travellerId: string) => Promise<AutopayRow | undefined>;
  readonly agreementOf: (row: AutopayRow | undefined) => string | null;
  readonly status: (travellerId: string | undefined) => Promise<TicketAutopay>;
  readonly context: (logger: Logger) => PaymentContext | undefined;
}

export function createTicketAutopay(deps: AutopayDeps): TicketAutopayService {
  const core = autopayCore(deps);
  return { status: core.status, ...autopayConnection(core), ...autopaySpending(core) };
}

function autopayCore(deps: AutopayDeps): AutopayCore {
  const { db, clock, payments } = deps;
  const agreements =
    payments.available && payments.config.environment === 'sandbox'
      ? payments.agreements
      : undefined;
  const read = async (travellerId: string) => {
    const result = await db.query({
      sql: 'SELECT enabled, agreement_id, connected_at FROM ticket_autopay WHERE traveller_id = ?',
      args: [travellerId],
    });
    const row = result.rows[0];
    return row === undefined ? undefined : parseRow(rowSchema, row, 'ticket_autopay');
  };
  /** The traveller's own agreement, or the test buyer's when the server has one. */
  const agreementOf = (row: AutopayRow | undefined): string | null =>
    agreements === undefined ? null : (row?.agreement_id ?? deps.demoAgreementId ?? null);
  const status = async (travellerId: string | undefined): Promise<TicketAutopay> => {
    const row = travellerId === undefined ? undefined : await read(travellerId);
    const own = agreements !== undefined && typeof row?.agreement_id === 'string';
    return {
      available: agreements !== undefined,
      enabled: row === undefined || row.enabled === 1,
      connected: agreementOf(row) !== null,
      connectedAt: own ? (row.connected_at ?? null) : null,
      testBuyer: !own && agreementOf(row) !== null,
    };
  };
  const context = (logger: Logger): PaymentContext | undefined =>
    payments.available
      ? {
          db,
          clock,
          logger,
          paypal: payments.paypal,
          catalog: deps.catalog,
          source: 'api',
          write: (work) => db.transaction(work),
        }
      : undefined;
  return { ...deps, agreements, read, agreementOf, status, context };
}

/** The switch, and connecting or disconnecting the traveller's PayPal agreement. */
function autopayConnection(
  core: AutopayCore,
): Pick<TicketAutopayService, 'setEnabled' | 'begin' | 'complete' | 'disconnect'> {
  const { db, clock, agreements, read, status } = core;
  return {
    async setEnabled(travellerId, enabled) {
      await db.execute({
        sql: `INSERT INTO ticket_autopay (traveller_id, enabled, updated_at) VALUES (?, ?, ?)
          ON CONFLICT (traveller_id) DO UPDATE SET enabled = excluded.enabled,
            updated_at = excluded.updated_at`,
        args: [travellerId, enabled ? 1 : 0, toInstant(clock.now())],
      });
      return status(travellerId);
    },
    async begin(travellerId, origin) {
      if (agreements === undefined) return undefined;
      const token = await agreements.createToken({
        description: AGREEMENT_DESCRIPTION,
        returnUrl: `${origin}/api/tickets/autopay/return`,
        cancelUrl: `${origin}/api/tickets/autopay/cancelled`,
      });
      await db.execute({
        sql: `INSERT INTO ticket_autopay (traveller_id, token_id, updated_at) VALUES (?, ?, ?)
          ON CONFLICT (traveller_id) DO UPDATE SET token_id = excluded.token_id,
            updated_at = excluded.updated_at`,
        args: [travellerId, token.tokenId, toInstant(clock.now())],
      });
      return { approvalUrl: token.approvalUrl };
    },
    async complete(tokenId) {
      if (agreements === undefined) return false;
      const pending = await db.query({
        sql: 'SELECT traveller_id FROM ticket_autopay WHERE token_id = ? AND agreement_id IS NULL',
        args: [tokenId],
      });
      if (pending.rows.length === 0) return false;
      const agreement = await agreements.create(tokenId);
      const now = toInstant(clock.now());
      const changed = await db.execute({
        sql: `UPDATE ticket_autopay SET agreement_id = ?, connected_at = ?, updated_at = ?
          WHERE token_id = ? AND agreement_id IS NULL`,
        args: [agreement.id, now, now, tokenId],
      });
      return changed.rowsAffected === 1;
    },
    async disconnect(travellerId, logger) {
      const row = await read(travellerId);
      if (typeof row?.agreement_id === 'string' && agreements !== undefined) {
        // PayPal first: an agreement still alive there must stay recorded here.
        await agreements.cancel(row.agreement_id);
        logger.info('ticket autopay disconnected');
      }
      await db.execute({
        sql: `UPDATE ticket_autopay SET agreement_id = NULL, token_id = NULL, connected_at = NULL,
          updated_at = ? WHERE traveller_id = ?`,
        args: [toInstant(clock.now()), travellerId],
      });
      return status(travellerId);
    },
  };
}

/** Spending: tickets the assistant buys and top-ups of the trip wallet with the agreement. */
function autopaySpending(core: AutopayCore): Pick<TicketAutopayService, 'buy' | 'addFunds'> {
  const { db, clock, payments, read, agreementOf, context } = core;
  return {
    async buy(travellerId, productIds, logger) {
      if (!payments.available || payments.config.environment !== 'sandbox')
        return { ok: false, reason: 'unavailable' };
      const row = await read(travellerId);
      if (row?.enabled === 0) return { ok: false, reason: 'switched-off' };
      const products = productsOf(productIds);
      if (products === undefined) return { ok: false, reason: 'unknown-product' };
      const total = products.reduce((sum, product) => sum + product.price.amountMinor, 0);
      if (products.length > MAX_TICKETS || total > SPENDING_LIMIT.amountMinor)
        return { ok: false, reason: 'limit' };
      const agreementId = agreementOf(row);
      const wallet = await readWallet(db, travellerId, true);
      if (agreementId === null && wallet.balance.amountMinor < total)
        return { ok: false, reason: 'no-funds' };
      const ctx = context(logger);
      if (ctx === undefined) return { ok: false, reason: 'unavailable' };
      const receipts: AutopayReceipt[] = [];
      for (const product of products) {
        receipts.push(await buyOne(ctx, travellerId, product, agreementId));
      }
      return { ok: true, receipts };
    },
    async addFunds(travellerId, amountMinor, logger) {
      const agreementId = agreementOf(await read(travellerId));
      const ctx = context(logger);
      if (agreementId === null || ctx === undefined) return false;
      const topUp = await createTopUp(db, clock, travellerId, amountMinor);
      const started = await startPayment(ctx, travellerId, topUp.purpose, agreementId);
      if (!started.ok) return false;
      const settled = await settle(ctx, started.payment);
      return settled.ok && settled.payment.status === 'captured';
    },
  };
}

/** The catalogue products, in order; undefined when one of the ids is not in the catalogue. */
function productsOf(productIds: readonly string[]): TicketProduct[] | undefined {
  const products: TicketProduct[] = [];
  for (const id of productIds) {
    const product = productOf(id);
    if (product === undefined) return undefined;
    products.push(product);
  }
  return products;
}

/**
 * One ticket: its intent, then the trip wallet when its balance covers the price. Otherwise the
 * order goes to the agreement: PayPal charges such an order as it opens it, so it is read back
 * at once and the capture it shows is recorded and applied.
 */
async function buyOne(
  ctx: PaymentContext,
  travellerId: string,
  product: TicketProduct,
  agreementId: string | null,
): Promise<AutopayReceipt> {
  const intent = await createIntent(ctx.db, ctx.clock, travellerId, product.id);
  if (intent === undefined) return { bought: false, product, reason: 'No such product.' };
  const fromWallet = await payFromWallet(ctx, {
    travellerId,
    purpose: intent.purpose,
    amount: product.price,
    description: product.name,
    label: `${product.name} · ${product.operator}`,
  });
  if (fromWallet !== undefined) {
    return { bought: true, ticketId: intent.id, product, paidWith: 'wallet', paypalOrderId: null };
  }
  if (agreementId === null) {
    return { bought: false, product, reason: 'The trip wallet does not cover this ticket.' };
  }
  const started = await startPayment(ctx, travellerId, intent.purpose, agreementId);
  if (!started.ok) return { bought: false, product, reason: started.message };
  const confirmed = await settle(ctx, started.payment);
  if (!confirmed.ok) return { bought: false, product, reason: confirmed.message };
  if (confirmed.payment.status !== 'captured') {
    return {
      bought: false,
      product,
      reason: 'PayPal has not confirmed this payment yet. Nothing more is charged meanwhile.',
    };
  }
  return {
    bought: true,
    ticketId: intent.id,
    product,
    paidWith: 'paypal',
    paypalOrderId: confirmed.payment.paypalOrderId,
  };
}
