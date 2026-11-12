import {
  paymentSchema,
  ticketDemoPartnerSchema,
  ticketDemoStatusSchema,
  ticketWalletSchema,
} from '@moviq/contracts';
import type { Page } from '@playwright/test';

import { appUrl, browserReaching, expect } from './support/app.js';
import { isPayPal, payPalRecordOf, sandboxBuyer, skipReason } from './support/paypal-sandbox.js';
import { approveAsBuyer, openPayPal, photographPages } from './support/paypal-window.js';

const test = browserReaching(isPayPal);
const skipped = skipReason();
test.skip(skipped !== undefined, skipped);

test.afterEach(async ({ context }, info) => {
  if (info.status !== info.expectedStatus) await photographPages(context, info, sandboxBuyer());
});

async function enterRole(page: Page, role: 'Business' | 'Traveller') {
  await page.goto(appUrl('/#/'));
  await expect(page.getByRole('heading', { name: 'Choose how to enter' })).toBeVisible();
  await page.getByRole('button', { name: role, exact: true }).click();
  const route = role === 'Business' ? '#/business' : '#/dashboard';
  await expect(page).toHaveURL(new RegExp(`${route.replaceAll('/', '\\/')}$`), {
    timeout: 10_000,
  });
}

test('a PATH 40-trip capture belongs to the traveller wallet and the private demo-provider report', async ({
  page,
}) => {
  test.setTimeout(180_000);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const demoStatusResponse = await page.request.get(appUrl('/api/tickets/demo/status'));
  expect(ticketDemoStatusSchema.parse(await demoStatusResponse.json())).toEqual({ enabled: true });

  const anonymousPartner = await page.request.get(appUrl('/api/tickets/demo/partner'));
  expect(anonymousPartner.status()).toBe(401);
  await enterRole(page, 'Business');
  const before = ticketDemoPartnerSchema.parse(
    await (await page.request.get(appUrl('/api/tickets/demo/partner'))).json(),
  );
  expect(before.items).toEqual([]);
  expect(before.totals).toMatchObject({
    sales: 0,
    refunded: 0,
    amountMinor: 0,
    refundedMinor: 0,
    netMinor: 0,
    currency: 'USD',
  });
  await page.getByRole('button', { name: 'Change profile', exact: true }).click();
  await expect(page).toHaveURL(/#\/$/);
  expect((await page.request.get(appUrl('/api/tickets/demo/partner'))).status()).toBe(401);

  await enterRole(page, 'Traveller');
  await page.locator('main#main').getByRole('link', { name: 'Browse tickets' }).last().click();
  await expect(page).toHaveURL(/#\/tickets$/);
  const product = page.getByTestId('ticket-product-path-tapp-40-demo');
  await product.getByRole('button', { name: 'Choose ticket', exact: true }).click();
  const orderResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/payments/orders') && response.request().method() === 'POST',
  );
  const popup = await openPayPal(page);
  const created = paymentSchema.parse(await (await orderResponse).json());
  expect(created.amount).toEqual({ amountMinor: 12400, currency: 'USD' });
  expect(created.status).toBe('created');
  expect(
    ticketWalletSchema.parse(await (await page.request.get(appUrl('/api/tickets/wallet'))).json())
      .items,
  ).toEqual([]);
  await approveAsBuyer(popup, sandboxBuyer());
  await expect(page.getByText(/Sandbox payment confirmed/).first()).toBeVisible({
    timeout: 30_000,
  });
  const confirmed = await page.request.post(appUrl(`/api/payments/orders/${created.id}/confirm`));
  expect(paymentSchema.parse(await confirmed.json()).status).toBe('captured');
  const record = await payPalRecordOf(created.paypalOrderId);
  expect(record.captures).toHaveLength(1);
  expect(record.captures[0]).toMatchObject({
    status: 'COMPLETED',
    value: '124.00',
    currency: 'USD',
  });
  const wallet = ticketWalletSchema.parse(
    await (await page.request.get(appUrl('/api/tickets/wallet'))).json(),
  );
  expect(wallet.items).toHaveLength(1);
  expect(wallet.items[0]).toMatchObject({
    paymentId: created.id,
    paypalOrderId: created.paypalOrderId,
    status: 'captured',
    product: { id: 'path-tapp-40-demo', rides: 40 },
  });
  expect(wallet.items[0]?.paypalCaptureId).toBe(record.captures[0]?.id);
  await page.goto(appUrl('/#/tickets/wallet'));
  await expect(page.getByText('PATH TAPP 40 rides', { exact: true })).toBeVisible();
  expect((await page.request.get(appUrl('/api/tickets/demo/partner'))).status()).toBe(401);
  expect((await page.request.get(appUrl('/api/tickets/partner'))).ok()).toBe(false);

  await page.goto(appUrl('/#/dashboard'));
  await page.getByRole('link', { name: 'Change profile', exact: true }).click();
  await expect(page).toHaveURL(/#\/$/);
  await enterRole(page, 'Business');
  const partnerResponse = await page.request.get(appUrl('/api/tickets/demo/partner'));
  expect(partnerResponse.status()).toBe(200);
  const partnerBody: unknown = await partnerResponse.json();
  expect(JSON.stringify(partnerBody)).not.toMatch(/travellerId|userId|email|phone/i);
  const partner = ticketDemoPartnerSchema.parse(partnerBody);
  expect(partner.items).toHaveLength(before.items.length + 1);
  expect(partner.totals).toMatchObject({
    sales: before.totals.sales + 1,
    refunded: before.totals.refunded,
    amountMinor: before.totals.amountMinor + 12400,
    refundedMinor: before.totals.refundedMinor,
    netMinor: before.totals.netMinor + 12400,
    currency: 'USD',
  });
  const transaction = partner.items.find((item) => item.paymentId === created.id);
  expect(transaction).toMatchObject({
    paymentId: created.id,
    paypalOrderId: created.paypalOrderId,
    paypalCaptureId: record.captures[0]?.id,
    amountMinor: 12400,
    currency: 'USD',
    refundedMinor: 0,
    netMinor: 12400,
    status: 'captured',
    product: { id: 'path-tapp-40-demo', rides: 40 },
  });
  await expect(page.getByRole('heading', { name: 'Transit ticket provider' })).toBeVisible();
  const transactionRow = page.locator('.dashboard-transactions li').filter({ hasText: created.id });
  await expect(
    transactionRow.getByText(`Capture PayPal: ${record.captures[0]?.id}`, { exact: true }),
  ).toBeVisible();
  await expect(
    transactionRow.getByText(`Order PayPal: ${created.paypalOrderId}`, { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Change profile', exact: true }).click();
  await expect(page).toHaveURL(/#\/$/);
  expect((await page.request.get(appUrl('/api/tickets/demo/partner'))).status()).toBe(401);
  const retainedWallet = ticketWalletSchema.parse(
    await (await page.request.get(appUrl('/api/tickets/wallet'))).json(),
  );
  expect(retainedWallet.items).toEqual(wallet.items);

  await enterRole(page, 'Traveller');
  await expect(page.getByText('PATH TAPP 40 rides', { exact: true })).toBeVisible();
});
