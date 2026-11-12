import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import type { AppBindings } from './context.js';
import { errorBody } from './errors.js';

/**
 * Refuses request bodies over `maxSize` bytes with a 413 in the shape of every API error. It
 * checks the declared length first and counts the bytes of streamed bodies as they arrive, so a
 * large body is never read in full.
 */
export function limitBody(maxSize: number): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const { requestId } = c.var;
    const limit = bodyLimit({
      maxSize,
      onError: (inner) =>
        inner.json(
          errorBody({ var: { requestId } }, 'too_large', 'This request is larger than we accept.'),
          413,
        ),
    });
    return limit(c, next);
  };
}
