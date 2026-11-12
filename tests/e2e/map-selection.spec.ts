import type { Page } from '@playwright/test';
import {
  liveLinesResponseSchema,
  liveVehiclesResponseSchema,
  type LiveLine,
} from '@moviq/contracts';

import { appUrl, expect, test } from './support/app.js';
import { resetProviderClock } from './support/provider-control.js';

const style = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e8edef' } }],
};

const key = (line: LiveLine) => JSON.stringify([line.mode, line.sourceId, line.lineId]);

async function catalog(page: Page) {
  const response = await page.request.get(appUrl('/api/live/lines'));
  expect(response.ok()).toBeTruthy();
  return liveLinesResponseSchema.parse(await response.json());
}

function networkName(line: LiveLine, sources: Awaited<ReturnType<typeof catalog>>['sources']) {
  if (line.sourceId === 'mta-lirr-realtime') return 'LIRR';
  if (line.sourceId === 'mta-metro-north-realtime') return 'Metro-North';
  return (
    sources.find((source) => source.provenance.sourceId === line.sourceId)?.title ?? line.sourceId
  );
}

async function addLine(
  page: Page,
  line: LiveLine,
  sources: Awaited<ReturnType<typeof catalog>>['sources'],
  lang: 'en' | 'es' = 'en',
) {
  const name = `${lang === 'en' ? 'Add' : 'Añadir'} ${line.name} · ${networkName(line, sources)}`;
  const input = page.getByRole('searchbox', {
    name: lang === 'en' ? 'Search lines' : 'Buscar líneas',
  });
  await input.fill(line.name);
  const result = page
    .locator('.your-results > li')
    .filter({ hasText: line.name })
    .filter({ hasText: networkName(line, sources) });
  await expect(result).toHaveCount(1);
  await result.getByRole('button', { name, exact: true }).click();
  await expect(page.locator('.your-lines > .your-line')).toContainText(line.name);
}

async function verifyVehicleFilter(page: Page, lines: readonly LiveLine[]) {
  const wanted = [...lines].map(key).sort();
  const response = await page.waitForResponse((candidate) => {
    if (!candidate.url().includes('/api/live/vehicles?')) return false;
    const raw = new URL(candidate.url()).searchParams.get('lines');
    if (raw === null) return false;
    try {
      const selected = JSON.parse(raw) as { mode: string; sourceId: string; lineId: string }[];
      return (
        JSON.stringify(
          selected.map((line) => JSON.stringify([line.mode, line.sourceId, line.lineId])).sort(),
        ) === JSON.stringify(wanted)
      );
    } catch {
      return false;
    }
  });
  expect(response.ok()).toBeTruthy();
  const answer = liveVehiclesResponseSchema.parse(await response.json());
  const selected = new Set(wanted);
  for (const vehicle of answer.vehicles) {
    expect(vehicle.line).not.toBeNull();
    expect(
      selected.has(JSON.stringify([vehicle.mode, vehicle.sourceId, vehicle.line?.id])),
    ).toBeTruthy();
  }
  return answer;
}

