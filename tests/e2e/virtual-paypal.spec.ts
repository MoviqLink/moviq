import {
  needViewSchema,
  virtualEstimateResponseSchema,
  virtualJourneyResponseSchema,
  virtualMetricsSchema,
} from '@moviq/contracts';

import { MERCHANT_TEST_TOKEN } from '../../apps/server/tests/support/merchant-access.js';
import { appUrl, browserReaching, expect } from './support/app.js';
import { ledgerOrders, orderIds } from './support/merchants.js';
import { isPayPal, payPalRecordOf, sandboxBuyer, skipReason } from './support/paypal-sandbox.js';
import { approveAsBuyer, openPayPal, photographPages } from './support/paypal-window.js';
import {
  boardCapturedM5,
  currentVirtualRide,
  placeVirtualMerchantAt,
  VIRTUAL_ITEM_ID,
  VIRTUAL_MERCHANT_ID,
} from './support/virtual-rides.js';

/** The traveller reaches MovIQ and PayPal's sandbox only. */
const test = browserReaching(isPayPal);
const skipped = skipReason();
test.skip(skipped !== undefined, skipped);

test.afterEach(async ({ context }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus)
    await photographPages(context, testInfo, sandboxBuyer());
});

test('a preview is negotiated explicitly, held in PayPal, shown by QR, then converted to a watched real trip', async ({
  browser,
  page,
}) => {
  test.setTimeout(360_000);
  await page.addInitScript(() => {
    localStorage.setItem(
      'moviq-shopper',
      JSON.stringify({
        alias: 'Mia',
        taste: {
          allergies: [],
          avoid: [],
          noAlcohol: true,
          diet: 'any',
          drink: null,
          spice: 'mild',
        },
      }),
    );
  });

  const created = await boardCapturedM5(page, true);
  const firstStop = created.stops[0];
  if (firstStop === undefined) throw new Error('The captured M5 has no upcoming stop.');
  placeVirtualMerchantAt(firstStop);
  const preview = await currentVirtualRide(page);
  const invitation = preview?.stops
    .flatMap((stop) => stop.suggestions)
    .find((item) => item.merchant.id === VIRTUAL_MERCHANT_ID && item.itemId === VIRTUAL_ITEM_ID);
  if (invitation === undefined) throw new Error('The seeded demo merchant has no M5 invitation.');

  const before = orderIds();
  const merchant = await browser.newPage();
  try {
    const login = await merchant.request.post(appUrl('/api/merchant/session'), {
      data: { merchantId: VIRTUAL_MERCHANT_ID, token: MERCHANT_TEST_TOKEN },
    });
    expect(login.status()).toBe(200);
    const metricsBeforeResponse = await merchant.request.get(
      appUrl('/api/virtual/partner/metrics'),
    );
    expect(metricsBeforeResponse.status()).toBe(200);
    const metricsBefore = virtualMetricsSchema.parse(await metricsBeforeResponse.json());
    expect(metricsBefore.visits).toBeGreaterThanOrEqual(0);

    await page.reload();
    const panel = page.getByRole('article', { name: 'Virtual ride' });
    const needResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/virtual/rides/${created.id}/needs`) &&
        response.request().method() === 'POST',
    );
    await panel.getByRole('button', { name: 'Ask for an offer' }).first().click();
    const requested = await needResponse;
    expect(requested.status()).toBe(201);
    const need = needViewSchema.parse(await requested.json());
    const offer = need.offers[0];
    if (offer === undefined)
      throw new Error('The demo merchant made no offer for the chosen preview.');
    expect(offer.merchant.id).toBe(VIRTUAL_MERCHANT_ID);

    await page.context().grantPermissions(['geolocation'], { origin: new URL(appUrl()).origin });
    await page.context().setGeolocation({ latitude: 40.833352, longitude: -73.861008 });
    await panel.getByRole('button', { name: 'Use my location' }).click();
    await expect(panel).toContainText('Selected origin');
    await expect(panel.locator('paypal-button')).toHaveCount(0);

    const estimateResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/virtual/rides/${created.id}/estimate`) &&
        response.request().method() === 'POST',
    );
    await panel.getByRole('button', { name: 'Check route' }).click();
    const estimated = await estimateResponse;
    const estimateBody: unknown = await estimated.json();
    expect(estimated.status(), JSON.stringify(estimateBody)).toBe(200);
    const plan = virtualEstimateResponseSchema.parse(estimateBody).plan;
    const itinerary = plan.itineraries.find((item) => item.id === plan.recommendedId);
    if (itinerary === undefined)
      throw new Error('The route estimate has no recommended itinerary.');
    expect(Date.parse(itinerary.arriveAt)).toBeLessThanOrEqual(Date.parse(offer.pickupAt));

    const approval = await openPayPal(page);
    await expect(page.getByText('Approve the reservation in the PayPal window.')).toBeVisible();
    expect(ledgerOrders(before)).toEqual([]);
    await approveAsBuyer(approval, sandboxBuyer());

    const orderCard = panel.getByRole('article', { name: /^Tsuki Ramen House [A-Z]-\d{4}$/ });
    await expect(orderCard).toContainText('Reserved', { timeout: 30_000 });
    await expect(orderCard).toContainText('Held in PayPal, not charged');
    await expect(orderCard.getByRole('img', { name: /^Pickup code [A-Z]-\d{4}$/ })).toBeVisible();

    const [order] = ledgerOrders(before);
    if (order === undefined) throw new Error('PayPal approval did not persist a reservation.');
    expect(order).toMatchObject({
      status: 'reserved',
      hold: { status: 'authorized', capturedMinor: 0, captures: 0 },
    });
    expect(order.hold.amountMinor).toBe(offer.reward.price.amountMinor);
    if (order.hold.paypalOrderId === null || order.hold.paypalAuthorizationId === null)
      throw new Error('The PayPal hold is missing its sandbox identifiers.');
    const paypal = await payPalRecordOf(order.hold.paypalOrderId);
    expect(paypal.authorizations).toEqual([
      { id: order.hold.paypalAuthorizationId, status: 'CREATED' },
    ]);
    expect(paypal.captures).toEqual([]);

    const metricsAfterHoldResponse = await merchant.request.get(
      appUrl('/api/virtual/partner/metrics'),
    );
    const metricsAfterHold = virtualMetricsSchema.parse(await metricsAfterHoldResponse.json());
    expect(metricsAfterHold).toEqual({
      visits: metricsBefore.visits + 1,
      reserved: metricsBefore.reserved + 1,
      visitedReal: metricsBefore.visitedReal,
    });

    const tripResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/virtual/rides/${created.id}/journey`) &&
        response.request().method() === 'POST',
    );
    await panel.getByRole('button', { name: 'Plan real trip' }).click();
    const trip = await tripResponse;
    expect(trip.status()).toBe(200);
    const journey = virtualJourneyResponseSchema.parse(await trip.json()).journey;
    expect(journey.state).toBe('watching');
    expect(journey.request.destination.lat).toBeCloseTo(40.752732, 5);
    expect(journey.request.destination.lon).toBeCloseTo(-73.977218, 5);
    const link = panel.getByRole('link', { name: 'Open your watched trip' });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`#\\/trip\\/${journey.id}$`));

    const metricsAfterTripResponse = await merchant.request.get(
      appUrl('/api/virtual/partner/metrics'),
    );
    const metricsAfterTripBody: unknown = await metricsAfterTripResponse.json();
    const metricsAfterTrip = virtualMetricsSchema.parse(metricsAfterTripBody);
    expect(metricsAfterTrip).toEqual({
      visits: metricsBefore.visits + 1,
      reserved: metricsBefore.reserved + 1,
      visitedReal: metricsBefore.visitedReal + 1,
    });
    if (typeof metricsAfterTripBody !== 'object' || metricsAfterTripBody === null) {
      throw new Error('Metrics response is not an object.');
    }
    expect(Object.keys(metricsAfterTripBody).sort()).toEqual(['reserved', 'visitedReal', 'visits']);
    await merchant.goto(appUrl('/#/merchant/virtual-visitors'));
    await expect(merchant.getByRole('heading', { name: 'Virtual visitors' })).toBeVisible();
    await expect(merchant.getByText('Real trips started')).toBeVisible();
  } finally {
    await merchant.close();
  }
});
