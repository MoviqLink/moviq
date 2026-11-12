import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { serveStatic } from '@hono/node-server/serve-static';
import type { MiddlewareHandler } from 'hono';

import type { AppBindings } from './context.js';

/**
 * Serves the built web from the same origin as the API. Hashed assets are cached for a year;
 * `index.html` is always revalidated, so a new release reaches people on their next visit.
 * Returns undefined when there is no build (local development serves the web with Vite).
 */
export function webApp(root: string): MiddlewareHandler<AppBindings> | undefined {
  if (!existsSync(join(root, 'index.html'))) return undefined;
  const serve = serveStatic<AppBindings>({ root });
  return async (c, next) => {
    const response = await serve(c, next);
    if (response instanceof Response && response.ok) {
      const hashed = c.req.path.startsWith('/assets/');
      response.headers.set(
        'Cache-Control',
        hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    }
    return response;
  };
}
