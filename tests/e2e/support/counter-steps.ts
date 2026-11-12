import { createHash } from 'node:crypto';

import type { Page } from '@playwright/test';

import { expect } from './app.js';
import type { LedgerOrder } from './merchants.js';

/** What the counter's panel got from the server: the status and the body, as sent. */
interface Answered {
  readonly status: number;
  readonly body: unknown;
}

/**
 * The `custom_id` MovIQ sends with a refund of a hold: the SHA-256, in hex, of its
 * `PayPal-Request-Id`, `<hold>:refund:<operation>` (`holdRefundReference` in the server).
 */
export const refundReference = (holdId: string, operation: string): string =>
  createHash('sha256').update(`${holdId}:refund:${operation}`).digest('hex');

/** The counter's panel, by its own navigation. */
export async function openSection(desk: Page, name: 'Tickets' | 'Scan'): Promise<void> {
  await desk
    .getByRole('navigation', { name: 'Merchant panel' })
    .getByRole('link', { name, exact: true })
    .click();
}

/** The merchant moves the ticket one step in the kitchen, and the panel says so. */
export async function moveTicket(
  desk: Page,
  code: string,
  step: 'Start' | 'Mark ready',
): Promise<void> {
  await desk.getByRole('button', { name: `${step} · ${code}` }).click();
  const status = step === 'Start' ? 'preparing' : 'ready';
  await expect(
    desk.getByRole('status').filter({ hasText: `Order ${code} is now ${status}.` }),
  ).toBeVisible();
}

/** The server's answer to the request the panel makes on `path` when `act` runs. */
async function answerTo(desk: Page, path: string, act: () => Promise<void>): Promise<Answered> {
  const answered = desk.waitForResponse((r) => new URL(r.url()).pathname === path);
  await act();
  const response = await answered;
  const body: unknown = await response.json();
  return { status: response.status(), body };
}

/** The code pasted at the counter and sent; returns the server's answer as the panel got it. */
export async function scan(desk: Page, qr: string): Promise<Answered> {
  await desk.getByRole('textbox', { name: 'Pickup code' }).fill(qr);
  return answerTo(desk, '/api/merchant/scan', () =>
    desk.getByRole('button', { name: 'Charge and hand over' }).click(),
  );
}

/**
 * On Scan, "Something missing?": the collected order, one of its lines marked and refunded;
 * returns the server's answer as the panel got it.
 */
export async function refundLine(desk: Page, order: LedgerOrder, line: number): Promise<Answered> {
  await desk.getByLabel('Collected order').selectOption(order.id);
  await desk.getByRole('group', { name: 'Missing lines' }).getByRole('checkbox').nth(line).check();
  return answerTo(desk, `/api/merchant/orders/${order.id}/refunds`, () =>
    desk.getByRole('button', { name: 'Refund the lines' }).click(),
  );
}
