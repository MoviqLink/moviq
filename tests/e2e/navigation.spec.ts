import type { Page } from '@playwright/test';

import { appUrl, expect, test } from './support/app.js';

const walletFixture = {
  demo: true,
  hasMore: false,
  notice: 'Fixture wallet for the billing grid.',
  items: [
    {
      id: '1f26db4d-c822-44be-a5b0-9c31e11c1510',
      product: {
        id: 'path-tapp-40-demo',
        category: 'train',
        name: 'PATH TAPP 40 rides',
        operator: 'PATH',
        description: 'Published PATH TAPP 40-trip fare.',
        price: { amountMinor: 12400, currency: 'USD' },
        rides: 40,
        officialUrl: 'https://www.panynj.gov/path/en/fares.html',
        fareVerifiedAt: '2026-11-11',
      },
      paymentId: 'payment-fixture-1',
      paypalOrderId: 'order-fixture-1',
      paypalCaptureId: 'capture-fixture-1',
      status: 'captured',
      createdAt: '2026-11-11T12:00:00.000Z',
    },
  ],
} as const;

async function enterTraveller(page: Page, lang: 'en' | 'es' = 'en') {
  await page.addInitScript((value) => {
    localStorage.setItem('moviq-lang', value);
    sessionStorage.setItem('moviq-traveller-entry', '1');
  }, lang);
  await page.goto(appUrl('/#/'));
}

async function expectWelcome(page: Page) {
  await expect(page.getByText('Welcome to MovIQ', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Your urban mobility assistant.', level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Talk to Sara' })).toHaveAttribute(
    'href',
    '#/agents',
  );
  await expect(page.getByRole('link', { name: 'See the city live' })).toBeVisible();
}

