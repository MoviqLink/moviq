import type { BrowserContext, Page, TestInfo } from '@playwright/test';

import { expect } from './app.js';
import type { SandboxBuyer } from './paypal-sandbox.js';

/**
 * PayPal's sign-in and review pages, by the ids and test ids PayPal gives their parts: they are
 * the same in every language, and the review page speaks the buyer's.
 */
const SIGN_IN = {
  email: '#email',
  next: '#btnNext',
  password: '#password',
  logIn: '#btnLogin',
} as const;
const REVIEW = { card: /^CC-.+-funding-option$/, pay: 'submit-button-initial' } as const;
/**
 * The buyer's card, by its brand alone, as PayPal titles its row in every language. Anchored: the
 * balance's row may also name the card, as the fallback when the balance does not cover it.
 */
const CARD_BRAND = /^Visa$/;
/** How long a page of PayPal's may take to show what the buyer acts on. */
const SHOWS_WITHIN_MS = 30_000;

/** Approving or cancelling ends with PayPal closing its window and the SDK telling the page. */
const CLOSES_WITHIN_MS = 60_000;

/** Presses PayPal's official button and returns the approval window it opens. */
export async function openPayPal(page: Page): Promise<Page> {
  const button = page.locator('paypal-button');
  await expect(button).toBeVisible({ timeout: 30_000 });
  const opened = page.waitForEvent('popup');
  await button.click();
  return opened;
}

/** The sandbox buyer signs in, with the email first and the password on the same or next page. */
async function signIn(popup: Page, buyer: SandboxBuyer): Promise<void> {
  await popup.locator(SIGN_IN.email).fill(buyer.email);
  const password = popup.locator(SIGN_IN.password);
  const next = popup.locator(SIGN_IN.next);
  await expect(password.or(next).first()).toBeVisible();
  if (await next.isVisible()) await next.click();
  await password.fill(buyer.password);
  await popup.locator(SIGN_IN.logIn).click();
}

/**
 * Chooses the buyer's card on the review page. PayPal draws its own circle over each radio and
 * listens on the row, so a click on the hidden input may not choose it: the row is pressed by the
 * card's brand, and the radio must then read as checked.
 */
async function chooseCard(popup: Page): Promise<void> {
  const card = popup.getByTestId(REVIEW.card).first();
  await expect(card).toBeAttached({ timeout: SHOWS_WITHIN_MS });
  if (!(await card.isChecked())) await popup.getByText(CARD_BRAND).first().click();
  await expect(card).toBeChecked();
}

/**
 * Signs in and pays with the buyer's card (a sandbox balance may not cover a taxi), then waits
 * for PayPal to close its window.
 */
export async function approveAsBuyer(popup: Page, buyer: SandboxBuyer): Promise<void> {
  await signIn(popup, buyer);
  await chooseCard(popup);
  const closed = popup.waitForEvent('close', { timeout: CLOSES_WITHIN_MS });
  await popup.getByTestId(REVIEW.pay).click();
  await closed;
}

/**
 * The buyer closes PayPal's window on its first page, before signing in: that page offers no other
 * way back, and the SDK tells MovIQ's page that the buyer left.
 */
export async function cancelInPayPal(popup: Page): Promise<void> {
  await expect(popup.locator(SIGN_IN.email)).toBeVisible({ timeout: SHOWS_WITHIN_MS });
  await popup.close({ runBeforeUnload: true });
}

/**
 * The controls of a page as selectors see them: tag, type, id, test id, accessible label and the
 * start of their text, never their values. The buyer's email is masked.
 */
async function describeControls(page: Page, buyer: SandboxBuyer): Promise<string> {
  const rows = await page
    .locator('input, button, label, [role="radio"], [data-testid]')
    .evaluateAll((elements) =>
      elements.map((element) =>
        [
          element.tagName.toLowerCase(),
          element.getAttribute('type'),
          element.id,
          element.getAttribute('data-testid'),
          element.getAttribute('aria-label'),
          element.textContent.trim().slice(0, 40),
        ].join(' | '),
      ),
    );
  return rows.join('\n').replaceAll(buyer.email, '[buyer]');
}

/**
 * Screenshots of every page still open, MovIQ's and PayPal's, for the report of a failed test.
 * Every field and any text with the buyer's email are masked, so no credential reaches a file.
 * `name` tells apart the pages of each browser context of a test (the traveller's, the counter's).
 */
export async function photographPages(
  context: BrowserContext,
  testInfo: TestInfo,
  buyer: SandboxBuyer,
  name = 'page',
): Promise<void> {
  for (const [index, page] of context.pages().entries()) {
    if (page.isClosed()) continue;
    const path = testInfo.outputPath(`${name}-${String(index)}.png`);
    await page.screenshot({ path, mask: [page.locator('input'), page.getByText(buyer.email)] });
    await testInfo.attach(`${name} ${String(index)}`, { path, contentType: 'image/png' });
    await testInfo.attach(`controls of ${name} ${String(index)}`, {
      body: await describeControls(page, buyer),
      contentType: 'text/plain',
    });
  }
}
