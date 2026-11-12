import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const contractsSource = fileURLToPath(new URL('packages/contracts/src/index.ts', import.meta.url));

/** `npm run verify:live`: real providers, real keys. Not part of `verify`, which needs neither. */
export default defineConfig({
  resolve: { alias: { '@moviq/contracts': contractsSource } },
  test: {
    include: ['apps/server/tests/live/**/*.live.test.ts'],
    environment: 'node',
    fileParallelism: false,
    maxConcurrency: 1,
  },
});
