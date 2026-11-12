import { appUrl, expect, test } from './support/app.js';

test('Sara’s conversation, a suggestion, clearing the chat and a line watch', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('moviq-lang', 'en');
  });
  await page.goto(appUrl('/#/agents'));
  await expect(page.getByRole('heading', { name: 'Sara', exact: true })).toBeVisible();
  await expect(page.getByLabel('Agent name')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create agent' })).toHaveCount(0);
  const thread = page.getByLabel('Conversation', { exact: true });
  await expect(thread).toContainText('Hi, I am Sara.');
  await expect(page.getByText('Let Sara buy tickets for me with PayPal')).toBeVisible();

  await page.getByLabel('Message', { exact: true }).fill('Hello from Sara');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(thread.getByText('Hello from Sara')).toBeVisible();

  const suggestion = 'Are there delays on the 4 line right now?';
  await page
    .getByRole('group', { name: 'Try asking' })
    .getByRole('button', { name: suggestion, exact: true })
    .click();
  await expect(thread.getByText(suggestion, { exact: true })).toBeVisible({ timeout: 30_000 });

  const clear = page.getByRole('button', { name: 'Clear chat', exact: true });
  await expect(clear).toBeEnabled({ timeout: 30_000 });
  await clear.click();
  await expect(thread.getByText('Hello from Sara')).toHaveCount(0);
  await expect(thread.getByText(suggestion, { exact: true })).toHaveCount(0);
  await expect(thread).toContainText('Hi, I am Sara.');

  const watches = page.getByRole('region', { name: 'Sara watches for you' });
  await expect(watches.getByRole('button', { name: 'A line', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await watches.getByLabel('Line, for example 7, M15 or PATH').fill('7');
  await watches.getByRole('button', { name: 'Watch line', exact: true }).click();
  const card = watches.locator('.agents-watch-list li.agents-watch');
  await expect(card).toHaveCount(1);
  await expect(card.getByRole('heading', { name: 'Line 7' })).toBeVisible();
  await expect(card.locator('.agents-badge.is-subway.is-purple')).toHaveText('7');
  await expect(watches.getByRole('button', { name: 'The 7 is already watched' })).toBeDisabled();
  await card.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(card.getByText('Paused', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(card).toHaveCount(0);
  await expect(watches.getByRole('button', { name: 'Watch the 7' })).toBeEnabled();
});

test('the street watch submits the segment chosen on its card and the threshold', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('moviq-lang', 'en');
  });
  await page.route('**/api/agents/roads?*', async (route) => {
    await route.fulfill({
      json: {
        available: true,
        source: {
          sourceId: 'nyc-dot-traffic-speeds',
          title: 'New York traffic speeds',
          dataTime: '2026-01-01T00:00:00.000Z',
          ageSeconds: 0,
          state: 'healthy',
        },
        segments: [
          {
            id: 'segment-1',
            name: 'Broadway',
            borough: 'Manhattan',
            measuredAt: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 'segment-2',
            name: 'Broadway north',
            borough: 'Manhattan',
            measuredAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    });
  });
  let sent: unknown;
  await page.route('**/api/agents/*/watches', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    sent = route.request().postDataJSON();
    await route.fulfill({
      status: 400,
      json: { error: { code: 'bad_request', message: 'Test refusal', requestId: 'test' } },
    });
  });
  await page.goto(appUrl('/#/agents'));
  const watches = page.getByRole('region', { name: 'Sara watches for you' });
  await watches.getByRole('button', { name: 'A street', exact: true }).click();
  await watches.getByLabel('Find a measured street or road').fill('Broadway');
  await watches.getByRole('button', { name: 'Find segments' }).click();
  const segments = watches.getByRole('group', { name: 'Measured segment' });
  await expect(segments.getByRole('radio')).toHaveCount(2);
  await expect(watches.getByText('2 measured segments')).toBeVisible();
  await segments.getByRole('radio', { name: /^Broadway Manhattan/ }).check();
  await expect(segments.getByRole('radio', { name: /^Broadway Manhattan/ })).toBeChecked();
  await watches.getByLabel('Notify above this speed (km/h)').fill('35');
  await watches.getByRole('button', { name: 'Save street task' }).click();
  await expect(watches.getByRole('alert').first()).toBeVisible();
  expect(sent).toEqual({
    line: 'Broadway',
    kind: 'street',
    segmentId: 'segment-1',
    thresholdKmh: 35,
  });
});
