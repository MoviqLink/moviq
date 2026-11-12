import type { Page } from '@playwright/test';

import { appUrl, browserReaching, expect } from './support/app.js';
import { orderIds, ordersInLedger } from './support/merchants.js';
import { isPayPal, sandboxBuyer, skipReason } from './support/paypal-sandbox.js';
import { photographPages } from './support/paypal-window.js';
import {
  answer,
  cravingOnTheTrip,
  expectOffer,
  ramenOrder,
  reserveWithPayPal,
  tellTastes,
  watchedTrip,
} from './support/reward-steps.js';

/** The browser reaches MovIQ and, when payments are on, PayPal; nothing else. */
const test = browserReaching(isPayPal);

/** With the sandbox keys of `.env` (`npm run e2e:paypal`) PayPal holds the money for real. */
const sandbox = skipReason() === undefined;

test.afterEach(async ({ context }, testInfo) => {
  if (sandbox && testInfo.status !== testInfo.expectedStatus)
    await photographPages(context, testInfo, sandboxBuyer());
});

/** Sara gets the craving in her own field; in basic mode she says so and passes the question on. */
async function cravingToSara(page: Page): Promise<void> {
  await page.getByLabel('Ask Sara about this trip').fill("I'm craving ramen");
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByText(/I passed “ramen” to the demo merchants on your way\./)).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByText('A merchant asks you something first: answer it below.'),
  ).toBeVisible();
}

test('a craving told to Sara on the trip: the question, the offer, declined; PayPal off holds nothing', async ({
  page,
}) => {
  test.skip(sandbox, 'With the sandbox keys, the next journey reserves for real.');
  test.setTimeout(120_000);
  // Other walk-throughs share the run's database: only the orders made from here on count.
  const before = orderIds();
  await watchedTrip(page);
  // The fixture opens demo merchants after the trip starts; reload reads their current rules.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Demo promotions on your route' })).toBeVisible();
  await expect(page.getByText('Vegan miso ramen', { exact: true })).toBeVisible();
  await test.info().attach('route-promotions', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
  await tellTastes(page);
  await cravingToSara(page);
  await expectOffer(page, await answer(page, 'Mild'));

  await test.step('declined: the offer leaves and the merchant sees it', async () => {
    await page.getByRole('button', { name: 'No, thanks' }).click();
    await expect(page.getByText('Declined. The merchant sees it.')).toBeVisible();
  });

  await test.step('asked again on the trip screen; without PayPal, nothing can be held', async () => {
    await cravingOnTheTrip(page);
    await expectOffer(page, await answer(page, 'Hot'));
    await expect(page.getByText(/^PayPal is not available here: /)).toBeVisible();
    await expect(page.locator('paypal-button')).toHaveCount(0);
    expect(ordersInLedger(before)).toEqual([]);
  });

  await test.step('My orders, at its own address, has none', async () => {
    await page.goto(appUrl('/#/rewards'));
    await expect(page.getByRole('heading', { name: 'Rewards on your route' })).toBeVisible();
    await expect(
      page.getByText('No orders yet. Ask Sara for something on your trip.'),
    ).toBeVisible();
  });
});

test('reserved with PayPal sandbox: held, not charged; the QR in My orders; cancelled for free', async ({
  page,
}) => {
  test.skip(!sandbox, skipReason());
  // The plan, the first verdict, then signing in and approving in the sandbox.
  test.setTimeout(300_000);
  const before = orderIds();
  await watchedTrip(page);
  await tellTastes(page);
  await cravingOnTheTrip(page);
  const need = await answer(page, 'Mild');
  await expectOffer(page, need);

  await test.step('the buyer approves the hold in PayPal; nothing is charged', async () => {
    await reserveWithPayPal(page, before, need);
  });

  await test.step('My orders shows the code; cancelling before the kitchen voids the hold', async () => {
    await page.getByRole('link', { name: 'See it in My orders' }).click();
    await expect(page).toHaveURL(/#\/rewards$/);
    const order = ramenOrder(page);
    await expect(order.getByRole('img', { name: /^Pickup code / })).toBeVisible();
    await order.getByRole('button', { name: 'Cancel for free' }).click();
    await expect(order).toContainText('Cancelled', { timeout: 30_000 });
    await expect(order).toContainText('Hold released, nothing charged');
    expect(ordersInLedger(before)).toEqual([{ status: 'cancelled', hold: 'voided' }]);
  });
});
