import { needViewSchema, virtualMetricsSchema, virtualRideSchema } from '@moviq/contracts';

import { MERCHANT_TEST_TOKEN } from '../../apps/server/tests/support/merchant-access.js';
import { appUrl, expect, test } from './support/app.js';
import {
  boardCapturedM5,
  currentVirtualRide,
  expireVirtualInvitation,
  placeVirtualMerchantAt,
  VIRTUAL_BUS_ID,
  VIRTUAL_ITEM_ID,
  VIRTUAL_MERCHANT_ID,
} from './support/virtual-rides.js';

test('a fresh M5 ride resumes for its owner, retains preview ids, and ends when the traveller gets off', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const created = await boardCapturedM5(page);
  expect(created.status).toBe('following');
  expect(created.vehicle.id).toBe(VIRTUAL_BUS_ID);
  expect(created.vehicle.line?.name).toBe('M5');
  expect(created.vehicle.position.basis).toBe('gps');
  expect(Date.now() - Date.parse(created.vehicle.position.dataTime)).toBeLessThanOrEqual(120_000);
  expect(created.stops.length).toBeGreaterThanOrEqual(3);
  expect(created.stops.length).toBeLessThanOrEqual(8);

  const firstStop = created.stops[0];
  if (firstStop === undefined) throw new Error('The captured M5 has no upcoming stop.');
  placeVirtualMerchantAt(firstStop);
  const first = await currentVirtualRide(page);
  expect(first?.id).toBe(created.id);
  const invitations = first?.stops.flatMap((stop) => stop.suggestions) ?? [];
  expect(invitations.length).toBeGreaterThan(0);
  for (const invitation of invitations) {
    expect(Date.parse(invitation.expiresAt)).toBeGreaterThan(Date.now());
  }
  const resumed = await currentVirtualRide(page);
  expect(resumed?.id).toBe(created.id);
  expect(
    resumed?.stops.flatMap((stop) => stop.suggestions).map((item) => item.invitationId),
  ).toEqual(invitations.map((item) => item.invitationId));

  await page.goto(appUrl('/#/explore?view=virtual'));
  const panel = page.getByRole('article', { name: 'Virtual ride' });
  await expect(panel).toContainText('M5');
  await expect(panel).toContainText('Next stops');
  await panel.getByRole('button', { name: 'Get off' }).click();
  await expect(panel).toBeHidden();
  expect(await currentVirtualRide(page)).toBeNull();
});

test('invitation previews are stable, expire visibly, and cannot be negotiated after expiry', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const created = await boardCapturedM5(page);
  const firstStop = created.stops[0];
  if (firstStop === undefined) throw new Error('The captured M5 has no upcoming stop.');
  placeVirtualMerchantAt(firstStop);
  const withInvitation = await currentVirtualRide(page);
  const invitation = withInvitation?.stops
    .flatMap((stop) => stop.suggestions)
    .find(
      (suggestion) =>
        suggestion.merchant.id === VIRTUAL_MERCHANT_ID && suggestion.itemId === VIRTUAL_ITEM_ID,
    );
  if (invitation === undefined)
    throw new Error('The seeded merchant was not matched to the M5 stop.');
  expect(invitation.status).toBe('offered');
  expect(Date.parse(invitation.expiresAt) - Date.now()).toBeGreaterThan(0);
  expect(Date.parse(invitation.expiresAt) - Date.now()).toBeLessThanOrEqual(5 * 60_000);

  const again = await currentVirtualRide(page);
  const same = again?.stops
    .flatMap((stop) => stop.suggestions)
    .find((item) => item.invitationId === invitation.invitationId);
  expect(same?.expiresAt).toBe(invitation.expiresAt);

  expireVirtualInvitation(invitation.invitationId);
  const expired = await currentVirtualRide(page);
  const expiredInvitation = expired?.stops
    .flatMap((stop) => stop.suggestions)
    .find((item) => item.invitationId === invitation.invitationId);
  expect(expiredInvitation?.status).toBe('expired');
  await page.reload();
  const panel = page.getByRole('article', { name: 'Virtual ride' });
  await expect(panel.getByText('Invitation expired')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Ask for an offer' })).toBeDisabled();

  const request = await page.request.post(appUrl(`/api/virtual/rides/${created.id}/needs`), {
    data: {
      invitationId: invitation.invitationId,
      alias: 'Mia',
      taste: { allergies: [], avoid: [], noAlcohol: true, diet: 'any', drink: null, spice: 'mild' },
      language: 'en',
    },
  });
  expect(request.status()).toBe(409);
});

