import { Hono } from 'hono';
import { z } from 'zod';

import type { AppBindings } from './context.js';
import { errorBody } from './errors.js';

const reportSchema = z
  .object({
    kind: z.enum(['initialization', 'resource', 'context-lost', 'timeout']),
    message: z.string().min(1).max(300),
    source: z.enum(['base', 'aerial', 'worker', 'unknown']),
  })
  .strict();

/** Accept only bounded, structured diagnostics; never log the incoming request or URL. */
export function mapDiagnosticsRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();
  app.post('/', async (c) => {
    const report = reportSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!report.success) return c.json(errorBody(c, 'bad_request', 'Invalid map diagnostic.'), 400);
    const message = report.data.message
      .replace(/https?:\/\/\S+/gi, '[URL]')
      .replace(/\p{Cc}/gu, ' ');
    c.var.logger.warn('browser map failure', { ...report.data, message });
    return c.body(null, 204);
  });
  return app;
}
