import type { KnownFailure } from '../../definition.js';

/** What the data.ny.gov portal does when it fails, with the codes the HTTP client gives. */
export const PORTAL_FAILURES: readonly KnownFailure[] = [
  {
    code: 'http-503',
    detection: 'The portal answers 500, 502, 503 or 504',
    state: 'degraded',
    remedy: 'The served list stays; the next daily run tries again',
  },
  {
    code: 'timeout',
    detection: 'No complete answer within the time limit of the source',
    state: 'degraded',
    remedy: 'The served list stays; the next daily run tries again',
  },
];