test('Explore starts with the city now and then fetches only the selected lines', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.route('https://tiles.openfreemap.org/styles/*', (route) =>
    route.fulfill({ json: style }),
  );
  const vehicleRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/live/vehicles')) vehicleRequests.push(request.url());
  });
  await resetProviderClock();
  await page.goto(appUrl('/#/explore'));
  await expect(page.locator('.your-map')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Your map' })).toBeVisible();
  await expect(page.locator('.your-lines')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(0);
  await expect(page.locator('.city-now-card[data-mode="subway"]')).toBeVisible({ timeout: 30_000 });
  const lines = await catalog(page);
  const subway = lines.lines.find((line) => line.mode === 'subway' && line.name === 'A');
  const bus = lines.lines.find((line) => line.mode === 'bus' && line.name === 'M15');
  if (subway === undefined || bus === undefined)
    throw new Error('The captured catalogue should contain subway A and bus M15.');
  const a = subway;
  const m15 = bus;
  // Before any choice: every train, ferry and shuttle and the PATH stations, no buses, no lines.
  await expect.poll(() => vehicleRequests.length).toBeGreaterThan(0);
  const firstRequest = vehicleRequests[0];
  if (firstRequest === undefined) throw new Error('No vehicle request was made.');
  const first = new URL(firstRequest).searchParams;
  expect(first.get('lines')).toBeNull();
  expect(first.get('modes')).toBe('subway,rail,ferry,shuttle,rail-station');

  await addLine(page, a, lines.sources);
  const one = await verifyVehicleFilter(page, [a]);
  expect(
    one.vehicles.every(
      (vehicle) =>
        vehicle.mode === a.mode && vehicle.sourceId === a.sourceId && vehicle.line?.id === a.lineId,
    ),
  ).toBeTruthy();
  await expect(page.locator('.your-lines > .your-line')).toHaveCount(1);

  await addLine(page, m15, lines.sources);
  const two = await verifyVehicleFilter(page, [a, m15]);
  expect(
    two.vehicles.every((vehicle) =>
      [key(a), key(m15)].includes(
        JSON.stringify([vehicle.mode, vehicle.sourceId, vehicle.line?.id]),
      ),
    ),
  ).toBeTruthy();
  await expect(page.locator('.your-lines > .your-line')).toHaveCount(2);

  const aRow = page.locator('.your-line').filter({
    has: page.getByRole('button', { name: `Remove A · ${networkName(a, lines.sources)}` }),
  });
  await aRow.getByText('View vehicles', { exact: true }).click();
  const nearby = aRow.getByRole('region', { name: 'On the map now' });
  if ((await nearby.getByRole('button').count()) > 0) {
    const routeRequest = page.waitForResponse((response) =>
      response.url().includes('/api/live/route?vehicle='),
    );
    await nearby.getByRole('button').first().click();
    const route = await routeRequest;
    expect(route.ok()).toBeTruthy();
    await expect(page.getByRole('article')).toBeVisible();
    await page.getByRole('article').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('article')).toBeHidden();
  }

  await aRow.getByRole('button', { name: `Remove A · ${networkName(a, lines.sources)}` }).click();
  await verifyVehicleFilter(page, [m15]);
  await expect(page.locator('.your-lines > .your-line')).toHaveCount(1);
  const m15Row = page.locator('.your-line').filter({
    has: page.getByRole('button', { name: `Remove M15 · ${networkName(m15, lines.sources)}` }),
  });
  await m15Row
    .getByRole('button', { name: `Remove M15 · ${networkName(m15, lines.sources)}` })
    .click();
  await expect(page.locator('.your-lines')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(0);
});

for (const locale of ['en-US', 'es-ES'] as const) {
  test.describe(`empty map in ${locale}`, () => {
    test.use({ locale });
    for (const colorScheme of ['light', 'dark'] as const) {
      for (const width of [1440, 390] as const) {
        test(`fits ${String(width)}px viewport in ${colorScheme} mode`, async ({
          page,
        }, testInfo) => {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
          await page.emulateMedia({ colorScheme });
          await page.route('https://tiles.openfreemap.org/styles/*', (route) =>
            route.fulfill({ json: style }),
          );
          await page.goto(appUrl('/#/explore'), { waitUntil: 'domcontentloaded' });
          const title = locale === 'en-US' ? 'Your map' : 'Tu mapa';
          const search = locale === 'en-US' ? 'Search lines' : 'Buscar líneas';
          await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
          await expect(page.getByRole('searchbox', { name: search })).toBeVisible();
          await expect(page.locator('.your-lines')).toHaveCount(0);
          const dimensions = await page.evaluate(() => ({
            width: document.documentElement.scrollWidth,
            viewport: innerWidth,
          }));
          expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport);
          await testInfo.attach(`empty-map-${locale}-${colorScheme}-${String(width)}.png`, {
            body: await page.screenshot(),
            contentType: 'image/png',
          });
        });
      }
    }
  });
}
