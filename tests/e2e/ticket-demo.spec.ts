import { ticketDemoStatusSchema } from '@moviq/contracts';

import { appUrl, browserReaching, expect } from './support/app.js';
import { skipReason } from './support/paypal-sandbox.js';

const test = browserReaching(() => false);
const skipped = skipReason();
test.skip(skipped !== undefined, skipped);

test('the demo entry recovers from a login error and lets the traveller skip the wait', async ({
  page,
}) => {
  const status = await page.request.get(appUrl('/api/tickets/demo/status'));
  expect(ticketDemoStatusSchema.parse(await status.json())).toEqual({ enabled: true });

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    sessionStorage.setItem('moviq-intro-seen', '1');
  });
  await page.goto(appUrl('/#/'));
  await expect(page.getByRole('heading', { name: 'Choose how to enter' })).toBeVisible();

  await page.route('**/api/tickets/demo/traveller', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"temporary"}' }),
  );
  await page.getByRole('button', { name: 'Traveller', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your demo access', exact: true })).toBeVisible();
  await expect(page.getByText('Opening your traveller account', { exact: true })).toBeVisible();
  await expect(page.getByLabel('User ID')).toHaveAttribute('readonly', '');
  await expect(page.getByLabel('Password')).toHaveAttribute('readonly', '');
  await expect(page.getByRole('status')).toContainText('Could not connect. Please try again.');
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();

  await page.unroute('**/api/tickets/demo/traveller');
  await page.route('**/api/tickets/demo/traveller', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  });
  const retryResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/tickets/demo/traveller') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Skip animation', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Skip animation', exact: true }).click();
  expect((await retryResponse).status()).toBe(200);
  await expect(page.getByRole('status')).toContainText('Signed in');
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('heading', { name: 'Your urban mobility assistant.' })).toBeVisible();
});

test('the business report and catalogue clear after logout in another tab', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    sessionStorage.setItem('moviq-intro-seen', '1');
  });
  await page.goto(appUrl('/#/'));
  await page.getByRole('button', { name: 'Business', exact: true }).click();
  await expect(page).toHaveURL(/#\/business$/);
  await expect(page.getByRole('heading', { name: 'Transit ticket provider' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sales', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Offered catalog' })).toBeVisible();

  const logout = await page.request.post(appUrl('/api/tickets/demo/logout'));
  expect(logout.ok()).toBe(true);
  await page.getByRole('button', { name: 'Refresh', exact: true }).first().click();
  await expect(page.getByRole('link', { name: 'Enter as demo business' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sales', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Offered catalog' })).toHaveCount(0);
});
