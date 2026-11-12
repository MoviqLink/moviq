import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { MERCHANT_TEST_TOKEN } from '../../apps/server/tests/support/merchant-access.js';

import type { Page } from '@playwright/test';
import { needViewSchema, orderViewSchema, type NeedView } from '@moviq/contracts';

import { appUrl, expect, test } from './support/app.js';

const MERCHANT = { id: 'demo-tsuki-ramen-house', name: 'Tsuki Ramen House', stop: '403671' };

function database(): DatabaseSync {
  const file = process.env['E2E_DATABASE_FILE'];
  if (file === undefined) throw new Error('E2E_DATABASE_FILE is set by the global setup.');
  return new DatabaseSync(file, { timeout: 5_000 });
}

/**
 * The demo merchant open around the clock in this run's throwaway database, so the offers its
 * agent makes pass the server's opening-hours check whatever the hour the test runs at.
 */
function openAllDay(): void {
  const db = database();
  const day = [{ opens: '00:00', closes: '24:00' }];
  const week = { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day };
  db.prepare('UPDATE commerce_agent_rules SET hours = ? WHERE merchant_id = ?').run(
    JSON.stringify(week),
    MERCHANT.id,
  );
  db.close();
}

/** Mia asks Sara for ramen at the merchant's stop; Sara and its agent talk it through. */
async function askForRamen(page: Page): Promise<NeedView> {
  const response = await page.request.post(`${appUrl()}/api/commerce/needs`, {
    data: {
      craving: 'ramen',
      alias: 'Mia',
      taste: {
        allergies: ['peanuts'],
        avoid: ['scallions'],
        noAlcohol: true,
        diet: 'any',
        drink: 'cola',
        spice: 'hot',
      },
      route: { stopId: MERCHANT.stop },
      language: 'en',
    },
  });
  expect(response.status()).toBe(201);
  return needViewSchema.parse(await response.json());
}

const text = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('Expected text from the database.');
  return value;
};

/**
 * Payments are off in end-to-end runs, and an order exists only once PayPal confirms its hold.
 * This writes what that confirmation leaves, as `hold-purchases.ts` would: the hold authorized
 * for the offer's price, the order reserved and its kitchen ticket. No PayPal call is made.
 */
function reserveInLedger(offerId: string): { orderId: string; code: string } {
  const db = database();
  const offer = db.prepare('SELECT * FROM commerce_offers WHERE id = ?').get(offerId);
  if (offer === undefined) throw new Error(`Offer ${offerId} is not in the ledger.`);
  const need = db
    .prepare(
      `SELECT n.alias FROM commerce_needs n JOIN commerce_threads t ON t.need_id = n.id
        WHERE t.id = ?`,
    )
    .get(text(offer['thread_id']));
  const price = Number(offer['price_minor']);
  const lines = JSON.parse(text(offer['lines'])) as { itemId: string; quantity: number }[];
  const ticket = lines.map((line, index) => {
    const item = db.prepare('SELECT name FROM commerce_menu_items WHERE id = ?').get(line.itemId);
    return {
      ...line,
      name: text(item?.['name']),
      paidMinor: index === 0 ? price : 0,
    };
  });
  const now = new Date().toISOString();
  const holdId = randomUUID();
  const orderId = randomUUID();
  const code = 'T-1001';
  const purpose = JSON.stringify({ kind: 'merchant-offer', offerId });
  const presentation = JSON.stringify({
    brandName: 'MovIQ',
    locale: 'en-US',
    items: [
      {
        name: 'Ramen',
        quantity: 1,
        unitAmount: { amountMinor: price, currency: 'USD' },
        category: 'PHYSICAL_GOODS',
      },
    ],
    discount: { amountMinor: 0, currency: 'USD' },
  });
  db.prepare(
    `INSERT INTO payment_holds (id, traveller_id, purpose, purpose_key, amount_minor, currency,
       description, presentation, status, pending, created_at, updated_at, version)
     VALUES (?, ?, ?, ?, ?, 'USD', 'Ramen', ?, 'unknown', 'authorize', ?, ?, 1)`,
  ).run(
    holdId,
    text(offer['traveller_id']),
    purpose,
    `merchant-offer:${offerId}`,
    price,
    presentation,
    now,
    now,
  );
  db.prepare(
    `UPDATE payment_holds SET status = 'authorized', pending = NULL, paypal_order_id = ?,
       paypal_authorization_id = ? WHERE id = ?`,
  ).run(`E2E-${holdId}`, `E2E-AUTH-${holdId}`, holdId);
  db.prepare(
    `INSERT INTO commerce_orders (id, offer_id, hold_id, traveller_id, merchant_id, code, alias,
       status, pickup_at, kitchen_starts_at, ticket, created_at, updated_at, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?, ?, 1)`,
  ).run(
    orderId,
    offerId,
    holdId,
    text(offer['traveller_id']),
    MERCHANT.id,
    code,
    text(need?.['alias']),
    text(offer['pickup_at']),
    now,
    JSON.stringify(ticket),
    now,
    now,
  );
  db.prepare("UPDATE commerce_offers SET status = 'reserved' WHERE id = ?").run(offerId);
  db.close();
  return { orderId, code };
}

