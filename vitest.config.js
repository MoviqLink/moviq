import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const contractsSource = fileURLToPath(new URL('packages/contracts/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '@moviq/contracts': contractsSource },
  },
  test: {
    include: [
      'packages/*/tests/**/*.test.ts',
      'apps/*/tests/**/*.test.ts',
      'tools/tests/**/*.test.ts',
    ],
    // Live tests need network and real keys: they run only with `npm run verify:live`.
    exclude: ['**/node_modules/**', '**/*.live.test.ts'],
    environment: 'node',
    restoreMocks: true,
    testTimeout: 15_000,
  },
});
