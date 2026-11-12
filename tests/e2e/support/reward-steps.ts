import { needViewSchema, type Money, type NeedView } from '@moviq/contracts';
import type { Locator, Page } from '@playwright/test';

import { expect } from './app.js';
import { expectWatched, planWithSara } from './journey-steps.js';
import { openDemoMerchantsAllDay, ordersInLedger } from './merchants.js';
import { sandboxBuyer } from './paypal-sandbox.js';
import { approveAsBuyer, openPayPal } from './paypal-window.js';
import { resetProviderClock } from './provider-control.js';

/** The demo ramen bar at 125 St, which the trip of the captures passes. */
export const RAMEN_BAR = { id: 'demo-tsuki-ramen-house', name: 'Tsuki Ramen House' } as const;

/** `$14.41`, as the screen writes an amount in English. */
export const dollars = (money: Money): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: money.currency }).format(
    money.amountMinor / 100,
  );

/** The one offer of a need: the ramen bar's, at the server's price. */
export function onlyOffer(need: NeedView): NeedView['offers'][number] {
  const [offer] = need.offers;
  if (offer === undefined) throw new Error('The merchant made no offer.');
  return offer;
}

/** An order of the ramen bar in My orders, by its merchant and its code. */
export const ramenOrder = (page: Page): Locator =>
  page.getByRole('article', { name: /^Tsuki Ramen House [A-Z]-\d{4}$/ });

/** The trip of the captures, watched, passing the demo ramen bar, open at any hour. */
export async function watchedTrip(page: Page): Promise<void> {
  await planWithSara(page, await resetProviderClock());
  await expectWatched(page);
  openDemoMerchantsAllDay();
}

/** The traveller tells Sara, on this device, an alias and a soy allergy (no miso ramen, then). */
export async function tellTastes(page: Page): Promise<void> {
  await page.getByText('What Sara tells the merchants').click();
  await page.getByLabel('Alias').fill('Mia');
  await page.getByRole('checkbox', { name: 'Soy' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved on this device.')).toBeVisible();
}

/** The merchant's question, answered; returns the need with the offer the server validated. */
export async function answer(page: Page, choice: 'Mild' | 'Hot'): Promise<NeedView> {
  const asks = page.getByRole('group', { name: 'A merchant asks' });
  await expect(asks).toContainText('Mild or hot for the Tonkotsu ramen?');
  const answered = page.waitForResponse((r) => r.url().endsWith('/answers') && r.ok());
  await asks.getByRole('button', { name: choice }).click();
  return needViewSchema.parse(await (await answered).json());
}

/** The offer in its row: recommended, demo, at the server's price, then opened in detail. */
export async function expectOffer(page: Page, need: NeedView): Promise<void> {
  const offer = onlyOffer(need);
  const offers = page.getByRole('region', { name: '1 offer made for you' });
  const row = offers.getByRole('button', { name: /Tsuki Ramen House/ });
  await expect(row).toContainText('Sara recommends');
  await expect(row).toContainText('demo');
  await expect(row).toContainText(dollars(offer.reward.price));
  await expect(row).toContainText(dollars(offer.reward.listPrice));
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  await expect(offers).toContainText(`You earn ${dollars(offer.reward.earned)}`);
  await expect(offers).toContainText("Composed by the merchant's rules");
  await expect(offers).toContainText('Tonkotsu ramen');
}

/** The craving from the trip screen's own field. */
export async function cravingOnTheTrip(page: Page): Promise<void> {
  await page.getByLabel('Something on the way').fill('ramen');
  await page.getByRole('button', { name: 'Ask the merchants' }).click();
}

/**
 * The offer reserved with PayPal's official button: the sandbox buyer approves the hold in
 * PayPal's window, and the order appears reserved with its code, held and not charged. Nothing
 * is in MovIQ's ledger before PayPal confirms; then one order, its hold authorized.
 */
export async function reserveWithPayPal(
  page: Page,
  before: ReadonlySet<string>,
  need: NeedView,
): Promise<void> {
  const popup = await openPayPal(page);
  await expect(page.getByText('Approve the reservation in the PayPal window.')).toBeVisible();
  expect(ordersInLedger(before)).toEqual([]);
  await approveAsBuyer(popup, sandboxBuyer());
  const order = ramenOrder(page);
  await expect(order).toContainText('Reserved', { timeout: 30_000 });
  await expect(order).toContainText('Held in PayPal, not charged');
  await expect(order).toContainText(dollars(onlyOffer(need).reward.price));
  await expect(order.getByRole('img', { name: /^Pickup code [A-Z]-\d{4}$/ })).toBeVisible();
  expect(ordersInLedger(before)).toEqual([{ status: 'reserved', hold: 'authorized' }]);
}
