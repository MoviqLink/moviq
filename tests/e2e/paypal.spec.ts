import { paymentSchema, type Alternative, type Journey, type Money } from '@moviq/contracts';
import type { APIRequestContext, Page } from '@playwright/test';

import { appUrl, browserReaching, expect } from './support/app.js';
import { expectWatched, holdTheTrain, planWithSara, readJourney } from './support/journey-steps.js';
import { ledgerOf, type LedgerPayment } from './support/ledger.js';
import { isPayPal, payPalRecordOf, sandboxBuyer, skipReason } from './support/paypal-sandbox.js';
import {
  approveAsBuyer,
  cancelInPayPal,
  openPayPal,
  photographPages,
} from './support/paypal-window.js';
import { resetProviderClock } from './support/provider-control.js';

/** The browser reaches MovIQ and PayPal, nothing else. */
const test = browserReaching(isPayPal);

const skipped = skipReason();
test.skip(skipped !== undefined, skipped);

test.afterEach(async ({ context }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus)
    await photographPages(context, testInfo, sandboxBuyer());
});

type Taxi = Alternative & { readonly price: Money };

/** `$31.25`, as the screen writes an amount in English. */
const dollars = (money: Money): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: money.currency }).format(
    money.amountMinor / 100,
  );

/** The text itself, inside a regular expression. */
const literally = (text: string): RegExp => new RegExp(text.replace(/[$.*+?^()[\]{}|\\]/g, '\\$&'));

/** PayPal writes amounts as decimal text: `31.25`. */
const paypalValue = (money: Money): string => (money.amountMinor / 100).toFixed(2);

/** The paid option the server offers: the demo partner's taxi, priced by the server. */
function paidTaxi(journey: Journey): Taxi {
  for (const option of journey.alternatives) {
    if (option.price !== null) return { ...option, price: option.price };
  }
  throw new Error('The watch offered no paid taxi.');
}

/**
 * The plan with Sara, the worker's first verdict and the late train; then the taxi of the demo
 * partner among the options, with the price the server set, chosen on the screen.
 */
async function chooseTheTaxi(page: Page, ops: APIRequestContext): Promise<[Journey, Taxi]> {
  const planned = await planWithSara(page, await resetProviderClock());
  await expectWatched(page);
  await holdTheTrain(planned, ops);
  await expect(page.getByText('At risk', { exact: true })).toBeVisible({ timeout: 60_000 });
  const options = page.getByRole('group', { name: 'Your options' });
  await expect(options.getByRole('radio').first()).toBeVisible({ timeout: 30_000 });
  const taxi = paidTaxi(await readJourney(page, planned.id));
  expect(taxi.itinerary.legs.some((leg) => leg.mode === 'taxi')).toBe(true);
  expect(taxi.price.currency).toBe('USD');
  expect(taxi.price.amountMinor).toBeGreaterThan(0);
  const radio = options.getByRole('radio', { name: /A taxi of our demo partner/ });
  await expect(radio).toHaveAccessibleName(literally(dollars(taxi.price)));
  await radio.check();
  await expect(page.getByText(`${dollars(taxi.price)}, priced by our server`)).toBeVisible();
  return [planned, taxi];
}

/** The one payment of the journey in MovIQ's ledger. */
function onlyPayment(journeyId: string): LedgerPayment {
  const { payments } = ledgerOf(journeyId);
  expect(payments).toHaveLength(1);
  const [payment] = payments;
  if (payment === undefined) throw new Error('The ledger has no payment.');
  return payment;
}

/** PayPal's window is open: an order of ours for the server's price, and nothing applied yet. */
async function expectOrderAwaitingTheBuyer(page: Page, planned: Journey, taxi: Taxi) {
  await expect(page.getByText('Approve the payment in the PayPal window.')).toBeVisible();
  const payment = onlyPayment(planned.id);
  expect(payment).toMatchObject({
    status: 'created',
    amountMinor: taxi.price.amountMinor,
    paypalCaptureId: null,
    capturedAt: [],
  });
  expect((await readJourney(page, planned.id)).itinerary.id).toBe(planned.itinerary.id);
  return payment;
}

