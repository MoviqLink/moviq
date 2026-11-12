import type { ApiError } from '@moviq/contracts';
import type { ErrorHandler, NotFoundHandler } from 'hono';

import type { AppBindings } from './context.js';

export const notFound: NotFoundHandler<AppBindings> = (c) =>
  c.json(errorBody(c, 'not_found', 'Nothing here matches this address.'), 404);

/** Unexpected failures: the full error goes to the log, the client gets a stable, plain answer. */
export const unexpectedError: ErrorHandler<AppBindings> = (error, c) => {
  c.var.logger.error('unhandled error', { error });
  return c.json(
    errorBody(c, 'internal', 'Something went wrong on our side. Please try again in a moment.'),
    500,
  );
};

export function errorBody(
  c: { readonly var: { readonly requestId: string } },
  code: ApiError['error']['code'],
  message: string,
): ApiError {
  return { error: { code, message, requestId: c.var.requestId } };
}
