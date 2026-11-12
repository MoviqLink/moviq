import {
  orderViewSchema,
  refundAnswerSchema,
  scanAnswerSchema,
  scanRefusalSchema,
  type Money,
} from '@moviq/contracts';
import type { Page } from '@playwright/test';

import { MERCHANT_TEST_TOKEN } from '../../apps/server/tests/support/merchant-access.js';

import { appUrl, browserReaching, confine, expect } from './support/app.js';
import {
  moveTicket,
  openSection,
  refundLine,
  refundReference,
  scan,
} from './support/counter-steps.js';
import {
  ledgerOrders,
  ledgerRefunds,
  orderIds,
  type LedgerOrder,
  type LedgerRefund,
} from './support/merchants.js';
import {
  isPayPal,
  payPalRecordOf,
  payPalRefundOf,
  sandboxBuyer,
  skipReason,
  type PayPalRecord,
} from './support/paypal-sandbox.js';
import { photographPages } from './support/paypal-window.js';
import {
  answer,
  cravingOnTheTrip,
  dollars,
  expectOffer,
  onlyOffer,
  RAMEN_BAR,
  reserveWithPayPal,
  tellTastes,
  watchedTrip,
} from './support/reward-steps.js';

/**
 * The traveller's browser reaches MovIQ and PayPal; the counter's, another context with its own
 * merchant session, only MovIQ. A failed test keeps the masked screenshots of both.
 */
const test = browserReaching(isPayPal).extend<{ desk: Page }>({
  desk: async ({ browser }, use, testInfo) => {
    const context = await browser.newContext();
    const refused = await confine(context, () => false);
    await use(await context.newPage());
    if (testInfo.status !== testInfo.expectedStatus) {
      await photographPages(context, testInfo, sandboxBuyer(), 'counter');
      if (refused.size > 0)
        await testInfo.attach('hosts refused to the counter', { body: [...refused].join('\n') });
    }
    await context.close();
  },
});

const skipped = skipReason();
test.skip(skipped !== undefined, skipped);

test.afterEach(async ({ context }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus)
    await photographPages(context, testInfo, sandboxBuyer());
});

/** `GET /api/commerce/orders`, as My orders reads it to draw each order and its QR. */
const ordersSchema = orderViewSchema.pick({}).extend({ orders: orderViewSchema.array() });

/** PayPal writes amounts as decimal text: `14.41`. */
const paypalValue = (money: Money): string => (money.amountMinor / 100).toFixed(2);

const usd = (amountMinor: number): Money => ({ amountMinor, currency: 'USD' });

/** The one order of this walk-through in MovIQ's ledger, with its hold. */
function onlyOrder(before: ReadonlySet<string>): LedgerOrder {
  const orders = ledgerOrders(before);
  expect(orders).toHaveLength(1);
  const [order] = orders;
  if (order === undefined) throw new Error('The ledger has no order.');
  return order;
}

/** PayPal's record of the order of a hold, read from the sandbox with the app's keys. */
function recordOf(order: LedgerOrder): Promise<PayPalRecord> {
  if (order.hold.paypalOrderId === null) throw new Error('The hold has no PayPal order.');
  return payPalRecordOf(order.hold.paypalOrderId);
}

/**
 * My orders, opened from the reservation: the pickup code exactly as the app gives it, from the
 * answer My orders draws the QR from; asking for the order alone gives the same code.
 */
async function pickupCode(page: Page, order: LedgerOrder): Promise<string> {
  const drawn = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/commerce/orders' && r.ok(),
  );
  await page.getByRole('link', { name: 'See it in My orders' }).click();
  await expect(page).toHaveURL(/#\/rewards$/);
  const { orders } = ordersSchema.parse(await (await drawn).json());
  const view = orders.find((candidate) => candidate.id === order.id);
  expect(view, 'My orders lists the order of the ledger').toMatchObject({
    code: order.code,
    status: 'reserved',
    payment: { status: 'authorized', captured: { amountMinor: 0 } },
  });
  const card = page.getByRole('article', { name: `${RAMEN_BAR.name} ${order.code}` });
  await expect(card.getByRole('img', { name: `Pickup code ${order.code}` })).toBeVisible();
  const qr = view?.pickup?.qr ?? '';
  expect(qr).toMatch(/^mq1\./);
  const alone = await page.request.get(appUrl(`/api/commerce/orders/${order.id}`));
  expect(alone.status()).toBe(200);
  expect(orderViewSchema.parse(await alone.json()).pickup?.qr).toBe(qr);
  return qr;
}

