import type { PaymentPurpose } from '@moviq/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Database } from '../../src/infrastructure/database/database.js';
import type { PurchaseCatalog } from '../../src/modules/payments/catalog.js';
import type { PayPalGateway } from '../../src/modules/payments/paypal/gateway.js';
import type { PaymentsSetup } from '../../src/modules/payments/setup.js';
import { createTicketAutopay } from '../../src/modules/tickets/autopay.js';
import { productOf } from '../../src/modules/tickets/catalog.js';
import { ticketPurchases } from '../../src/modules/tickets/purchases.js';
import { createIntent } from '../../src/modules/tickets/store.js';
import { walletTopUps } from '../../src/modules/wallet/purchases.js';
import { createTopUp, payFromWallet, readWallet } from '../../src/modules/wallet/store.js';
import { manualClock } from '../support/manual-clock.js';
import { memoryLogger } from '../support/memory-logger.js';
import type { TempDatabase } from '../support/temp-database.js';
import { fakePayPal, type FakePayPal } from '../payments/support/fake-paypal.js';
import { addTraveller, count, paymentsDatabase } from '../payments/support/payments.js';

const clock = manualClock();
const { logger } = memoryLogger();
const DEMO_AGREEMENT = 'B-TEST-AGREEMENT';
let temp: TempDatabase;
let db: Database;
let travellerId: string;
let paypal: FakePayPal;

beforeEach(async () => {
  ({ temp, db } = await paymentsDatabase(clock));
  travellerId = await addTraveller(db, clock);
  paypal = fakePayPal();
});

afterEach(async () => {
  await temp.dispose();
});

/** PayPal charges an order opened on an agreement as it opens it, with no window. */
function chargingGateway(): PayPalGateway {
  return {
    ...paypal,
    createOrder: async (input) => {
      const order = await paypal.createOrder(input);
      if (input.billingAgreementId !== undefined) {
        paypal.approve(order.id);
        await paypal.captureOrder(order.id, `charge-${order.id}`);
      }
      return order;
    },
  };
}

/** Tickets and top-ups priced and applied by their own modules, as the server routes them. */
function catalog(): PurchaseCatalog {
  const tickets = ticketPurchases({ db, sandbox: true });
  const topUps = walletTopUps({ db, sandbox: true });
  const ownerOf = (purpose: PaymentPurpose) =>
    purpose.kind === 'wallet-top-up' ? topUps : tickets;
  return {
    quote: (purpose, traveller) => ownerOf(purpose).quote(purpose, traveller),
    fulfil: (purpose, paymentId, tx) => ownerOf(purpose).fulfil(purpose, paymentId, tx),
  };
}

function setup(withAgreements: boolean): PaymentsSetup {
  return {
    available: true,
    paypal: chargingGateway(),
    ...(withAgreements
      ? {
          agreements: {
            createToken: () =>
              Promise.resolve({ tokenId: 'TOKEN-1', approvalUrl: 'https://paypal.test/approve' }),
            create: () => Promise.resolve({ id: 'B-OWN' }),
            cancel: () => Promise.resolve(),
          },
        }
      : {}),
    config: { available: true, clientId: 'test-client', environment: 'sandbox', currency: 'USD' },
    webhookId: undefined,
  };
}

const autopay = (withAgreements = true) =>
  createTicketAutopay({
    db,
    clock,
    payments: setup(withAgreements),
    catalog: catalog(),
    demoAgreementId: DEMO_AGREEMENT,
  });

const payments = () => count(db, 'SELECT COUNT(*) AS n FROM payment_operations');

