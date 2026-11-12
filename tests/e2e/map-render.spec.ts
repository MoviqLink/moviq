import { appUrl, expect, test } from './support/app.js';

/** A deterministic base style isolates worker packaging from external tile availability. */
const style = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e8edef' } }],
};

test('the production build serves its map worker and initializes live map layers', async ({
  page,
}, testInfo) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('https://tiles.openfreemap.org/styles/*', (route) =>
    route.fulfill({ json: style }),
  );
  const worker = page.waitForResponse((response) =>
    /\/assets\/maplibre-gl-worker[-.]/.test(new URL(response.url()).pathname),
  );
  await page.goto(appUrl('/#/how-it-works'));
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Live map' }).click();
  await expect(page).toHaveURL(/#\/explore$/);
  expect((await worker).status()).toBe(200);
  const map = page.locator('.explore-map');
  await expect(map).toHaveAttribute('data-map-status', 'ready');
  await expect(map.locator('canvas')).toBeVisible();
  const geometry = await map.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      position: getComputedStyle(element).position,
      height: rect.height,
      viewport: innerHeight,
    };
  });
  expect(geometry.position).toBe('fixed');
  expect(geometry.height).toBeGreaterThanOrEqual(geometry.viewport * 0.9);

  await page.reload();
  try {
    await expect(map).toHaveAttribute('data-map-status', 'ready');
  } catch (error) {
    await testInfo.attach('browser errors after map reload', {
      body: browserErrors.join('\n') || '(no pageerror or console.error captured)',
      contentType: 'text/plain',
    });
    throw error;
  }
  await expect(map.locator('canvas')).toBeVisible();
  const reloadedGeometry = await map.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      position: getComputedStyle(element).position,
      height: rect.height,
      viewport: innerHeight,
    };
  });
  expect(reloadedGeometry.position).toBe('fixed');
  expect(reloadedGeometry.height).toBeGreaterThanOrEqual(reloadedGeometry.viewport * 0.9);
  await page.getByRole('radio', { name: '2D', exact: true }).click();
  await expect(page.getByRole('radio', { name: '2D', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('a failed map style stays visible above the mobile panel and retries to a ready canvas', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let styleRequests = 0;
  await page.route('https://tiles.openfreemap.org/styles/*', async (route) => {
    styleRequests += 1;
    if (styleRequests === 1) {
      await route.fulfill({ status: 503, body: 'temporarily unavailable' });
      return;
    }
    await route.fulfill({ json: style });
  });

  await page.goto(appUrl('/#/explore'));
  const map = page.locator('.explore-map');
  const notice = map.getByRole('status');
  await expect(map).toHaveAttribute('data-map-status', 'failed');
  await expect(notice).toContainText('The map could not finish loading');
  const noticeBox = await notice.boundingBox();
  expect(noticeBox).not.toBeNull();
  expect(noticeBox?.x).toBeGreaterThanOrEqual(0);
  expect((noticeBox?.x ?? 390) + (noticeBox?.width ?? 0)).toBeLessThanOrEqual(390);
  expect(noticeBox?.y).toBeGreaterThanOrEqual(0);
  expect((noticeBox?.y ?? 844) + (noticeBox?.height ?? 0)).toBeLessThanOrEqual(844);
  const sheetBox = await page.locator('.ex-sheet').boundingBox();
  expect(sheetBox).not.toBeNull();
  expect((noticeBox?.y ?? 0) + (noticeBox?.height ?? 0)).toBeLessThan(sheetBox?.y ?? 844);
  const retry = page.getByRole('button', { name: 'Retry map' });
  await expect(retry).toBeVisible();

  await retry.click();
  await expect(map).toHaveAttribute('data-map-status', 'ready');
  await expect(map.locator('canvas')).toBeVisible();
  expect(styleRequests).toBeGreaterThanOrEqual(2);
});

/** A static aerial tile must not download forever when the provider marks it expired at once. */
test('static aerial imagery does not repeatedly refresh an expired tile while idle', async ({
  page,
}) => {
  await page.route('https://tiles.openfreemap.org/styles/*', (route) =>
    route.fulfill({ json: style }),
  );
  const requests = new Map<string, number>();
  // A tiny raster fixture isolates request scheduling from public imagery availability.
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  let detailRequests = 0;
  await page.route('https://orthos.its.ny.gov/**', (route) => {
    detailRequests += 1;
    return route.fulfill({ body: pixel, contentType: 'image/png' });
  });
  await page.route('https://basemap.nationalmap.gov/**', (route) => {
    const url = route.request().url();
    requests.set(url, (requests.get(url) ?? 0) + 1);
    return route.fulfill({
      body: pixel,
      contentType: 'image/png',
      headers: { 'cache-control': 'public, max-age=0, must-revalidate' },
    });
  });
  await page.goto(appUrl('/#/explore'));
  await expect(page.locator('.explore-map')).toHaveAttribute('data-map-status', 'ready');
  await page.getByRole('radio', { name: 'Aerial', exact: true }).click();
  await expect.poll(() => requests.size).toBeGreaterThan(0);
  // Let the first raster tiles settle before measuring idle network work.
  await page.waitForTimeout(1_000);
  const settled = [...requests.entries()];
  // The expiry implementation retries after one second; observe beyond two retry intervals.
  await page.waitForTimeout(3_500);
  expect([...requests.entries()]).toEqual(settled);
  expect(detailRequests).toBe(0);
  // Detailed NYS imagery is deferred until the user actually zooms down to street level.
  for (let step = 0; step < 5; step += 1) {
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await page.waitForTimeout(400);
  }
  await expect.poll(() => detailRequests).toBeGreaterThan(0);
});