test('virtual ride and invitation data are private to the traveller session', async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  const created = await boardCapturedM5(page);
  const response = await page.request.get(appUrl(`/api/virtual/rides/${created.id}`));
  expect(response.status()).toBe(200);
  await page.reload();
  await expect(page.getByText('M5').first()).toBeVisible();

  const outsider = await browser.newPage();
  try {
    await outsider.goto(appUrl('/#/explore?view=virtual'));
    expect(await currentVirtualRide(outsider)).toBeNull();
    const hidden = await outsider.request.get(appUrl(`/api/virtual/rides/${created.id}`));
    expect(hidden.status()).toBe(404);
  } finally {
    await outsider.close();
  }
});

test('a chosen invitation creates one personal request and the merchant sees aggregate counts only', async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  const created = await boardCapturedM5(page);
  const firstStop = created.stops[0];
  if (firstStop === undefined) throw new Error('The captured M5 has no upcoming stop.');
  placeVirtualMerchantAt(firstStop);
  const ride = await currentVirtualRide(page);
  const invitation = ride?.stops
    .flatMap((stop) => stop.suggestions)
    .find((item) => item.merchant.id === VIRTUAL_MERCHANT_ID && item.itemId === VIRTUAL_ITEM_ID);
  if (invitation === undefined) throw new Error('The seeded merchant has no preview invitation.');
  const merchant = await browser.newPage();
  try {
    const login = await merchant.request.post(appUrl('/api/merchant/session'), {
      data: { merchantId: VIRTUAL_MERCHANT_ID, token: MERCHANT_TEST_TOKEN },
    });
    expect(login.status()).toBe(200);
    const beforeResponse = await merchant.request.get(appUrl('/api/virtual/partner/metrics'));
    expect(beforeResponse.status()).toBe(200);
    const before = virtualMetricsSchema.parse(await beforeResponse.json());

    await page.reload();
    const panel = page.getByRole('article', { name: 'Virtual ride' });
    const needResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/virtual/rides/${created.id}/needs`) &&
        response.request().method() === 'POST',
    );
    await panel.getByRole('button', { name: 'Ask for an offer' }).click();
    const needReply = await needResponse;
    expect(needReply.status()).toBe(201);

    const need = needViewSchema.parse(await needReply.json());
    expect(need.craving).toBe('Vegan miso ramen');
    const persisted = await page.request.get(appUrl(`/api/virtual/rides/${created.id}`));
    const savedRide = virtualRideSchema.parse(await persisted.json());
    expect(savedRide.needs.map((item) => item.id)).toContain(need.id);

    const metricsResponse = await merchant.request.get(appUrl('/api/virtual/partner/metrics'));
    expect(metricsResponse.status()).toBe(200);
    const metricsBody: unknown = await metricsResponse.json();
    const metrics = virtualMetricsSchema.parse(metricsBody);
    expect(metrics.visits).toBe(before.visits + 1);
    if (typeof metricsBody !== 'object' || metricsBody === null) {
      throw new Error('The metrics response is not an object.');
    }
    expect(Object.keys(metricsBody).sort()).toEqual(['reserved', 'visitedReal', 'visits']);
  } finally {
    await merchant.close();
  }
});
