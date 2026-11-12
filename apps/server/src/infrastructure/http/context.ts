import { randomUUID } from 'node:crypto';

import type { MiddlewareHandler } from 'hono';

import type { Logger } from '../telemetry/logger.js';

/** Values every request handler can read from the Hono context. */
interface RequestVariables {
  readonly requestId: string;
  readonly logger: Logger;
}

export interface AppBindings {
  Variables: RequestVariables;
}

const REQUEST_ID_HEADER = 'x-request-id';
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Gives each request an id (reusing a well-formed incoming one), a logger bound to it, and one
 * log line when it ends. Only the path is logged: query strings may carry personal data.
 */
export function requestContext(logger: Logger): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const incoming = c.req.header(REQUEST_ID_HEADER);
    const requestId =
      incoming !== undefined && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    const requestLogger = logger.child({ requestId });
    c.set('requestId', requestId);
    c.set('logger', requestLogger);
    const started = performance.now();
    await next();
    c.header(REQUEST_ID_HEADER, requestId);
    requestLogger.info('request', {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Math.round(performance.now() - started),
    });
  };
}