function contrastRatio(foreground: string, background: string): number {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (color: string) => {
    const values = color.match(/[\d.]+/g)?.map(Number);
    if (values === undefined || values.length < 3) throw new Error(`Unexpected color: ${color}`);
    return (
      0.2126 * channel(values[0] ?? 0) +
      0.7152 * channel(values[1] ?? 0) +
      0.0722 * channel(values[2] ?? 0)
    );
  };
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

for (const theme of ['light', 'dark'] as const) {
  test(`the home menu keeps readable contrast in ${theme} theme`, async ({ page }) => {
    await page.addInitScript((choice) => {
      localStorage.setItem('moviq-lang', 'en');
      localStorage.setItem('moviq-theme', choice);
      sessionStorage.setItem('moviq-traveller-entry', '1');
    }, theme);
    await page.goto(appUrl('/#/'));
    await page.getByRole('button', { name: 'Open menu' }).click();
    const dialog = page.getByRole('dialog', { name: 'Menu' });
    const link = dialog.getByRole('link', { name: 'Live map' });
    const colors = await page.evaluate(() => {
      const menu = document.querySelector<HTMLDialogElement>('.site-menu');
      const anchor = menu?.querySelector('a');
      if (menu === null || anchor === null || anchor === undefined)
        throw new Error('Menu link is missing');
      return {
        foreground: getComputedStyle(anchor).color,
        background: getComputedStyle(menu).backgroundColor,
      };
    });
    await expect(link).toBeVisible();
    expect(contrastRatio(colors.foreground, colors.background)).toBeGreaterThanOrEqual(4.5);
  });
}

test('the seven-item menu supports keyboard dismissal and excludes legacy role entries', async ({
  page,
}) => {
  await enterTraveller(page);
  const opener = page.getByRole('button', { name: 'Open menu' });
  await opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Menu' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('link')).toHaveText([
    'Home',
    'Dashboard',
    'Agent',
    'Live map',
    'Traffic',
    'Incidents',
    'Stations and lines',
  ]);
  const destinations = [
    '#/',
    '#/dashboard',
    '#/agents',
    '#/explore',
    '#/explore?view=traffic',
    '#/explore?view=incidents',
    '#/explore?view=stations',
  ];
  for (const [index, destination] of destinations.entries()) {
    await expect(dialog.getByRole('link').nth(index)).toHaveAttribute('href', destination);
  }
  await expect(dialog.getByRole('link', { name: 'Business', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('link', { name: 'Credits', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
  await opener.click();
  await dialog.getByRole('link', { name: 'Incidents' }).click();
  await expect(page).toHaveURL(/#\/explore\?view=incidents$/);
  await expect(page.locator('#explore-incidents')).toBeFocused({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Incidents', level: 1 })).toBeVisible();
});

test('the Spanish menu has the same seven destinations', async ({ page }) => {
  await enterTraveller(page, 'es');
  await page.getByRole('button', { name: 'Abrir menú' }).click();
  const dialog = page.getByRole('dialog', { name: 'Menú' });
  await expect(dialog.getByRole('link')).toHaveText([
    'Inicio',
    'Panel',
    'Agente',
    'Mapa en vivo',
    'Tráfico',
    'Incidencias',
    'Estaciones y líneas',
  ]);
  await expect(dialog.getByRole('link', { name: 'Empresa', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('link', { name: 'Créditos', exact: true })).toHaveCount(0);
});

test('traveller login changes home in place and persists the welcome on reload', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    localStorage.setItem('moviq-lang', 'en');
    sessionStorage.setItem('moviq-intro-seen', '1');
  });
  await page.route('**/api/tickets/demo/status', async (route) => {
    await route.fulfill({ json: { enabled: true } });
  });
  await page.route('**/api/tickets/demo/traveller', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.fulfill({ json: { demo: true } });
  });

  await page.goto(appUrl('/#/'));
  await expect(page.getByRole('heading', { name: 'Choose how to enter' })).toBeVisible();
  await page.getByRole('button', { name: 'Traveller', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your demo access' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip animation' }).click();
  await expect(page.getByRole('status')).toContainText('Signed in');
  await expect(page).toHaveURL(/#\/$/);
  await expectWelcome(page);

  await page.reload();
  await expect(page).toHaveURL(/#\/$/);
  await expectWelcome(page);
});

test('dashboard tabs, the payments grid and the overview survive browser history', async ({
  page,
}) => {
  await enterTraveller(page);
  await page.route('**/api/tickets/wallet', async (route) => {
    await route.fulfill({ json: walletFixture });
  });
  await page.getByRole('button', { name: 'Open menu' }).click();
  const menu = page.getByRole('dialog', { name: 'Menu' });
  await menu.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page).toHaveURL(/#\/dashboard$/);
  await expect(page.locator('main.traveller-dashboard')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your AI urban assistant' })).toBeVisible();
  for (const heading of ['Where you stand', 'Your trip wallet', 'Recent trips', 'My tickets']) {
    await expect(page.getByRole('heading', { name: heading, level: 2 })).toBeVisible();
  }
  await expect(page.getByText('AT A GLANCE', { exact: true })).toBeVisible();
  for (const gone of ['My rewards', 'Take a virtual ride', 'Activate tourist mode']) {
    await expect(page.getByRole('link', { name: gone })).toHaveCount(0);
  }
  await expect(page.getByRole('link', { name: /^(Browse|Buy) tickets$/ })).toHaveCount(0);

  const sections = page.getByRole('navigation', { name: 'Dashboard sections' });
  await expect(sections.getByRole('link')).toHaveText([
    'Overview',
    'Wallet',
    'My tickets',
    'Payments',
    'Refunds',
    'My trips',
    'Calendar',
  ]);
  await sections.getByRole('link', { name: 'Payments' }).click();
  await expect(page).toHaveURL(/#\/dashboard\?section=payments$/);
  await expect(page.getByRole('heading', { name: 'Payments', level: 1 })).toBeVisible();
  const payments = page.getByRole('region', { name: 'Payments' });
  await expect(payments.locator('.ag-root-wrapper')).toBeVisible();
  await expect(payments.locator('.ag-header-cell-text')).toHaveText([
    'Date',
    'Concept',
    'Type',
    'Method',
    'Amount',
    'Status',
    'PayPal order',
  ]);
  const ticketRow = payments.getByRole('row', { name: /PATH TAPP 40 rides/ });
  await expect(ticketRow).toContainText('Ticket');
  await expect(ticketRow).toContainText('Paid');
  await expect(ticketRow).toContainText('$124.00');
  await expect(ticketRow).toContainText('order-fixture-1');

  await sections.getByRole('link', { name: 'My trips' }).click();
  await expect(page).toHaveURL(/#\/dashboard\?section=trips$/);
  await expect(page.getByRole('heading', { name: 'My trips', level: 1 })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#\/dashboard\?section=payments$/);
  await page.goForward();
  await expect(page).toHaveURL(/#\/dashboard\?section=trips$/);
  await sections.getByRole('link', { name: 'My tickets' }).click();
  await expect(page).toHaveURL(/#\/dashboard\?section=purchases$/);
  await expect(sections.getByRole('link', { name: 'My tickets' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.goto(appUrl('/#/dashboard'));
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Home' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expectWelcome(page);
  await page.reload();
  await expect(page).toHaveURL(/#\/$/);
  await expectWelcome(page);
});
