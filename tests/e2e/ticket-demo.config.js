import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';

import journeys from '../../playwright.config.js';

/** Only this isolated suite opts the server into ticket demos; the option still requires Sandbox. */
const ENV_FILE = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

export default defineConfig({
  ...journeys,
  testDir: '.',
  testMatch: ['ticket-demo.spec.ts', 'tickets-paypal.spec.ts'],
  testIgnore: [],
  globalSetup: './support/ticket-demo-setup.ts',
  outputDir: '../../test-results/ticket-demo',
  use: { ...journeys.use, trace: 'off', screenshot: 'off', video: 'off' },
});