test('a demo merchant reads the conversation with Sara, moves a ticket and scans a code', async ({
  page,
}) => {
  openAllDay();
  const need = await askForRamen(page);
  const offer = need.offers.find((candidate) => candidate.merchant.id === MERCHANT.id);
  expect(offer, 'the agent of the ramen house makes an offer the server accepts').toBeDefined();
  const order = reserveInLedger(offer?.id ?? '');

  // F-J9-01: a valid demo access key is required before a merchant panel opens.
  await page.goto(`${appUrl()}/#/merchant`);
  await expect(page.getByRole('heading', { name: 'Your merchant panel' })).toBeVisible();
  const enter = page.getByRole('button', { name: `Enter as ${MERCHANT.name}` });
  await expect(enter).toBeDisabled();
  await page.getByLabel('Merchant access key').fill('wrong-key');
  await enter.click();
  await expect(page.getByRole('alert')).toContainText('That access key is not valid');
  await page.getByLabel('Merchant access key').fill(MERCHANT_TEST_TOKEN);
  await page.getByRole('button', { name: `Enter as ${MERCHANT.name}` }).click();
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
  await expect(page.getByText(MERCHANT.name).first()).toBeVisible();
  await expect(page.getByText(order.code).first()).toBeVisible();

  // F-J9-03, F-J9-13: the request and the conversation between Sara and the agent, in order.
  await page
    .getByRole('navigation', { name: 'Merchant panel' })
    .getByRole('link', { name: 'Requests' })
    .click();
  await page.getByRole('link', { name: /Mia · ramen/ }).click();
  const talk = page.getByRole('list', {
    name: 'Conversation between Sara and your agent about Mia',
  });
  await expect(talk.getByText('Mia would like ramen')).toBeVisible();
  await expect(talk.getByText('Allergic to peanuts')).toBeVisible();
  await expect(talk.getByText('Accepted').first()).toBeVisible();
  await expect(talk.getByText(/^Offers it for \$/).first()).toBeVisible();

  // F-J9-04: the kitchen starts the ticket; the server moves it and the grid shows it.
  await page
    .getByRole('navigation', { name: 'Merchant panel' })
    .getByRole('link', { name: 'Tickets' })
    .click();
  await page.getByRole('button', { name: `Start · ${order.code}` }).click();
  await expect(
    page.getByRole('status').filter({ hasText: `Order ${order.code} is now preparing.` }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: `Mark ready · ${order.code}` })).toBeVisible();

  // F-J9-05: the customer's real pickup code, pasted; with payments off nothing is charged.
  const traveller = await page.request.get(`${appUrl()}/api/commerce/orders/${order.orderId}`);
  const qr = orderViewSchema.parse(await traveller.json()).pickup?.qr ?? '';
  expect(qr).not.toBe('');
  await page
    .getByRole('navigation', { name: 'Merchant panel' })
    .getByRole('link', { name: 'Scan' })
    .click();
  await page.getByRole('textbox', { name: 'Pickup code' }).fill(qr);
  await page.getByRole('button', { name: 'Charge and hand over' }).click();
  const outcome = page.getByRole('status').filter({ hasText: 'Not charged' });
  await expect(outcome).toContainText('PayPal is not set up on this server');
  await expect(outcome).toContainText('Nothing has been charged.');

  // F-J9-08, F-J9-09: the opening hours, saved with the rules, and what the rules compose now.
  await page
    .getByRole('navigation', { name: 'Merchant panel' })
    .getByRole('link', { name: 'Your agent' })
    .click();
  const examples = page.getByRole('list', { name: 'Example offers' });
  await expect(examples.locator(':scope > li')).toHaveCount(3);
  await expect(examples.getByText('The server would accept it').first()).toBeVisible();
  await page.getByRole('button', { name: 'Remove stretch 1 on Sunday' }).click();
  await page.getByRole('button', { name: 'Add a stretch on Sunday' }).click();
  await page.getByRole('textbox', { name: 'Sunday, stretch 1, closes' }).fill('15:00');
  await page.getByRole('button', { name: 'Save the rules' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Saved. Your agent follows them' }),
  ).toBeVisible();
  await expect(page.getByText('Version 2')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Sunday, stretch 1, opens' })).toHaveValue(
    '09:00',
  );
});
