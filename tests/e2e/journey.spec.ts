import { paymentsConfigSchema } from '@moviq/contracts';

import { appUrl, expect, test } from './support/app.js';
import {
  LATE_MINUTES,
  SUBWAY_SOURCE,
  expectWatched,
  holdTheTrain,
  planWithSara,
  readJourney,
} from './support/journey-steps.js';
import { resetProviderClock } from './support/provider-control.js';

test('a traveller plans with Sara and the worker watches the trip; payments say why they are off', async ({
  page,
}) => {
  // Three turns with Sara, then a watch round of the worker (every 20 s).
  test.setTimeout(120_000);
  const clock = await resetProviderClock();
  await test.step('(a) Sara asks only what is missing and plans backwards', async () => {
    await planWithSara(page, clock);
  });
  await test.step('(b) the worker watches the trip and says why', async () => {
    await expectWatched(page);
  });
  await test.step('(e) without PayPal keys, payments say they are off and why', async () => {
    const response = await page.request.get(appUrl('/api/payments/config'));
    expect(paymentsConfigSchema.parse(await response.json())).toMatchObject({
      available: false,
      reason: expect.stringContaining('PayPal is not set up on this server'),
    });
  });
});

test('a late train of the plan brings the incident, its proof and the options; a free one is taken', async ({
  page,
  playwright,
}) => {
  // The plan and its first verdict, then a feed refresh, a watch round and Sara's reading.
  test.setTimeout(180_000);
  const clock = await resetProviderClock();
  const planned = await planWithSara(page, clock);
  await expectWatched(page);
  const id = planned.id;

  await test.step('(c) the 6 is held at Grand Central: incident, proof and options', async () => {
    const ops = await playwright.request.newContext();
    await holdTheTrain(planned, ops);
    await ops.dispose();
    await expect(page.getByText('At risk', { exact: true })).toBeVisible({ timeout: 60_000 });
    const delay = page
      .getByRole('region', { name: 'What changed' })
      .getByRole('listitem')
      .filter({ hasText: 'Delay' });
    await expect(delay).toContainText(`${String(LATE_MINUTES)} min later than planned`);
    await expect(delay).toContainText(`Source: ${SUBWAY_SOURCE}`);
    const first = page.getByRole('group', { name: 'Your options' }).getByRole('radio').first();
    await expect(first).toBeVisible({ timeout: 30_000 });
    await expect(first).toHaveAccessibleName(/the earliest option/);
    await expect(first).toHaveAccessibleName(/Recommended/);
  });

  await test.step('(d) a free option replaces the route', async () => {
    const offered = await readJourney(page, id);
    const best = offered.alternatives[0];
    if (best === undefined) throw new Error('The watch offered no alternative.');
    expect(best).toMatchObject({ recommended: true, price: null });
    // A real radio group: the arrows move the choice, and the recommended one is chosen back.
    const radios = page.getByRole('group', { name: 'Your options' }).getByRole('radio');
    await radios.first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(radios.nth(1)).toBeChecked();
    await page.keyboard.press('ArrowUp');
    await expect(radios.first()).toBeChecked();
    await page.getByRole('button', { name: 'Use this route' }).click();
    await expect(page.getByText(/^You are now on: .+\. Sara keeps watching it\.$/)).toBeVisible();
    const switched = await readJourney(page, id);
    expect(switched.itinerary.id).toBe(best.itinerary.id);
    expect(switched.itinerary.departAt).not.toBe(planned.itinerary.departAt);
  });
});
