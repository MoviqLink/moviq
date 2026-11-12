import type { Page } from '@playwright/test';
import {
  jobListSchema,
  opsSummarySchema,
  sourceDetailSchema,
  sourceListSchema,
} from '@moviq/contracts';

import { appUrl, expect, test } from './support/app.js';
import { E2E_ADMIN_TOKEN, E2E_VIEWER_TOKEN } from './support/tokens.js';

const SOURCE = 'faa-airport-status';
const REASON = 'end-to-end check';

async function signIn(page: Page, token: string): Promise<void> {
  await page.goto(`${appUrl()}/#/ops`);
  await page.getByLabel('Operations token').fill(token);
  await page.getByRole('button', { name: 'Open session' }).click();
  await expect(page.getByRole('heading', { name: 'Summary', level: 1 })).toBeVisible();
}

async function api<T>(
  page: Page,
  path: string,
  schema: { parse: (value: unknown) => T },
): Promise<T> {
  const response = await page.request.get(`${appUrl()}${path}`);
  expect(response.status()).toBe(200);
  return schema.parse(await response.json());
}

test('an operator watches every source and refreshes one, which the worker carries out', async ({
  page,
}) => {
  // On a fresh start the worker reads once every source it can run, the timetables one at a time.
  test.setTimeout(240_000);
  await signIn(page, E2E_ADMIN_TOKEN);
  await expect
    .poll(
      async () => {
        const { sources } = await api(page, '/api/ops/sources', sourceListSchema);
        const runnable = sources.filter((row) => row.nextRunReason !== 'never');
        return runnable.length > 0 && runnable.every((row) => row.lastAttemptAt !== null);
      },
      { timeout: 180_000 },
    )
    .toBe(true);
  // A source whose credential this deployment lacks is never run, and says what it needs.
  const { sources } = await api(page, '/api/ops/sources', sourceListSchema);
  for (const row of sources.filter((candidate) => candidate.nextRunReason === 'never')) {
    expect(row).toMatchObject({ state: 'misconfigured', lastAttemptAt: null });
    expect(row.evidence).toMatch(/^Needs [A-Z_, ]+, which (is|are) not set\.$/);
  }

  await page.goto(`${appUrl()}/#/ops/sources`);
  await expect(page.getByRole('treegrid').or(page.getByRole('grid')).first()).toBeVisible();

  await page.goto(`${appUrl()}/#/ops/sources/${SOURCE}`);
  await page.getByRole('button', { name: 'Refresh now' }).click();
  await page.getByLabel('Reason').fill(REASON);
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'created' })).toBeVisible();

  await expect
    .poll(async () => (await api(page, '/api/ops/jobs', jobListSchema)).jobs[0]?.state, {
      timeout: 30_000,
    })
    .toBe('done');
  const detail = await api(page, `/api/ops/sources/${SOURCE}`, sourceDetailSchema);
  expect(detail.runs[0]).toMatchObject({ trigger: 'manual', reason: REASON });

  await page.goto(`${appUrl()}/#/ops/audit`);
  await expect(page.getByText(REASON).first()).toBeVisible();
});

test('the worker holds the lease and the hosting probe beats', async ({ page }) => {
  await signIn(page, E2E_VIEWER_TOKEN);
  await expect
    .poll(async () => (await api(page, '/api/ops/summary', opsSummarySchema)).worker.beatsLast24h, {
      timeout: 20_000,
    })
    .toBeGreaterThan(1);
  const summary = await api(page, '/api/ops/summary', opsSummarySchema);
  expect(summary.worker.leader?.fencingToken).toBeGreaterThan(0);
});

test('a viewer can look but not act, on screen and on the server', async ({ page }) => {
  await signIn(page, E2E_VIEWER_TOKEN);
  await page.goto(`${appUrl()}/#/ops/sources/${SOURCE}`);
  await expect(page.getByRole('button', { name: 'Refresh now' })).toBeDisabled();
  await expect(page.getByText('Your role is viewer')).toBeVisible();
  const refused = await page.request.post(`${appUrl()}/api/ops/sources/${SOURCE}/refresh`, {
    data: { reason: 'just looking' },
  });
  expect(refused.status()).toBe(403);
});
