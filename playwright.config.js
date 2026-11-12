import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end journeys against the real API and worker, fed with captures of real responses. The
 * PayPal journey runs apart, with `npm run e2e:paypal` (`tests/e2e/paypal.config.js`).
 */
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '*.spec.ts',
  testIgnore: [
    'paypal.spec.ts',
    'ticket-demo.spec.ts',
    'tickets-paypal.spec.ts',
    'virtual-paypal.spec.ts',
  ],
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  reporter: [['list']],
  globalSetup: './tests/e2e/support/global-setup.ts',
  use: { trace: 'retain-on-failure', locale: 'en-US', timezoneId: 'America/New_York' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
