import { ticketDemoStatusSchema } from '@moviq/contracts';

import { appUrl, expect, test } from './support/app.js';

test('ticket demo stays off by default and the entry page has no old Sara form or doors', async ({
  page,
}) => {
  const status = await page.request.get(appUrl('/api/tickets/demo/status'));
  expect(ticketDemoStatusSchema.parse(await status.json())).toEqual({ enabled: false });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(appUrl('/#/'));
  await expect(page.locator('.intro')).toHaveCount(0);
  await page.getByRole('button', { name: 'Español', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Elige cómo quieres entrar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Usuario', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Empresa', exact: true })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'Mensaje para Sara' })).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: '¿Adónde tienes que llegar, y a qué hora?' }),
  ).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'También en MovIQ' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Cómo funciona' })).toBeVisible();

  await page.getByRole('link', { name: 'Cómo funciona' }).click();
  await expect(page).toHaveURL(/#\/how-it-works$/);
  await expect(
    page.getByRole('heading', { name: 'Sara es tu asistente de movilidad urbana con IA.' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lo que Sara hace por ti' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Empezar' })).toHaveAttribute('href', '#/agents');
  await expect(page.getByRole('textbox', { name: 'Mensaje para Sara' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Recompensas en tu ruta' })).toHaveCount(0);
});
