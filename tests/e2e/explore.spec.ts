import { liveLinesResponseSchema, liveVehiclesResponseSchema } from '@moviq/contracts';
import type { Page } from '@playwright/test';

import { appUrl, expect, test } from './support/app.js';
import { resetProviderClock } from './support/provider-control.js';

interface Words {
  readonly title: string;
  readonly search: string;
  readonly add: string;
  readonly remove: string;
  readonly vehicles: string;
  readonly nearby: string;
  readonly noVehicles: string;
  readonly unavailable: string;
  readonly byStation: string;
  readonly stationPosition: string;
  readonly close: string;
  readonly mapView: string;
  readonly views: readonly [string, string];
}

const ENGLISH: Words = {
  title: 'Your map',
  search: 'Search lines',
  add: 'Add',
  remove: 'Remove',
  vehicles: 'View vehicles',
  nearby: 'On the map now',
  noVehicles: 'No vehicles now',
  unavailable: 'Source unavailable',
  byStation: 'By station, no GPS',
  stationPosition: 'Station position:',
  close: 'Close',
  mapView: 'Map view',
  views: ['2D', 'Aerial'],
};
const SPANISH: Words = {
  title: 'Tu mapa',
  search: 'Buscar líneas',
  add: 'Añadir',
  remove: 'Quitar',
  vehicles: 'Ver vehículos',
  nearby: 'En el mapa ahora',
  noVehicles: 'Sin vehículos ahora',
  unavailable: 'Fuente no disponible',
  byStation: 'Por estación, sin GPS',
  stationPosition: 'Posición por estación:',
  close: 'Cerrar',
  mapView: 'Vista del mapa',
  views: ['2D', 'Aérea'],
};

const style = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e8edef' } }],
};

async function startMap(page: Page, words: Words): Promise<void> {
  await page.route('https://tiles.openfreemap.org/styles/*', (route) =>
    route.fulfill({ json: style }),
  );
  await page.goto(appUrl('/#/explore'));
  await expect(page.getByRole('heading', { level: 1, name: words.title })).toBeVisible();
}

/** Search waits for the compact line catalogue and chooses the exact line and network. */
async function addLine(page: Page, words: Words, name: string, network: string): Promise<void> {
  const search = page.getByRole('searchbox', { name: words.search });
  await search.fill(name);
  const add = page.getByRole('button', { name: `${words.add} ${name} · ${network}`, exact: true });
  await expect(add).toBeEnabled({ timeout: 120_000 });
  await add.click();
  await expect(search).toHaveValue('');
  await expect(
    page.getByRole('button', { name: `${words.remove} ${name} · ${network}` }),
  ).toBeVisible();
}

async function openVehicle(
  page: Page,
  words: Words,
  name: string,
  network: string,
  station: boolean,
) {
  const remove = page.getByRole('button', { name: `${words.remove} ${name} · ${network}` });
  const line = page.locator('.your-line').filter({ has: remove });
  await line.getByText(words.vehicles, { exact: true }).click();
  const buttons = line.getByRole('region', { name: words.nearby }).getByRole('button');
  await expect(buttons.first()).toBeVisible({ timeout: 120_000 });
  await buttons.first().click();
  const card = page.getByRole('article');
  await expect(card).toBeVisible();
  if (station) {
    await expect(card).toContainText(words.byStation);
    await expect(card).toContainText(words.stationPosition);
  } else {
    // Bus GPS may be extrapolated along its route after the latest report: either says GPS.
    await expect(card).toContainText('GPS');
    await expect(card.locator('.ex-foot')).toContainText('GPS');
  }
  await card.getByRole('button', { name: words.close }).click();
  await expect(card).toBeHidden();
}

async function checkViews(page: Page, words: Words) {
  const views = page.getByRole('radiogroup', { name: words.mapView });
  const [twoD, aerial] = words.views;
  await expect(views.getByRole('radio')).toHaveCount(2);
  await expect(views.getByRole('radio', { name: twoD })).toHaveAttribute('aria-checked', 'true');
  await views.getByRole('radio', { name: twoD }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(views.getByRole('radio', { name: aerial })).toHaveAttribute('aria-checked', 'true');
  await expect(views.getByRole('radio', { name: aerial })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(views.getByRole('radio', { name: twoD })).toHaveAttribute('aria-checked', 'true');
}

async function checkExplore(page: Page, words: Words) {
  await resetProviderClock();
  await startMap(page, words);
  await expect(page.locator('.your-line')).toHaveCount(0);
  await addLine(page, words, 'A', 'MTA');
  await openVehicle(page, words, 'A', 'MTA', true);
  await page.getByRole('button', { name: `${words.remove} A · MTA` }).click();
  await addLine(page, words, 'Q5', 'MTA Bus');
  await openVehicle(page, words, 'Q5', 'MTA Bus', false);
  await checkViews(page, words);
}

/** Simulate a quiet line or an unavailable source without attributing either to the other. */
async function checkSourceState(page: Page, words: Words, state: 'healthy' | 'unavailable') {
  await page.route('**/api/live/lines', async (route) => {
    const response = await route.fetch();
    const data = liveLinesResponseSchema.parse(await response.json());
    await route.fulfill({
      response,
      json: {
        ...data,
        lines: data.lines.map((line) =>
          line.sourceId === 'mta-subway-ace' && line.lineId === 'A'
            ? { ...line, vehicleCount: 0 }
            : line,
        ),
        sources: data.sources.map((source) =>
          source.provenance.sourceId === 'mta-subway-ace'
            ? { ...source, provenance: { ...source.provenance, state } }
            : source,
        ),
      },
    });
  });
  await page.route('**/api/live/vehicles?*', async (route) => {
    const response = await route.fetch();
    const data = liveVehiclesResponseSchema.parse(await response.json());
    await route.fulfill({ response, json: { ...data, vehicles: [], stations: [] } });
  });
  await startMap(page, words);
  await addLine(page, words, 'A', 'MTA');
  const row = page
    .locator('.your-line')
    .filter({ has: page.getByRole('button', { name: `${words.remove} A · MTA` }) });
  await expect(row).toContainText(state === 'healthy' ? words.noVehicles : words.unavailable);
  if (state === 'unavailable') await expect(row).not.toContainText(words.noVehicles);
}

for (const [locale, words] of [
  ['en-US', ENGLISH],
  ['es-ES', SPANISH],
] as const) {
  test.describe(`Explore in ${locale}`, () => {
    test.use({ locale });
    test('selects lines, identifies positions and changes map views with the keyboard', async ({
      page,
    }) => {
      test.setTimeout(180_000);
      await checkExplore(page, words);
    });
    for (const state of ['healthy', 'unavailable'] as const) {
      test(`distinguishes ${state === 'healthy' ? 'a line with no vehicles' : 'an unavailable source'}`, async ({
        page,
      }) => {
        test.setTimeout(150_000);
        await checkSourceState(page, words, state);
      });
    }
  });
}