test('reserved with PayPal sandbox, charged once at the counter; the code again is used; a line refunded once', async ({
  page,
  desk,
}) => {
  // The plan, the first verdict, signing in and approving in the sandbox, then PayPal's records.
  test.setTimeout(360_000);
  const before = orderIds();
  await watchedTrip(page);
  await tellTastes(page);
  await cravingOnTheTrip(page);
  const need = await answer(page, 'Mild');
  await expectOffer(page, need);
  const price = onlyOffer(need).reward.price;

  const reserved =
    await test.step('the buyer approves the hold in PayPal; nothing is charged', async () => {
      await reserveWithPayPal(page, before, need);
      const order = onlyOrder(before);
      expect(order).toMatchObject({
        merchantId: RAMEN_BAR.id,
        status: 'reserved',
        hold: {
          status: 'authorized',
          amountMinor: price.amountMinor,
          capturedMinor: 0,
          paypalOrderId: expect.any(String),
          paypalAuthorizationId: expect.any(String),
          paypalCaptureId: null,
          captures: 0,
        },
      });
      expect(await recordOf(order)).toMatchObject({
        authorizations: [{ id: order.hold.paypalAuthorizationId, status: 'CREATED' }],
        captures: [],
      });
      return order;
    });

  const qr = await test.step('My orders shows the QR; its code is the API’s', () =>
    pickupCode(page, reserved));

  await test.step('the merchant enters its panel and follows the ticket', async () => {
    await desk.goto(appUrl('/#/merchant'));
    await desk.getByLabel('Merchant access key').fill(MERCHANT_TEST_TOKEN);
    await desk.getByRole('button', { name: `Enter as ${RAMEN_BAR.name}` }).click();
    await expect(desk.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
    await openSection(desk, 'Tickets');
    await moveTicket(desk, reserved.code, 'Start');
    await moveTicket(desk, reserved.code, 'Mark ready');
    expect(onlyOrder(before)).toEqual({ ...reserved, status: 'ready' });
  });

  const charged =
    await test.step('the code pasted at the counter: charged once, handed over', async () => {
      await openSection(desk, 'Scan');
      const answered = await scan(desk, qr);
      expect(answered.status).toBe(200);
      expect(scanAnswerSchema.parse(answered.body)).toEqual({
        orderId: reserved.id,
        code: reserved.code,
        status: 'picked_up',
        charged: price,
      });
      const outcome = desk
        .getByRole('status')
        .filter({ hasText: `Order ${reserved.code} is handed over.` });
      await expect(outcome.getByText('Charged', { exact: true })).toBeVisible();
      await expect(outcome).toContainText(dollars(price));
      const order = onlyOrder(before);
      expect(order).toEqual({
        ...reserved,
        status: 'picked_up',
        hold: {
          ...reserved.hold,
          status: 'captured',
          capturedMinor: price.amountMinor,
          paypalCaptureId: expect.any(String),
          captures: 1,
        },
      });
      const record = await recordOf(order);
      expect(record).toMatchObject({
        authorizations: [{ id: reserved.hold.paypalAuthorizationId, status: 'CAPTURED' }],
        captures: [
          {
            id: order.hold.paypalCaptureId,
            status: 'COMPLETED',
            value: paypalValue(price),
            currency: 'USD',
          },
        ],
      });
      return { order, record };
    });

  await test.step('the traveller sees it collected and charged, without a code', async () => {
    await page.reload();
    const card = page.getByRole('article', { name: `${RAMEN_BAR.name} ${reserved.code}` });
    await expect(card).toContainText('Collected');
    await expect(card).toContainText(`Charged with PayPal · Charged ${dollars(price)}`);
    await expect(card.getByRole('img', { name: /^Pickup code / })).toHaveCount(0);
  });

  await test.step('the same code scanned again: already used, nothing more charged', async () => {
    const answered = await scan(desk, qr);
    expect(answered.status).toBe(409);
    expect(scanRefusalSchema.parse(answered.body).error.reason).toBe('used');
    const outcome = desk.getByRole('status').filter({ hasText: 'Not charged' });
    await expect(outcome).toContainText('This order has already been collected.');
    await expect(outcome).toContainText('Nothing more is charged.');
    await expect(outcome).toContainText('Nothing has been charged.');
    expect(onlyOrder(before)).toEqual(charged.order);
    expect(await recordOf(charged.order)).toEqual(charged.record);
  });

  const { order } = charged;
  const line = 0;
  const paid = order.paidPerLine[line] ?? 0;

  const refunded =
    await test.step('a missing line given back at the counter, through PayPal', async () => {
      expect(paid).toBeGreaterThan(0);
      const answered = await refundLine(desk, order, line);
      const given = refundAnswerSchema.parse(answered.body);
      // PayPal completes a refund at once (200, refunded) or keeps it pending (202, in progress).
      const completed = answered.status === 200;
      expect([200, 202]).toContain(answered.status);
      test.info().annotations.push({
        type: 'refund',
        description: completed ? 'completed by PayPal (200)' : 'pending in PayPal (202)',
      });
      expect(given).toMatchObject(
        completed
          ? { ok: true, refunded: usd(paid), pending: usd(0) }
          : { ok: true, refunded: usd(0), pending: usd(paid) },
      );
      await expect(
        desk.getByRole('status').filter({
          hasText: completed
            ? `${dollars(usd(paid))} refunded through PayPal.`
            : `Refund in progress: ${dollars(usd(paid))}, until PayPal confirms it.`,
        }),
      ).toBeVisible();
      const refunds = ledgerRefunds(order.hold.id);
      expect(refunds).toEqual([
        {
          operation: `missing:${String(line)}`,
          amountMinor: paid,
          status: completed ? 'completed' : 'unknown',
          paypalRefundId: expect.any(String),
        },
      ]);
      const [refund] = refunds;
      if (refund === undefined || refund.paypalRefundId === null)
        throw new Error('The refund has no PayPal id.');
      expect(refund.amountMinor).toBeLessThanOrEqual(order.hold.capturedMinor);
      const reference = refundReference(order.hold.id, refund.operation);
      expect(reference).toMatch(/^[0-9a-f]{64}$/);
      const movement = {
        id: refund.paypalRefundId,
        status: completed ? 'COMPLETED' : 'PENDING',
        value: paypalValue(usd(paid)),
        currency: 'USD',
      };
      expect(await payPalRefundOf(refund.paypalRefundId)).toEqual({
        ...movement,
        customId: reference,
      });
      expect((await recordOf(order)).refunds).toEqual([movement]);
      return refund;
    });

  await test.step('the same line again: nothing more is given back, in the ledger or in PayPal', async () => {
    const again = await refundLine(desk, order, line);
    // Refused as already given back, and said so at the counter; nothing is asked of PayPal.
    expect(again.status).toBe(409);
    await expect(desk.getByRole('alert')).toContainText(
      /already (refunded through PayPal|being refunded)/,
    );
    const same = (refund: LedgerRefund) => ({
      operation: refund.operation,
      amountMinor: refund.amountMinor,
      paypalRefundId: refund.paypalRefundId,
    });
    expect(ledgerRefunds(order.hold.id).map(same)).toEqual([same(refunded)]);
    const record = await recordOf(order);
    expect(record.refunds.map((refund) => refund.id)).toEqual([refunded.paypalRefundId]);
  });
});