describe('the trip wallet', () => {
  it('counts a top-up only once its payment is captured', async () => {
    await createTopUp(db, clock, travellerId, 1000);
    expect((await readWallet(db, travellerId, true)).balance.amountMinor).toBe(0);

    paypal.captureEndsAs('PENDING');
    expect(await autopay().addFunds(travellerId, 1000, logger)).toBe(false);
    expect((await readWallet(db, travellerId, true)).balance.amountMinor).toBe(0);

    expect(await autopay().addFunds(travellerId, 1000, logger)).toBe(true);
    const wallet = await readWallet(db, travellerId, true);
    expect(wallet.balance).toEqual({ amountMinor: 1000, currency: 'USD' });
    expect(wallet.movements).toMatchObject([{ kind: 'top-up', amountMinor: 1000 }]);
  });

  it('pays a ticket from the balance, with no PayPal order', async () => {
    expect(await autopay().addFunds(travellerId, 1000, logger)).toBe(true);
    const orders = paypal.calls.filter((call) => call.method === 'createOrder').length;
    const intent = await createIntent(db, clock, travellerId, 'omny-single-demo');
    if (intent === undefined) throw new Error('missing product');
    const paid = await payFromWallet(
      { db, clock, catalog: catalog() },
      {
        travellerId,
        purpose: intent.purpose,
        amount: intent.product.price,
        description: intent.product.name,
        label: intent.product.name,
      },
    );
    expect(paid?.status).toBe('captured');
    expect(paypal.calls.filter((call) => call.method === 'createOrder')).toHaveLength(orders);
    const wallet = await readWallet(db, travellerId, true);
    expect(wallet.balance.amountMinor).toBe(700);
    expect(wallet.spent.amountMinor).toBe(300);
    expect(
      await count(db, 'SELECT COUNT(*) AS n FROM ticket_intents WHERE payment_id IS NOT NULL'),
    ).toBe(1);
  });

  it('writes nothing when the balance does not cover the price', async () => {
    const intent = await createIntent(db, clock, travellerId, 'path-tapp-10-demo');
    if (intent === undefined) throw new Error('missing product');
    const paid = await payFromWallet(
      { db, clock, catalog: catalog() },
      {
        travellerId,
        purpose: intent.purpose,
        amount: intent.product.price,
        description: intent.product.name,
        label: intent.product.name,
      },
    );
    expect(paid).toBeUndefined();
    expect(await payments()).toBe(0);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM wallet_spends')).toBe(0);
  });
});

describe('tickets the assistant buys', () => {
  it('pays from the trip wallet when its balance covers them', async () => {
    const service = autopay();
    expect(await service.addFunds(travellerId, 1000, logger)).toBe(true);
    const purchase = await service.buy(travellerId, ['omny-single-demo'], logger);
    expect(purchase).toMatchObject({
      ok: true,
      receipts: [{ bought: true, paidWith: 'wallet', paypalOrderId: null }],
    });
    expect((await readWallet(db, travellerId, true)).balance.amountMinor).toBe(700);
  });

  it('charges the PayPal agreement when the balance does not cover them', async () => {
    const purchase = await autopay().buy(travellerId, ['omny-single-demo'], logger);
    expect(purchase).toMatchObject({ ok: true, receipts: [{ bought: true, paidWith: 'paypal' }] });
    if (!purchase.ok || !purchase.receipts[0]?.bought) throw new Error('not bought');
    const orderId = purchase.receipts[0].paypalOrderId ?? '';
    expect(paypal.order(orderId)?.input.billingAgreementId).toBe(DEMO_AGREEMENT);
    expect(paypal.order(orderId)?.input.amount).toEqual(productOf('omny-single-demo')?.price);
  });

  it('buys nothing while the traveller has the switch off', async () => {
    const service = autopay();
    await service.setEnabled(travellerId, false);
    expect(await service.buy(travellerId, ['omny-single-demo'], logger)).toEqual({
      ok: false,
      reason: 'switched-off',
    });
    expect(await payments()).toBe(0);
  });

  it('buys nothing with no balance and no PayPal agreement', async () => {
    const service = autopay(false);
    expect((await service.status(travellerId)).connected).toBe(false);
    expect(await service.buy(travellerId, ['omny-single-demo'], logger)).toEqual({
      ok: false,
      reason: 'no-funds',
    });
    expect(await payments()).toBe(0);
  });
});
