import type { KnownFailure, Licence } from '../../definition.js';

export const MTA_PROVIDER = 'Metropolitan Transportation Authority (MTA)';

/**
 * MTA data may be stored and passed on from our own server, unchanged, and marked when it is more
 * than a minute old; the provenance of every value already carries its age.
 */
export const MTA_LICENCE: Licence = {
  name: 'MTA Developer Terms and Conditions',
  url: 'https://www.mta.info/developers/terms-and-conditions',
  attribution: 'Data from the Metropolitan Transportation Authority (MTA)',
};

export const MTA_FEEDS_URL = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/';

const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const counter = new Intl.NumberFormat('en-US');

/** "1,488 stops": the counts shown to operators as coverage. */
export function count(value: number, noun: string): string {
  return `${counter.format(value)} ${noun}`;
}

/** Failures every MTA download can meet, with the codes the HTTP client gives them. */
export const HTTP_FAILURES: readonly KnownFailure[] = [
  {
    code: 'http-503',
    detection: 'The MTA gateway answers 503 Service Unavailable (500, 502 and 504 alike)',
    state: 'degraded',
    remedy: 'Retry with growing waits; the last good data keeps being served with its age',
  },
  {
    code: 'timeout',
    detection: 'No complete answer within the time limit of the source',
    state: 'degraded',
    remedy: 'Retry with growing waits; the last good data keeps being served with its age',
  },
  {
    code: 'http-403',
    detection: 'The MTA answers 401 or 403, as it does when a feed starts asking for a key',
    state: 'misconfigured',
    remedy: 'No retry loop; an operator checks the MTA developer page for the new access rule',
  },
  {
    code: 'too-large',
    detection: 'The body grows past the byte limit of the source',
    state: 'degraded',
    remedy: 'Refused unread; an operator raises the limit if the MTA feed really grew',
  },
];