async function confirmAgain(page: Page, paymentId: string) {
  const response = await page.request.post(appUrl(`/api/payments/orders/${paymentId}/confirm`));
  expect(response.status()).toBe(200);
  return paymentSchema.parse(await response.json());
}

test('cancelling in PayPal’s window charges nothing and the trip stays as planned', async ({
  page,
  playwright,
}) => {
  // The plan, two watch rounds, then PayPal's first page in the sandbox.
  test.setTimeout(240_000);
  const ops = await playwright.request.newContext();
  const [planned, taxi] = await chooseTheTaxi(page, ops);
  await ops.dispose();
  const popup = await openPayPal(page);
  const payment = await expectOrderAwaitingTheBuyer(page, planned, taxi);

  await test.step('the buyer cancels in PayPal’s window', async () => {
    await cancelInPayPal(popup);
    await expect(
      page.getByText('You closed PayPal. Nothing was charged and your trip did not change.'),
    ).toBeVisible();
  });

  await test.step('nothing was charged, and the trip and its options are as they were', async () => {
    expect(onlyPayment(planned.id)).toMatchObject({ status: 'created', paypalCaptureId: null });
    const journey = await readJourney(page, planned.id);
    expect(journey.itinerary.id).toBe(planned.itinerary.id);
    expect(journey.alternatives.map((option) => option.id)).toContain(taxi.id);
    if (payment.paypalOrderId === null) throw new Error('The payment has no PayPal order.');
    expect(await payPalRecordOf(payment.paypalOrderId)).toMatchObject({ captures: [] });
  });
});

test('the buyer approves the taxi in PayPal sandbox; it is charged once, and only then taken', async ({
  page,
  playwright,
}) => {
  // The plan, two watch rounds, then signing in and paying in the sandbox.
  test.setTimeout(300_000);
  const ops = await playwright.request.newContext();
  const [planned, taxi] = await chooseTheTaxi(page, ops);
  await ops.dispose();
  const popup = await openPayPal(page);
  const created = await expectOrderAwaitingTheBuyer(page, planned, taxi);
  const paid = `Paid ${dollars(taxi.price)} with PayPal sandbox. The new route was applied with the payment.`;

  await test.step('the sandbox buyer signs in and approves; the page confirms', async () => {
    await approveAsBuyer(popup, sandboxBuyer());
    await expect(page.getByText(paid).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('group', { name: 'Your options' })).toBeHidden();
    await expect(page.getByText(paid)).toBeVisible();
  });

  const payment = await test.step('the server captured, and then switched the trip', async () => {
    const charged = onlyPayment(planned.id);
    expect(charged).toMatchObject({
      id: created.id,
      status: 'captured',
      amountMinor: taxi.price.amountMinor,
      paypalOrderId: created.paypalOrderId,
      paypalCaptureId: expect.any(String),
    });
    expect(charged.capturedAt).toHaveLength(1);
    const journey = await readJourney(page, planned.id);
    expect(journey.itinerary.id).toBe(taxi.itinerary.id);
    const switched = ledgerOf(planned.id).events.filter(
      (event) => event.kind === 'alternative-paid',
    );
    expect(switched).toHaveLength(1);
    expect(switched[0]?.detail).toEqual({ alternativeId: taxi.id, paymentId: created.id });
    expect(Date.parse(switched[0]?.at ?? '')).toBeGreaterThanOrEqual(
      Date.parse(charged.capturedAt[0] ?? ''),
    );
    return charged;
  });

  await test.step('confirming again charges nothing more', async () => {
    expect(await confirmAgain(page, payment.id)).toMatchObject({
      id: payment.id,
      status: 'captured',
    });
    expect(onlyPayment(planned.id)).toEqual(payment);
    if (payment.paypalOrderId === null) throw new Error('The payment has no PayPal order.');
    const record = await payPalRecordOf(payment.paypalOrderId);
    expect(record.status).toBe('COMPLETED');
    expect(record.captures).toEqual([
      {
        id: payment.paypalCaptureId,
        status: 'COMPLETED',
        value: paypalValue(taxi.price),
        currency: 'USD',
      },
    ]);
  });
});
