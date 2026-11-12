import { z } from 'zod';

/** Machine-readable codes for API errors. Each one maps to a single HTTP status. */
const apiErrorCodeSchema = z.enum([
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'too_large',
  'rate_limited',
  'unavailable',
  'internal',
]);

/** The body of every error response, so clients need one adapter for all of them. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string().min(1),
    requestId: z.string().min(1),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
