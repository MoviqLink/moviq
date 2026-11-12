import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

// The web never talks to a data provider: every request goes to our own API, proxied in development.
export default defineConfig({
  plugins: [react()],
  // Read @moviq/contracts from its sources, as TypeScript and the tests do.
  resolve: { conditions: ['moviq-source', ...defaultClientConditions] },
  // AG Grid with only the modules in use is about 0.9 MB minified; past 1.2 MB something grew.
  build: { chunkSizeWarningLimit: 1200 },
  server: {
    host: '127.0.0.1',
    port: 5190,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:8080' } },
  },
});
