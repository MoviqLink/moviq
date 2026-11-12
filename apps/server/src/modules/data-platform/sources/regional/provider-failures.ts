import type { KnownFailure } from '../../definition.js';
import { HTTP_FAILURES } from '../mta/provider.js';
import { REALTIME_FAILURES } from '../mta/realtime-feed.js';

const RETRY = 'Retry with growing waits; the last good data keeps being served with its age';

/**
 * The HTTP failures any provider can meet, with the codes the HTTP client gives them and the
 * page where an operator checks a new access rule.
 */
export function httpFailures(provider: string, accessPage: string): readonly KnownFailure[] {
  return [
    {
      code: 'http-503',
      detection: `${provider} answers 503 Service Unavailable (500, 502 and 504 alike)`,
      state: 'degraded',
      remedy: RETRY,
    },
    {
      code: 'timeout',
      detection: 'No complete answer within the time limit of the source',
      state: 'degraded',
      remedy: RETRY,
    },
    {
      code: 'http-403',
      detection: `${provider} answers 401 or 403, as when a feed starts asking for a key`,
      state: 'misconfigured',
      remedy: `No retry loop; an operator checks ${accessPage} for the new access rule`,
    },
    {
      code: 'too-large',
      detection: 'The body grows past the byte limit of the source',
      state: 'degraded',
      remedy: 'Refused unread; an operator raises the limit if the feed really grew',
    },
  ];
}

const httpCodes = new Set(HTTP_FAILURES.map((failure) => failure.code));

/** The GTFS Realtime failures of `mta/realtime-feed.ts` that do not depend on the provider. */
export const GTFS_REALTIME_FAILURES: readonly KnownFailure[] = REALTIME_FAILURES.filter(
  (failure) => !httpCodes.has(failure.code),
);
