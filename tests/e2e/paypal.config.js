import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';

import journeys from '../../playwright.config.js';

/** The sandbox keys and the test buyer come from `.env`, as for `npm run verify:live`. */
const ENV_FILE = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

/**
 * `npm run e2e:paypal`: the paid alternative and a reward on the way, approved by the sandbox
 * buyer in PayPal's own window, then cancelled, or collected at the counter and charged. It needs
 * the network and the keys of `.env`, so it is not part of `npm run e2e`.
 * PayPal's window is not traced: a trace would keep what is typed in it.
 */
export default defineConfig({
  ...journeys,
  testDir: '.',
  testMatch: ['paypal.spec.ts', 'rewards.spec.ts', 'pickup.spec.ts', 'virtual-paypal.spec.ts'],
  testIgnore: [],
  globalSetup: './support/paypal-setup.ts',
  outputDir: '../../test-results/paypal',
  use: { ...journeys.use, trace: 'off', screenshot: 'off', video: 'off' },
});
